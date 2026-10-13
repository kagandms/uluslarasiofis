# Print settings rollout and staging UAT

## Compatibility contract

Migration `0012_print_options.sql` adds the original persisted paper/color/duplex settings. Migration `0013_print_orientation_volume.sql` adds portrait/landscape, expands copies to a hard ceiling of 50, enforces a 1,000-impression schema ceiling, and permits heartbeat protocol 2 while preserving existing records and indexes. Protocol 0 agents receive default A4 monochrome simplex portrait jobs only; protocol 1 agents may receive the previous paper/color/duplex combinations but only portrait and at most three copies. Protocol 2 is required for landscape or more than three copies.

Upload-intent requests include orientation and all print settings. The Worker validates them against its enabled options and configured limits, then D1 verifies the current heartbeat protocol at insert time. Idempotent replays must match every setting. A legacy agent cannot claim a landscape or high-copy job. After the Agent parses the document, both Agent and Worker validate the verified page count against the total impression budget before a job can become ready.

The Agent normalizes every page to the selected media geometry and centers it without cropping, then maps `orientation` to Sumatra's `portrait` / `landscape`, `paper_size` to A4/A3, `color_mode` to monochrome/color, `duplex` to simplex/duplexlong, and `copies` to `<n>x`. See [SumatraPDF command-line arguments](https://www.sumatrapdfreader.org/docs/Command-line-arguments). Physical A4/A3 orientation and Kyocera behavior still require Windows UAT.

## Staging rollout

1. Bring the Windows `print_agent.py` and `test_print_agent.py` changes from Antigravity into the project before modifying Agent files. Confirm the Windows `win32print` fix and all 15 tests are present.
2. Apply migrations 0012 and 0013 to staging D1, then deploy the Worker/UI with A3/color/duplex flags false and server limits `PRINT_MAX_COPIES_PER_JOB=50`, `PRINT_MAX_PAGE_COPIES=200`.
3. Install the updated Agent in the foreground on the school PC and confirm its protocol-2 heartbeat for the `Uluslararası Ofis` Windows queue.
4. Supervised staging UAT may temporarily enable color and duplex after office authorization. Keep A3 disabled until the A3 tray and driver path are verified.
5. Test synthetic PDF, JPG, and PNG files; portrait/landscape; copy boundaries; total impression-budget rejection; color/monochrome; simplex/long-edge duplex; offline/recovery; restart; pre-submission network failure; and connection loss after `submission_started`. Clean test jobs/objects manually while the scheduled cleanup issue remains open.

## Rollback

Disable non-default settings first and stop new print submissions. Drain or manually clean staging jobs, and verify no queued job requests settings unsupported by the previous Agent before rolling the Worker/UI back. Keep migrations 0012 and 0013; do not edit or reverse prior migrations. The known scheduled cleanup cron issue remains a production blocker.

## Staging checks

- Run the full local test suite, staging build, and Wrangler staging dry-run before any staging deployment.
- After staging deployment, check `/yazdir/` and `/api/public/print/status`; with flags disabled, only A4, monochrome, simplex should be offered.
- With a fresh protocol-1 heartbeat and supervised staging flags enabled, confirm the returned capabilities, D1 settings, Agent validation, and SumatraPDF command mapping agree exactly.
- Verify tampered, disabled, and unknown settings fail without creating a print job. Verify a legacy heartbeat remains on defaults.
- Do not use production, student documents, Windows Service installation, or real non-synthetic content during this UAT.
