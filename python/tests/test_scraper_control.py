import io
import json
import tempfile
import subprocess
import sys
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
    def test_exhausted_backend_retries_report_error_and_stop_later_boxes(self):
        class Process:
            def __init__(self):
                self.stdout = io.StringIO('Backblaze upload: HTTP 500; retry 4/4 in 4 seconds\n'
                    'Raw pipeline failed: Backblaze upload failed with HTTP 500 after 4 attempts. secret-value\n')
            def wait(self): return 1
            def poll(self): return 1
        with tempfile.TemporaryDirectory() as tmp:
            control = ScraperControl(tmp)
            plan = {"tiles": [{"offset": [0, 0], "bbox": [0, 0, 1, 1]},
                              {"offset": [1, 0], "bbox": [1, 0, 2, 1]}]}
            with patch("fireblock_analysis.scraper_control.subprocess.Popen", return_value=Process()) as spawn:
                control._run([["first"], ["second"]], {"FIRMS_MAP_KEY": "secret-value"}, Path(tmp), plan)
            self.assertEqual(spawn.call_count, 1)
            error = json.loads((Path(tmp) / "error.json").read_text())
            self.assertEqual((error["box"], error["exit_code"]), (1, 1))
            self.assertIn("HTTP 500 after 4 attempts", error["message"])
            self.assertNotIn("secret-value", error["message"])
            self.assertIn("[redacted]", error["message"])
            saved = json.loads((Path(tmp) / "collection-plan.json").read_text())
            self.assertEqual(saved["tiles"][0]["status"], "failed")
            self.assertNotIn("status", saved["tiles"][1])
            events = [control.events.get_nowait() for _ in range(control.events.qsize())]
            self.assertTrue(any(kind == "error" and "after 4 attempts" in text for kind, text in events))

    def test_slow_ui_has_bounded_recent_events_and_latest_state(self):
        control = ScraperControl(Path.cwd())
        for i in range(50000):
            control.events.put(("log", f"message {i}"))
        control.events.put(("log", "x" * 20000))
        control.events.put(("state", "Complete"))
        self.assertEqual(control.events.qsize(), 1024)
        events = [control.events.get_nowait() for _ in range(1024)]
        self.assertEqual(events[-1], ("state", "Complete"))
        self.assertEqual(len(events[-2][1]), 8192)
        self.assertNotIn(("log", "message 0"), events)

    def test_read_failure_reaps_child_and_kills_if_terminate_times_out(self):
        for stubborn in (False, True):
            class BrokenOutput(io.StringIO):
                def __next__(self):
                    raise MemoryError("simulated allocation failure")
            class Process:
                def __init__(self):
                    self.stdout = BrokenOutput()
                    self.terminated = self.killed = self.reaped = False
                    self.code = None
                def poll(self): return self.code
                def terminate(self): self.terminated = True
                def kill(self): self.killed = True
                def wait(self, timeout=None):
                    if stubborn and not self.killed:
                        raise subprocess.TimeoutExpired("fake-child", timeout)
                    self.code = -1
                    self.reaped = True
                    return self.code
            with tempfile.TemporaryDirectory() as tmp:
                process = Process()
                control = ScraperControl(tmp)
                with patch("fireblock_analysis.scraper_control.subprocess.Popen", return_value=process):
                    control._run([["fake-child"]], {}, Path(tmp), {"tiles": [{"offset": [0, 0]}]})
                self.assertTrue(process.terminated)
                self.assertEqual(process.killed, stubborn)
                self.assertTrue(process.reaped)
                self.assertTrue(process.stdout.closed)
                self.assertIsNone(control.process)
                self.assertFalse(control.active)

    def test_worker_exception_stops_a_real_owned_child(self):
        class BrokenOutput(io.StringIO):
            def __next__(self):
                raise MemoryError("simulated allocation failure")
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                                   stdout=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        process.stdout.close()
        process.stdout = BrokenOutput()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                control = ScraperControl(tmp)
                with patch("fireblock_analysis.scraper_control.subprocess.Popen", return_value=process):
                    control._run([["owned-child"]], {}, Path(tmp), {"tiles": [{"offset": [0, 0]}]})
                self.assertIsNotNone(process.poll())
                self.assertFalse(control.active)
                self.assertTrue(process.stdout.closed)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)

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
