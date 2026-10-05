import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Board, EventResult, EventSpec, Flow, Mission, Placement, ServiceType, Trace } from '../engine/model';
import type { CallSpec } from '../engine/iam/access';
import { traceCall } from '../engine/iam/access';
import { IncidentScore, scoreIncident } from '../engine/incident/score';
import * as ops from '../engine/board';
import { createBoardFromLayout } from '../engine/board';
import { traceFlow } from '../engine/net/trace';
import { runEvent, runMission } from '../engine/sim/runner';
import { RefactorScore, scoreRefactor, scoreResults } from '../engine/scoring';
import { addEvidence, Evidence, evidenceFor, evidenceFromResults } from '../engine/mastery/evidence';
import { buildDailySession, dueConcepts } from '../engine/mastery/daily';
import { pickSurprise } from '../engine/mastery/surprise';
import { drawExam, scoreExam } from '../engine/mastery/exam';
import { ALL_MISSIONS, DIFFS, INCIDENTS, MISSION_BY_ID, MISSIONS } from '../content/missions';
import { CONCEPTS } from '../content/concepts';
import { QUESTION_BY_ID, QUESTIONS } from '../content/questions';
import { SURPRISES } from '../content/surprises';
import { safeStorage } from './storage';
import { DailyRecord, ExamAttempt, IncidentProgress, migrate, PersistedState, SCHEMA_VERSION, validateImport } from './schema';

/** Wall clock, in one place. */
export const nowIso = () => new Date().toISOString();
const pad = (n: number) => String(n).padStart(2, '0');
/** The player's local calendar day (daily sessions and streaks follow the player's midnight). */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const CONCEPT_IDS = CONCEPTS.map((c) => c.id);

// Starting-board and reference results of refactor missions: computed once per mission.
const baselines: Record<string, { start: EventResult[]; ref: EventResult[] }> = {};
export function refactorBaselines(m: Mission) {
  return (baselines[m.id] ??= { start: runMission(m.startingBoard!, m), ref: runMission(m.reference, m) });
}

/** A day's session is complete when every item has been answered. */
export function dailyComplete(r: DailyRecord | undefined): boolean {
  return !!r && r.plan.items.length > 0 && r.plan.items.every((i) => i.id in r.done);
}

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

export type Mode = 'build' | 'incident' | 'diff' | 'refactor';

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
  // ----- Stage 4 -----
  /** Concept map: null (closed), 'index', or a concept id to show. */
  mapOpen: string | null;
  dailyOpen: boolean;
  examOpen: boolean;
  /** Defend round being answered. */
  defend: { missionId: string; eventId: string } | null;
  /** Surprise event injected into a replayed build mission, with its latest result. */
  surprise: Record<string, { event: EventSpec; result?: EventResult }>;
  refactorScores: Record<string, RefactorScore>;
  /** "Practice this": a custom question set for the questions modal. */
  practice: { title: string; questionIds: string[] } | null;
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
  // ----- Stage 4 -----
  recordEvidence: (items: Evidence[]) => void;
  openMap: (v: string | null) => void;
  openDaily: (v: boolean) => void;
  /** Today's session, created (and frozen) on first call of the day. */
  ensureDaily: () => DailyRecord;
  completeDailyItem: (itemId: string, correct: boolean, chosen?: string[]) => void;
  openDefend: (d: { missionId: string; eventId: string } | null) => void;
  saveDefend: (missionId: string, eventId: string, answer: string, covered: number[], rubricLength: number) => void;
  openExam: (v: boolean) => void;
  currentExam: () => ExamAttempt | null;
  startExam: () => void;
  answerExam: (questionId: string, chosen: string[]) => void;
  toggleFlag: (questionId: string) => void;
  finishExam: () => void;
  abandonExam: () => void;
  setTutorial: (step: number, done?: boolean) => void;
  practiceConcept: (conceptId: string) => void;
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
  return m.mode === 'incident' ? 'incident' : m.mode === 'diff' ? 'diff' : m.mode === 'refactor' ? 'refactor' : 'build';
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
    daily: {},
    defends: {},
    exams: [],
    tutorial: { done: false, step: 0 },
  };
}

function persistedOf(s: PersistedState): PersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentMissionId: s.currentMissionId,
    boards: s.boards,
    best: s.best,
    questionHistory: s.questionHistory,
    conceptEvidence: s.conceptEvidence,
    settings: s.settings,
    incidents: s.incidents,
    diffAnswers: s.diffAnswers,
    daily: s.daily,
    defends: s.defends,
    exams: s.exams,
    tutorial: s.tutorial,
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
      mapOpen: null,
      dailyOpen: false,
      examOpen: false,
      defend: null,
      surprise: {},
      refactorScores: {},
      practice: null,

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
          const at = nowIso();
          return {
            diffAnswers: { ...s.diffAnswers, [m.id]: { chosen, correct, at } },
            best: { ...s.best, [m.id]: { stars, points: correct ? 100 : 30, at } },
            conceptEvidence: addEvidence(s.conceptEvidence, evidenceFor('diff', m.id, m.concepts, correct, at)),
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
          const refactorScores = { ...s.refactorScores };
          delete refactorScores[m.id];
          return { boards, results, incidents, reports, refactorScores, selection: null, activeTrace: null, highlight: [] };
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
          // The diagnosis is evidence once, at the first verify (it locks there).
          if (!p.verifiedAt) get().recordEvidence(evidenceFor('incident', m.id, m.concepts, report.rootCause.correct, nowIso()));
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
        const at = nowIso();
        const board = get().board();
        const results = runMission(board, m);
        let evidence = evidenceFromResults(m.id, m.events, results, at);
        let surprise = get().surprise[m.id];
        // Replaying a build mission injects one surprise event drawn from a due concept.
        if (m.mode === 'build' && get().best[m.id] && !surprise) {
          const ev = pickSurprise(m, dueConcepts(get().conceptEvidence, CONCEPT_IDS, at), SURPRISES);
          if (ev) {
            surprise = { event: ev };
            get().toast(`Surprise event: ${ev.name.replace(/^Surprise: /, '')}. It doesn't change your stars, but it counts for your mastery.`, 'info');
          }
        }
        if (surprise) {
          const r = runEvent(board, surprise.event, { budget: m.budget, usage: m.usage });
          surprise = { event: surprise.event, result: r };
          evidence = [...evidence, ...evidenceFromResults(m.id, [surprise.event], [r], at, 'surprise')];
        }
        get().recordEvidence(evidence);
        if (m.mode === 'refactor') {
          const base = refactorBaselines(m);
          const rs = scoreRefactor(m, results, base.start, base.ref);
          set((s) => {
            const prev = s.best[m.id];
            const best = !prev || rs.points > prev.points ? { ...s.best, [m.id]: { stars: rs.stars, points: rs.points, at } } : s.best;
            return { results: { ...s.results, [m.id]: results }, refactorScores: { ...s.refactorScores, [m.id]: rs }, best, simOpen: true, highlight: results.flatMap((r) => (r.status === 'fail' ? r.highlight : [])) };
          });
          return;
        }
        const score = scoreResults(m.events, results);
        set((s) => {
          const prev = s.best[m.id];
          const best = !prev || score.points > prev.points ? { ...s.best, [m.id]: { stars: score.stars, points: score.points, at } } : s.best;
          return {
            results: { ...s.results, [m.id]: results },
            best,
            surprise: surprise ? { ...s.surprise, [m.id]: surprise } : s.surprise,
            simOpen: true,
            highlight: results.flatMap((r) => (r.status === 'fail' ? r.highlight : [])),
          };
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
      openQuestions: (questionsOpen) => set(questionsOpen ? { questionsOpen } : { questionsOpen, practice: null }),

      answerQuestion: (questionId, chosen, correct) => {
        const at = nowIso();
        const q = QUESTION_BY_ID[questionId];
        set((s) => ({
          questionHistory: [...s.questionHistory, { questionId, chosen, correct, at }],
          conceptEvidence: q ? addEvidence(s.conceptEvidence, evidenceFor('question', q.id, q.concepts, correct, at)) : s.conceptEvidence,
        }));
      },

      toast: (text, kind = 'info') => {
        const id = ++toastSeq;
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
        setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      exportProgress: () => JSON.stringify({ app: 'blast-radius', exportedAt: nowIso(), state: persistedOf(get()) }, null, 2),
      importProgress: (json) => {
        try {
          const s = validateImport(JSON.parse(json));
          set({ ...s, results: {}, reports: {}, refactorScores: {}, surprise: {}, selection: null, activeTrace: null, highlight: [] });
          get().toast('Progress imported.', 'success');
        } catch (e) {
          get().toast(`Import failed: ${(e as Error).message}`, 'error');
        }
      },
      setReducedMotion: (v) => set((s) => ({ settings: { ...s.settings, reducedMotion: v } })),

      // ----- Stage 4 -----
      recordEvidence: (items) => {
        if (items.length) set((s) => ({ conceptEvidence: addEvidence(s.conceptEvidence, items) }));
      },
      openMap: (mapOpen) => set({ mapOpen }),
      openDaily: (dailyOpen) => {
        if (dailyOpen) get().ensureDaily();
        set({ dailyOpen });
      },
      ensureDaily: () => {
        const today = localDay();
        const existing = get().daily[today];
        if (existing) return existing;
        const s = get();
        const plan = buildDailySession({
          today,
          now: nowIso(),
          evidence: s.conceptEvidence,
          questionHistory: s.questionHistory,
          concepts: CONCEPTS,
          questions: QUESTIONS,
          diffs: DIFFS.map((m) => ({ id: m.id, concepts: m.concepts })),
          incidents: INCIDENTS.map((m) => ({ id: m.id, concepts: m.concepts })),
        });
        const rec: DailyRecord = { plan, done: {} };
        set((st) => ({ daily: { ...st.daily, [today]: rec } }));
        return rec;
      },
      completeDailyItem: (itemId, correct, chosen) => {
        const today = localDay();
        const rec = get().daily[today];
        const item = rec?.plan.items.find((i) => i.id === itemId);
        if (!rec || !item || itemId in rec.done) return;
        const at = nowIso();
        let evidence: Evidence[] = [];
        if (item.kind === 'question') {
          const q = QUESTION_BY_ID[item.questionId];
          if (q) evidence = evidenceFor('question', q.id, q.concepts, correct, at);
          set((s) => ({ questionHistory: [...s.questionHistory, { questionId: item.questionId, chosen: chosen ?? [], correct, at }] }));
        } else {
          const m = MISSION_BY_ID[item.missionId];
          if (m) evidence = evidenceFor(item.kind, m.id, m.concepts, correct, at);
        }
        set((s) => ({ daily: { ...s.daily, [today]: { ...rec, done: { ...rec.done, [itemId]: correct } } }, conceptEvidence: addEvidence(s.conceptEvidence, evidence) }));
      },
      openDefend: (defend) => set({ defend }),
      saveDefend: (missionId, eventId, answer, covered, rubricLength) => {
        const at = nowIso();
        const ev = MISSION_BY_ID[missionId]?.events.find((e) => e.id === eventId);
        const key = `${missionId}/${eventId}`;
        set((s) => ({
          defends: { ...s.defends, [key]: { answer, covered, at } },
          conceptEvidence: ev ? addEvidence(s.conceptEvidence, evidenceFor('defend', key, ev.concepts, covered.length * 2 >= rubricLength, at)) : s.conceptEvidence,
        }));
      },
      openExam: (examOpen) => set({ examOpen }),
      currentExam: () => {
        const last = get().exams[get().exams.length - 1];
        return last && !last.finishedAt ? last : null;
      },
      startExam: () => {
        if (get().currentExam()) return;
        const startedAt = nowIso();
        const id = `exam-${startedAt}`;
        const attempt: ExamAttempt = { id, startedAt, questionIds: drawExam(QUESTIONS, id), answers: {}, flagged: [] };
        set((s) => ({ exams: [...s.exams, attempt] }));
      },
      answerExam: (questionId, chosen) => {
        const cur = get().currentExam();
        if (!cur) return;
        set((s) => ({ exams: [...s.exams.slice(0, -1), { ...cur, answers: { ...cur.answers, [questionId]: chosen } }] }));
      },
      toggleFlag: (questionId) => {
        const cur = get().currentExam();
        if (!cur) return;
        const flagged = cur.flagged.includes(questionId) ? cur.flagged.filter((x) => x !== questionId) : [...cur.flagged, questionId];
        set((s) => ({ exams: [...s.exams.slice(0, -1), { ...cur, flagged }] }));
      },
      finishExam: () => {
        const cur = get().currentExam();
        if (!cur) return;
        const at = nowIso();
        const sc = scoreExam(cur.questionIds, QUESTION_BY_ID, cur.answers);
        const evidence = cur.questionIds.flatMap((id) => {
          const q = QUESTION_BY_ID[id];
          const a = cur.answers[id];
          return q ? evidenceFor('exam', id, q.concepts, !!a && a.length === q.correct.length && q.correct.every((c) => a.includes(c)), at) : [];
        });
        const done: ExamAttempt = { ...cur, finishedAt: at, score: { scaled: sc.scaled, correct: sc.correct, total: sc.total, pass: sc.pass, byDomain: sc.byDomain } };
        set((s) => ({ exams: [...s.exams.slice(0, -1), done], conceptEvidence: addEvidence(s.conceptEvidence, evidence) }));
      },
      abandonExam: () => {
        if (get().currentExam()) set((s) => ({ exams: s.exams.slice(0, -1) }));
      },
      setTutorial: (step, done) => set((s) => ({ tutorial: { step, done: done ?? s.tutorial.done } })),
      practiceConcept: (conceptId) => {
        const c = CONCEPTS.find((x) => x.id === conceptId);
        const ids = QUESTIONS.filter((q) => q.concepts.includes(conceptId)).map((q) => q.id).slice(0, 5);
        if (!ids.length) return get().toast('No questions for this concept yet: try a mission that teaches it.', 'info');
        set({ practice: { title: `Practice: ${c?.title ?? conceptId}`, questionIds: ids }, questionsOpen: true, mapOpen: null });
      },
    }),
    {
      name: 'blast-radius',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => persistedOf(s),
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
