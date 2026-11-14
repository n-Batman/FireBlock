import { Suspense } from "react";
import type { Metadata } from "next";
import { ScanScreen } from "@/components/ScanScreen";

export const metadata: Metadata = {
  title: "Scan the rows | FireBlock",
  description: "Point the camera at the rows and see dry growth and brush risks as you walk.",
};

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-paper" aria-hidden="true" />}>
      <ScanScreen />
    </Suspense>
  );
}
