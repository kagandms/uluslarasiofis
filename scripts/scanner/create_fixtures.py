from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image
from pypdf import PdfWriter


def create_fixtures(directory: Path) -> None:
    """Create synthetic documents only; EICAR is a harmless antivirus test signature."""
    directory.mkdir(parents=True, exist_ok=True)
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_metadata({'/Title': 'Synthetic scanner acceptance'})
    with (directory / 'clean.pdf').open('wb') as document_file:
        writer.write(document_file)
    Image.new('RGB', (16, 16), 'white').save(directory / 'clean.png')
    Image.new('RGB', (16, 16), 'white').save(directory / 'clean.jpg')
    Image.new('RGB', (16, 16), 'white').save(directory / 'clean.webp')
    # Split the marker so this source tree is not itself an EICAR test object.
    marker = b'X5O!P%@AP[4' + b'\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
    (directory / 'eicar.png').write_bytes((directory / 'clean.png').read_bytes() + marker)
    writer.encrypt('synthetic-only-password')
    with (directory / 'encrypted.pdf').open('wb') as document_file:
        writer.write(document_file)
    (directory / 'broken.png').write_bytes(b'\x89PNG\r\n\x1a\ninvalid')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    create_fixtures(parser.parse_args().directory)
