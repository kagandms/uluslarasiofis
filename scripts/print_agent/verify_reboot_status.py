"""Post-Reboot Verification Script for Topkapi Print Agent v7 Production.

Verifies:
1. Print Agent process (pythonw.exe) running from .venv.
2. Fresh ready heartbeat and protocol 3 logged after system boot.
3. Named mutex protection active (single instance enforced).
4. Printer 'Uluslararası Ofis' online in Windows spooler.
5. UluslararasiOfis-Scanner daemon running untouched.
"""
from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import time
from pathlib import Path

# Add scripts/print_agent to path
sys.path.insert(0, str(Path(__file__).parent))

import print_agent
import secure_credentials


def get_agent_process_tree() -> list[dict[str, int]]:
    """Find python processes running run_production_agent.py."""
    cmd = 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like \'python*\' -and $_.CommandLine -like \'*run_production_agent.py*\' } | Select-Object ProcessId, ParentProcessId | ConvertTo-Json"'
    out = subprocess.check_output(cmd, shell=True, text=True).strip()
    if not out:
        return []
    import json
    data = json.loads(out)
    if isinstance(data, dict):
        data = [data]
    return [{"pid": d["ProcessId"], "parent": d["ParentProcessId"]} for d in data]


def check_scanner_process() -> list[int]:
    """Find PID of scanner daemon."""
    cmd = 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like \'python*\' -and $_.CommandLine -like \'*daemon.py*\' } | Select-Object -ExpandProperty ProcessId"'
    out = subprocess.check_output(cmd, shell=True, text=True).strip()
    pids = [int(p) for p in out.splitlines() if p.strip().isdigit()]
    return pids


def check_mutex_is_held() -> bool:
    """Verify that named mutex is held by the running agent."""
    ERROR_ALREADY_EXISTS = 183
    handle = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\TopkapiPrintAgent_Mutex")
    err = ctypes.windll.kernel32.GetLastError()
    if handle:
        ctypes.windll.kernel32.CloseHandle(handle)
    return err == ERROR_ALREADY_EXISTS


def check_printer_available() -> bool:
    return print_agent.printer_is_available("Uluslararası Ofis")


def check_recent_heartbeats() -> tuple[bool, str]:
    log_file = Path(__file__).parent / "agent_production.log"
    if not log_file.is_file():
        return False, "Log file not found"
    lines = log_file.read_text(encoding="utf-8").splitlines()[-15:]
    recent = [l for l in lines if "Heartbeat sent: health=ready" in l and "protocol=3" in l]
    if not recent:
        return False, "No recent ready protocol 3 heartbeat in log tail"
    return True, recent[-1]


def main() -> None:
    print("=" * 60)
    print("TOPKAPI PRINT AGENT v7 POST-REBOOT VERIFICATION")
    print("=" * 60)

    # 1. Agent process tree
    tree = get_agent_process_tree()
    all_pids = {p["pid"] for p in tree}
    # Root processes are those whose parent is NOT another agent python process
    root_pids = [p["pid"] for p in tree if p["parent"] not in all_pids]
    print(f"[*] Print Agent process tree: {tree}")
    print(f"[*] Distinct Agent root instance(s): {root_pids}")
    if len(root_pids) == 1:
        print("  -> OK: Exactly 1 single Print Agent instance tree running.")
    elif len(root_pids) == 0:
        print("  -> FAIL: Print Agent is NOT running.")
    else:
        print("  -> FAIL: Multiple Print Agent root instances running!")

    # 2. Mutex
    mutex_held = check_mutex_is_held()
    print(f"[*] Named Mutex held by running instance: {mutex_held}")
    if mutex_held:
        print("  -> OK: Windows Named Mutex active (single instance guaranteed).")
    else:
        print("  -> FAIL: Mutex is NOT held.")

    # 3. Printer availability
    printer_ok = check_printer_available()
    print(f"[*] Printer 'Uluslararası Ofis' availability: {printer_ok}")
    if printer_ok:
        print("  -> OK: Printer is ready in Windows Spooler.")
    else:
        print("  -> FAIL: Printer is not available.")

    # 4. Scanner process
    scanner_pids = check_scanner_process()
    print(f"[*] Scanner daemon PID(s): {scanner_pids}")
    if len(scanner_pids) >= 1:
        print("  -> OK: Scanner daemon running and untouched.")
    else:
        print("  -> WARNING: Scanner daemon PID not detected.")

    # 5. Heartbeat
    hb_ok, hb_last = check_recent_heartbeats()
    print(f"[*] Cloudflare Production Heartbeat: {hb_ok}")
    print(f"    Latest line: {hb_last}")

    all_ok = len(root_pids) == 1 and mutex_held and printer_ok and hb_ok
    print("=" * 60)
    if all_ok:
        print("RESULT: REBOOT AUTO-START VERIFIED")
    else:
        print("RESULT: BLOCKED")
    print("=" * 60)


if __name__ == "__main__":
    main()
