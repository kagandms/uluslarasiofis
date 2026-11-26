from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

SCANNER_DIRECTORY = Path(__file__).resolve().parents[2] / 'scripts' / 'scanner'
sys.path.insert(0, str(SCANNER_DIRECTORY))

from pdf_rebuild import RebuildResult, rebuild_pdf  # noqa: E402


def _make_text_pdf(pages: int = 1) -> bytes:
    writer = PdfWriter()
    for index in range(pages):
        page = writer.add_blank_page(width=612, height=792)
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 72 720 Td (Page {index + 1}) Tj ET'.encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(stream)
        page[NameObject('/Resources')] = DictionaryObject(
            {
                NameObject('/Font'): DictionaryObject(
                    {
                        NameObject('/F1'): DictionaryObject(
                            {
                                NameObject('/Type'): NameObject('/Font'),
                                NameObject('/Subtype'): NameObject('/Type1'),
                                NameObject('/BaseFont'): NameObject('/Helvetica'),
                            }
                        )
                    }
                )
            }
        )
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class PdfRebuildTests(unittest.TestCase):
    def test_plain_text_pdf_is_rebuilt_preserving_pages_and_text(self) -> None:
        source = _make_text_pdf(pages=2)
        result = rebuild_pdf(source)

        self.assertIsInstance(result, RebuildResult)
        self.assertEqual(result.outcome, 'rebuilt')
        self.assertEqual(result.reason, '')
        self.assertEqual(result.pages, 2)
        self.assertEqual(result.removed, ())
        self.assertIsNotNone(result.pdf_bytes)

        reopened = PdfReader(io.BytesIO(result.pdf_bytes))
        self.assertEqual(len(reopened.pages), 2)
        self.assertIn('Page 1', reopened.pages[0].extract_text())

    def test_open_action_javascript_is_stripped_and_recorded(self) -> None:
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        js_action = DictionaryObject(
            {
                NameObject('/Type'): NameObject('/Action'),
                NameObject('/S'): NameObject('/JavaScript'),
                NameObject('/JS'): TextStringObject('app.alert("test");'),
            }
        )
        writer._root_object[NameObject('/OpenAction')] = writer._add_object(js_action)
        buf = io.BytesIO()
        writer.write(buf)

        result = rebuild_pdf(buf.getvalue())

        self.assertEqual(result.outcome, 'rebuilt')
        self.assertEqual(result.reason, '')
        self.assertIn('open_action', result.removed)
        self.assertIn('javascript', result.removed)
        self.assertIsNotNone(result.pdf_bytes)

        reopened = PdfReader(io.BytesIO(result.pdf_bytes))
        root = reopened.trailer['/Root'].get_object()
        self.assertNotIn('/OpenAction', root)
        names = root.get('/Names')
        if names is not None:
            self.assertNotIn('/JavaScript', names.get_object())

    def test_embedded_file_is_stripped_and_recorded(self) -> None:
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        writer.add_attachment('payload.txt', b'embedded content')
        buf = io.BytesIO()
        writer.write(buf)

        result = rebuild_pdf(buf.getvalue())

        self.assertEqual(result.outcome, 'rebuilt')
        self.assertIn('embedded_files', result.removed)
        self.assertIsNotNone(result.pdf_bytes)

        reopened = PdfReader(io.BytesIO(result.pdf_bytes))
        root = reopened.trailer['/Root'].get_object()
        names = root.get('/Names')
        if names is not None:
            self.assertNotIn('/EmbeddedFiles', names.get_object())

    def test_page_additional_actions_and_active_annotations_are_stripped(self) -> None:
        writer = PdfWriter()
        page = writer.add_blank_page(width=612, height=792)
        page[NameObject('/AA')] = DictionaryObject(
            {
                NameObject('/O'): DictionaryObject(
                    {
                        NameObject('/S'): NameObject('/JavaScript'),
                        NameObject('/JS'): TextStringObject('app.beep();'),
                    }
                )
            }
        )
        uri_annot = DictionaryObject(
            {
                NameObject('/Type'): NameObject('/Annot'),
                NameObject('/Subtype'): NameObject('/Link'),
                NameObject('/Rect'): ArrayObject(
                    [NumberObject(0), NumberObject(0), NumberObject(100), NumberObject(100)]
                ),
                NameObject('/A'): DictionaryObject(
                    {
                        NameObject('/S'): NameObject('/URI'),
                        NameObject('/URI'): TextStringObject('https://example.invalid'),
                    }
                ),
            }
        )
        launch_annot = DictionaryObject(
            {
                NameObject('/Type'): NameObject('/Annot'),
                NameObject('/Subtype'): NameObject('/Link'),
                NameObject('/Rect'): ArrayObject(
                    [NumberObject(10), NumberObject(10), NumberObject(50), NumberObject(50)]
                ),
                NameObject('/A'): DictionaryObject(
                    {
                        NameObject('/S'): NameObject('/Launch'),
                        NameObject('/F'): TextStringObject('calc.exe'),
                    }
                ),
            }
        )
        page[NameObject('/Annots')] = ArrayObject(
            [writer._add_object(uri_annot), writer._add_object(launch_annot)]
        )
        buf = io.BytesIO()
        writer.write(buf)

        result = rebuild_pdf(buf.getvalue())

        self.assertEqual(result.outcome, 'rebuilt')
        self.assertIn('additional_actions', result.removed)
        self.assertIn('javascript', result.removed)
        self.assertIn('uri_action', result.removed)
        self.assertIn('launch', result.removed)
        self.assertIsNotNone(result.pdf_bytes)

        reopened = PdfReader(io.BytesIO(result.pdf_bytes))
        rebuilt_page = reopened.pages[0]
        self.assertNotIn('/AA', rebuilt_page)
        self.assertNotIn('/Annots', rebuilt_page)

    def test_encrypted_pdf_is_rejected(self) -> None:
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        writer.encrypt('secret-password')
        buf = io.BytesIO()
        writer.write(buf)

        result = rebuild_pdf(buf.getvalue())

        self.assertEqual(result.outcome, 'rejected')
        self.assertEqual(result.reason, 'encrypted')
        self.assertIsNone(result.pdf_bytes)

    def test_too_many_pages_is_rejected(self) -> None:
        source = _make_text_pdf(pages=3)
        result = rebuild_pdf(source, max_pages=2)

        self.assertEqual(result.outcome, 'rejected')
        self.assertEqual(result.reason, 'too_many_pages')
        self.assertIsNone(result.pdf_bytes)

    def test_random_bytes_are_rejected_as_not_pdf(self) -> None:
        result = rebuild_pdf(b'not-a-pdf-\x00\x01\x02\x03')

        self.assertEqual(result.outcome, 'rejected')
        self.assertEqual(result.reason, 'not_pdf')
        self.assertIsNone(result.pdf_bytes)
        self.assertEqual(result.pages, 0)

    def test_unexpected_pypdf_error_returns_unsupported_content(self) -> None:
        with patch('pdf_rebuild.PdfReader', side_effect=RuntimeError('unexpected')):
            result = rebuild_pdf(b'%PDF-1.4\n')

        self.assertEqual(result, RebuildResult('rejected', 'unsupported_content', None, 0, ()))


if __name__ == '__main__':
    unittest.main()
