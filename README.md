# Blast Radius

A browser game for learning AWS Solutions Architect (Associate) material deeply: place services, configure them, trace packets through security groups, NACLs and routes, then throw traffic surges, AZ outages, audits and the monthly bill at the design.

The full spec is in [docs/BLAST_RADIUS_SPEC.md](docs/BLAST_RADIUS_SPEC.md). **Stage 1** is implemented.

## Run it

```sh
npm install
npm run dev      # local dev server
npm test         # engine + mission validation tests (Vitest)
npm run build    # one self-contained dist/index.html that plays from file://
```

No backend and no network calls at runtime. Progress lives in IndexedDB (falling back to localStorage) and can be exported/imported as JSON from the top bar.

## Layout

- `src/engine/` — pure TypeScript simulation: CIDR/routing/SG/NACL evaluation, packet tracer, capacity and failure models, cost estimate, audits, scoring. No React or DOM imports.
- `src/content/` — data: missions, transfer questions, concepts, Field Manual entries (`manual/*.md`).
- `src/store/` — Zustand store, persistence and schema migrations.
- `src/ui/` — React UI (board, console, tracer, sim drawer, manual, questions).
- `tests/content/missions.test.ts` — validates every mission: the reference board scores 3 stars, the empty board fails, and each listed mistake fails exactly the expected events.

Prices are approximate us-east-1 values in `src/engine/cost/pricing.ts`.
