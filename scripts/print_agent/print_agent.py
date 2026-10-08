from __future__ import annotations

import hashlib
import importlib
import io
import json
import logging
import os
import re
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import fitz
from PIL import Image, ImageOps

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PAGE_COUNT = 20
MAX_COPIES_PER_JOB = 50
MAX_PAGE_COPIES = 1000
SETTINGS_PROTOCOL = 3
HEARTBEAT_SECONDS = 20
POLL_SECONDS = 5
REQUEST_TIMEOUT_SECONDS = 30
DEFAULT_AGENT_TEMP_DIR = Path(tempfile.gettempdir()) / "topkapi-print-agent"
A4_WIDTH_POINTS = 595.2756
A4_HEIGHT_POINTS = 841.8898
A3_WIDTH_POINTS = 841.8898
A3_HEIGHT_POINTS = 1190.5512
PRINT_DPI = 300
PAPER_DIMENSIONS = {
    "A4": (A4_WIDTH_POINTS, A4_HEIGHT_POINTS),
    "A3": (A3_WIDTH_POINTS, A3_HEIGHT_POINTS),
}
ALLOWED_COLOR_MODES = {"monochrome", "color"}
ALLOWED_DUPLEX_MODES = {"simplex", "duplexlong"}


def is_https_origin(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == "https" and bool(parsed.hostname) and parsed.username is None
                and parsed.password is None and parsed.path in {"", "/"} and not parsed.query
                and not parsed.fragment and (parsed.port is None or 1 <= parsed.port <= 65535))
    except ValueError:
        return False


@dataclass(frozen=True)
class AgentConfig:
    base_url: str
    secret: str
    printer_id: str
    runner_id: str
    printer_name: str
    temp_directory: Path = DEFAULT_AGENT_TEMP_DIR
    poll_seconds: int = POLL_SECONDS
    configuration_errors: tuple[str, ...] = ()

    @classmethod
    def from_environment(cls) -> AgentConfig:
        base_url = os.environ.get("PRINT_AGENT_BASE_URL", "").rstrip("/")
        secret = os.environ.get("PRINTER_SECRET", "")
        printer_id = os.environ.get("PRINT_PRINTER_ID", "unconfigured-printer")
        runner_id = os.environ.get("PRINT_RUNNER_ID", "unconfigured-runner")
        printer_name = os.environ.get("PRINT_PRINTER_NAME", "")
        temp_directory = Path(os.environ.get("PRINT_AGENT_TEMP_DIR", str(DEFAULT_AGENT_TEMP_DIR)))
        errors: list[str] = []
        if not is_https_origin(base_url):
            errors.append("base_url_must_be_https_origin")
        if not secret:
            errors.append("printer_secret_missing")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", printer_id) or printer_id == "unconfigured-printer":
            errors.append("printer_id_missing_or_invalid")
            printer_id = "unconfigured-printer"
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", runner_id) or runner_id == "unconfigured-runner":
            errors.append("runner_id_missing_or_invalid")
            runner_id = "unconfigured-runner"
        if (not printer_name.strip() or len(printer_name) > 128
                or any(ord(character) < 32 for character in printer_name)):
            errors.append("printer_name_missing_or_invalid")
            printer_name = "Unconfigured printer"
        raw_poll_seconds = os.environ.get("PRINT_AGENT_POLL_SECONDS", str(POLL_SECONDS))
        try:
            poll_seconds = int(raw_poll_seconds)
            if not 1 <= poll_seconds <= 60:
                raise ValueError
        except ValueError:
            errors.append("poll_seconds_invalid")
            poll_seconds = POLL_SECONDS
        return cls(base_url, secret, printer_id, runner_id, printer_name, temp_directory,
                   poll_seconds, tuple(errors))


class PrintApi:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config

    def request(self, path: str, body: dict[str, Any] | None = None,
                headers: dict[str, str] | None = None) -> tuple[bytes, dict[str, str]]:
        request_headers = {
            "Authorization": f"Bearer {self.config.secret}",
            "User-Agent": "TopkapiPrintAgent/1.0",
            **(headers or {}),
        }
        payload = None
        if body is not None:
            payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        method = "POST" if body is not None else "GET"
        request = urllib.request.Request(self.config.base_url + path, data=payload, headers=request_headers, method=method)
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return response.read(MAX_FILE_BYTES + 1024), dict(response.headers.items())

    def json(self, path: str, body: dict[str, Any] | None = None,
             headers: dict[str, str] | None = None) -> dict[str, Any]:
        response, _ = self.request(path, body, headers)
        return json.loads(response)


def paper_dimensions(paper_size: str, orientation: str) -> tuple[float, float]:
    dimensions = PAPER_DIMENSIONS.get(paper_size)
    if dimensions is None or orientation not in {"portrait", "landscape"}:
        raise ValueError("Print paper size is unsupported.")
    width, height = dimensions
    return (height, width) if orientation == "landscape" else (width, height)


def image_to_pdf(source: Path, target: Path, paper_size: str, orientation: str) -> int:
    """Fit an EXIF-oriented image without rotating it to match the paper.

    Args: source image path, target PDF path, paper size and paper orientation.
    Returns: The number of normalized pages.
    Raises: ValueError for oversized pixels or unsupported paper settings.
    """
    dimensions = paper_dimensions(paper_size, orientation)
    with Image.open(source) as image:
        image.verify()
    with Image.open(source) as image:
        oriented = ImageOps.exif_transpose(image).convert("RGB")
        if oriented.width * oriented.height > 40_000_000:
            raise ValueError("Image pixel count exceeds the configured limit.")
        with fitz.open() as document:
            page = document.new_page(width=dimensions[0], height=dimensions[1])
            scale = min(page.rect.width / oriented.width, page.rect.height / oriented.height)
            width = oriented.width * scale
            height = oriented.height * scale
            image_rect = fitz.Rect((page.rect.width - width) / 2, (page.rect.height - height) / 2,
                                   (page.rect.width + width) / 2, (page.rect.height + height) / 2)
            with io.BytesIO() as image_bytes:
                oriented.save(image_bytes, format="PNG")
                page.insert_image(image_rect, stream=image_bytes.getvalue())
            document.save(target)
    return 1


def has_expected_signature(source: Path, media_type: str) -> bool:
    with source.open("rb") as file_handle:
        signature = file_handle.read(8)
    signatures = {
        "application/pdf": lambda value: value.startswith(b"%PDF-"),
        "image/jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        "image/png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
    }
    validator = signatures.get(media_type)
    return validator is not None and validator(signature)


def normalize_pdf(source: Path, target: Path, paper_size: str, orientation: str) -> int:
    """Center source pages proportionally while preserving their displayed direction.

    Args: source PDF path, target PDF path, paper size and paper orientation.
    Returns: The source page count; the source file remains unchanged.
    Raises: ValueError for unsafe PDFs, invalid page counts or paper settings.
    """
    width, height = paper_dimensions(paper_size, orientation)
    with fitz.open(source) as source_document, fitz.open() as normalized:
        if source_document.is_encrypted or source_document.is_repaired:
            raise ValueError("PDF cannot be safely parsed for printing.")
        if not 1 <= source_document.page_count <= MAX_PAGE_COUNT:
            raise ValueError("PDF page count is outside the allowed range.")
        for source_page in source_document:
            target_page = normalized.new_page(width=width, height=height)
            # PyMuPDF uses an unrotated source rectangle; preserve intrinsic /Rotate once at placement.
            source_rotation = source_page.rotation
            source_page.set_rotation(0)
            try:
                target_page.show_pdf_page(target_page.rect, source_document, source_page.number,
                                          keep_proportion=True, overlay=True, rotate=-source_rotation)
            finally:
                source_page.set_rotation(source_rotation)
        normalized.save(target)
        return source_document.page_count


def validate_document(source: Path, media_type: str, target_pdf: Path, paper_size: str = "A4",
                      orientation: str = "portrait") -> int:
    if source.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("Print file exceeds the configured size limit.")
    if not has_expected_signature(source, media_type):
        raise ValueError("Print file signature does not match the declared format.")
    if media_type == "application/pdf":
        return normalize_pdf(source, target_pdf, paper_size, orientation)
    if media_type in {"image/jpeg", "image/png"}:
        page_count = image_to_pdf(source, target_pdf, paper_size, orientation)
        if page_count > MAX_PAGE_COUNT:
            raise ValueError("Image page count is outside the allowed range.")
        return page_count
    raise ValueError("Print media type is unsupported.")


def printer_is_available(printer_name: str) -> bool:
    if os.name != "nt":
        return False
    try:
        try:
            import pywintypes
            win_error: type[Exception] = pywintypes.error
        except ImportError:
            win_error = OSError
        import win32print

        printer_names = {
            entry["pPrinterName"]
            for entry in win32print.EnumPrinters(
                win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS, None, 2
            )
            if isinstance(entry, dict) and isinstance(entry.get("pPrinterName"), str)
        }
        if printer_name not in printer_names:
            return False
        handle = win32print.OpenPrinter(printer_name)
        try:
            printer_info = win32print.GetPrinter(handle, 2)
            if not isinstance(printer_info, dict):
                return False
            status = printer_info.get("Status")
            if type(status) is not int:
                return False
            unavailable_statuses = (win32print.PRINTER_STATUS_ERROR | win32print.PRINTER_STATUS_OFFLINE
                                    | win32print.PRINTER_STATUS_NOT_AVAILABLE | win32print.PRINTER_STATUS_PAPER_OUT
                                    | win32print.PRINTER_STATUS_PAUSED | win32print.PRINTER_STATUS_PENDING_DELETION)
            return not bool(status & unavailable_statuses)
        finally:
            win32print.ClosePrinter(handle)
    except (ImportError, OSError, RuntimeError, win_error):
        return False


def send_heartbeat(api: PrintApi, config: AgentConfig, has_prerequisites: bool) -> bool:
    is_available = has_prerequisites and printer_is_available(config.printer_name)
    api.json("/api/printer/heartbeat", {
        "health": "ready" if is_available else "unavailable",
        "printer_id": config.printer_id,
        "printer_name": config.printer_name,
        "runner_id": config.runner_id,
        "settings_protocol": SETTINGS_PROTOCOL,
    })
    return is_available


def validate_startup(config: AgentConfig) -> tuple[str, ...]:
    errors = list(config.configuration_errors)
    if os.name == "nt":
        try:
            for module_name in ("win32con", "win32gui", "win32print", "PIL.ImageWin"):
                importlib.import_module(module_name)
        except ImportError:
            errors.append("windows_print_api_unavailable")
    try:
        config.temp_directory.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=config.temp_directory):
            pass
    except OSError:
        errors.append("temporary_directory_unavailable")
    return tuple(errors)


def post_job_result(api: PrintApi, job: dict[str, Any], result: dict[str, Any]) -> None:
    api.json(f"/api/printer/jobs/{job['id']}/result", result,
             {"X-Print-Lease": job["lease_token"]})


def download_job(api: PrintApi, job: dict[str, Any], destination: Path) -> str:
    response, headers = api.request(f"/api/printer/jobs/{job['id']}/content", headers={"X-Print-Lease": job["lease_token"]})
    expected_hash = headers.get("X-Content-SHA256", "")
    actual_hash = hashlib.sha256(response).hexdigest()
    if len(response) != job["byte_size"] or actual_hash != expected_hash:
        raise ValueError("Print content integrity check failed.")
    destination.write_bytes(response)
    return actual_hash


def report_validation_ready(api: PrintApi, job: dict[str, Any], page_count: int) -> None:
    api.json(f"/api/printer/jobs/{job['id']}/validation-result", {"status": "ready", "page_count": page_count},
             {"X-Print-Lease": job["lease_token"]})


def report_validation_failure(api: PrintApi, job: dict[str, Any], result_code: str) -> None:
    api.json(f"/api/printer/jobs/{job['id']}/validation-result", {"status": "failed", "result_code": result_code},
             {"X-Print-Lease": job["lease_token"]})


def validate_print_settings(job: dict[str, Any]) -> None:
    paper_size = job.get("paper_size")
    color_mode = job.get("color_mode")
    duplex = job.get("duplex")
    orientation = job.get("orientation")
    copies = job.get("copies")
    limits = job.get("limits")
    if paper_size not in PAPER_DIMENSIONS or color_mode not in ALLOWED_COLOR_MODES:
        raise ValueError("Print settings are unsupported.")
    if duplex not in ALLOWED_DUPLEX_MODES or orientation not in {"portrait", "landscape"}:
        raise ValueError("Print settings are unsupported.")
    if (type(copies) is not int or not 1 <= copies <= MAX_COPIES_PER_JOB
            or not isinstance(limits, dict)
            or type(limits.get("max_copies")) is not int or not 1 <= limits["max_copies"] <= MAX_COPIES_PER_JOB
            or type(limits.get("max_page_copies")) is not int
            or not 1 <= limits["max_page_copies"] <= MAX_PAGE_COPIES
            or copies > limits["max_copies"]):
        raise ValueError("Print settings are unsupported.")


def calculate_fit_rectangle(source_width: float, source_height: float,
                            target_width: int, target_height: int) -> tuple[int, int, int, int]:
    if min(source_width, source_height, target_width, target_height) <= 0:
        raise ValueError("Print page geometry is invalid.")
    scale = min(target_width / source_width, target_height / source_height)
    width = source_width * scale
    height = source_height * scale
    left = (target_width - width) / 2
    top = (target_height - height) / 2
    return round(left), round(top), round(left + width), round(top + height)


def configure_devmode(devmode: Any, job: dict[str, Any], win32con: Any) -> Any:
    if (job.get("orientation") not in {"portrait", "landscape"}
            or job.get("paper_size") not in PAPER_DIMENSIONS
            or job.get("color_mode") not in ALLOWED_COLOR_MODES
            or job.get("duplex") not in ALLOWED_DUPLEX_MODES):
        raise ValueError("Print settings are unsupported.")
    orientation = win32con.DMORIENT_LANDSCAPE if job["orientation"] == "landscape" else win32con.DMORIENT_PORTRAIT
    paper_size = win32con.DMPAPER_A3 if job["paper_size"] == "A3" else win32con.DMPAPER_A4
    color = win32con.DMCOLOR_COLOR if job["color_mode"] == "color" else win32con.DMCOLOR_MONOCHROME
    duplex = win32con.DMDUP_VERTICAL if job["duplex"] == "duplexlong" else win32con.DMDUP_SIMPLEX
    devmode.Fields |= (win32con.DM_ORIENTATION | win32con.DM_PAPERSIZE | win32con.DM_COLOR
                       | win32con.DM_DUPLEX | win32con.DM_COPIES)
    devmode.Orientation = orientation
    devmode.PaperSize = paper_size
    devmode.Color = color
    devmode.Duplex = duplex
    devmode.Copies = 1
    return devmode


def create_printer_dc(printer_name: str, job: dict[str, Any]) -> int:
    import win32con
    import win32gui
    import win32print

    printer_handle = win32print.OpenPrinter(printer_name)
    try:
        printer_info = win32print.GetPrinter(printer_handle, 2)
        if (not isinstance(printer_info, dict) or printer_info.get("pDevMode") is None
                or not isinstance(printer_info.get("pPrintProcessor"), str)):
            raise RuntimeError("Printer driver did not provide a DEVMODE.")
        devmode = configure_devmode(printer_info["pDevMode"], job, win32con)
        accepted = win32print.DocumentProperties(0, printer_handle, printer_name, devmode, devmode,
                                                 win32con.DM_IN_BUFFER | win32con.DM_OUT_BUFFER)
        if accepted != win32con.IDOK or not devmode_matches_job(devmode, job, win32con):
            raise RuntimeError("Printer driver rejected the requested print settings.")
        device_context = win32gui.CreateDC(printer_info["pPrintProcessor"], printer_name, devmode)
    finally:
        win32print.ClosePrinter(printer_handle)
    verify_printer_page_geometry(device_context, job, win32print, win32con)
    return device_context


def devmode_matches_job(devmode: Any, job: dict[str, Any], win32con: Any) -> bool:
    orientation = win32con.DMORIENT_LANDSCAPE if job["orientation"] == "landscape" else win32con.DMORIENT_PORTRAIT
    paper_size = win32con.DMPAPER_A3 if job["paper_size"] == "A3" else win32con.DMPAPER_A4
    color = win32con.DMCOLOR_COLOR if job["color_mode"] == "color" else win32con.DMCOLOR_MONOCHROME
    duplex = win32con.DMDUP_VERTICAL if job["duplex"] == "duplexlong" else win32con.DMDUP_SIMPLEX
    required_fields = (win32con.DM_ORIENTATION | win32con.DM_PAPERSIZE | win32con.DM_COLOR
                       | win32con.DM_DUPLEX | win32con.DM_COPIES)
    # Kyocera KX may normalize DM_COLOR back to color; monochrome jobs then use only grayscale GDI pixels.
    color_matches = devmode.Color == color or (
        job["color_mode"] == "monochrome" and devmode.Color == win32con.DMCOLOR_COLOR
    )
    return (devmode.Fields & required_fields == required_fields and devmode.Orientation == orientation
            and devmode.PaperSize == paper_size and color_matches and devmode.Duplex == duplex
            and devmode.Copies == 1)


def verify_printer_page_geometry(device_context: int, job: dict[str, Any], win32print: Any,
                                 win32con: Any) -> None:
    try:
        width = win32print.GetDeviceCaps(device_context, win32con.PHYSICALWIDTH)
        height = win32print.GetDeviceCaps(device_context, win32con.PHYSICALHEIGHT)
        is_landscape = width > height
        if width <= 0 or height <= 0 or is_landscape != (job["orientation"] == "landscape"):
            raise RuntimeError("Printer driver did not apply the requested paper orientation.")
    except Exception:
        import win32gui

        win32gui.DeleteDC(device_context)
        raise


def rasterize_pdf_page(page: fitz.Page, color_mode: str) -> Image.Image:
    if color_mode == "monochrome":
        colorspace, image_mode = fitz.csGRAY, "L"
    elif color_mode == "color":
        colorspace, image_mode = fitz.csRGB, "RGB"
    else:
        raise ValueError("Print color mode is unsupported.")
    pixmap = page.get_pixmap(matrix=fitz.Matrix(PRINT_DPI / 72, PRINT_DPI / 72),
                             colorspace=colorspace, alpha=False)
    return Image.frombytes(image_mode, (pixmap.width, pixmap.height), pixmap.samples)


def draw_pdf_page(page: fitz.Page, device_context: int, color_mode: str) -> None:
    from PIL import ImageWin
    import win32con
    import win32print

    printable_width = win32print.GetDeviceCaps(device_context, win32con.HORZRES)
    printable_height = win32print.GetDeviceCaps(device_context, win32con.VERTRES)
    destination = calculate_fit_rectangle(page.rect.width, page.rect.height, printable_width, printable_height)
    image = rasterize_pdf_page(page, color_mode)
    ImageWin.Dib(image).draw(device_context, destination)


def submit_pdf_to_printer(pdf_path: Path, device_context: int, copies: int, color_mode: str) -> str:
    import win32gui
    import win32print

    started = False
    try:
        spooler_job_id = win32print.StartDoc(device_context, ("Topkapi print job", None, None, 0))
        if type(spooler_job_id) is not int or spooler_job_id <= 0:
            raise RuntimeError("Windows spooler did not accept the print job.")
        started = True
        with fitz.open(pdf_path) as document:
            for _ in range(copies):
                for page in document:
                    win32print.StartPage(device_context)
                    draw_pdf_page(page, device_context, color_mode)
                    win32print.EndPage(device_context)
        win32print.EndDoc(device_context)
        return str(spooler_job_id)
    except Exception:
        if started:
            win32print.AbortDoc(device_context)
        raise
    finally:
        win32gui.DeleteDC(device_context)


def print_job(api: PrintApi, config: AgentConfig, job: dict[str, Any]) -> None:
    try:
        validate_print_settings(job)
    except ValueError:
        report_validation_failure(api, job, "invalid_print_options")
        return
    suffix = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}.get(job["media_type"])
    if suffix is None:
        report_validation_failure(api, job, "unsupported_content")
        return
    with tempfile.TemporaryDirectory(prefix="topkapi-print-", dir=config.temp_directory) as temporary_directory:
        folder = Path(temporary_directory)
        downloaded = folder / f"source{suffix}"
        printable = folder / "document.pdf"
        try:
            download_job(api, job, downloaded)
            page_count = validate_document(downloaded, job["media_type"], printable, job["paper_size"],
                                           job["orientation"])
        except (OSError, ValueError, fitz.FileDataError, fitz.EmptyFileError, Image.DecompressionBombError):
            report_validation_failure(api, job, "validation_failed")
            return
        if page_count * job["copies"] > job["limits"]["max_page_copies"]:
            report_validation_failure(api, job, "page_copy_budget_exceeded")
            return
        try:
            device_context = create_printer_dc(config.printer_name, job)
        except Exception as error:
            logging.warning("Print driver rejected job settings: %s", type(error).__name__)
            report_validation_failure(api, job, "validation_failed")
            return
        try:
            report_validation_ready(api, job, page_count)
            api.json(f"/api/printer/jobs/{job['id']}/submission-started", {},
                     {"X-Print-Lease": job["lease_token"]})
        except Exception:
            import win32gui

            win32gui.DeleteDC(device_context)
            raise
        try:
            spooler_job_id = submit_pdf_to_printer(printable, device_context, job["copies"], job["color_mode"])
        except Exception:
            post_job_result(api, job, {"status": "unknown", "result_code": "submission_unknown", "spooler_job_id": None})
            return
        post_job_result(api, job, {"status": "submitted", "result_code": "submitted", "spooler_job_id": spooler_job_id})


def run_agent(config: AgentConfig) -> None:
    api = PrintApi(config)
    startup_errors = validate_startup(config)
    can_report_health = bool(config.secret and is_https_origin(config.base_url))
    if startup_errors:
        logging.error("Print Agent startup unavailable: %s", ",".join(startup_errors))
    if not can_report_health:
        logging.error("Print Agent cannot report unavailable health without an HTTPS URL and secret.")
        return
    next_heartbeat = 0.0
    while True:
        try:
            if time.monotonic() >= next_heartbeat:
                is_available = send_heartbeat(api, config, not startup_errors)
                if not is_available:
                    time.sleep(HEARTBEAT_SECONDS)
                    next_heartbeat = time.monotonic() + HEARTBEAT_SECONDS
                    continue
                next_heartbeat = time.monotonic() + HEARTBEAT_SECONDS
            claim = api.json("/api/printer/claim", {"runner_id": config.runner_id})
            job = claim.get("job")
            if job:
                print_job(api, config, job)
                continue
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError) as error:
            logging.warning("Print Agent request failed: %s", type(error).__name__)
            time.sleep(min(POLL_SECONDS * 2, HEARTBEAT_SECONDS))
        time.sleep(config.poll_seconds)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = AgentConfig.from_environment()
    run_agent(config)


if __name__ == "__main__":
    main()
