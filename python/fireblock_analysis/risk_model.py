"""Replaceable scoring interface over parsed satellite features (not probabilities)."""
from typing import Mapping, Protocol
import numpy as np

FEATURE_SCHEMA = "fireblock.risk-features.v1"


class RiskModel(Protocol):
    model_id: str
    feature_schema: str

    def score(self, features: Mapping[str, np.ndarray], parameters: dict) -> np.ndarray:
        """Return a 0–100 score array with the same shape as the input cells."""
        ...


class MathematicalRiskModel:
    model_id = "fireblock-relative-risk-v2"
    feature_schema = FEATURE_SCHEMA

    def score(self, features, parameters):
        vegetation = np.clip((features["ndvi"] - .2) / .6, 0, 1)
        dryness = np.clip((.4 - features["ndmi"]) / .8, 0, 1)
        dry = parameters.get("dryness_weight", .7)
        heat = parameters.get("hotspot_weight", .3)
        if not np.isfinite(dry) or not np.isfinite(heat) or min(dry, heat) < 0 or dry + heat <= 0:
            raise ValueError("Mathematical model needs finite nonnegative weights with positive sum")
        baseline = (dry * dryness + heat * features["hotspot_pressure"]) / (dry + heat)
        weight = parameters.get("weather_weight", .3)
        if type(weight) not in (int, float) or not np.isfinite(weight) or not 0 <= weight <= 1:
            raise ValueError("weather_weight must be finite and within 0..1")
        weather = features.get("weather_pressure", np.full_like(baseline, np.nan))
        # Missing weather retains the satellite-only baseline, never a fabricated calm day.
        combined = np.where(np.isfinite(weather), (1 - weight) * baseline + weight * weather, baseline)
        return 100 * vegetation * combined


def evaluate_model(model, features, parameters):
    if not isinstance(model.model_id, str) or not model.model_id or model.feature_schema != FEATURE_SCHEMA:
        raise ValueError("Risk model must declare its version and a compatible feature schema")
    shape = features["ndvi"].shape
    views = {}
    for name, values in features.items():
        if values.shape != shape:
            raise ValueError("Risk feature arrays are misaligned")
        views[name] = values.view()
        views[name].flags.writeable = False
    scores = np.asarray(model.score(views, parameters), dtype="float64")
    if scores.shape != shape:
        raise ValueError("Risk model output is not aligned to the grid")
    known = np.isfinite(features["ndvi"]) & np.isfinite(features["ndmi"]) & np.isfinite(features["hotspot_pressure"])
    if not np.all(np.isfinite(scores[known]) & (scores[known] >= 0) & (scores[known] <= 100)):
        raise ValueError("Risk model must return finite 0–100 values for known cells")
    return np.where(known, scores, np.nan)
