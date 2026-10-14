# Blast Radius

A browser game for learning AWS Solutions Architect (Associate) material deeply: place services, configure them, trace packets through security groups, NACLs and routes, then throw traffic surges, AZ outages, audits and the monthly bill at the design. Then switch sides: investigate broken production systems in the Incident Room, debug IAM and KMS policies, and work out why one of two nearly identical designs survives. Breadth missions add a second Region, peering and Transit Gateway, an on-premises data centre over VPN and Direct Connect, S3 storage classes and data protection, streaming and migrations. Retention features track what you know: a concept map coloured by mastery, spaced repetition, a 10-minute daily session, surprise events on replays, Defend rounds you grade against a rubric (or paste into Claude), refactor missions that cut a working design's bill, and a timed 65-question practice exam.

The full spec is in [docs/BLAST_RADIUS_SPEC.md](docs/BLAST_RADIUS_SPEC.md). **All four stages** are implemented: 12 build missions (4 depth, 8 breadth), 8 incidents, 4 Spot the Difference rounds, 5 refactor missions, 152 questions balanced to the SAA-C03 domain weights, and 81 Field Manual entries.

## Run it

```sh
npm install
npm run dev      # local dev server
npm test         # engine + mission validation tests (Vitest)
npm run e2e      # browser tests of the getting-unstuck flows (Playwright, Chromium)
npm run build    # one self-contained dist/index.html that plays from file://
```

## Getting unstuck

Every failed check says what is wrong on *your* board, what it should be, and how to fix it. **Fix it** opens the exact object, on the right tab, and highlights the field or rule to change; a pinned banner keeps the instruction in view. Failures sort first in the results drawer and stale results are flagged after an edit. When that isn't enough, **Stuck?** reveals the mission's hints one at a time and then a plain-language comparison with the reference design (hints cost an investigation action in incidents, and every assist counts as a "not yet" for its concepts in spaced repetition). The board toolbar has undo/redo (Ctrl/⌘+Z), an undoable reset, live security checks, and a **Security view** that draws which security group lets which tier in and marks borrowed groups.

## Finding a mission

**All** at the start of the mission row opens an index of every mission in every mode: Build and Refactor missions and Incidents by stage, Spot the Difference rounds, and all Course Labs by course section, each with its stars and a done count per group. Search finds any mission by title, client or course section across all modes, and picking one jumps straight to it.

## Course Labs

**Course Labs** (top bar) follows the sections of the SAA-C03 video course, so you can test each section right after watching it. The arrows beside the section name step to the previous or next section, and clicking the section name lists every section and its labs. Each section has one to three labs. Each lab is tagged:

- **fix**: the board is already built and something on it is broken.
- **finish**: the board is half-built; keep what works and add what is missing.
- **build**: you start from an empty board.

Each brief lists the lectures to rewatch if you get stuck, and **Restore the starting board** puts a fix or finish lab back the way it was handed over. There are 37 labs across 21 sections. Sections that are introductions, recaps or services the simulator doesn't model (EBS/EFS, containers, ML, monitoring) are listed without labs, and say why. Labs reuse everything else: easy and hard palettes, hints, Fix it, the solution review and practice questions. They live in `src/content/course/`. `tests/content/course.test.ts` checks that every lab's reference earns 3 stars, that the handed-over board fails exactly as its brief says, and that every section has its labs.

## Easy and hard, and the solution review

Build and refactor missions come in two difficulties (switch in the brief or in Settings). **Easy** offers only the services the mission can use. **Hard** mixes four to six plausible services the design doesn't need into the palette, and hides the exam signal phrases until your first run, so picking the right tools is part of the puzzle. Three stars in hard mode earn the mission chip an **H**.

After a run, **Solution review** (or **See the solution** before every check passes, which counts as help) shows the reference design's key decisions, each with what the reference does, why it matters and the checks that prove it, marked ✓ (your design handles it), ✗ (it doesn't, with exactly where your board differs) or = (you match the reference; another decision explains the failure). A side-by-side tab outlines what's missing, extra or set up differently on both boards, and every service the reference skipped comes with a "why not". The content lives in `src/content/solutions.ts`; `tests/content/solutions.test.ts` checks that every distractor can be placed, every mistake board is blamed on the decision that actually differs, and no difference goes unexplained.

No backend and no network calls at runtime. Progress lives in IndexedDB (falling back to localStorage) and can be exported/imported as JSON from the top bar.

## Layout

- `src/engine/` — pure TypeScript simulation: CIDR/routing/SG/NACL evaluation, packet tracer (peering, Transit Gateway, VPN/DX to on-premises), Route 53 policies (`net/dns.ts`), capacity, AZ and Region failure models (`sim/failure.ts`, `sim/dr.ts`), cost estimate, audits, scoring. `engine/iam/` is the policy evaluator; `engine/incident/` holds board diffs, suspects and incident scoring. No React or DOM imports.
- `src/engine/mastery/` — evidence, mastery, Leitner spaced repetition, the daily session, exam draw and scoring, and surprise selection. Pure functions with injected dates.
- `src/content/` — data: build missions, incidents, Spot the Difference rounds, refactor missions, questions, concepts and exam task statements, surprise events, Defend prompts, Field Manual entries (`manual/*.md`).
- `src/store/` — Zustand store, persistence and schema migrations.
- `src/ui/` — React UI (board, console, tracer, sim drawer, manual, questions, incident tools, IAM editor, diff view, concept map, daily session, Defend rounds, exam mode, tutorial and settings).
- `tests/content/fixes.test.ts` — every failure on every mistake, incident and wrong-fix board carries a fix hint, a target that exists and a focus label the console renders.
- `e2e/course.spec.ts` — picks a course section, opens a fix lab and runs its broken starting board.
- `e2e/review.spec.ts` — easy and hard palettes, and the solution review on a solved and a failing board, including a phone-width check.
- `e2e/unstuck.spec.ts` — replays stuck scenarios in Chromium (the load balancer's security group on the app tier, the hint ladder, undo/redo, the Security view) and counts the clicks to recover.
- `tests/content/missions.test.ts` — validates every build mission: the reference board scores 3 stars, the empty board fails, and each listed mistake fails exactly the expected events.
- `tests/content/incidents.test.ts` — each incident's starting board fails with exactly its symptom, the reference fix passes with no collateral, and every listed wrong fix fails or is flagged.
- `tests/engine/stage3.test.ts` — peering non-transitivity, TGW route tables, on-prem over VPN/DX, overlapping CIDRs, Route 53 policies, and the RTO/RPO/strategy of each DR strategy.
- `tests/content/diffs.test.ts` — each Spot the Difference round has one survivor, and its answer options cover exactly the real differences between the boards.
- `tests/content/refactors.test.ts` — each refactor's production board misses the new requirements, its reference scores 3 stars, and each mistake fails exactly its expected events.
- `tests/engine/mastery.test.ts` and `tests/engine/persistence.test.ts` — SRS, mastery, daily sessions, exam draws and surprises with injected dates; the v2 → v3 save migration and an export → import round trip that restores mastery exactly.

Prices are approximate us-east-1 values in `src/engine/cost/pricing.ts`.
