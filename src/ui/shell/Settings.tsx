import { useEffect, useRef } from 'react';
import { MISSIONS } from '../../content/missions';
import { useGame } from '../../store/game';
import { usePrefersReducedMotion } from './useMedia';
import { Icon } from './Icon';
import { DifficultyToggle } from './Brief';

const SHORTCUTS: [string, string][] = [
  ['Ctrl/⌘ + Z', 'Undo the last change to the board'],
  ['Ctrl/⌘ + Shift + Z, Ctrl + Y', 'Redo'],
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
  const liveChecks = useGame((s) => s.settings.liveChecks !== false);
  const setLiveChecks = useGame((s) => s.setLiveChecks);
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
          <label className="field">
            <span>
              Live security checks
              <div className="hint">Runs the mission's security audit as you edit and marks problems on the board before you run the simulation. Turn it off for exam-style practice.</div>
            </span>
            <input type="checkbox" checked={liveChecks} onChange={(e) => setLiveChecks(e.target.checked)} />
          </label>
          <div className="field">
            <span>
              Difficulty
              <div className="hint">Easy offers only the services a mission can use. Hard mixes in plausible services the design doesn't need and hides the exam signal phrases until your first run. Applies to build and refactor missions.</div>
            </span>
            <DifficultyToggle />
          </div>
          <div className="section" style={{ marginTop: 16 }}>
            <h4>Progress</h4>
            <p className="hint">Progress lives in this browser. Export it to back it up or move it to another device.</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" onClick={doExport}>
                <Icon name="download" /> Export progress
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" /> Import progress
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
