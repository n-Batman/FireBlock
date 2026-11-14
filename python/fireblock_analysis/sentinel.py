"""Small, windowed Sentinel-2 L2A worker. No automatic risk classification."""
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import numpy as np

NODATA = -9999.0


def normalized_difference(a, b, valid):
    denominator = a + b
    good = valid & np.isfinite(a) & np.isfinite(b) & (a >= 0) & (b >= 0) & (np.abs(denominator) > 1e-8)
    output = np.full(a.shape, NODATA, dtype="float32")
    np.divide(a - b, denominator, out=output, where=good)
    return output, good


def safe_inputs(archive):
    """Read ZIP in-place with GDAL /vsizip; require exactly one granule."""
    archive = Path(archive).resolve()
    with zipfile.ZipFile(archive) as product:
        names = product.namelist()
        def unique(pattern):
            found = [n for n in names if re.search(pattern, n)]
            if len(found) != 1:
                raise ValueError(f"SAFE ZIP needs exactly one match for {pattern}; supply individual granules/bands")
            return found[0]
        selected = {band: unique(rf"/R{resolution}m/[^/]+_{band}_{resolution}m\.jp2$")
                    for band, resolution in (("B04", 10), ("B08", 10), ("B11", 20), ("SCL", 20))}
        metadata = unique(r"(?:^|/)MTD_MSIL2A\.xml$")
        info = product.getinfo(metadata)
        if info.file_size > 16 * 1024 * 1024:
            raise ValueError("SAFE XML exceeds metadata limit")
        root = ET.fromstring(product.read(metadata))
        def tag(element):
            return element.tag.rsplit("}", 1)[-1]
        quantification = next((float(e.text) for e in root.iter() if tag(e) == "BOA_QUANTIFICATION_VALUE"), None)
        if quantification is None or not math.isfinite(quantification) or quantification <= 0:
            raise ValueError("Missing/invalid BOA_QUANTIFICATION_VALUE")
        baseline = next((e.text for e in root.iter() if tag(e) == "PROCESSING_BASELINE"), None)
        offsets = {int(e.attrib["band_id"]): float(e.text) for e in root.iter() if tag(e) == "BOA_ADD_OFFSET"}
        if not offsets and (baseline is None or float(baseline) >= 4):
            raise ValueError("Modern/unknown processing baseline lacks BOA offsets; supply explicit calibrated bands")
        calibration = {band: {"scale": 1 / quantification, "offset": offsets.get(index, 0) / quantification}
                       for band, index in (("B04", 3), ("B08", 7), ("B11", 11))}
        if offsets and not {3, 7, 11}.issubset(offsets):
            raise ValueError("Missing required band calibration offsets")
    return {b: f"/vsizip/{archive.as_posix()}/{n}" for b, n in selected.items()}, calibration


class Stats:
    def __init__(self):
        self.count = 0
        self.total = self.squares = 0.0
        self.minimum = self.maximum = None

    def add(self, values):
        values = values.astype("float64")
        if not values.size:
            return
        self.count += int(values.size)
        self.total += float(values.sum())
        self.squares += float(np.square(values).sum())
        self.minimum = min(self.minimum if self.minimum is not None else float("inf"), float(values.min()))
        self.maximum = max(self.maximum if self.maximum is not None else -float("inf"), float(values.max()))

    def result(self):
        mean = self.total / self.count if self.count else None
        return {"count": self.count, "mean": mean, "min": self.minimum, "max": self.maximum,
                "stddev": math.sqrt(max(0, self.squares / self.count - mean * mean)) if self.count else None}


def analyze_scene(bands, calibration, output, bbox=None, min_valid_fraction=0.6, valid_classes=(4, 5)):
    import rasterio
    from contextlib import ExitStack
    from rasterio.vrt import WarpedVRT
    from rasterio.enums import Resampling
    from rasterio.windows import Window, from_bounds, transform as window_transform
    from rasterio.warp import transform_bounds

    if not 0 <= min_valid_fraction <= 1:
        raise ValueError("min_valid_fraction must be 0..1")
    if not valid_classes or not set(valid_classes).issubset({2, 4, 5, 6, 7}):
        raise ValueError("valid_classes may contain only SCL 2,4,5,6,7")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    result = {"provider": "Copernicus Sentinel-2 L2A", "valid_scl_classes": list(valid_classes),
              "calibration": calibration,
              "min_valid_fraction": min_valid_fraction, "bbox_wgs84": bbox, "indices": {},
              "warnings": ["Coverage is a quality indicator, not a fire-risk prediction.",
                           "SCL masking has 20 m effective detail, including when applied to 10 m NDVI."]}
    with ExitStack() as stack:
        sources = {b: stack.enter_context(rasterio.open(bands[b])) for b in ("B04", "B08", "B11", "SCL")}
        for b, expected in (("B04", 10), ("B08", 10), ("B11", 20), ("SCL", 20)):
            src = sources[b]
            if (not src.crs or not src.crs.is_projected or src.crs.linear_units != "metre"
                    or not all(math.isclose(r, expected, abs_tol=0.01) for r in src.res)
                    or src.transform.b != 0 or src.transform.d != 0):
                raise ValueError(f"{b} must be a north-up projected {expected} m raster in metres")
        for name, first, second, reference, resolution in (("ndvi", "B08", "B04", "B04", 10), ("ndmi", "B08", "B11", "B11", 20)):
            ref = sources[reference]
            if bbox:
                bounds = transform_bounds("EPSG:4326", ref.crs, *bbox, densify_pts=21)
                w = from_bounds(*bounds, ref.transform)
                # Keep the entire requested rectangle: outside-scene pixels remain invalid.
                left, top = math.floor(w.col_off), math.floor(w.row_off)
                width, height = math.ceil(w.col_off + w.width) - left, math.ceil(w.row_off + w.height) - top
                transform = window_transform(Window(left, top, width, height), ref.transform)
            else:
                transform, width, height = ref.transform, ref.width, ref.height
            if width <= 0 or height <= 0 or width * height > 2_000_000_000:
                raise ValueError("Invalid or excessively large output grid")
            grid = dict(crs=ref.crs, transform=transform, width=width, height=height)
            with ExitStack() as local:
                def aligned(band, categorical=False):
                    src = sources[band]
                    # SAFE DN=0 is nodata. Explicit reflectance inputs can have valid zeros.
                    raw_dn = band != "SCL" and (calibration[band]["scale"] != 1 or calibration[band]["offset"] != 0)
                    missing = src.nodata if src.nodata is not None else (0 if categorical or raw_dn else None)
                    return local.enter_context(WarpedVRT(src, **grid, dtype="float32", src_nodata=missing,
                        nodata=float("nan"), resampling=Resampling.nearest if categorical else Resampling.average))
                a, b, scl = aligned(first), aligned(second), aligned("SCL", True)
                profile = dict(driver="GTiff", **grid, count=1, dtype="float32", nodata=NODATA,
                               tiled=True, blockxsize=256, blockysize=256, compress="deflate")
                destination = local.enter_context(rasterio.open(output / f"{name}.tif", "w", **profile))
                stats = Stats()
                counts = {k: 0 for k in ("classified", "cloud", "shadow", "snow", "vegetation", "usable_scl")}
                for _, window in destination.block_windows(1):
                    classes = scl.read(1, window=window)
                    masks = {"classified": np.isfinite(classes) & (classes > 0) & (classes <= 11),
                             "cloud": np.isin(classes, [8, 9, 10]), "shadow": classes == 3,
                             "snow": classes == 11, "vegetation": classes == 4,
                             "usable_scl": np.isin(classes, valid_classes)}
                    for key, mask in masks.items():
                        counts[key] += int(mask.sum())
                    values = []
                    for band, reader in ((first, a), (second, b)):
                        scale, offset = calibration[band]["scale"], calibration[band]["offset"]
                        if not math.isfinite(scale) or not math.isfinite(offset) or scale <= 0:
                            raise ValueError("Calibration needs finite positive scale and finite offset")
                        values.append(reader.read(1, window=window) * scale + offset)
                    index, good = normalized_difference(*values, masks["usable_scl"])
                    stats.add(index[good])
                    destination.write(index, 1, window=window)
                total = width * height
                valid_fraction = stats.count / total
                coverage = {key + "_fraction": count / total for key, count in counts.items()}
                coverage.update(total_pixels=total, valid_pixels=stats.count, valid_fraction=valid_fraction,
                                cloud_fraction_of_classified=counts["cloud"] / counts["classified"] if counts["classified"] else None)
                destination.update_tags(index=name.upper(), effective_resolution_m=resolution,
                                        formula=f"({first}-{second})/({first}+{second})")
                result["indices"][name] = {"effective_resolution_m": resolution, "statistics": stats.result(),
                    "formula": f"({first}-{second})/({first}+{second})",
                    "coverage": coverage, "usable": stats.count > 0 and valid_fraction >= min_valid_fraction,
                    "raster": f"{name}.tif", "crs": str(ref.crs), "width": width, "height": height}
    result["usable"] = all(index["usable"] for index in result["indices"].values())
    return result
