from __future__ import annotations

import logging
import sys
import warnings
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

Image.MAX_IMAGE_PIXELS = 25_000_000


def validate_content(document_path: Path, media_type: str) -> None:
    """Require parseable PDF or fully decoded accepted image; raises for encrypted/broken content."""
    with warnings.catch_warnings():
        warnings.simplefilter('error')
        if media_type == 'application/pdf':
            reader = PdfReader(document_path, strict=True)
            if reader.is_encrypted or not 0 < len(reader.pages) <= 500:
                raise ValueError('policy_blocked')
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
    except Exception:
        # The parent emits a fixed code; parser exceptions can contain document bytes/names.
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
