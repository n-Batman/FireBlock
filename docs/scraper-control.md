# Desktop scraper control

The UI retains at most 1024 recent events, with each displayed message limited
to 8192 characters. Older UI events are discarded if the window falls behind;
the full redacted `progress.log` stays on disk. Unexpected worker exceptions
terminate and reap the owned native process, escalating to a kill after a
five-second termination timeout. The error state includes the exception type
without including potentially sensitive exception text.

## Outward spiral and grid size

The controller now defaults to **1 km × 1 km collection boxes**. Change
**Collection box side (m)** to choose a different size (100–50,000 m). **Total boxes**
includes the first box and defaults to 9. The panel shows box dimensions and total
approximate collection area before starting. Settings can be saved and reused.

With spiral expansion enabled, the center of the entered west/south/east/north
area is the seed. The entered rectangle locates the center; it does not define
the size of every spiral box. Order is center → east → north → west → south,
with increasing run lengths (1,1,2,2,3,3,…). The first 9 boxes form a 3 × 3
region about **3 km × 3 km**, totaling **9 km²** at the default size.
With expansion disabled, only the exact entered rectangle is scraped.

Boxes are a contiguous longitude/latitude grid, approximately the chosen metre
size at the seed latitude. East-west size changes slightly as latitude changes.
Plans that cross the antimeridian or supported polar boundary are rejected
before collection starts. Maximum count is 1,000 boxes.

Boxes run sequentially. The progress bar counts completed boxes, with provider
and file progress in the log. Each box uses a separate output/archive batch;
cloud-backed cleanup still applies. The run's `collection-plan.json` records the
exact box coordinates, order, and completion state. A failure or Stop prevents
later boxes from starting; automatic resume is not implemented.

The product limit applies **per box**, not to the entire spiral. Satellite
products can intersect multiple boxes. Cloud-backed jobs now reuse verified
satellite assets by product UUID instead of downloading/archiving each one again;
see [satellite deduplication](satellite-deduplication.md). Collection boxes are
search regions, not pixel crops.
This setting does not change the independent risk-analysis grid (`risk.cell_km`)
or the native Sentinel-2 pixel resolutions.

Double-click `scraper-control.cmd` in the FireBlock folder. This opens a basic
local desktop window; there is no web server or hosted account to configure.

Prerequisites: build the C++ programs with `build.cmd`, and have the project
Python environment (`.venv`) with Tkinter. The window can also be started with
`.venv\Scripts\python.exe -m fireblock_analysis.scraper_ui`.

If this Python 3.14 installation reports missing `init.tcl`, first run
`.venv\Scripts\python.exe scripts/setup_tk.py` to restore official Tcl/Tk 9.0.4
script data locally. Other Python/Tcl versions need their matching Tk runtime.

Enter one named rectangular area using west/south/east/north decimal degrees.
Set UTC start/end dates (end is exclusive), select Copernicus and/or FIRMS, and
choose preview/full imagery, product/cloud limits and FIRMS sensors. Full
Sentinel-2 L2A imagery is required for subsequent raster risk scoring.

Click **Save settings** to keep the current area, or **Start scrape** to collect.
The window locks settings during a job and shows provider, file and upload
activity as it arrives. The moving indicator means the job is active; it is not
a byte percentage or an ETA. Large individual downloads can take time between
messages. A successful run ends with **Complete**; failures show their exit code
and backend diagnostics in the log.

Credentials are read from the project `.env` or inherited environment. Required:
`FIRMS_MAP_KEY` for FIRMS, `CDSE_USERNAME`/`CDSE_PASSWORD` for full Copernicus
products, and the existing B2 key pair for archiving. Environment values take
precedence. The UI does not display credential values. It saves settings in
Git-ignored `config/scraper-ui.local.json`; credentials are not copied there.

Without archiving, the controller calls `fireblock_ingest`. With **Also archive
raw data in Backblaze B2**, it calls `fireblock_pipeline scrape`, using an existing
bucket from the field or `B2_BUCKET_NAME`. Each run has a fresh `raw-work/ui-*/`
directory containing the exact submitted ingestion configuration, downloaded
files and a redacted `progress.log`. **Open run folder** opens this directory.
Successful archive jobs report their manifest file ID in the log for later
retrieval or risk-map processing.

**Stop** terminates the active native process. Completed files stay on disk;
an interrupted transfer may leave a `.part` file. A stopped archive can leave
uploaded objects without a complete manifest. A new run uses a fresh directory;
the panel does not automatically resume or delete interrupted files.

Backblaze HTTP 500 and other 5xx storage errors now get four total attempts with
1, 2 and 4 second delays. Each retry appears in the progress log. Uploads check a
unique stored receipt before being retried, and use a fresh upload URL. Exhausted
attempts stop the current box and prevent later boxes from starting. The panel
shows a **Scraper stopped** error dialog, and the run folder retains `error.json`
with the failed box and redacted backend message. Completed boxes remain archived.
See [storage retries](storage-retries.md) for scope and failure semantics.
Closing the window while active offers to stop the job first.

This is a one-area, one-job controller, with no scheduler or location search.
The area fields are explicit coordinates; no third-party map API is required.
