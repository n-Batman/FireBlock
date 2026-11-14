"use client";

import { MotionConfig } from "motion/react";

/** Every motion component honors the visitor's reduced-motion setting. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
