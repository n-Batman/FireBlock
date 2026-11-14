import { Suspense } from "react";
import type { Metadata } from "next";
import { PlanScreen } from "@/components/PlanScreen";

export const metadata: Metadata = {
  title: "Fire-prep plan | FireBlock",
  description: "Blocks ranked by risk, what to do on each, and the days left until June 1.",
};

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-paper" aria-hidden="true" />}>
      <PlanScreen />
    </Suspense>
  );
}
