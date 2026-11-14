"""Secure DPAPI Credential Storage for Topkapi Print Agent.

Uses Windows Data Protection API (DPAPI) via pywin32 to encrypt secrets at rest.
Only the active Windows user account on this specific machine can decrypt the data.
No plaintext secrets are ever written to disk or logs.
"""
from __future__ import annotations

import sys
from pathlib import Path

import win32crypt

SECRET_FILE = Path(__file__).parent / "prod_secret.dpapi"


def save_secret_dpapi(secret: str) -> Path:
    """Encrypt and store secret using Windows DPAPI."""
    if not secret or len(secret) < 32:
        raise ValueError("Invalid secret length")
    raw = secret.strip().encode("utf-8")
    encrypted = win32crypt.CryptProtectData(
        raw, "Topkapi Print Agent Production Secret", None, None, None, 0
    )
    SECRET_FILE.write_bytes(encrypted)
    return SECRET_FILE


def load_secret_dpapi() -> str | None:
    """Decrypt and return secret in memory, or None if not present."""
    if not SECRET_FILE.is_file():
        return None
    encrypted = SECRET_FILE.read_bytes()
    description, raw = win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)
    return raw.decode("utf-8")


def has_saved_secret() -> bool:
    """Return True if encrypted secret file exists."""
    return SECRET_FILE.is_file()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "has_secret":
        print("true" if has_saved_secret() else "false")
