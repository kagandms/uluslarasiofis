from __future__ import annotations

import io
import warnings
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from pypdf import PdfReader, PdfWriter
from pypdf.errors import FileNotDecryptedError, PdfReadError
from pypdf.generic import ArrayObject, NameObject

Outcome = Literal['rebuilt', 'rejected']

_ACTION_CODES: dict[str, str] = {
    '/JavaScript': 'javascript',
    '/Launch': 'launch',
    '/URI': 'uri_action',
    '/SubmitForm': 'submit_form',
}


@dataclass(frozen=True)
class RebuildResult:
    """Result of sanitizing an incoming PDF into a clean structural copy."""

    outcome: Outcome
    reason: str
    pdf_bytes: bytes | None
    pages: int
    removed: tuple[str, ...]


def _deref(obj: Any) -> Any:
    """Resolve a pypdf IndirectObject if needed."""
    return obj.get_object() if hasattr(obj, 'get_object') else obj


def _record(removed: list[str], code: str) -> None:
    """Append a removal code once, preserving discovery order."""
    if code not in removed:
        removed.append(code)


def _inspect_action(action_obj: Any, removed: list[str], depth: int = 0) -> bool:
    """Record active action codes in an action dictionary; return True if dangerous."""
    if depth > 16:
        return False
    action = _deref(action_obj)
    if not isinstance(action, Mapping):
        return False

    dangerous = False
    action_type = action.get('/S')
    if isinstance(action_type, str) and action_type in _ACTION_CODES:
        _record(removed, _ACTION_CODES[action_type])
        dangerous = True
    if '/JS' in action:
        _record(removed, 'javascript')
        dangerous = True

    next_action = action.get('/Next')
    if next_action is not None:
        resolved_next = _deref(next_action)
        if isinstance(resolved_next, list):
            for item in resolved_next:
                if _inspect_action(item, removed, depth + 1):
                    dangerous = True
        elif _inspect_action(resolved_next, removed, depth + 1):
            dangerous = True

    return dangerous


def _inspect_aa(aa_obj: Any, removed: list[str]) -> None:
    """Record additional-actions removal and any nested action types."""
    _record(removed, 'additional_actions')
    aa = _deref(aa_obj)
    if isinstance(aa, Mapping):
        for value in aa.values():
            _inspect_action(value, removed)


def _inspect_root(root_obj: Any, removed: list[str]) -> None:
    """Inspect the source root catalog for active content that the clean writer drops."""
    root = _deref(root_obj)
    if not isinstance(root, Mapping):
        return

    if '/OpenAction' in root:
        _record(removed, 'open_action')
        _inspect_action(root['/OpenAction'], removed)

    if '/AA' in root:
        _inspect_aa(root['/AA'], removed)

    names = _deref(root.get('/Names'))
    if isinstance(names, Mapping):
        if '/JavaScript' in names:
            _record(removed, 'javascript')
        if '/EmbeddedFiles' in names:
            _record(removed, 'embedded_files')

    if '/EmbeddedFiles' in root:
        _record(removed, 'embedded_files')

    acroform = _deref(root.get('/AcroForm'))
    if isinstance(acroform, Mapping):
        fields = _deref(acroform.get('/Fields'))
        if isinstance(fields, list):
            _inspect_fields(fields, removed)


def _inspect_fields(fields: list[Any], removed: list[str], depth: int = 0) -> None:
    """Walk AcroForm fields to record any embedded actions before the form is dropped."""
    if depth > 16:
        return
    for field_ref in fields:
        field = _deref(field_ref)
        if not isinstance(field, Mapping):
            continue
        if '/A' in field:
            _inspect_action(field['/A'], removed)
        if '/AA' in field:
            _inspect_aa(field['/AA'], removed)
        kids = _deref(field.get('/Kids'))
        if isinstance(kids, list):
            _inspect_fields(kids, removed, depth + 1)


def _sanitize_page(page: Any, removed: list[str]) -> None:
    """Strip page-level /AA and active annotations from a page before copying."""
    if '/AA' in page:
        _inspect_aa(page['/AA'], removed)
        page.pop('/AA', None)

    annots_ref = page.get('/Annots')
    if annots_ref is None:
        return
    annots = _deref(annots_ref)
    if not isinstance(annots, list):
        page.pop('/Annots', None)
        return

    kept_annots: list[Any] = []
    for annot_ref in annots:
        annot = _deref(annot_ref)
        if not isinstance(annot, Mapping):
            continue
        if annot.get('/Subtype') == '/FileAttachment':
            _record(removed, 'embedded_files')
            continue
        if '/AA' in annot:
            _inspect_aa(annot['/AA'], removed)
            annot.pop('/AA', None)
        if '/A' in annot and _inspect_action(annot['/A'], removed):
            continue
        if '/JS' in annot:
            _record(removed, 'javascript')
            continue
        kept_annots.append(annot_ref)

    if kept_annots:
        page[NameObject('/Annots')] = ArrayObject(kept_annots)
    else:
        page.pop('/Annots', None)


def rebuild_pdf(source_bytes: bytes, max_pages: int = 200) -> RebuildResult:
    """Rebuild an incoming PDF into a sanitized structural copy without active content."""
    if not isinstance(source_bytes, (bytes, bytearray)) or len(source_bytes) == 0:
        return RebuildResult('rejected', 'not_pdf', None, 0, ())

    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            try:
                reader = PdfReader(io.BytesIO(bytes(source_bytes)), strict=False)
            except PdfReadError:
                return RebuildResult('rejected', 'not_pdf', None, 0, ())

            if reader.is_encrypted:
                return RebuildResult('rejected', 'encrypted', None, 0, ())

            page_count = len(reader.pages)
            if page_count <= 0:
                return RebuildResult('rejected', 'unsupported_content', None, 0, ())
            if page_count > max_pages:
                return RebuildResult('rejected', 'too_many_pages', None, page_count, ())

            removed: list[str] = []
            _inspect_root(reader.trailer.get('/Root'), removed)

            writer = PdfWriter()
            for page in reader.pages:
                _sanitize_page(page, removed)
                writer.add_page(page)

            output = io.BytesIO()
            writer.write(output)
            return RebuildResult('rebuilt', '', output.getvalue(), page_count, tuple(removed))
    except FileNotDecryptedError:
        return RebuildResult('rejected', 'encrypted', None, 0, ())
    except PdfReadError:
        return RebuildResult('rejected', 'not_pdf', None, 0, ())
    except Exception:
        return RebuildResult('rejected', 'unsupported_content', None, 0, ())
