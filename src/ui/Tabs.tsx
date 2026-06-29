// A small, reusable segmented-tab control (ARIA tablist). Used by the notebook and
// anywhere else that needs modern tabs, so the look stays consistent.

export interface TabDef<T extends string> {
  key: T;
  label: string;
  title?: string;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          title={t.title}
          className={`tab ${active === t.key ? 'on' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
