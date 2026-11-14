export class LocationError extends Error {}

interface Geo {
  getCurrentPosition(
    ok: (p: { coords: { latitude: number; longitude: number } }) => void,
    fail: (e: { code: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
}

const REASONS: Record<number, string> = {
  1: "Location access was blocked. Allow location for this site to save a scan to a parcel.",
  2: "Your device could not find its location. Try again outdoors.",
  3: "Finding your location took too long. Try again.",
};

/** The device's location now. Rejects with a LocationError whose message says what to do. */
export function currentPosition(geo: Geo | undefined): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!geo) return reject(new LocationError("This browser cannot share its location."));
    geo.getCurrentPosition(
      ({ coords }) => {
        const lat = coords.latitude;
        const lon = coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          reject(new LocationError(REASONS[2]));
          return;
        }
        resolve({ lat, lon });
      },
      (error) => reject(new LocationError(REASONS[error.code] ?? REASONS[2])),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}
