"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ParcelScan } from "@/data/types";
import { PARCEL_SCAN_KEY, loadParcelScans } from "./parcelScanStore";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const read = () => {
  try {
    return window.localStorage.getItem(PARCEL_SCAN_KEY) ?? "";
  } catch {
    return "";
  }
};

/** The scans saved with a location in this browser. Empty on the server. */
export function useParcelScans(): ParcelScan[] {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => loadParcelScans({ getItem: () => raw || null }), [raw]);
}
