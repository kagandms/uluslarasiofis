from __future__ import annotations

import hashlib
import hmac
import json
import ssl
from dataclasses import dataclass
from typing import Mapping
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from scanner_config import ScannerConfig
from scanner_engine import MAX_BYTES
from scanner_job import ScanJob

@dataclass(frozen=True)
class Download:
    content: bytes
    sha256: str
    etag: str

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request: Request, response: object, code: int, message: str,
                         headers: Mapping[str, str], new_url: str) -> None:
        """Reject redirects so a machine secret never leaves its configured origin."""
        raise ValueError('redirect_rejected')


def verify_download(content: bytes, expected_size: int, expected_hash: str) -> None:
    """Validate byte count and SHA-256; raises ValueError for incomplete or substituted content."""
    if not 0 < expected_size <= MAX_BYTES or len(content) != expected_size:
        raise ValueError('content_mismatch')
    if not hmac.compare_digest(hashlib.sha256(content).hexdigest(), expected_hash):
        raise ValueError('content_mismatch')

class ScannerTransport:
    def __init__(self, config: ScannerConfig) -> None:
        self.config = config
        context = ssl.create_default_context(cafile=config.ca_file)
        self.opener = build_opener(NoRedirect(), HTTPSHandler(context=context))

    def request(self, path: str, body: Mapping[str, object] | None = None, token: str | None = None) -> object:
        """Make one bounded authenticated HTTPS call; callers redact network exceptions."""
        headers = {'Authorization': f'Bearer {self.config.secret}', 'Content-Type': 'application/json'}
        if token:
            headers['X-Scan-Lease'] = token
        request = Request(self.config.origin + '/api/scanner/' + path,
            data=json.dumps(body).encode() if body is not None else None, headers=headers)
        with self.opener.open(request, timeout=30) as response:
            response_bytes = response.read(65537)
        if len(response_bytes) > 65536:
            raise ValueError('response_too_large')
        return json.loads(response_bytes)

    def download(self, job: ScanJob) -> Download:
        """Download only the leased object; refuses redirects, wrong sizes and hash mismatch."""
        expected_size = job.byte_size
        if not isinstance(expected_size, int) or not 0 < expected_size <= MAX_BYTES:
            raise ValueError('content_mismatch')
        headers = {'Authorization': f'Bearer {self.config.secret}', 'X-Scan-Lease': str(job.lease_token)}
        request = Request(self.config.origin + f"/api/scanner/jobs/{job.id}/content", headers=headers)
        with self.opener.open(request, timeout=30) as response:
            if response.headers.get('Content-Length') != str(expected_size):
                raise ValueError('content_mismatch')
            sha256 = response.headers.get('X-Content-SHA256', '')
            etag = response.headers.get('X-Object-ETag', '')
            content = response.read(expected_size + 1)
        verify_download(content, expected_size, sha256)
        if not etag:
            raise ValueError('content_mismatch')
        return Download(content, sha256, etag)
