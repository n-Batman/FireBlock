"""Future trained-model interface. No default or fabricated forecast model."""
import json
import math
from datetime import timedelta
from pathlib import Path
from typing import Protocol, Sequence

from .risk import FEATURE_SCHEMA, utc


class PredictionModel(Protocol):
    model_id: str
    feature_schema: str
    trained_until: str
    horizon_hours: int
    target_definition: str

    def predict(self, features: Sequence[dict]) -> Sequence[float | None]: ...


def build_prediction(features_path, model: PredictionModel, destination):
    """Apply a supplied model and export a probability map with explicit horizon.

    Model calibration, backtesting and weather/label collection belong to the
    model implementation. This contract checks provenance and basic leakage only.
    """
    if (not model.model_id or model.feature_schema != FEATURE_SCHEMA or
            type(model.horizon_hours) is not int or not 1 <= model.horizon_hours <= 720 or
            not model.target_definition):
        raise ValueError("Prediction model must declare compatible schema, ID, target and horizon")
    with open(features_path, encoding="utf-8") as stream:
        features = [json.loads(line) for line in stream if line.strip()]
    if not features or len(features) > 50000:
        raise ValueError("Prediction needs 1..50000 feature cells")
    stamps = {f["properties"]["as_of"] for f in features}
    ids = [f["properties"]["cell_id"] for f in features]
    if len(stamps) != 1 or len(set(ids)) != len(ids):
        raise ValueError("Prediction cells must have one issue time and unique IDs")
    as_of = utc(stamps.pop())
    if utc(model.trained_until) > as_of:
        raise ValueError("Model training cutoff is later than the forecast issue time")
    for feature in features:
        p = feature["properties"]
        if p["feature_schema"] != FEATURE_SCHEMA:
            raise ValueError("Incompatible risk feature schema")
        if p.get("scene_acquired_at") and utc(p["scene_acquired_at"]) > as_of:
            raise ValueError("Future observations cannot enter a forecast")
    # Pass only cells with sufficient input evidence. Unknown cells remain null
    # rather than letting a model manufacture certainty from missing features.
    known = [f for f in features if f["properties"]["status"] == "estimated"]
    probabilities = list(model.predict([f["properties"] for f in known])) if known else []
    if len(probabilities) != len(known):
        raise ValueError("Model output length does not match known feature cells")
    mapped = {}
    for feature, value in zip(known, probabilities):
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1):
            raise ValueError("Prediction probabilities must be finite values in [0,1] or null")
        mapped[feature["properties"]["cell_id"]] = value
    output = {"type": "FeatureCollection", "model_id": model.model_id, "trained_until": model.trained_until,
        "issued_at": as_of.isoformat(), "valid_until": (as_of + timedelta(hours=model.horizon_hours)).isoformat(),
        "horizon_hours": model.horizon_hours, "target_definition": model.target_definition, "features": []}
    for feature in features:
        identity = feature["properties"]["cell_id"]
        probability = mapped.get(identity)
        output["features"].append({"type": "Feature", "geometry": feature["geometry"], "properties": {
            "cell_id": identity, "fire_probability": probability,
            "status": "predicted" if probability is not None else "unknown", "model_id": model.model_id}})
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.write_text(json.dumps(output, allow_nan=False), encoding="utf-8")
    temporary.replace(destination)
    return output
