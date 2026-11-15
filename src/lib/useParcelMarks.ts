"use client";

import { useMemo, useSyncExternalStore } from "react";
import { loadParcelFix, loadParcelReset, PARCEL_FIX_KEY, PARCEL_MARKS_EVENT, PARCEL_RESET_KEY, type ParcelFix } from "./parcelScanStore";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PARCEL_MARKS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PARCEL_MARKS_EVENT, onChange);
  };
}

const read = () => {
  try {
    return `${window.localStorage.getItem(PARCEL_RESET_KEY) ?? ""}\n${window.localStorage.getItem(PARCEL_FIX_KEY) ?? ""}`;
  } catch {
    return "";
  }
};

/** A parcel's reset marker and mowed mark in this browser. Both are null on the server and when nothing is saved. */
export function useParcelMarks(parcelId: string | null): { resetAt: string | null; fix: ParcelFix | null } {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => {
    const [reset = "", fix = ""] = raw.split("\n");
    return {
      resetAt: parcelId ? loadParcelReset({ getItem: () => reset || null }, parcelId) : null,
      fix: parcelId ? loadParcelFix({ getItem: () => fix || null }, parcelId) : null,
    };
  }, [raw, parcelId]);
}
