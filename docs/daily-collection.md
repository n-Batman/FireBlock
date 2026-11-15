# Daily backend data collection

`python/worker_entry.py daily` collects current NWS weather and NASA FIRMS
detections, runs the mathematical risk pipeline and uses the analysis job's
existing storage/publication settings. Collection and scoring happen on the
backend. The frontend continues to read published regional grids.

## Configure

1. Build the existing C++ storage and ingestion executables with `build.cmd`,
   and install the Python package/dependencies in `.venv`.
2. Copy `config/daily.example.json` and point `analysis_job` at a real risk job.
   Its bbox sets the collection area. Its `source` identifies existing stored
   satellite inputs, or it can list explicit scenes. Replace the example raw
   manifest placeholder. The worker sets `risk.as_of` on every run.
3. Set `FIRMS_MAP_KEY` in the backend's environment or project-root `.env`.
   Storage uses the analysis job's existing B2 settings/credentials. Weather uses
   the project's NWS User-Agent; `NWS_USER_AGENT` in the process environment can
   supply another contact identifier. Credentials are not written into jobs.
4. Use a separate `state_dir` for each independently scheduled region/job.
   Run from the repository root; config/asset/executable paths follow the same
   working-directory convention as existing analysis commands.

```powershell
# Offline structure check: no downloads, uploads or publication.
.\.venv\Scripts\python.exe python/worker_entry.py daily config/daily.example.json --validate

# Run once if due; first invocation runs immediately.
.\.venv\Scripts\python.exe python/worker_entry.py daily config/daily.example.json

# Keep running on the backend; automatically collect/analyze every 24 hours.
.\.venv\Scripts\python.exe python/worker_entry.py daily config/daily.example.json --watch

# Optional manual refresh before the next scheduled run.
.\.venv\Scripts\python.exe python/worker_entry.py daily config/daily.example.json --force
```

The backend host must remain running and online. Run `--watch` under your
existing process supervisor or a Windows Task Scheduler startup task with the
repository as its working directory. Enable restart on failure and use a
non-interactive account with access to the executables, state directory and
credentials. Alternatively, invoke the one-shot command every five minutes;
the persisted gate performs provider work only when due. A once-per-day OS
trigger can drift behind the completion-based gate and skip a day.
No scheduled task or hosted service is installed by this code change.

## Timing, restarts and failures

- After a completed analysis, the next run is due 24 hours after completion.
  Watch mode checks every 60 seconds, so collection starts within a minute of
  that due time while the process is healthy.
- `.cache/daily-risk/state.json` records the last successful manifest and time.
  Restarting the process reuses that state. An overdue job runs once; missed
  days are not replayed as a backlog of stale weather requests.
- A process-held OS lock prevents overlapping runs in the same state directory.
  It releases when the process exits, including crashes; the empty lock file
  remaining on disk is harmless. `--force` still respects this lock.
- A provider or analysis failure records a redacted error type and run directory,
  preserves the last success timestamp, and delays retries for one hour. Provider
  URLs/exception bodies are not printed. Failed run inputs remain available for
  investigation. `--force` can retry immediately.
- Risk publication uses the existing verified pipeline. The daily schedule is
  advanced only after analysis returns a completed manifest. Its existing
  pointer/catalog ordering remains unchanged: a catalog failure after a verified
  pointer upload can leave the pointer updated even though the daily attempt fails.

Run directories contain configs, native FIRMS outputs, raw NWS responses and the
normalized snapshot. They are retained locally; provision disk space and archive
or remove old run directories according to your retention policy. The analysis
pipeline separately archives/hashes its weather and FIRMS input files in B2 when
uploads are enabled, then applies its existing artifact retention policy.

## Sources and coverage

FIRMS uses the existing C++ collector, including its bounded downloads, CSV
validation and retry handling. Dates roll forward automatically in UTC. The
default is today's partial day plus three previous days, covering the model's
default 72-hour hotspot window and overlapping daily collections to pick up NRT
revisions. Configure `firms.days` from 1 to 5. Today's results are filtered by
`risk.as_of` during scoring. Old FIRMS job inputs are replaced by the fresh batch.
An empty detection CSV with a valid header remains a valid result.

Weather uses [NWS points and hourly forecasts](https://www.weather.gov/documentation/services-web-api).
The collector samples the requested bbox at nominal 2 km spacing, with a default
maximum of 256 point lookups. Oversized requests fail validation rather than
silently reducing sampling density. Forecast URLs are deduplicated within the
run. Forecast responses are bounded to 8 MiB, have a 20-second socket timeout,
and retry transient failures up to three attempts. Provider links and redirects
are restricted to the NWS HTTPS origin and supported endpoint paths.

Wind ranges use the upper speed; supported quantitative wind units are converted
to mph. Temperatures are converted to Celsius. Forecast issue time and the
current hourly validity interval are retained. Each record keeps its actual
convex forecast footprint in `coverage_polygon`, plus its enclosing bbox;
the risk model requires the entire cell to be inside both. A box around a rotated
forecast cannot incorrectly extend its coverage. Sampling does not guarantee
complete regional coverage. Uncovered cells retain satellite-only scores and
explicit unavailable weather metadata. A collection with no fresh, complete
wind/humidity/temperature measurements fails and retries later.

The model's six-hour default weather issue-age limit applies at the generated
grid's `as_of`; published daily snapshots are not live weather. See
[mathematical-risk.md](mathematical-risk.md) for the provisional weather formula
and its limits. Existing imagery still ages out according to `scene_max_age_days`;
weather and FIRMS cannot turn missing/stale imagery into a known risk score.

## Future satellite connection

`daily.collect_satellite(job, settings, backend, destination)` is the explicit
adapter point before analysis. Today it returns already-stored scene descriptors
and the generated native ingestion config always sets `copernicus.enabled=false`.
`satellite.enabled=true` is rejected so a configuration cannot accidentally
start an imagery scrape.

A future adapter can return normal scene descriptors with pinned archive IDs,
acquisition timestamps and calibration metadata, then update the validation gate.
It can use the same backend and per-run directory. No satellite catalogue lookup,
new imagery download or Copernicus login is implemented by this daily runner.

## Checks

`python -m unittest discover -s python/tests` covers the persisted 24-hour gate,
forced refresh, retry delay, lock release/overlap, rolling FIRMS dates, replacement
of old detections, reuse of satellite scenes, disabled satellite scraping,
full pipeline publication, weather unit conversion, shared forecast deduplication,
stale/missing/future weather rejection, URL restrictions and rotated footprints.
