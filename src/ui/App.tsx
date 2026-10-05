import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import type { ServiceType } from '../engine/model';
import { modeOf, useGame } from '../store/game';
import { DiffMain } from './diff/DiffView';
import { DiagnoseModal, IncidentBar, LogsModal } from './incident/IncidentBar';
import { Board, parseZoneId } from './board/Board';
import { Palette, PaletteOverlayItem } from './board/Palette';
import { Console } from './console/Console';
import { FieldManual } from './manual/FieldManual';
import { Questions } from './questions/Questions';
import { Brief } from './shell/Brief';
import { Toasts } from './shell/Toasts';
import { TopBar } from './shell/TopBar';
import { useIsMobile } from './shell/useMedia';
import { SimDrawer } from './sim/SimDrawer';
import { TracePanel } from './trace/TracePanel';

function RightPanel() {
  const selection = useGame((s) => s.selection);
  const traceOpen = useGame((s) => s.traceOpen);
  if (traceOpen) return <TracePanel />;
  if (selection) return <Console />;
  return <Brief />;
}

export function App() {
  const place = useGame((s) => s.place);
  const selection = useGame((s) => s.selection);
  const traceOpen = useGame((s) => s.traceOpen);
  const select = useGame((s) => s.select);
  const openTrace = useGame((s) => s.openTrace);
  const setPlacing = useGame((s) => s.setPlacing);
  const isMobile = useIsMobile();
  const [briefOpen, setBriefOpen] = useState(false);
  const [dragType, setDragType] = useState<ServiceType | null>(null);
  const mission = useGame((s) => s.mission());
  const mode = modeOf(mission);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useGame.getState();
      if (s.manualOpen) return s.openManual(null);
      if (s.logsOpen) return s.openLogs(false);
      if (s.diagnoseOpen) return s.openDiagnose(false);
      if (s.questionsOpen) return s.openQuestions(false);
      if (s.placing) return s.setPlacing(null);
      if (s.traceOpen) return s.openTrace(false);
      if (s.selection) return s.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDragStart = (e: DragStartEvent) => setDragType((e.active.data.current?.type as ServiceType) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragType(null);
    const type = e.active.data.current?.type as ServiceType | undefined;
    if (!type || !e.over) return;
    place(type, parseZoneId(String(e.over.id)));
  };

  const sheetOpen = mode !== 'diff' && isMobile && (!!selection || traceOpen || briefOpen);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragType(null)}>
      <div className="app">
        <TopBar />
        {mode === 'diff' ? (
          <div className="main diff">
            <DiffMain key={mission.id} isMobile={isMobile} />
          </div>
        ) : (
        <div className="main">
          {!isMobile && (
            <aside className="col left">
              <Palette />
            </aside>
          )}
          <main className="col center">
            {isMobile && (
              <div style={{ padding: '8px 10px 0', display: 'flex', gap: 6 }}>
                <button className="btn small" onClick={() => { setBriefOpen(true); select(null); openTrace(false); }}>
                  Brief & requirements
                </button>
              </div>
            )}
            {mode === 'incident' && <IncidentBar />}
            <Board />
          </main>
          {!isMobile && (
            <aside className="col right">
              <RightPanel />
            </aside>
          )}
          {isMobile && <Palette tray />}
        </div>
        )}
        {mode !== 'diff' && <SimDrawer />}
      </div>
      {sheetOpen && (
        <>
          <div className="modal-back" style={{ background: 'rgba(0,0,0,0.35)', zIndex: 39 }} onClick={() => { setBriefOpen(false); select(null); openTrace(false); setPlacing(null); }} />
          <aside className="col right sheet" aria-label="Console">
            <div className="sheet-grip" />
            {traceOpen ? <TracePanel /> : selection ? <Console /> : <Brief />}
          </aside>
        </>
      )}
      <DragOverlay dropAnimation={null}>{dragType ? <PaletteOverlayItem type={dragType} /> : null}</DragOverlay>
      <Questions />
      <LogsModal />
      <DiagnoseModal />
      <FieldManual />
      <Toasts />
    </DndContext>
  );
}
