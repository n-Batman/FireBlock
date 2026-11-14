"use client";

import { useEffect, useState } from "react";
import { demoClipExists } from "./demoClip";

/** `null` while checking, then `true` or `false`. */
export function useDemoAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    demoClipExists().then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
