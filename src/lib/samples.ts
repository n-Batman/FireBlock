import type { AreaNote } from "@/data/types";
import type { Mask } from "./fuelMask";
import type { ScanEstimate } from "./scanView";
import data from "../../public/demo/samples.json";

/**
 * A sample still for the scan screen with its replies already saved: masks from /api/segment and the estimate from
 * /api/estimate for that exact 1024 px frame (and optional words), so it scans with no requests when the camera or the APIs are down.
 */
export interface Sample {
  id: string;
  label: string;
  src: string;
  masks: Mask[];
  estimate: ScanEstimate;
  notes?: AreaNote[];
}

export const SAMPLES = data as Sample[];
