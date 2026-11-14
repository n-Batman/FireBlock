import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fireblock_analysis.scraper_control import collection_tiles, ScraperControl
from test_scraper_control import settings


class SpiralTests(unittest.TestCase):
    def test_default_1000_metres_and_user_selected_size(self):
        value = {**settings(), "spiral": True, "box_count": "9"}
        box = collection_tiles(value)[0]["bbox"]
        self.assertAlmostEqual((box[3]-box[1])*111195, 1000, places=5)
        bigger = collection_tiles({**value, "box_m": "500"})[0]["bbox"]
        self.assertAlmostEqual((bigger[3]-bigger[1])*111195, 500, places=5)
    def test_order_unique_neighbors_and_box_size(self):
        value = {**settings(), "spiral": True, "box_km": "2", "box_count": "9"}
        tiles = collection_tiles(value)
        self.assertEqual([t["offset"] for t in tiles], [[0,0],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]])
        self.assertEqual(len({tuple(t["bbox"]) for t in tiles}), 9)
        box = tiles[0]["bbox"]
        self.assertAlmostEqual((box[0]+box[2])/2, -122.5)
        self.assertAlmostEqual((box[1]+box[3])/2, 37.5)
        self.assertAlmostEqual((box[3]-box[1])*111.195, 2)
        self.assertAlmostEqual(box[2], tiles[1]["bbox"][0])

    def test_limits_and_longer_spiral(self):
        for size, count in ((0,9),(51,9),(2,0),(2,1001),(2,"3.5")):
            with self.assertRaises(ValueError):
                collection_tiles({**settings(), "spiral": True,"box_km":size,"box_count":count})
        self.assertEqual(len(collection_tiles({**settings(),"spiral":True,"box_count":25})),25)
        self.assertEqual(len(collection_tiles({**settings(),"spiral":True,"box_count":1})),1)
        with self.assertRaises(ValueError):
            collection_tiles({**settings(),"west":179.99,"east":180,"spiral":True,"box_km":50})

    def test_orchestrator_runs_each_box_and_stops_on_failure(self):
        for fail in (False, True):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                native = root / "build/native"
                native.mkdir(parents=True)
                (native / "fireblock_ingest.exe").touch()
                calls = []
                class Process:
                    stdout = None
                    def __init__(self): self.stdout = io.StringIO("provider progress\n")
                    def wait(self): return 2 if fail else 0
                    def poll(self): return 0
                def spawn(args, **kwargs):
                    calls.append(json.loads(Path(args[1]).read_text()))
                    return Process()
                controller = ScraperControl(root)
                with patch.dict("os.environ", {"FIRMS_MAP_KEY":"secret"}), patch("fireblock_analysis.scraper_control.subprocess.Popen", side_effect=spawn):
                    job = controller.start({**settings(),"spiral":True,"box_km":"2","box_count":"9"})
                    controller.thread.join(5)
                self.assertFalse(controller.active)
                self.assertEqual(len(calls), 1 if fail else 9)
                plan = json.loads((job / "collection-plan.json").read_text())
                self.assertEqual(plan["tiles"][0]["status"], "failed" if fail else "complete")
                if not fail:
                    self.assertEqual(calls[-1]["bbox"], plan["tiles"][-1]["bbox"])
                    self.assertEqual(len({c["output"] for c in calls}),9)


if __name__ == "__main__": unittest.main()
