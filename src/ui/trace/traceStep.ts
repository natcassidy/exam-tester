import { create } from 'zustand';

/** Which hop the trace animation is on (shared by the overlay and the hop list). */
export const useTraceStep = create<{ step: number; set: (n: number) => void }>((set) => ({ step: 0, set: (step) => set({ step }) }));
