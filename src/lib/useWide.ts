import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";
const canMatch = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

function subscribe(onChange: () => void) {
  if (!canMatch()) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True at the desktop layout breakpoint (1024px and up). */
export const useWide = () =>
  useSyncExternalStore(
    subscribe,
    () => (canMatch() ? window.matchMedia(QUERY).matches : true),
    () => true,
  );
