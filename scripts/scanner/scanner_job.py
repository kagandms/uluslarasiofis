from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping

from scanner_engine import MAX_BYTES

@dataclass(frozen=True)
class ScanJob:
    id: str
    file_id: str
    revision_id: str
    storage_key: str
    byte_size: int
    media_type: str
    lease_until: str
    lease_token: str


def parse_job(payload: object) -> ScanJob | None:
    """Narrow a server DTO into one bounded job; raises ValueError for malformed authority."""
    if not isinstance(payload, dict) or 'job' not in payload:
        raise ValueError('invalid_job')
    fields = payload['job']
    if fields is None:
        return None
    if not isinstance(fields, dict) or set(fields) != set(ScanJob.__dataclass_fields__):
        raise ValueError('invalid_job')
    for name in ('id', 'file_id', 'revision_id'):
        if not isinstance(fields[name], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', fields[name]):
            raise ValueError('invalid_job')
    if not re.fullmatch(r'quarantine/[a-fA-F0-9-]{36}', fields['storage_key']):
        raise ValueError('invalid_job')
    if not isinstance(fields['byte_size'], int) or not 0 < fields['byte_size'] <= MAX_BYTES:
        raise ValueError('invalid_job')
    if fields['media_type'] not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'):
        raise ValueError('invalid_job')
    if not re.fullmatch(r'[a-f0-9]{64}', fields['lease_token']):
        raise ValueError('invalid_job')
    lease_until = datetime.fromisoformat(fields['lease_until'].replace('Z', '+00:00'))
    if lease_until.tzinfo is None or not 0 < (lease_until - datetime.now(timezone.utc)).total_seconds() <= 330:
        raise ValueError('invalid_job')
    return ScanJob(**fields)
