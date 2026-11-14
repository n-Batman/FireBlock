const ITEMS = [
  { label: "Low", swatch: "bg-low" },
  { label: "Medium", swatch: "bg-med" },
  { label: "High", swatch: "bg-high" },
];

export function Legend() {
  return (
    <ul className="glass pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs font-medium">
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
