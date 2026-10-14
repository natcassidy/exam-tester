// Inline SVG icons. Unicode symbols (⚿, ⟿, ⇧) render as empty boxes in some system fonts.

const PATHS: Record<string, string> = {
  clock: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z M9 4v14 M15 6v14',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4',
  trace: 'M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 17c5-1 2-9 8-10',
  key: 'M14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M13 12l7 7 M17 16l2-2 M15 14l2-2',
  book: 'M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h13 M8 7h7 M8 11h5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  undo: 'M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  reset: 'M4 4v6h6 M5 15a8 8 0 1 0 2-8.5L4 10',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14 M12 17.5v.5 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  target: 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  upload: 'M12 20V9 M7 14l5-5 5 5 M5 4h14',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  warn: 'M12 4 2.5 20h19L12 4z M12 10v4 M12 17v.5',
  play: 'M7 5v14l11-7L7 5z',
  close: 'M6 6l12 12 M18 6 6 18',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 15, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
