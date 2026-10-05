import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Board, EventResult, Flow, Mission, Placement, ServiceType, Trace } from '../engine/model';
import type { CallSpec } from '../engine/iam/access';
import { traceCall } from '../engine/iam/access';
import { IncidentScore, scoreIncident } from '../engine/incident/score';
import * as ops from '../engine/board';
import { createBoardFromLayout } from '../engine/board';
import { traceFlow } from '../engine/net/trace';
import { runMission } from '../engine/sim/runner';
import { scoreResults } from '../engine/scoring';
import { ALL_MISSIONS, MISSION_BY_ID, MISSIONS } from '../content/missions';
import { safeStorage } from './storage';
import { IncidentProgress, migrate, PersistedState, SCHEMA_VERSION, validateImport } from './schema';

export type Selection =
  | { kind: 'component'; id: string }
  | { kind: 'subnet'; id: string }
  | { kind: 'sg'; id: string; ruleRef?: string }
  | { kind: 'nacl'; id: string; ruleRef?: string }
  | { kind: 'routeTable'; id: string; ruleRef?: string }
  | { kind: 'iam' }
  | { kind: 'role'; id: string; policy?: string }
  | { kind: 'key'; id: string }
  | { kind: 'scp' };

export type Mode = 'build' | 'incident' | 'diff';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface ActiveTrace {
  flow: Flow;
  trace: Trace;
  label: string;
  /** Set for API-call traces (network leg plus permission checks). */
  call?: CallSpec;
  /** Bumped on each replay so the overlay restarts. */
  nonce: number;
}

interface UiState {
  selection: Selection | null;
  consoleTab: 'config' | 'networking' | 'permissions' | 'notes';
  placing: ServiceType | null;
  results: Record<string, EventResult[]>;
  activeTrace: ActiveTrace | null;
  simOpen: boolean;
  traceOpen: boolean;
  manualOpen: string | null; // concept id or 'index'
  questionsOpen: boolean;
  toasts: Toast[];
  highlight: string[];
  logsOpen: boolean;
  diagnoseOpen: boolean;
  /** Incident report from the latest "Verify fix", per mission. */
  reports: Record<string, IncidentScore>;
  lastByMode: Partial<Record<Mode, string>>;
}

interface Actions {
  mission: () => Mission;
  board: () => Board;
  setMission: (id: string) => void;
  setMode: (m: Mode) => void;
  incident: () => IncidentProgress;
  /** Charge an investigation action once per key (incident missions only). */
  charge: (key: string, label: string) => void;
  viewLog: (id: string) => void;
  openLogs: (v: boolean) => void;
  openDiagnose: (v: boolean) => void;
  diagnose: (suspectId: string) => void;
  runCallTrace: (call: CallSpec, label: string) => void;
  answerDiff: (chosen: string) => void;
  apply: (fn: (b: Board) => ops.OpResult, success?: string) => boolean;
  place: (type: ServiceType, zone: Placement) => void;
  select: (s: Selection | null, tab?: UiState['consoleTab']) => void;
  setTab: (t: UiState['consoleTab']) => void;
  setPlacing: (t: ServiceType | null) => void;
  resetBoard: () => void;
  runSim: () => void;
  runTrace: (flow: Flow, label: string) => void;
  showTrace: (t: Trace, flow: Flow, label: string) => void;
  clearTrace: () => void;
  openSim: (v: boolean) => void;
  openTrace: (v: boolean) => void;
  openManual: (id: string | null) => void;
  openQuestions: (v: boolean) => void;
  answerQuestion: (questionId: string, chosen: string[], correct: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  exportProgress: () => string;
  importProgress: (json: string) => void;
  setReducedMotion: (v: boolean) => void;
}

export type GameState = PersistedState & UiState & Actions;

let toastSeq = 0;

// A stable empty board per mission, so selectors return the same object until the player edits it.
const emptyBoards: Record<string, Board> = {};
function emptyBoardFor(m: Mission): Board {
  return (emptyBoards[m.id] ??= createBoardFromLayout(m.layout));
}

// Incident missions start from a broken production board; diff rounds show their left board.
function startBoardFor(m: Mission): Board {
  if (m.startingBoard) return m.startingBoard;
  if (m.diff) return m.diff.left;
  return emptyBoardFor(m);
}

export function modeOf(m: Mission): Mode {
  return m.mode === 'incident' ? 'incident' : m.mode === 'diff' ? 'diff' : 'build';
}

const NO_PROGRESS: IncidentProgress = { actions: [], diagnosis: null };

function selectionKey(s: Selection): string {
  return 'id' in s ? `open:${s.kind}:${s.id}` : `open:${s.kind}`;
}

function initialPersisted(): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentMissionId: MISSIONS[0].id,
    boards: {},
    best: {},
    questionHistory: [],
    conceptEvidence: [],
    settings: { reducedMotion: false },
    incidents: {},
    diffAnswers: {},
  };
}

export const useGame = create<GameState>()(
  persist(
    (set, get) => ({
      ...initialPersisted(),
      selection: null,
      consoleTab: 'config',
      placing: null,
      results: {},
      activeTrace: null,
      simOpen: false,
      traceOpen: false,
      manualOpen: null,
      questionsOpen: false,
      toasts: [],
      highlight: [],
      logsOpen: false,
      diagnoseOpen: false,
      reports: {},
      lastByMode: {},

      mission: () => MISSION_BY_ID[get().currentMissionId] ?? MISSIONS[0],
      board: () => {
        const m = get().mission();
        return get().boards[m.id] ?? startBoardFor(m);
      },

      setMission: (id) => {
        const m = MISSION_BY_ID[id];
        set((s) => ({
          currentMissionId: id,
          selection: null,
          activeTrace: null,
          traceOpen: false,
          highlight: [],
          placing: null,
          logsOpen: false,
          diagnoseOpen: false,
          simOpen: !!s.results[id],
          lastByMode: m ? { ...s.lastByMode, [modeOf(m)]: id } : s.lastByMode,
        }));
      },
      setMode: (mode) => {
        const cur = get().mission();
        if (modeOf(cur) === mode) return;
        const id = get().lastByMode[mode] ?? ALL_MISSIONS.find((m) => modeOf(m) === mode)!.id;
        get().setMission(id);
      },

      incident: () => get().incidents[get().mission().id] ?? NO_PROGRESS,
      charge: (key, label) => {
        const m = get().mission();
        if (!m.incident) return;
        const p = get().incident();
        if (p.verifiedAt || p.actions.includes(key)) return;
        const actions = [...p.actions, key];
        set((s) => ({ incidents: { ...s.incidents, [m.id]: { ...p, actions } } }));
        const { budget } = m.incident;
        get().toast(`Investigation action ${actions.length}/${budget}: ${label}${actions.length > budget ? ' (over budget)' : ''}`, actions.length > budget ? 'error' : 'info');
      },
      viewLog: (id) => {
        const log = get().mission().incident?.logs.find((l) => l.id === id);
        if (log) get().charge(`log:${id}`, log.title);
      },
      openLogs: (logsOpen) => set({ logsOpen }),
      openDiagnose: (diagnoseOpen) => set({ diagnoseOpen }),
      diagnose: (suspectId) => {
        const m = get().mission();
        const p = get().incident();
        if (p.verifiedAt) return get().toast('The diagnosis is locked once you have verified a fix.', 'error');
        set((s) => ({ incidents: { ...s.incidents, [m.id]: { ...p, diagnosis: suspectId } }, diagnoseOpen: false }));
        get().toast('Diagnosis recorded. Fix it on the board, then press Verify fix.', 'success');
      },

      answerDiff: (chosen) => {
        const m = get().mission();
        const d = m.diff;
        if (!d) return;
        const correct = chosen === d.correct;
        set((s) => {
          if (s.diffAnswers[m.id]) return {};
          const stars = correct ? 3 : 1;
          return {
            diffAnswers: { ...s.diffAnswers, [m.id]: { chosen, correct, at: new Date().toISOString() } },
            best: { ...s.best, [m.id]: { stars, points: correct ? 100 : 30, at: new Date().toISOString() } },
          };
        });
      },

      apply: (fn, success) => {
        const m = get().mission();
        const r = fn(get().board());
        if (!r.ok) {
          get().toast(r.error, 'error');
          return false;
        }
        set((s) => ({ boards: { ...s.boards, [m.id]: r.board } }));
        if (success) get().toast(success, 'success');
        return true;
      },

      place: (type, zone) => {
        const m = get().mission();
        let newId: string | undefined;
        const ok = get().apply((b) => {
          const r = ops.placeComponent(b, type, zone, m.defaults);
          if (r.ok) newId = r.id;
          return r;
        });
        set({ placing: null });
        if (ok && newId) set({ selection: { kind: 'component', id: newId }, consoleTab: 'config' });
      },

      select: (selection, tab) => {
        // The IAM overview is a directory, not evidence: only opening a specific object costs an action.
        if (selection && selection.kind !== 'iam') get().charge(selectionKey(selection), `opened ${describeSelection(get().board(), selection)}`);
        set({ selection, consoleTab: tab ?? (selection?.kind === 'component' ? 'config' : 'networking') });
      },
      setTab: (consoleTab) => set({ consoleTab }),
      setPlacing: (placing) => set({ placing }),

      resetBoard: () => {
        const m = get().mission();
        set((s) => {
          const boards = { ...s.boards };
          delete boards[m.id];
          const results = { ...s.results };
          delete results[m.id];
          const incidents = { ...s.incidents };
          delete incidents[m.id];
          const reports = { ...s.reports };
          delete reports[m.id];
          return { boards, results, incidents, reports, selection: null, activeTrace: null, highlight: [] };
        });
        get().toast(m.incident ? `${m.title}: incident restarted from the alert.` : `${m.title}: board reset.`, 'info');
      },

      runSim: () => {
        const m = get().mission();
        if (m.incident) {
          const p = get().incident();
          if (!p.diagnosis) {
            get().toast('Name the root cause first (Diagnose), then verify your fix.', 'error');
            set({ diagnoseOpen: true });
            return;
          }
          const results = runMission(get().board(), m);
          const report = scoreIncident(m, { diagnosis: p.diagnosis, results, board: get().board(), actionsUsed: p.actions.length });
          set((s) => {
            const prev = s.best[m.id];
            const best = !prev || report.total > prev.points ? { ...s.best, [m.id]: { stars: report.stars, points: report.total, at: new Date().toISOString() } } : s.best;
            return {
              results: { ...s.results, [m.id]: results },
              reports: { ...s.reports, [m.id]: report },
              incidents: { ...s.incidents, [m.id]: { ...p, verifiedAt: p.verifiedAt ?? new Date().toISOString() } },
              best,
              simOpen: true,
              highlight: results.flatMap((r) => (r.status === 'fail' ? r.highlight : [])),
            };
          });
          return;
        }
        const results = runMission(get().board(), m);
        const score = scoreResults(m.events, results);
        set((s) => {
          const prev = s.best[m.id];
          const best = !prev || score.points > prev.points ? { ...s.best, [m.id]: { stars: score.stars, points: score.points, at: new Date().toISOString() } } : s.best;
          return { results: { ...s.results, [m.id]: results }, best, simOpen: true, highlight: results.flatMap((r) => (r.status === 'fail' ? r.highlight : [])) };
        });
      },

      runTrace: (flow, label) => {
        get().charge(`trace:${flow.from}>${flow.to}:${flow.protocol}:${flow.port}`, `traced ${label}`);
        const t = traceFlow(get().board(), flow);
        get().showTrace(t, flow, label);
      },
      runCallTrace: (call, label) => {
        get().charge(`call:${call.principal}>${call.action}>${call.resource}:${call.objectKey ?? ''}`, `simulated ${label}`);
        const trace = traceCall(get().board(), call);
        set((s) => ({ activeTrace: { trace, flow: { from: call.principal, to: call.resource, protocol: 'tcp', port: 443 }, label, call, nonce: (s.activeTrace?.nonce ?? 0) + 1 }, traceOpen: true }));
      },
      showTrace: (trace, flow, label) => set((s) => ({ activeTrace: { trace, flow, label, nonce: (s.activeTrace?.nonce ?? 0) + 1 }, traceOpen: true })),
      clearTrace: () => set({ activeTrace: null }),

      openSim: (simOpen) => set({ simOpen }),
      openTrace: (traceOpen) => set({ traceOpen }),
      openManual: (manualOpen) => set({ manualOpen }),
      openQuestions: (questionsOpen) => set({ questionsOpen }),

      answerQuestion: (questionId, chosen, correct) =>
        set((s) => ({ questionHistory: [...s.questionHistory, { questionId, chosen, correct, at: new Date().toISOString() }] })),

      toast: (text, kind = 'info') => {
        const id = ++toastSeq;
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
        setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      exportProgress: () => {
        const s = get();
        const state: PersistedState = {
          schemaVersion: SCHEMA_VERSION,
          currentMissionId: s.currentMissionId,
          boards: s.boards,
          best: s.best,
          questionHistory: s.questionHistory,
          conceptEvidence: s.conceptEvidence,
          settings: s.settings,
          incidents: s.incidents,
          diffAnswers: s.diffAnswers,
        };
        return JSON.stringify({ app: 'blast-radius', exportedAt: new Date().toISOString(), state }, null, 2);
      },
      importProgress: (json) => {
        try {
          const s = validateImport(JSON.parse(json));
          set({ ...s, results: {}, reports: {}, selection: null, activeTrace: null, highlight: [] });
          get().toast('Progress imported.', 'success');
        } catch (e) {
          get().toast(`Import failed: ${(e as Error).message}`, 'error');
        }
      },
      setReducedMotion: (v) => set((s) => ({ settings: { ...s.settings, reducedMotion: v } })),
    }),
    {
      name: 'blast-radius',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        schemaVersion: s.schemaVersion,
        currentMissionId: s.currentMissionId,
        boards: s.boards,
        best: s.best,
        questionHistory: s.questionHistory,
        conceptEvidence: s.conceptEvidence,
        settings: s.settings,
        incidents: s.incidents,
        diffAnswers: s.diffAnswers,
      }),
      migrate: (persisted, version) => migrate(persisted, version),
    },
  ),
);

/** Short human name for a selection, used in investigation toasts. */
export function describeSelection(board: Board, s: Selection): string {
  switch (s.kind) {
    case 'component':
      return board.components[s.id]?.name ?? s.id;
    case 'sg':
      return `security group ${board.securityGroups[s.id]?.name ?? s.id}`;
    case 'nacl':
      return `network ACL ${board.nacls[s.id]?.name ?? s.id}`;
    case 'routeTable':
      return `route table ${board.routeTables[s.id]?.name ?? s.id}`;
    case 'subnet':
      return `subnet ${s.id}`;
    case 'role':
      return board.iam?.roles[s.id]?.name ?? s.id;
    case 'key':
      return `KMS key ${board.iam?.keys[s.id]?.alias ?? s.id}`;
    case 'scp':
      return 'service control policies';
    case 'iam':
      return 'the IAM overview';
  }
}
