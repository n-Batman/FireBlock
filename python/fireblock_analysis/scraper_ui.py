"""No-dependency desktop control panel for one scraper area."""
import json
import os
from datetime import date, timedelta
from pathlib import Path
from queue import Empty
import tkinter as tk
from tkinter import messagebox, ttk

from .scraper_control import ScraperControl, SOURCES, config_for


def main():
    root_path = Path(__file__).resolve().parents[2]
    runtime = root_path / ".venv/tk-runtime"
    for key, folder, marker in (("TCL_LIBRARY", "tcl9.0", "init.tcl"), ("TK_LIBRARY", "tk9.0", "tk.tcl")):
        if (runtime / folder / marker).is_file():
            os.environ.setdefault(key, str(runtime / folder))
    control = ScraperControl(root_path)
    saved = root_path / "config/scraper-ui.local.json"
    today = date.today()
    settings = {"area": "My area", "west": "-122.6", "south": "37.0", "east": "-121.5", "north": "38.1",
        "start": str(today - timedelta(days=3)), "end": str(today), "copernicus": True, "firms": True,
        "cloud_cover": "30", "max_products": "10", "quicklooks": True, "products": False,
        "archive": False, "bucket": "", "sources": [SOURCES[0]]}
    if saved.is_file():
        try:
            previous = json.loads(saved.read_text(encoding="utf-8"))
            settings.update({k: v for k, v in previous.items() if k in settings})
        except (ValueError, OSError):
            pass
    window = tk.Tk()
    window.title("FireBlock — scraper control")
    window.geometry("790x830")
    frame = ttk.Frame(window, padding=16)
    frame.pack(fill="both", expand=True)
    variables, widgets = {}, []
    ttk.Label(frame, text="Scraper control", font=("Segoe UI", 18, "bold")).pack(anchor="w")
    ttk.Label(frame, text="One area · one job at a time. Settings are locked while collecting.").pack(anchor="w", pady=(2, 12))
    def group(title):
        box = ttk.LabelFrame(frame, text=title, padding=8)
        box.pack(fill="x", pady=4)
        return box
    def field(parent, label, key, row, col=0, width=17):
        variables[key] = tk.StringVar(value=settings[key])
        ttk.Label(parent, text=label).grid(row=row, column=col, sticky="w", padx=5)
        entry = ttk.Entry(parent, textvariable=variables[key], width=width)
        entry.grid(row=row, column=col + 1, sticky="ew", padx=5, pady=3)
        widgets.append(entry)
    def check(parent, label, key):
        variables[key] = tk.BooleanVar(value=settings[key])
        button = ttk.Checkbutton(parent, text=label, variable=variables[key])
        button.pack(anchor="w", pady=2)
        widgets.append(button)
    area = group("1. Area — decimal degrees (longitude west/east, latitude south/north)")
    field(area, "Area name", "area", 0, width=25)
    field(area, "West", "west", 1)
    field(area, "East", "east", 1, 2)
    field(area, "South", "south", 2)
    field(area, "North", "north", 2, 2)
    dates = group("2. Dates — YYYY-MM-DD, UTC; end date is excluded")
    field(dates, "Start", "start", 0)
    field(dates, "End", "end", 0, 2)
    providers = group("3. Data")
    left, right = ttk.Frame(providers), ttk.Frame(providers)
    left.pack(side="left", fill="both", expand=True)
    right.pack(side="left", fill="both", expand=True)
    check(left, "Copernicus Sentinel-2 L2A", "copernicus")
    check(left, "Preview images", "quicklooks")
    check(left, "Full imagery (needed for risk scoring; large files)", "products")
    controls = ttk.Frame(left)
    controls.pack(anchor="w")
    field(controls, "Max products", "max_products", 0, width=8)
    field(controls, "Cloud limit %", "cloud_cover", 1, width=8)
    check(right, "NASA FIRMS detections", "firms")
    sensors = {}
    for source in SOURCES:
        var = sensors[source] = tk.BooleanVar(value=source in settings["sources"])
        button = ttk.Checkbutton(right, text=source, variable=var)
        button.pack(anchor="w")
        widgets.append(button)
    storage = group("4. Save data")
    check(storage, "Also archive raw data in Backblaze B2", "archive")
    bucket = ttk.Frame(storage)
    bucket.pack(anchor="w")
    field(bucket, "B2 bucket (blank uses .env)", "bucket", 0, width=30)
    ttk.Label(storage, text="Credentials: project .env or environment. Local files stay in raw-work/.").pack(anchor="w", pady=3)
    actions = ttk.Frame(frame)
    actions.pack(fill="x", pady=8)
    status = tk.StringVar(value="Idle")
    ttk.Label(actions, textvariable=status).pack(side="right")
    activity = ttk.Progressbar(frame, mode="indeterminate")
    activity.pack(fill="x")
    log_frame = ttk.Frame(frame)
    log_frame.pack(fill="both", expand=True, pady=6)
    log = tk.Text(log_frame, height=10, wrap="word", state="disabled")
    scroll = ttk.Scrollbar(log_frame, command=log.yview)
    log.configure(yscrollcommand=scroll.set)
    scroll.pack(side="right", fill="y")
    log.pack(fill="both", expand=True)
    last_folder = None
    def append(text):
        log.configure(state="normal")
        log.insert("end", text + "\n")
        if int(log.index("end-1c").split(".")[0]) > 2000:
            log.delete("1.0", "200.0")
        log.see("end")
        log.configure(state="disabled")
    def collect():
        result = {key: var.get() for key, var in variables.items()}
        result["sources"] = [source for source, var in sensors.items() if var.get()]
        return result
    def save():
        try:
            value = collect()
            config_for(value, "raw-work/preview")
            saved.write_text(json.dumps(value, indent=2), encoding="utf-8")
            append("Saved one-area settings.")
        except (ValueError, OSError) as exc:
            messagebox.showerror("Settings", str(exc))
    def start():
        nonlocal last_folder
        try:
            value = collect()
            config_for(value, "raw-work/preview")
            saved.write_text(json.dumps(value, indent=2), encoding="utf-8")
            last_folder = control.start(value)
            append(f"Area: {value['area']} | W/S/E/N: {value['west']}, {value['south']}, {value['east']}, {value['north']}")
            append(f"Run folder: {last_folder}")
            for widget in widgets:
                widget.configure(state="disabled")
            start_button.configure(state="disabled")
            save_button.configure(state="disabled")
            stop_button.configure(state="normal")
            activity.start()
        except (ValueError, OSError) as exc:
            messagebox.showerror("Cannot start scraper", str(exc))
    start_button = ttk.Button(actions, text="Start scrape", command=start)
    start_button.pack(side="left", padx=3)
    stop_button = ttk.Button(actions, text="Stop", command=control.stop, state="disabled")
    stop_button.pack(side="left", padx=3)
    save_button = ttk.Button(actions, text="Save settings", command=save)
    save_button.pack(side="left", padx=3)
    ttk.Button(actions, text="Open run folder", command=lambda: os.startfile(last_folder or root_path / "raw-work") if (last_folder or root_path / "raw-work").exists() else None).pack(side="left", padx=3)
    def poll():
        try:
            while True:
                kind, value = control.events.get_nowait()
                if kind == "state":
                    status.set(value)
                append(value)
        except Empty:
            pass
        if not control.active and str(start_button["state"]) == "disabled":
            activity.stop()
            for widget in widgets:
                widget.configure(state="normal")
            start_button.configure(state="normal")
            save_button.configure(state="normal")
            stop_button.configure(state="disabled")
        window.after(200, poll)
    def close():
        if control.active:
            if not messagebox.askyesno("Stop scraper?", "A job is running. Stop it and close? Completed downloads will remain."):
                return
            control.stop()
            window.after(100, close_when_stopped)
        else:
            window.destroy()
    def close_when_stopped():
        if control.active:
            window.after(100, close_when_stopped)
        else:
            window.destroy()
    window.protocol("WM_DELETE_WINDOW", close)
    poll()
    window.mainloop()


if __name__ == "__main__":
    main()
