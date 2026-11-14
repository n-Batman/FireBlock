"""Restore upstream Tcl/Tk 9.0.4 script data matching this Python runtime's DLLs."""
import io
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parents[1] / ".venv/tk-runtime"
for project in ("tcl", "tk"):
    url = f"https://codeload.github.com/tcltk/{project}/zip/refs/tags/core-9-0-4"
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise RuntimeError("Release archive exceeds limit")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        prefix = f"{project}-core-9-0-4/library/"
        for entry in archive.infolist():
            if not entry.filename.startswith(prefix) or entry.is_dir():
                continue
            relative = PurePosixPath(entry.filename[len(prefix):])
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Unsafe archive path")
            target = root / (project + "9.0") / Path(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))
    print(f"Installed {project} 9.0.4 script libraries")
