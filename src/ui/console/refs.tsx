import type { Component, ServiceConfig, ServiceType } from '../../engine/model';
import { updateConfig } from '../../engine/board';
import { useGame } from '../../store/game';

export function useUpdate(c: Component) {
  const apply = useGame((s) => s.apply);
  return (patch: Partial<ServiceConfig> | Record<string, unknown>) => apply((b) => updateConfig(b, c.id, patch as Partial<ServiceConfig>));
}

export function RefSelect({ label, value, types, onChange, exclude, hint }: { label: string; value: string | null; types: ServiceType[]; onChange: (v: string | null) => void; exclude?: string; hint?: string }) {
  const board = useGame((s) => s.board());
  const opts = Object.values(board.components).filter((c) => types.includes(c.type) && c.id !== exclude);
  return (
    <label className="field">
      <span>
        {label}
        {hint && <div className="hint">{hint}</div>}
      </span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— none —</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

