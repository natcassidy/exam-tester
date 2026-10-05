import { useEffect, useRef } from 'react';
import { MISSIONS } from '../../content/missions';
import { useGame } from '../../store/game';
import { usePrefersReducedMotion } from './useMedia';

const SHORTCUTS: [string, string][] = [
  ['Esc', 'Close the open window, cancel placing, or clear the selection'],
  ['Tab / Shift+Tab', 'Move between controls; every action has a button'],
  ['Space / Enter', 'Pick up a palette item, then arrow keys and Space to drop it'],
];

export function Settings({ onClose }: { onClose: () => void }) {
  const reduced = useGame((s) => s.settings.reducedMotion);
  const setReduced = useGame((s) => s.setReducedMotion);
  const setTutorial = useGame((s) => s.setTutorial);
  const setMission = useGame((s) => s.setMission);
  const prefers = usePrefersReducedMotion();
  const exportProgress = useGame((s) => s.exportProgress);
  const importProgress = useGame((s) => s.importProgress);
  const toast = useGame((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const doExport = () => {
    try {
      const blob = new Blob([exportProgress()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blast-radius-progress-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Progress exported.', 'success');
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    }
  };
  // Escape closes this window only, before the app-wide handler sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose} role="dialog" aria-modal aria-label="Settings">
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">
          <label className="field">
            <span>
              Reduce motion
              <div className="hint">{prefers ? 'Your system already asks for reduced motion, so animations are off.' : 'Turns off packet animations and transitions.'}</div>
            </span>
            <input type="checkbox" checked={reduced || prefers} disabled={prefers} onChange={(e) => setReduced(e.target.checked)} />
          </label>
          <div className="section">
            <h4>Getting started</h4>
            <button
              className="btn"
              onClick={() => {
                setTutorial(0, false);
                setMission(MISSIONS[0].id);
                onClose();
              }}
            >
              Replay the tour
            </button>
          </div>
          <div className="section">
            <h4>Progress</h4>
            <p className="hint" style={{ marginTop: 0 }}>
              Progress is saved in this browser. Export it to back it up or move it to another device.
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn" onClick={doExport}>
                ⇩ Export progress
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                ⇧ Import progress
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) importProgress(await f.text());
              }}
            />
          </div>
          <div className="section">
            <h4>Keyboard</h4>
            <dl className="shortcuts">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
