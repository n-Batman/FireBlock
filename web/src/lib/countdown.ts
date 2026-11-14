const DAY_MS = 86_400_000;

/** Whole days until the county's June 1 clearance deadline (0 on June 1). */
export function daysUntilJune1(today: Date): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let deadline = new Date(start.getFullYear(), 5, 1);
  if (start > deadline) deadline = new Date(start.getFullYear() + 1, 5, 1);
  return Math.round((deadline.getTime() - start.getTime()) / DAY_MS);
}
