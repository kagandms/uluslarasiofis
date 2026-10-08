# Print Agent

The agent runs on the office Windows PC and applies A4/A3, portrait/landscape, monochrome/color, simplex/long-edge duplex, and server-configured copy limits to each job. It reports settings protocol 3. Protocol 3 is required for landscape jobs because it supplies a per-job Windows DEVMODE to the printer driver. Protocol 2 remains eligible for portrait jobs; protocol 0/1 remains limited to portrait jobs and at most three copies.

Install the Python dependencies from `requirements.txt`, then configure these environment variables for the service account:

- `PRINT_AGENT_BASE_URL`: HTTPS origin of the deployed portal.
- `PRINTER_SECRET`: the machine API secret stored separately in the Worker environment.
- `PRINT_PRINTER_ID`: stable opaque identifier for this printer.
- `PRINT_RUNNER_ID`: stable opaque identifier for this agent instance.
- `PRINT_PRINTER_NAME`: exact Windows printer queue name.
- `PRINT_AGENT_TEMP_DIR`: private local directory for downloaded and normalized files.
- `PRINT_AGENT_POLL_SECONDS`: polling interval from 1 to 60 seconds (default 5).

Use `.env.example` as a names-only template; it is not automatically loaded. Set values for the Windows account using the office's approved secret/configuration mechanism. Never put the real `PRINTER_SECRET` in this repository. At startup the agent checks the HTTPS origin, secret presence, stable IDs, and writable temporary directory. Invalid configuration prevents job claims. When it can authenticate to the configured HTTPS origin, it reports an `unavailable` heartbeat until local prerequisites and the Windows printer queue are ready.

The agent checks PDF/JPG/PNG signatures against the declared type, downloads only content that matches the expected byte count and SHA-256, and parses the file locally before sending the verified page count. PDF pages and images are normalized to centered, uncropped A4/A3 pages. Paper orientation changes only the target page geometry and the Windows DEVMODE. Source content is never rotated merely because its dimensions differ from the paper. Existing PDF /Rotate and image EXIF orientation are preserved; the complete visible page is centered and scaled proportionally without cropping or changing its content flow. The Worker and Agent enforce the configured maximum copies and page-impression budget (`verified page count × copies`); defaults are 50 copies and 200 impressions per job. The D1 schema retains hard ceilings of 50 copies and 1,000 impressions. The per-job temporary directory is removed after processing.

Printing uses the Windows GDI spooler with a driver-returned DEVMODE copied for that job. Orientation, paper size, color mode, and duplex are validated by the driver before the job enters `submission_started`; the agent never calls `SetPrinter` or changes shared queue defaults. It checks the resulting physical page geometry before spooling, then renders each normalized PDF page at 300 DPI and fits it inside the printable area without cropping or distorting it. Copies are emitted as pages in one spool job, avoiding reliance on driver copy defaults. The Cloudflare-compatible `TopkapiPrintAgent/1.0` User-Agent is sent on API requests. Windows printer checks fail closed when the queue entry, status payload, or required status field is missing or malformed.

Monochrome jobs are rasterized to 8-bit grayscale before GDI receives page pixels. The Kyocera TASKalfa 2554ci KX driver can return `DMCOLOR_COLOR` after a monochrome request; that result is accepted only for a monochrome job, because its GDI raster contains no chromatic pixel data. This prevents color source content from reaching the color driver path, but does not prove the printer's toner selection or color-counter classification. Confirm those on the device during authorized physical UAT. Color jobs still require the driver's color DEVMODE value.

For the foreground test, open PowerShell under the intended Windows account, configure the variables above in that session, then run:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe .\print_agent.py
```

This starts the agent in the foreground. No Windows Service is installed by these steps. Confirm the intended driver and A4 tray are available before the first physical UAT.

A job is durably marked `submission_started` before the GDI spooler receives pages. Any ambiguous result after that point is reported as `unknown`; the agent never claims or prints that job again automatically. The Windows GDI and Kyocera driver combination must pass authorized portrait/landscape physical UAT before production use. Keep PRINT_ENABLED=false until physical UAT and explicit enablement approval. This package does not start an Agent or change the Worker.

## v7 orientation correction (settings protocol 3)

This package replaces the v6 paper-dependent PDF and JPG/PNG rotations. Protocol 3, limits, copies, monochrome handling, duplex and submission/duplicate protections remain compatible. See `AGENT_UPDATE.md` at the ZIP root. The Python suite contains raster comparisons of text, an asymmetric F, an upward arrow and border/corner markers; page dimensions alone are insufficient.

From the extracted package root, using the existing Python environment with the pinned dependencies installed:

```powershell
python -m unittest discover -s scripts\print_agent -p "test*.py"
```

This command runs tests and does not print or start the production Agent. Physical Test B must be repeated separately under office authorization.
