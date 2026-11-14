import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fireblock_analysis.scraper_control import ScraperControl, config_for, credentials


def settings():
    return {"area": "One area", "west": "-123", "east": "-122", "south": "37", "north": "38",
        "start": "2026-11-10", "end": "2026-11-13", "max_products": "10", "cloud_cover": "30",
        "firms": True, "copernicus": True, "quicklooks": True, "products": False,
        "archive": False, "bucket": "", "sources": ["VIIRS_NOAA20_NRT"]}


class ControlTests(unittest.TestCase):
    def test_desktop_window_constructs_without_running_jobs(self):
        import tkinter as tk
        from tkinter import ttk
        from fireblock_analysis import scraper_ui
        observed = []
        def inspect(window):
            window.withdraw()
            window.update_idletasks()
            def descendants(widget):
                yield widget
                for child in widget.winfo_children():
                    yield from descendants(child)
            labels = [w.cget("text") for w in descendants(window) if isinstance(w, ttk.Button)]
            observed.extend(labels)
            window.destroy()
        with patch.object(tk.Tk, "mainloop", inspect):
            scraper_ui.main()
        for label in ("Start scrape", "Stop", "Save settings", "Open run folder"):
            self.assertIn(label, observed)

    def test_area_and_settings_validation(self):
        self.assertEqual(config_for(settings(), "out")["bbox"], [-123, 37, -122, 38])
        for change in ({"west": "nan"}, {"east": "-124"}, {"start": "2026-11-14"},
                {"sources": []}, {"max_products": "0"}, {"firms": False, "copernicus": False}):
            with self.assertRaises(ValueError):
                config_for({**settings(), **change}, "out")

    def test_environment_precedence_and_limited_dotenv(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"FIRMS_MAP_KEY": "inherited"}, clear=True):
            root = Path(tmp)
            (root / ".env").write_text('FIRMS_MAP_KEY=file\nCDSE_PASSWORD="private"\nPATH=bad\n')
            result = credentials(root)
            self.assertEqual(result["FIRMS_MAP_KEY"], "inherited")
            self.assertEqual(result["CDSE_PASSWORD"], "private")
            self.assertNotIn("PATH", result)

    def test_local_and_b2_wiring_with_redacted_logs(self):
        class Process:
            def __init__(self):
                self.stdout = io.StringIO("Downloading: product.zip\nsecret-value\n")
            def wait(self): return 0
            def poll(self): return 0
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            native = root / "build/native"
            native.mkdir(parents=True)
            for name in ("fireblock_ingest.exe", "fireblock_pipeline.exe"):
                (native / name).touch()
            control = ScraperControl(root)
            with patch.dict("os.environ", {"FIRMS_MAP_KEY": "secret-value", "B2_APPLICATION_KEY_ID": "id",
                    "B2_APPLICATION_KEY": "key", "B2_BUCKET_NAME": "bucket"}), patch(
                    "fireblock_analysis.scraper_control.subprocess.Popen", side_effect=lambda *a, **k: Process()) as spawn:
                job = control.start(settings())
                control.thread.join(3)
                self.assertFalse(control.active)
                self.assertIn("fireblock_ingest.exe", spawn.call_args.args[0][0])
                self.assertNotIn("secret-value", (job / "progress.log").read_text())
                self.assertNotIn("secret-value", (job / "ingest.json").read_text())
                self.assertEqual(json.loads((job / "ingest.json").read_text())["bbox"], [-123, 37, -122, 38])
                control.start({**settings(), "archive": True})
                control.thread.join(3)
                self.assertIn("fireblock_pipeline.exe", spawn.call_args.args[0][0])
                self.assertEqual(spawn.call_args.args[0][1], "scrape")

    def test_stop_terminates_only_owned_process(self):
        control = ScraperControl(Path.cwd())
        class Thread:
            def is_alive(self): return True
        class Process:
            terminated = False
            def poll(self): return None
            def terminate(self): self.terminated = True
        control.thread, control.process = Thread(), Process()
        with self.assertRaises(ValueError):
            control.start(settings())
        control.stop()
        self.assertTrue(control.cancel.is_set())
        self.assertTrue(control.process.terminated)


if __name__ == "__main__": unittest.main()
