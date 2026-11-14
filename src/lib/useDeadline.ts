"use client";

import { useSyncExternalStore } from "react";
import { daysUntilJune1 } from "./countdown";

const noopSubscribe = () => () => {};

/**
 * Days until the county's June 1 deadline. `null` on the server, so server and browser never
 * disagree about today's date. `today` can be fixed for tests.
 */
export function useDaysUntilJune1(today?: Date): number | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => daysUntilJune1(today ?? new Date()),
    () => null,
  );
}
