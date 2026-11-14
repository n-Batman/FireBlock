# Desktop scraper control

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
the panel does not automatically resume, delete files or retry ambiguous uploads.
Closing the window while active offers to stop the job first.

This is a one-area, one-job controller, with no scheduler or location search.
The area fields are explicit coordinates; no third-party map API is required.
