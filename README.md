# Blast Radius

A browser game for learning AWS Solutions Architect (Associate) material deeply: place services, configure them, trace packets through security groups, NACLs and routes, then throw traffic surges, AZ outages, audits and the monthly bill at the design. Then switch sides: investigate broken production systems in the Incident Room, debug IAM and KMS policies, and work out why one of two nearly identical designs survives.

The full spec is in [docs/BLAST_RADIUS_SPEC.md](docs/BLAST_RADIUS_SPEC.md). **Stages 1 and 2** are implemented: 4 build missions, 8 incidents and 4 Spot the Difference rounds.

## Run it

```sh
npm install
npm run dev      # local dev server
npm test         # engine + mission validation tests (Vitest)
npm run build    # one self-contained dist/index.html that plays from file://
```

No backend and no network calls at runtime. Progress lives in IndexedDB (falling back to localStorage) and can be exported/imported as JSON from the top bar.

## Layout

- `src/engine/` — pure TypeScript simulation: CIDR/routing/SG/NACL evaluation, packet tracer, capacity and failure models, cost estimate, audits, scoring. `engine/iam/` is the policy evaluator; `engine/incident/` holds board diffs, suspects and incident scoring. No React or DOM imports.
- `src/content/` — data: build missions, incidents, Spot the Difference rounds, transfer questions, concepts, Field Manual entries (`manual/*.md`).
- `src/store/` — Zustand store, persistence and schema migrations.
- `src/ui/` — React UI (board, console, tracer, sim drawer, manual, questions, incident tools, IAM editor, diff view).
- `tests/content/missions.test.ts` — validates every build mission: the reference board scores 3 stars, the empty board fails, and each listed mistake fails exactly the expected events.
- `tests/content/incidents.test.ts` — each incident's starting board fails with exactly its symptom, the reference fix passes with no collateral, and every listed wrong fix fails or is flagged.
- `tests/content/diffs.test.ts` — each Spot the Difference round has one survivor, and its answer options cover exactly the real differences between the boards.

Prices are approximate us-east-1 values in `src/engine/cost/pricing.ts`.
