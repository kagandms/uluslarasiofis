"""Production Print Agent Runner with Secure DPAPI Secret Loading & Supervisor.

Runs Print Agent v7 connected to Cloudflare Production (goc.topkapiuni.workers.dev).
Loads credentials securely from Windows DPAPI without plaintext exposure.
Provides resilient startup handling (printer & network retries), automatic error
recovery, heartbeat logging, and single-instance mutex protection.

The poll interval is read from PRINT_AGENT_POLL_SECONDS (1-60, default 5).
"""
from __future__ import annotations

import ctypes
import logging
import os
import sys
import time
from pathlib import Path

# Add scripts/print_agent to path
sys.path.insert(0, str(Path(__file__).parent))

import print_agent
import secure_credentials

ERROR_ALREADY_EXISTS = 183
_MUTEX_HANDLE: object | None = None

PROD_BASE_URL = "https://goc.topkapiuni.workers.dev"
PRINTER_NAME = "Uluslararası Ofis"
PRINTER_ID = "office-printer-01"
RUNNER_ID = "office-runner-01"
TEMP_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "Temp/topkapi-print-agent"


def acquire_single_instance_mutex(mutex_name: str = "Local\\TopkapiPrintAgent_Mutex") -> object | None:
    """Acquire a Windows kernel named mutex to guarantee single instance execution."""
    global _MUTEX_HANDLE
    handle = ctypes.windll.kernel32.CreateMutexW(None, False, mutex_name)
    last_error = ctypes.windll.kernel32.GetLastError()
    if last_error == ERROR_ALREADY_EXISTS:
        return None
    _MUTEX_HANDLE = handle
    return handle


def initialize_production_config() -> print_agent.AgentConfig:
    secret = secure_credentials.load_secret_dpapi()
    if not secret:
        secret = os.environ.get("PRINTER_SECRET", "")
    if not secret:
        raise ValueError("Production PRINTER_SECRET is not available. Please store it via DPAPI first.")

    # Configure environment
    os.environ["PRINT_AGENT_BASE_URL"] = PROD_BASE_URL
    os.environ["PRINTER_SECRET"] = secret
    os.environ["PRINT_PRINTER_NAME"] = PRINTER_NAME
    os.environ["PRINT_PRINTER_ID"] = PRINTER_ID
    os.environ["PRINT_RUNNER_ID"] = RUNNER_ID
    os.environ["PRINT_AGENT_TEMP_DIR"] = str(TEMP_DIR)
    _poll = os.environ.get("PRINT_AGENT_POLL_SECONDS", "5")
    if not _poll.isdigit() or not (1 <= int(_poll) <= 60):
        _poll = "5"
    os.environ["PRINT_AGENT_POLL_SECONDS"] = _poll

    return print_agent.AgentConfig(
        base_url=PROD_BASE_URL,
        secret=secret,
        printer_id=PRINTER_ID,
        runner_id=RUNNER_ID,
        printer_name=PRINTER_NAME,
        temp_directory=TEMP_DIR,
        poll_seconds=int(os.environ["PRINT_AGENT_POLL_SECONDS"]),
    )


def install_heartbeat_logger() -> None:
    """Wrap send_heartbeat to log continuous proof-of-life heartbeats to the log."""
    orig_send_heartbeat = print_agent.send_heartbeat

    def logged_send_heartbeat(api: print_agent.PrintApi, config: print_agent.AgentConfig, has_prerequisites: bool) -> bool:
        is_available = orig_send_heartbeat(api, config, has_prerequisites)
        logging.info("Heartbeat sent: health=%s, printer='%s', protocol=%d",
                     "ready" if is_available else "unavailable",
                     config.printer_name,
                     print_agent.SETTINGS_PROTOCOL)
        return is_available

    print_agent.send_heartbeat = logged_send_heartbeat


def wait_for_prerequisites(config: print_agent.AgentConfig) -> None:
    """Wait for Windows print spooler and network connection to become available."""
    api = print_agent.PrintApi(config)
    attempt = 0
    while True:
        attempt += 1
        printer_ok = print_agent.printer_is_available(config.printer_name)
        if not printer_ok:
            if attempt % 6 == 1:
                logging.warning("Printer '%s' is not yet ready in Windows spooler. Retrying in 5s...",
                                config.printer_name)
            time.sleep(5)
            continue

        try:
            is_available = print_agent.send_heartbeat(api, config, True)
            if is_available:
                logging.info("PREREQUISITES READY: Printer '%s' available and initial heartbeat verified.",
                             config.printer_name)
                return
            else:
                if attempt % 6 == 1:
                    logging.warning("Initial heartbeat returned unavailable. Retrying in 5s...")
                time.sleep(5)
        except Exception as exc:
            if attempt % 6 == 1:
                logging.warning("Waiting for production connection (%s: %s). Retrying in 5s...",
                                type(exc).__name__, exc)
            time.sleep(5)


def main() -> None:
    handlers: list[logging.Handler] = [
        logging.FileHandler(Path(__file__).parent / "agent_production.log", encoding="utf-8"),
    ]
    if sys.stdout is not None:
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=handlers,
    )

    mutex = acquire_single_instance_mutex()
    if not mutex:
        logging.warning("Another instance of Topkapi Print Agent is already running. Exiting.")
        sys.exit(0)

    logging.info("Starting Topkapi Print Agent v7 Production Supervisor...")

    while True:
        try:
            config = initialize_production_config()
            break
        except Exception as exc:
            logging.error("Failed to load configuration / DPAPI secret: %s. Retrying in 5s...", exc)
            time.sleep(5)

    errors = print_agent.validate_startup(config)
    if errors:
        logging.error("Startup validation errors: %s", errors)
        sys.exit(1)

    install_heartbeat_logger()
    wait_for_prerequisites(config)

    # Supervisor loop: automatically recover from any unexpected errors
    logging.info("Entering main print agent supervisor loop (Protocol: %d)...",
                 print_agent.SETTINGS_PROTOCOL)
    while True:
        try:
            print_agent.run_agent(config)
        except KeyboardInterrupt:
            logging.info("Agent stopped by user.")
            break
        except Exception as exc:
            logging.exception("Unexpected error in agent runner loop: %s. Resuming loop in 5s...", exc)
            time.sleep(5)


if __name__ == "__main__":
    main()
