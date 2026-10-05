import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Board, EventResult, Flow, Mission, Placement, ServiceType, Trace } from '../engine/model';
import * as ops from '../engine/board';
import { createBoardFromLayout } from '../engine/board';
import { traceFlow } from '../engine/net/trace';
import { runMission } from '../engine/sim/runner';
import { scoreResults } from '../engine/scoring';
import { MISSION_BY_ID, MISSIONS } from '../content/missions';
import { safeStorage } from './storage';
import { migrate, PersistedState, SCHEMA_VERSION, validateImport } from './schema';

export type Selection =
  | { kind: 'component'; id: string }
  | { kind: 'subnet'; id: string }
  | { kind: 'sg'; id: string; ruleRef?: string }
  | { kind: 'nacl'; id: string; ruleRef?: string }
  | { kind: 'routeTable'; id: string; ruleRef?: string };

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface ActiveTrace {
  flow: Flow;
  trace: Trace;
  label: string;
  /** Bumped on each replay so the overlay restarts. */
  nonce: number;
}

interface UiState {
  selection: Selection | null;
  consoleTab: 'config' | 'networking' | 'notes';
  placing: ServiceType | null;
  results: Record<string, EventResult[]>;
  activeTrace: ActiveTrace | null;
  simOpen: boolean;
  traceOpen: boolean;
  manualOpen: string | null; // concept id or 'index'
  questionsOpen: boolean;
  toasts: Toast[];
  highlight: string[];
}

interface Actions {
  mission: () => Mission;
  board: () => Board;
  setMission: (id: string) => void;
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

function initialPersisted(): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentMissionId: MISSIONS[0].id,
    boards: {},
    best: {},
    questionHistory: [],
    conceptEvidence: [],
    settings: { reducedMotion: false },
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

      mission: () => MISSION_BY_ID[get().currentMissionId] ?? MISSIONS[0],
      board: () => {
        const m = get().mission();
        return get().boards[m.id] ?? emptyBoardFor(m);
      },

      setMission: (id) => set({ currentMissionId: id, selection: null, activeTrace: null, highlight: [], placing: null, simOpen: !!get().results[id] }),

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

      select: (selection, tab) => set({ selection, consoleTab: tab ?? (selection?.kind === 'component' ? 'config' : 'networking') }),
      setTab: (consoleTab) => set({ consoleTab }),
      setPlacing: (placing) => set({ placing }),

      resetBoard: () => {
        const m = get().mission();
        set((s) => {
          const boards = { ...s.boards };
          delete boards[m.id];
          const results = { ...s.results };
          delete results[m.id];
          return { boards, results, selection: null, activeTrace: null, highlight: [] };
        });
        get().toast(`${m.title}: board reset.`, 'info');
      },

      runSim: () => {
        const m = get().mission();
        const results = runMission(get().board(), m);
        const score = scoreResults(m.events, results);
        set((s) => {
          const prev = s.best[m.id];
          const best = !prev || score.points > prev.points ? { ...s.best, [m.id]: { stars: score.stars, points: score.points, at: new Date().toISOString() } } : s.best;
          return { results: { ...s.results, [m.id]: results }, best, simOpen: true, highlight: results.flatMap((r) => (r.status === 'fail' ? r.highlight : [])) };
        });
      },

      runTrace: (flow, label) => {
        const t = traceFlow(get().board(), flow);
        get().showTrace(t, flow, label);
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
        };
        return JSON.stringify({ app: 'blast-radius', exportedAt: new Date().toISOString(), state }, null, 2);
      },
      importProgress: (json) => {
        try {
          const s = validateImport(JSON.parse(json));
          set({ ...s, results: {}, selection: null, activeTrace: null, highlight: [] });
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
      }),
      migrate: (persisted, version) => migrate(persisted, version),
    },
  ),
);
