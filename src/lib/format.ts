const asOf = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

/** "Nov 13, 7:00 AM PST". Fixed locale and zone so server and browser agree. */
export function formatAsOf(iso: string): string {
  return asOf.format(new Date(iso)).replace(/[  ]/g, " ");
}
