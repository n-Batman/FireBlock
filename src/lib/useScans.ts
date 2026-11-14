"use client";

import { useMemo, useSyncExternalStore } from "react";
import { SCAN_STORAGE_KEY, loadScans, type ScanResult } from "./scanStore";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const read = () => {
  try {
    return window.localStorage.getItem(SCAN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

/** The scans saved in this browser. Empty on the server. */
export function useScans(): Record<string, ScanResult> {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => loadScans({ getItem: () => raw || null }), [raw]);
}
