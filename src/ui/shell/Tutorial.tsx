import { useEffect } from 'react';
import { MISSIONS } from '../../content/missions';
import { GameState, useGame } from '../../store/game';

interface Step {
  title: string;
  body: string;
  /** True once the player has done what the step asks. */
  done: (s: GameState) => boolean;
}

const STEPS: Step[] = [
  {
    title: 'Place a component',
    body: 'Drag S3 from the palette onto the board, or tap it and then tap the board. Every service lands where it lives: Regional services on the Region, instances in a subnet.',
    done: (s) => Object.keys(s.board().components).length > 0,
  },
  {
    title: 'Configure it',
    body: 'Click the component to open its console. Each setting is one the real console has; hover the hints to see what it changes.',
    done: (s) => s.selection?.kind === 'component',
  },
  {
    title: 'Trace a request',
    body: 'Press Trace in the top bar and send a request through your design. You will see every hop and the rule that allowed or blocked it.',
    done: (s) => !!s.activeTrace,
  },
  {
    title: 'Run the simulation',
    body: "Press Run simulation at the bottom. The events test each requirement against your design and explain what failed and why. Add CloudFront and Route 53 to finish the brief.",
    done: (s) => !!s.results[s.currentMissionId],
  },
];

/** A four-step coach card on the first mission, shown until finished or skipped. */
export function Tutorial() {
  const tutorial = useGame((s) => s.tutorial);
  const setTutorial = useGame((s) => s.setTutorial);
  const onFirst = useGame((s) => s.currentMissionId === MISSIONS[0].id);
  // Shrink the card to one line while the player is placing (so it doesn't hide the drop zones)
  // or reading results (it sits just above the drawer).
  const compact = useGame((s) => !!s.placing || (s.simOpen && !!s.results[s.currentMissionId]));
  const aboveDrawer = useGame((s) => s.simOpen && !!s.results[s.currentMissionId]);
  const stepDone = useGame((s) => !s.tutorial.done && s.tutorial.step < STEPS.length && STEPS[s.tutorial.step].done(s));

  useEffect(() => {
    if (stepDone) setTutorial(tutorial.step + 1, tutorial.step + 1 >= STEPS.length + 1);
  }, [stepDone, tutorial.step, setTutorial]);

  if (tutorial.done || !onFirst) return null;
  const finished = tutorial.step >= STEPS.length;
  const step = STEPS[Math.min(tutorial.step, STEPS.length - 1)];
  return (
    <aside className={`coach ${compact ? 'compact' : ''} ${aboveDrawer ? 'above-drawer' : ''}`} role="region" aria-label="Getting started" aria-live="polite">
      <div className="coach-head">
        <span className="hint">
          {finished ? 'Done' : `Step ${tutorial.step + 1} of ${STEPS.length}`}
          {compact && <b className="coach-title">{finished ? 'You have the loop' : step.title}</b>}
        </span>
        <button className="btn ghost small" onClick={() => setTutorial(tutorial.step, true)} aria-label="Skip the tour">
          {finished ? 'Close' : 'Skip'}
        </button>
      </div>
      {finished ? (
        <>
          <h3>You have the loop</h3>
          <p>Place, configure, trace, simulate. The concept map, the daily session and the practice exam are in the top bar. You can replay this tour from Settings.</p>
          <button className="btn primary small" onClick={() => setTutorial(STEPS.length, true)}>
            Got it
          </button>
        </>
      ) : (
        <>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
          <ol className="coach-dots" aria-hidden>
            {STEPS.map((_, i) => (
              <li key={i} className={i < tutorial.step ? 'ok' : i === tutorial.step ? 'on' : ''} />
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
