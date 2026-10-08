from __future__ import annotations

import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import fitz
from PIL import Image, ImageChops, ImageDraw, ImageFont

from print_agent import (
    AgentConfig,
    calculate_fit_rectangle,
    configure_devmode,
    create_printer_dc,
    devmode_matches_job,
    is_https_origin,
    print_job,
    printer_is_available,
    rasterize_pdf_page,
    send_heartbeat,
    validate_print_settings,
    validate_document,
    validate_startup,
)


class PrintAgentTests(unittest.TestCase):
    def test_backend_address_must_be_an_https_origin(self) -> None:
        self.assertTrue(is_https_origin("https://print.example.test"))
        self.assertFalse(is_https_origin("http://print.example.test"))
        self.assertFalse(is_https_origin("https://print.example.test/path"))
        self.assertFalse(is_https_origin("https://user:pass@print.example.test"))

    def test_environment_configuration_records_invalid_url_and_missing_printer(self) -> None:
        with patch.dict("os.environ", {
            "PRINT_AGENT_BASE_URL": "http://print.example.test/path",
            "PRINTER_SECRET": "secret",
        }, clear=True):
            config = AgentConfig.from_environment()

        self.assertIn("base_url_must_be_https_origin", config.configuration_errors)
        self.assertIn("printer_id_missing_or_invalid", config.configuration_errors)
        self.assertIn("runner_id_missing_or_invalid", config.configuration_errors)
        self.assertIn("printer_name_missing_or_invalid", config.configuration_errors)

    def test_missing_local_prerequisite_reports_unavailable_heartbeat(self) -> None:
        class FakeApi:
            def __init__(self) -> None:
                self.body = None

            def json(self, _path: str, body: dict[str, object]):
                self.body = body
                return {}

        api = FakeApi()
        config = AgentConfig("https://example.test", "secret", "printer", "runner", "Office")

        is_available = send_heartbeat(api, config, False)

        self.assertFalse(is_available)
        self.assertEqual(api.body["health"], "unavailable")
        self.assertEqual(api.body["settings_protocol"], 3)

    def test_api_requests_include_cloudflare_compatible_user_agent(self) -> None:
        class FakeResponse:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit: int) -> bytes:
                return b"{}"

        config = AgentConfig("https://example.test", "secret", "printer", "runner", "Office")
        with patch("urllib.request.urlopen", return_value=FakeResponse()) as urlopen:
            from print_agent import PrintApi

            PrintApi(config).request("/api/printer/heartbeat", {})

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), "TopkapiPrintAgent/1.0")

    def test_pdf_page_count_is_read_from_the_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "source.pdf"
            target = Path(temporary_directory) / "ready.pdf"
            import fitz

            document = fitz.open()
            document.new_page()
            document.new_page()
            document.save(source)
            document.close()

            page_count = validate_document(source, "application/pdf", target)

        self.assertEqual(page_count, 2)

    def test_png_is_converted_to_a_single_page_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "source.png"
            target = Path(temporary_directory) / "ready.pdf"
            Image.new("RGB", (200, 100), "white").save(source)

            page_count = validate_document(source, "image/png", target)

            self.assertEqual(page_count, 1)
            self.assertTrue(target.is_file())
            import fitz

            with fitz.open(target) as document:
                self.assertAlmostEqual(document[0].rect.width, 595.2756, places=2)
                self.assertAlmostEqual(document[0].rect.height, 841.8898, places=2)

    def test_jpeg_conversion_uses_selected_a3_page_size(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "source.jpg"
            target = Path(temporary_directory) / "ready.pdf"
            Image.new("RGB", (200, 100), "white").save(source)

            page_count = validate_document(source, "image/jpeg", target, "A3")

            self.assertEqual(page_count, 1)
            import fitz

            with fitz.open(target) as document:
                self.assertAlmostEqual(document[0].rect.width, 841.8898, places=2)
                self.assertAlmostEqual(document[0].rect.height, 1190.5512, places=2)

    def test_jpeg_conversion_uses_a3_landscape_page_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "source.jpg"
            target = Path(temporary_directory) / "ready.pdf"
            Image.new("RGB", (100, 200), "blue").save(source)

            validate_document(source, "image/jpeg", target, "A3", "landscape")

            import fitz

            with fitz.open(target) as document:
                self.assertAlmostEqual(document[0].rect.width, 1190.5512, places=2)
                self.assertAlmostEqual(document[0].rect.height, 841.8898, places=2)
                self.assertEqual(document[0].rotation, 0)
                pixmap = document[0].get_pixmap()
                page_image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
                content_bounds = ImageChops.difference(page_image,
                    Image.new("RGB", page_image.size, "white")).getbbox()
                self.assertIsNotNone(content_bounds)
                left, top, right, bottom = content_bounds
                self.assertEqual(top, 0)
                self.assertGreater(left, 0)
                self.assertLess(right, page_image.width)
                self.assertEqual(bottom, page_image.height)
                self.assertAlmostEqual((right - left) / (bottom - top), 0.5, delta=0.02)

    def test_pdf_pages_are_normalized_to_landscape_without_cropping(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "portrait.pdf"
            target = Path(temporary_directory) / "landscape.pdf"
            import fitz

            original = fitz.open()
            page = original.new_page(width=595, height=842)
            page.insert_text((72, 72), "TOP LEFT")
            page.insert_text((420, 780), "BOTTOM RIGHT")
            original.save(source)
            original.close()

            page_count = validate_document(source, "application/pdf", target, "A4", "landscape")

            self.assertEqual(page_count, 1)
            with fitz.open(target) as normalized:
                self.assertGreater(normalized[0].rect.width, normalized[0].rect.height)
                self.assertEqual(normalized[0].rotation, 0)
                self.assertEqual(normalized[0].get_text().splitlines(), ["TOP LEFT", "BOTTOM RIGHT"])
                words = normalized[0].get_text("words")
                self.assertTrue(all(0 <= word[0] < word[2] <= normalized[0].rect.width for word in words))
                self.assertTrue(all(0 <= word[1] < word[3] <= normalized[0].rect.height for word in words))
                top_left = next(word for word in words if word[4] == "TOP")
                bottom_right = next(word for word in words if word[4] == "BOTTOM")
                self.assertLess(top_left[0], bottom_right[0])
                self.assertLess(top_left[1], bottom_right[1])

    def test_png_conversion_creates_landscape_page_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "source.png"
            target = Path(temporary_directory) / "ready.pdf"
            Image.new("RGB", (200, 100), "white").save(source)

            validate_document(source, "image/png", target, "A4", "landscape")

            import fitz

            with fitz.open(target) as document:
                self.assertGreater(document[0].rect.width, document[0].rect.height)

    def test_print_settings_accept_each_supported_option(self) -> None:
        validate_print_settings({
            "paper_size": "A3", "color_mode": "color", "duplex": "duplexlong", "orientation": "landscape",
            "copies": 25, "limits": {"max_copies": 50, "max_page_copies": 200},
        })

    def test_print_settings_accept_all_requested_copy_boundaries(self) -> None:
        for copies in (1, 2, 3, 4, 10, 50):
            with self.subTest(copies=copies):
                validate_print_settings({
                    "paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex",
                    "orientation": "portrait", "copies": copies,
                    "limits": {"max_copies": 50, "max_page_copies": 200},
                })

    def test_print_settings_reject_unsupported_or_modified_values(self) -> None:
        valid_job = {"paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex",
                     "orientation": "portrait", "copies": 1,
                     "limits": {"max_copies": 50, "max_page_copies": 200}}
        invalid_jobs = (
            {**valid_job, "paper_size": "LETTER"},
            {**valid_job, "color_mode": "auto"},
            {**valid_job, "duplex": "duplex"},
            {**valid_job, "copies": True},
            {**valid_job, "copies": 0},
            {**valid_job, "orientation": "sideways"},
            {**valid_job, "copies": 51},
            {**valid_job, "copies": 21, "limits": {"max_copies": 20, "max_page_copies": 200}},
        )

        for job in invalid_jobs:
            with self.subTest(job=job), self.assertRaises(ValueError):
                validate_print_settings(job)

    def test_landscape_orientation_is_applied_to_a_job_scoped_devmode(self) -> None:
        constants = types.SimpleNamespace(
            DMORIENT_LANDSCAPE=2, DMORIENT_PORTRAIT=1, DMPAPER_A3=8, DMPAPER_A4=9,
            DMCOLOR_COLOR=2, DMCOLOR_MONOCHROME=1, DMDUP_VERTICAL=2, DMDUP_SIMPLEX=1,
            DM_ORIENTATION=1, DM_PAPERSIZE=2, DM_COLOR=4, DM_DUPLEX=8, DM_COPIES=16,
        )
        devmode = types.SimpleNamespace(Fields=0)
        job = {"orientation": "landscape", "paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex"}

        configured = configure_devmode(devmode, job, constants)

        self.assertEqual(configured.Orientation, constants.DMORIENT_LANDSCAPE)
        self.assertEqual(configured.PaperSize, constants.DMPAPER_A4)
        self.assertEqual(configured.Fields, 31)
        self.assertEqual(configured.Copies, 1)

    def test_devmode_maps_all_supported_job_settings(self) -> None:
        constants = types.SimpleNamespace(
            DMORIENT_LANDSCAPE=2, DMORIENT_PORTRAIT=1, DMPAPER_A3=8, DMPAPER_A4=9,
            DMCOLOR_COLOR=2, DMCOLOR_MONOCHROME=1, DMDUP_VERTICAL=2, DMDUP_SIMPLEX=1,
            DM_ORIENTATION=1, DM_PAPERSIZE=2, DM_COLOR=4, DM_DUPLEX=8, DM_COPIES=16,
        )
        devmode = types.SimpleNamespace(Fields=0)
        job = {"orientation": "landscape", "paper_size": "A3", "color_mode": "color", "duplex": "duplexlong"}

        configured = configure_devmode(devmode, job, constants)

        self.assertEqual((configured.Orientation, configured.PaperSize, configured.Color, configured.Duplex),
                         (2, 8, 2, 2))
        self.assertEqual(configured.Copies, 1)

    def test_printer_driver_receives_per_job_orientation_without_changing_queue_defaults(self) -> None:
        constants = types.SimpleNamespace(
            DMORIENT_LANDSCAPE=2, DMORIENT_PORTRAIT=1, DMPAPER_A3=8, DMPAPER_A4=9,
            DMCOLOR_COLOR=2, DMCOLOR_MONOCHROME=1, DMDUP_VERTICAL=2, DMDUP_SIMPLEX=1,
            DM_ORIENTATION=1, DM_PAPERSIZE=2, DM_COLOR=4, DM_DUPLEX=8, DM_COPIES=16,
            DM_IN_BUFFER=16, DM_OUT_BUFFER=32, IDOK=1, PHYSICALWIDTH=100, PHYSICALHEIGHT=101,
        )
        devmode = types.SimpleNamespace(Fields=0)
        fake_print = types.ModuleType("win32print")
        fake_print.OpenPrinter = MagicMock(return_value="handle")
        fake_print.GetPrinter = MagicMock(return_value={"pDevMode": devmode, "pPrintProcessor": "WinPrint"})
        def normalize_color_to_driver_default(*_args: object) -> int:
            devmode.Color = constants.DMCOLOR_COLOR
            return constants.IDOK
        fake_print.DocumentProperties = MagicMock(side_effect=normalize_color_to_driver_default)
        fake_print.GetDeviceCaps = MagicMock(side_effect=lambda _dc, cap: {100: 3500, 101: 2480}[cap])
        fake_print.ClosePrinter = MagicMock()
        fake_gui = types.ModuleType("win32gui")
        fake_gui.CreateDC = MagicMock(return_value=44)
        fake_gui.DeleteDC = MagicMock()
        job = {"orientation": "landscape", "paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex"}

        with patch.dict("sys.modules", {"win32con": constants, "win32print": fake_print, "win32gui": fake_gui}):
            dc = create_printer_dc("Uluslararası Ofis", job)

        self.assertEqual(dc, 44)
        self.assertEqual(fake_gui.CreateDC.call_args.args[2].Orientation, constants.DMORIENT_LANDSCAPE)
        self.assertEqual(fake_gui.CreateDC.call_args.args[2].Color, constants.DMCOLOR_COLOR)
        self.assertFalse(hasattr(fake_print, "SetPrinter"))
        fake_print.ClosePrinter.assert_called_once_with("handle")

    def test_driver_rejection_of_requested_orientation_fails_closed(self) -> None:
        constants = types.SimpleNamespace(
            DMORIENT_LANDSCAPE=2, DMORIENT_PORTRAIT=1, DMPAPER_A3=8, DMPAPER_A4=9,
            DMCOLOR_COLOR=2, DMCOLOR_MONOCHROME=1, DMDUP_VERTICAL=2, DMDUP_SIMPLEX=1,
            DM_ORIENTATION=1, DM_PAPERSIZE=2, DM_COLOR=4, DM_DUPLEX=8, DM_COPIES=16,
            DM_IN_BUFFER=32, DM_OUT_BUFFER=64, IDOK=1, PHYSICALWIDTH=100, PHYSICALHEIGHT=101,
        )
        devmode = types.SimpleNamespace(Fields=0)
        fake_print = types.ModuleType("win32print")
        fake_print.OpenPrinter = MagicMock(return_value="handle")
        fake_print.GetPrinter = MagicMock(return_value={"pDevMode": devmode, "pPrintProcessor": "WinPrint"})
        def reject_landscape(*_args: object) -> int:
            devmode.Orientation = constants.DMORIENT_PORTRAIT
            return constants.IDOK
        fake_print.DocumentProperties = MagicMock(side_effect=reject_landscape)
        fake_print.ClosePrinter = MagicMock()
        fake_gui = types.ModuleType("win32gui")
        fake_gui.CreateDC = MagicMock()
        job = {"orientation": "landscape", "paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex"}

        with patch.dict("sys.modules", {"win32con": constants, "win32print": fake_print, "win32gui": fake_gui}):
            with self.assertRaisesRegex(RuntimeError, "rejected"):
                create_printer_dc("Uluslararası Ofis", job)

        fake_gui.CreateDC.assert_not_called()
        fake_print.ClosePrinter.assert_called_once_with("handle")

    def test_driver_geometry_mismatch_fails_before_spool(self) -> None:
        constants = types.SimpleNamespace(
            DMORIENT_LANDSCAPE=2, DMORIENT_PORTRAIT=1, DMPAPER_A3=8, DMPAPER_A4=9,
            DMCOLOR_COLOR=2, DMCOLOR_MONOCHROME=1, DMDUP_VERTICAL=2, DMDUP_SIMPLEX=1,
            DM_ORIENTATION=1, DM_PAPERSIZE=2, DM_COLOR=4, DM_DUPLEX=8, DM_COPIES=16,
            DM_IN_BUFFER=32, DM_OUT_BUFFER=64, IDOK=1, PHYSICALWIDTH=100, PHYSICALHEIGHT=101,
        )
        devmode = types.SimpleNamespace(Fields=0)
        fake_print = types.ModuleType("win32print")
        fake_print.OpenPrinter = MagicMock(return_value="handle")
        fake_print.GetPrinter = MagicMock(return_value={"pDevMode": devmode, "pPrintProcessor": "WinPrint"})
        fake_print.DocumentProperties = MagicMock(return_value=constants.IDOK)
        fake_print.GetDeviceCaps = MagicMock(side_effect=lambda _dc, cap: {100: 2480, 101: 3500}[cap])
        fake_print.ClosePrinter = MagicMock()
        fake_gui = types.ModuleType("win32gui")
        fake_gui.CreateDC = MagicMock(return_value=44)
        fake_gui.DeleteDC = MagicMock()
        job = {"orientation": "landscape", "paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex"}

        with patch.dict("sys.modules", {"win32con": constants, "win32print": fake_print, "win32gui": fake_gui}):
            with self.assertRaisesRegex(RuntimeError, "orientation"):
                create_printer_dc("Uluslararası Ofis", job)

        fake_gui.DeleteDC.assert_called_once_with(44)
        fake_print.ClosePrinter.assert_called_once_with("handle")

    def test_kyocera_color_devmode_fallback_is_limited_to_grayscale_jobs(self) -> None:
        constants = types.SimpleNamespace(
            DMORIENT_LANDSCAPE=2, DMORIENT_PORTRAIT=1, DMPAPER_A3=8, DMPAPER_A4=9,
            DMCOLOR_COLOR=2, DMCOLOR_MONOCHROME=1, DMDUP_VERTICAL=2, DMDUP_SIMPLEX=1,
            DM_ORIENTATION=1, DM_PAPERSIZE=2, DM_COLOR=4, DM_DUPLEX=8, DM_COPIES=16,
        )
        devmode = types.SimpleNamespace(Fields=31, Orientation=2, PaperSize=9, Color=2, Duplex=1, Copies=1)
        job = {"orientation": "landscape", "paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex"}

        self.assertTrue(devmode_matches_job(devmode, job, constants))
        color_job_devmode = types.SimpleNamespace(**vars(devmode))
        color_job_devmode.Color = constants.DMCOLOR_MONOCHROME
        self.assertFalse(devmode_matches_job(color_job_devmode, {**job, "color_mode": "color"}, constants))

    def test_color_pdf_is_rasterized_to_grayscale_for_monochrome_jobs(self) -> None:
        import fitz

        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "color.pdf"
            normalized = Path(temporary_directory) / "normalized.pdf"
            source_document = fitz.open()
            source_page = source_document.new_page(width=100, height=100)
            source_page.draw_rect(fitz.Rect(0, 0, 50, 100), color=(1, 0, 0), fill=(1, 0, 0))
            source_page.draw_rect(fitz.Rect(50, 0, 100, 100), color=(0, 0, 1), fill=(0, 0, 1))
            source_document.save(source)
            source_document.close()
            validate_document(source, "application/pdf", normalized, "A4", "portrait")
            with fitz.open(normalized) as normalized_document:
                page = normalized_document[0]
                monochrome_image = rasterize_pdf_page(page, "monochrome")
                color_image = rasterize_pdf_page(page, "color")

        self.assertEqual(monochrome_image.mode, "L")
        self.assertNotEqual(monochrome_image.getpixel((500, 1000)), monochrome_image.getpixel((1800, 1000)))
        self.assertEqual(color_image.mode, "RGB")
        self.assertNotEqual(color_image.getpixel((500, 1000)), color_image.getpixel((1800, 1000)))

    def test_color_png_is_normalized_then_rasterized_to_grayscale_for_monochrome_jobs(self) -> None:
        import fitz

        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "color.png"
            normalized = Path(temporary_directory) / "normalized.pdf"
            image = Image.new("RGB", (200, 100), "red")
            for x in range(100, 200):
                for y in range(100):
                    image.putpixel((x, y), (0, 0, 255))
            image.save(source)
            validate_document(source, "image/png", normalized, "A4", "portrait")
            with fitz.open(normalized) as document:
                monochrome_image = rasterize_pdf_page(document[0], "monochrome")
                color_image = rasterize_pdf_page(document[0], "color")

        self.assertEqual(monochrome_image.mode, "L")
        self.assertEqual(color_image.mode, "RGB")
        self.assertNotEqual(monochrome_image.getextrema()[0], monochrome_image.getextrema()[1])

    def test_gdi_spools_each_page_per_copy_in_a_single_job(self) -> None:
        import fitz
        from print_agent import submit_pdf_to_printer

        fake_print = types.ModuleType("win32print")
        fake_print.StartDoc = MagicMock(return_value=123)
        fake_print.StartPage = MagicMock()
        fake_print.EndPage = MagicMock()
        fake_print.EndDoc = MagicMock()
        fake_print.AbortDoc = MagicMock()
        fake_gui = types.ModuleType("win32gui")
        fake_gui.DeleteDC = MagicMock()

        with tempfile.TemporaryDirectory() as temporary_directory:
            pdf_path = Path(temporary_directory) / "two-pages.pdf"
            document = fitz.open()
            document.new_page()
            document.new_page()
            document.save(pdf_path)
            document.close()
            with patch.dict("sys.modules", {"win32print": fake_print, "win32gui": fake_gui}), \
                    patch("print_agent.draw_pdf_page") as draw_page:
                spooler_job_id = submit_pdf_to_printer(pdf_path, 44, 2, "monochrome")

        self.assertEqual(spooler_job_id, "123")
        self.assertEqual(fake_print.StartPage.call_count, 4)
        self.assertEqual(fake_print.EndPage.call_count, 4)
        self.assertEqual(draw_page.call_count, 4)
        self.assertTrue(all(call.args[2] == "monochrome" for call in draw_page.call_args_list))
        fake_print.EndDoc.assert_called_once_with(44)
        fake_gui.DeleteDC.assert_called_once_with(44)
        self.assertFalse(hasattr(fake_print, "SetPrinter"))

    def test_fit_rectangle_preserves_aspect_ratio_and_centers_without_cropping(self) -> None:
        rectangle = calculate_fit_rectangle(595, 842, 3500, 2480)

        left, top, right, bottom = rectangle
        self.assertGreater(left, 0)
        self.assertEqual(top, 0)
        self.assertLess(right, 3500)
        self.assertEqual(bottom, 2480)
        self.assertAlmostEqual((right - left) / (bottom - top), 595 / 842, places=2)

    def test_declared_format_must_match_file_signature(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "source.png"
            target = Path(temporary_directory) / "ready.pdf"
            source.write_bytes(b"%PDF-not-a-png")

            with self.assertRaisesRegex(ValueError, "signature"):
                validate_document(source, "image/png", target)

    def test_startup_requires_writable_temporary_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            config = AgentConfig("https://example.test", "secret", "printer", "runner", "Office",
                                 Path(temporary_directory) / "temp")

            errors = validate_startup(config)

        self.assertEqual(errors, ())

    def test_gdi_spooler_failure_after_submission_lock_is_marked_unknown(self) -> None:
        class FakeApi:
            def __init__(self) -> None:
                self.calls: list[tuple[str, dict[str, object]]] = []

            def request(self, path: str, body=None, headers=None):
                import hashlib

                payload = b"%PDF-test"
                return payload, {"X-Content-SHA256": hashlib.sha256(payload).hexdigest()}

            def json(self, path: str, body=None, headers=None):
                self.calls.append((path, body or {}))
                return {}

        api = FakeApi()
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "printable.pdf"
            import fitz

            document = fitz.open()
            document.new_page()
            document.save(source)
            document.close()
            job = {"id": "job1", "lease_token": "lease", "media_type": "application/pdf", "byte_size": source.stat().st_size,
                   "paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex", "orientation": "portrait",
                   "copies": 1, "limits": {"max_copies": 50, "max_page_copies": 200}}
            config = AgentConfig("https://example.test", "secret", "printer", "runner", "Office",
                                 Path(temporary_directory))

            with patch("print_agent.download_job", side_effect=lambda _api, _job, target: target.write_bytes(source.read_bytes())), \
                    patch("print_agent.create_printer_dc", return_value=77), \
                    patch("print_agent.submit_pdf_to_printer", side_effect=TimeoutError()) as submit:
                print_job(api, config, job)

        self.assertTrue(any(path.endswith("submission-started") for path, _ in api.calls))
        self.assertEqual(api.calls[-1][1]["status"], "unknown")
        submit.assert_called_once()

    def test_invalid_copy_count_is_rejected_before_download_or_submission(self) -> None:
        class FakeApi:
            def __init__(self) -> None:
                self.calls: list[tuple[str, dict[str, object]]] = []

            def json(self, path: str, body=None, headers=None):
                self.calls.append((path, body or {}))
                return {}

        api = FakeApi()
        config = AgentConfig("https://example.test", "secret", "printer", "runner", "Office")
        job = {"id": "job1", "lease_token": "lease", "media_type": "application/pdf", "paper_size": "A4",
               "color_mode": "monochrome", "duplex": "simplex", "orientation": "portrait", "copies": 51,
               "limits": {"max_copies": 50, "max_page_copies": 200}}

        print_job(api, config, job)

        self.assertEqual(api.calls[0][1]["result_code"], "invalid_print_options")
        self.assertFalse(any(path.endswith("submission-started") for path, _ in api.calls))

    def test_page_copy_budget_is_checked_after_real_document_parse_before_submission(self) -> None:
        class FakeApi:
            def __init__(self) -> None:
                self.calls: list[tuple[str, dict[str, object]]] = []

            def json(self, path: str, body=None, headers=None):
                self.calls.append((path, body or {}))
                return {}

        api = FakeApi()
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "twenty-pages.pdf"
            import fitz

            document = fitz.open()
            for _ in range(20):
                document.new_page()
            document.save(source)
            document.close()
            job = {"id": "job-budget", "lease_token": "lease", "media_type": "application/pdf",
                   "byte_size": source.stat().st_size, "paper_size": "A4", "color_mode": "monochrome",
                   "duplex": "simplex", "orientation": "portrait", "copies": 11,
                   "limits": {"max_copies": 50, "max_page_copies": 200}}
            config = AgentConfig("https://example.test", "secret", "printer", "runner", "Office",
                                 Path(temporary_directory))

            with patch("print_agent.download_job", side_effect=lambda _api, _job, target: target.write_bytes(source.read_bytes())), \
                    patch("print_agent.create_printer_dc", return_value=77), \
                    patch("print_agent.submit_pdf_to_printer") as submit:
                print_job(api, config, job)

        self.assertEqual(api.calls[-1][1]["result_code"], "page_copy_budget_exceeded")
        self.assertFalse(any(path.endswith("submission-started") for path, _ in api.calls))
        submit.assert_not_called()

    def test_twenty_pages_at_ten_copies_respects_two_hundred_page_budget(self) -> None:
        class FakeApi:
            def __init__(self) -> None:
                self.calls: list[tuple[str, dict[str, object]]] = []

            def json(self, path: str, body=None, headers=None):
                self.calls.append((path, body or {}))
                return {}

        api = FakeApi()
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "twenty-pages.pdf"
            import fitz

            document = fitz.open()
            for _ in range(20):
                document.new_page()
            document.save(source)
            document.close()
            job = {"id": "job-at-budget", "lease_token": "lease", "media_type": "application/pdf",
                   "byte_size": source.stat().st_size, "paper_size": "A4", "color_mode": "monochrome",
                   "duplex": "simplex", "orientation": "landscape", "copies": 10,
                   "limits": {"max_copies": 50, "max_page_copies": 200}}
            config = AgentConfig("https://example.test", "secret", "printer", "runner", "Office",
                                 Path(temporary_directory))

            with patch("print_agent.download_job", side_effect=lambda _api, _job, target: target.write_bytes(source.read_bytes())), \
                    patch("print_agent.create_printer_dc", return_value=77), \
                    patch("print_agent.submit_pdf_to_printer", return_value="123") as submit:
                print_job(api, config, job)

        ready = next(body for path, body in api.calls if path.endswith("validation-result"))
        self.assertEqual(ready, {"status": "ready", "page_count": 20})
        self.assertTrue(any(path.endswith("submission-started") for path, _ in api.calls))
        self.assertEqual(Path(submit.call_args.args[0]).name, "document.pdf")
        self.assertEqual(submit.call_args.args[1:], (77, 10, "monochrome"))

    def test_missing_claim_setting_is_rejected_before_download_or_submission(self) -> None:
        class FakeApi:
            def __init__(self) -> None:
                self.calls: list[tuple[str, dict[str, object]]] = []

            def json(self, path: str, body=None, headers=None):
                self.calls.append((path, body or {}))
                return {}

        api = FakeApi()
        config = AgentConfig("https://example.test", "secret", "printer", "runner", "Office")
        job = {"id": "job1", "lease_token": "lease", "media_type": "application/pdf", "copies": 1,
               "paper_size": "A4", "color_mode": "monochrome", "duplex": "simplex", "orientation": "portrait"}

        print_job(api, config, job)

        self.assertEqual(api.calls[0][1]["result_code"], "invalid_print_options")
        self.assertFalse(any(path.endswith("submission-started") for path, _ in api.calls))

    @staticmethod
    def _create_mock_win32print(printer_name: str = "Office Printer", status: int = 0, enum_entries=None):
        fake = types.ModuleType("win32print")
        fake.PRINTER_ENUM_LOCAL = 2
        fake.PRINTER_ENUM_CONNECTIONS = 4
        fake.PRINTER_STATUS_ERROR = 0x2
        fake.PRINTER_STATUS_OFFLINE = 0x80
        fake.PRINTER_STATUS_NOT_AVAILABLE = 0x1000
        fake.PRINTER_STATUS_PAPER_OUT = 0x10
        fake.PRINTER_STATUS_PAUSED = 0x1
        fake.PRINTER_STATUS_PENDING_DELETION = 0x4
        if enum_entries is None:
            enum_entries = ({"pPrinterName": printer_name},)
        fake.EnumPrinters = MagicMock(return_value=enum_entries)
        fake.OpenPrinter = MagicMock(return_value=123)
        fake.GetPrinter = MagicMock(return_value={"Status": status})
        fake.ClosePrinter = MagicMock()
        return fake

    def test_printer_is_available_with_level_2_dict_and_ready_status(self) -> None:
        fake_win32print = self._create_mock_win32print("Office Printer", status=0)
        with patch("os.name", "nt"), patch.dict("sys.modules", {"win32print": fake_win32print}):
            self.assertTrue(printer_is_available("Office Printer"))
            fake_win32print.ClosePrinter.assert_called_once_with(123)

    def test_printer_is_available_returns_false_when_printer_not_found(self) -> None:
        fake_win32print = self._create_mock_win32print("Office Printer", status=0)
        with patch("os.name", "nt"), patch.dict("sys.modules", {"win32print": fake_win32print}):
            self.assertFalse(printer_is_available("Nonexistent Printer"))
            fake_win32print.OpenPrinter.assert_not_called()

    def test_printer_is_available_returns_false_when_printer_is_offline(self) -> None:
        fake_win32print = self._create_mock_win32print("Office Printer", status=0x80)
        with patch("os.name", "nt"), patch.dict("sys.modules", {"win32print": fake_win32print}):
            self.assertFalse(printer_is_available("Office Printer"))
            fake_win32print.ClosePrinter.assert_called_once_with(123)

    def test_printer_is_available_safely_handles_malformed_enum_entries(self) -> None:
        malformed_entries = ({}, None, {"pPrinterName": 123}, {"pPrinterName": "Office Printer"})
        fake_win32print = self._create_mock_win32print(enum_entries=malformed_entries, status=0)
        with patch("os.name", "nt"), patch.dict("sys.modules", {"win32print": fake_win32print}):
            self.assertTrue(printer_is_available("Office Printer"))
            self.assertFalse(printer_is_available("Missing Printer"))

    def test_printer_is_available_returns_false_when_get_printer_returns_non_dict(self) -> None:
        fake_win32print = self._create_mock_win32print("Office Printer", status=0)
        fake_win32print.GetPrinter = MagicMock(return_value="unexpected_string_result")
        with patch("os.name", "nt"), patch.dict("sys.modules", {"win32print": fake_win32print}):
            self.assertFalse(printer_is_available("Office Printer"))
            fake_win32print.ClosePrinter.assert_called_once_with(123)

    def test_printer_is_available_returns_false_when_get_printer_status_is_invalid(self) -> None:
        for invalid_status in ("not_an_int", None, []):
            with self.subTest(invalid_status=invalid_status):
                fake_win32print = self._create_mock_win32print("Office Printer", status=0)
                fake_win32print.GetPrinter = MagicMock(return_value={"Status": invalid_status})
                with patch("os.name", "nt"), patch.dict("sys.modules", {"win32print": fake_win32print}):
                    self.assertFalse(printer_is_available("Office Printer"))
                    fake_win32print.ClosePrinter.assert_called_once_with(123)


def create_direction_image(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size, "white")
    drawing = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=24)
    drawing.rectangle((5, 5, width - 6, height - 6), outline="black", width=3)
    drawing.text((20, 30), "UP RIGHT F", font=font, fill="black")
    drawing.line((width // 2, 140, width // 2, 80), fill="black", width=7)
    drawing.polygon(((width // 2, 65), (width // 2 - 18, 90), (width // 2 + 18, 90)), fill="black")
    drawing.rectangle((15, height - 50, 45, height - 20), fill="black")
    drawing.ellipse((width - 60, height - 60, width - 20, height - 20), fill="black")
    return image


def create_direction_pdf(path: Path, size: tuple[int, int]) -> None:
    width, height = size
    with fitz.open() as document:
        page = document.new_page(width=width, height=height)
        page.draw_rect(fitz.Rect(5, 5, width - 5, height - 5), width=3)
        page.insert_text((25, 65), "UP RIGHT F", fontsize=28)
        page.draw_line((width / 2, 160), (width / 2, 90), width=7)
        page.draw_polyline(((width / 2 - 18, 105), (width / 2, 75),
                            (width / 2 + 18, 105)), width=7)
        page.draw_rect(fitz.Rect(15, height - 50, 45, height - 20), fill=(0, 0, 0))
        page.draw_circle((width - 40, height - 40), 20, fill=(0, 0, 0))
        document.save(path)


def render_pdf(path: Path) -> Image.Image:
    with fitz.open(path) as document:
        pixmap = document[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def create_expected_raster(source: Image.Image, page_size: tuple[int, int]) -> Image.Image:
    scale = min(page_size[0] / source.width, page_size[1] / source.height)
    dimensions = (round(source.width * scale), round(source.height * scale))
    resized = source.resize(dimensions, Image.Resampling.LANCZOS)
    expected = Image.new("RGB", page_size, "white")
    expected.paste(resized, ((page_size[0] - dimensions[0]) // 2,
                            (page_size[1] - dimensions[1]) // 2))
    return expected


class OrientationNormalizationTests(unittest.TestCase):
    def assert_preserved_raster(self, source: Image.Image, target: Path) -> None:
        actual = render_pdf(target)
        expected = create_expected_raster(source, actual.size)
        actual_mask = actual.convert("L").point(lambda pixel: 255 if pixel < 180 else 0)
        expected_mask = expected.convert("L").point(lambda pixel: 255 if pixel < 180 else 0)
        mismatched = ImageChops.difference(actual_mask, expected_mask).histogram()[255]
        expected_ink = expected_mask.histogram()[255]

        self.assertGreater(expected_ink, 500)
        self.assertLess(mismatched / expected_ink, 0.20,
                        "Raster text/arrow must retain source direction and centered proportional placement")
        actual_bounds = actual_mask.getbbox()
        expected_bounds = expected_mask.getbbox()
        self.assertIsNotNone(actual_bounds)
        self.assertIsNotNone(expected_bounds)
        for actual_edge, expected_edge in zip(actual_bounds, expected_bounds):
            self.assertAlmostEqual(actual_edge, expected_edge, delta=3)

    def verify_pdf_outputs(self, source_size: tuple[int, int]) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "same-source.pdf"
            create_direction_pdf(source, source_size)
            source_raster = render_pdf(source)
            for paper in ("A4", "A3"):
                for orientation in ("portrait", "landscape"):
                    with self.subTest(paper=paper, orientation=orientation):
                        target = Path(directory) / f"{paper}-{orientation}.pdf"

                        page_count = validate_document(source, "application/pdf", target, paper, orientation)

                        self.assertEqual(page_count, 1)
                        with fitz.open(target) as document:
                            page = document[0]
                            expected_width = 595.2756 if paper == "A4" else 841.8898
                            expected_height = 841.8898 if paper == "A4" else 1190.5512
                            if orientation == "landscape":
                                expected_width, expected_height = expected_height, expected_width
                            self.assertAlmostEqual(page.rect.width, expected_width, places=2)
                            self.assertAlmostEqual(page.rect.height, expected_height, places=2)
                            self.assertEqual(page.rotation, 0)
                            self.assertIn("UP RIGHT F", page.get_text())
                        self.assert_preserved_raster(source_raster, target)

    def test_same_portrait_pdf_preserves_text_and_arrow_on_both_paper_orientations(self) -> None:
        self.verify_pdf_outputs((595, 842))

    def test_same_landscape_pdf_preserves_text_and_arrow_on_both_paper_orientations(self) -> None:
        self.verify_pdf_outputs((842, 595))

    def verify_image_outputs(self, source_size: tuple[int, int], suffix: str) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / f"same-source.{suffix}"
            create_direction_image(source_size).save(source)
            with Image.open(source) as decoded:
                source_raster = decoded.convert("RGB")
            for paper in ("A4", "A3"):
                for orientation in ("portrait", "landscape"):
                    with self.subTest(paper=paper, orientation=orientation, suffix=suffix):
                        target = Path(directory) / f"{paper}-{orientation}.pdf"

                        page_count = validate_document(source, f"image/{'jpeg' if suffix == 'jpg' else 'png'}",
                                                       target, paper, orientation)

                        self.assertEqual(page_count, 1)
                        self.assert_preserved_raster(source_raster, target)

    def test_portrait_png_preserves_raster_text_and_arrow(self) -> None:
        self.verify_image_outputs((400, 600), "png")

    def test_landscape_png_preserves_raster_text_and_arrow(self) -> None:
        self.verify_image_outputs((600, 400), "png")

    def test_portrait_jpeg_preserves_raster_text_and_arrow(self) -> None:
        self.verify_image_outputs((400, 600), "jpg")

    def test_landscape_jpeg_preserves_raster_text_and_arrow(self) -> None:
        self.verify_image_outputs((600, 400), "jpg")


    def test_intrinsic_pdf_rotation_preserves_displayed_content_without_paper_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "original.pdf"
            create_direction_pdf(original, (595, 842))
            for rotation in (90, 180, 270):
                source = Path(directory) / f"rotation-{rotation}.pdf"
                with fitz.open(original) as document:
                    document[0].set_rotation(rotation)
                    document.save(source)
                original_bytes = source.read_bytes()
                for orientation in ("portrait", "landscape"):
                    with self.subTest(rotation=rotation, orientation=orientation):
                        target = Path(directory) / f"output-{orientation}.pdf"

                        validate_document(source, "application/pdf", target, "A4", orientation)

                        self.assert_preserved_raster(render_pdf(source), target)
                        self.assertEqual(source.read_bytes(), original_bytes)

    def test_cropped_pdf_keeps_visible_content_and_intrinsic_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "original.pdf"
            source = Path(directory) / "cropped.pdf"
            create_direction_pdf(original, (595, 842))
            with fitz.open(original) as document:
                document[0].set_cropbox(fitz.Rect(10, 10, 585, 832))
                document[0].set_rotation(90)
                document.save(source)
            for orientation in ("portrait", "landscape"):
                with self.subTest(orientation=orientation):
                    target = Path(directory) / f"output-{orientation}.pdf"

                    validate_document(source, "application/pdf", target, "A4", orientation)

                    self.assert_preserved_raster(render_pdf(source), target)

    def test_jpeg_exif_orientation_is_preserved_independently_of_paper_orientation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "exif.jpg"
            image = create_direction_image((600, 400))
            exif = image.getexif()
            exif[274] = 6
            image.save(source, exif=exif)
            with Image.open(source) as decoded:
                reference = decoded.transpose(Image.Transpose.ROTATE_270).convert("RGB")
            for orientation in ("portrait", "landscape"):
                with self.subTest(orientation=orientation):
                    target = Path(directory) / f"output-{orientation}.pdf"

                    validate_document(source, "image/jpeg", target, "A4", orientation)

                    self.assert_preserved_raster(reference, target)

if __name__ == "__main__":
    unittest.main()
