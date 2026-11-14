const ITEMS = [
  { label: "Low", swatch: "bg-low" },
  { label: "Medium", swatch: "bg-med" },
  { label: "High", swatch: "bg-high" },
];

export function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--r)] border border-line bg-surface px-3 py-2 text-xs font-medium shadow-[0_1px_2px_rgb(21_36_29/0.1)]">
      {ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span className={`size-3 rounded-sm ${item.swatch}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span className="hatch size-3 rounded-sm border border-line" aria-hidden="true" />
        No-mow habitat
      </li>
    </ul>
  );
}
