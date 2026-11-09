from __future__ import annotations

import logging
import sys
import warnings
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

Image.MAX_IMAGE_PIXELS = 25_000_000


EXIT_UNREADABLE = 2
EXIT_POLICY = 3
KNOWN_CODES = {'policy_blocked', 'unsupported_content'}


def validate_content(document_path: Path, media_type: str) -> None:
    """Require parseable PDF or fully decoded accepted image; raises for encrypted/broken content.

    Recoverable parser warnings (slightly malformed xref tables, odd EXIF blocks) are tolerated because
    ClamAV already scanned the same bytes with broken-file alerts on; only unreadable files and
    decompression-bomb warnings are rejected here.
    """
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        if media_type == 'application/pdf':
            reader = PdfReader(document_path, strict=False)
            # PDFs "encrypted" only for permission flags (empty user password) open for everyone, so they are
            # allowed; anything that needs a real password stays blocked.
            if reader.is_encrypted and not reader.decrypt(''):
                raise ValueError('policy_blocked')
            page_count = len(reader.pages)
            if not 0 < page_count <= 500:
                raise ValueError('policy_blocked' if page_count > 500 else 'unsupported_content')
            reader.pages[0].mediabox  # first page must be reachable
            return
        expected_format = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}.get(media_type)
        if expected_format is None:
            raise ValueError('unsupported_content')
        with Image.open(document_path) as image:
            if image.format != expected_format or getattr(image, 'n_frames', 1) != 1:
                raise ValueError('unsupported_content')
            image.load()


def main() -> int:
    """Run validation isolated from the runner and bounded by its parent timeout."""
    logging.disable(logging.CRITICAL)
    try:
        validate_content(Path(sys.argv[1]), sys.argv[2])
        return 0
    except ValueError as error:
        # Only our own fixed codes are mapped; parser exception text can contain document bytes/names.
        sys.stderr.write(f'reason={error.__class__.__name__}:{str(error) if str(error) in KNOWN_CODES else "other"}')
        return EXIT_POLICY if str(error) == 'policy_blocked' and error.__class__ is ValueError else EXIT_UNREADABLE
    except Exception as error:
        # Only the exception class name is emitted; its message can contain document bytes/names.
        sys.stderr.write(f'reason={error.__class__.__name__}')
        return EXIT_UNREADABLE

if __name__ == '__main__':
    raise SystemExit(main())
