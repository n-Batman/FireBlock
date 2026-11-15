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

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

/** "Nov 15". Same fixed zone as `formatAsOf`. */
export function formatDay(iso: string): string {
  return day.format(new Date(iso));
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Whole dollars: "$1,728". */
export function formatMoney(n: number): string {
  return money.format(n);
}
