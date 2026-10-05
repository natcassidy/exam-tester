# Blast Radius — Implementation Spec

A browser-based game for learning AWS Solutions Architect (Associate) material deeply. You don't just place boxes. You configure them, trace packets and permission checks through them, break them on purpose, and prove the knowledge transfers to exam-style questions.

This spec is written for a Claude Code session to implement in **four stages**. Each stage must ship as a working, playable app before the next begins.

The file `blast-radius-v1.html` is the current single-file prototype. It is the visual and gameplay baseline. Port its look, its four missions and its feel, then go much deeper.

---

## 0. Ground rules

### Product constraints
- **Runs entirely in the browser, locally.** No backend, no accounts, no login, no network calls at runtime.
- All progress is stored in browser storage, with **Export progress / Import progress** (JSON file) for backup or moving between devices.
- Must work on desktop and phone (touch drag and drop, ~400px wide minimum).
- The production build must open by double-clicking `dist/index.html` (via `file://`). See the stack section below.

### Working rules for the implementer
- Implement one stage at a time. A stage is done only when its **acceptance criteria** (listed at the end of each stage) pass, including tests.
- The **simulation engine is pure TypeScript** with no React or DOM imports. Everything the game decides (reachability, permissions, capacity, cost, RTO/RPO, scoring) lives in `src/engine` and is unit-tested.
- Content (missions, questions, Field Manual entries) is **data**, separate from code, so new scenarios can be added without touching the engine.
- **AWS accuracy matters more than volume.** Verify service behaviour, limits and prices against current AWS documentation before encoding them. Prices are approximate (us-east-1), live in one pricing table, and are labelled "approximate" in the UI.
- Before Stage 4, check the current SAA exam guide (SAA-C03 or its successor) and update the domain list and weights if they changed.
- The sim must be **deterministic**: if randomness is used, it must be seeded, so tests are repeatable.

### Design principles (do not lose these)
1. **Consequences, not verdicts.** A failure shows what happened (the packet dropped at NACL rule 100, the queue grew to 12,000 messages, 47 minutes of downtime), not just "incorrect."
2. **Every failure links to its cause.** Clicking a failed result opens the exact config and rule involved, plus the related Field Manual entry.
3. **No spoilers before the sim.** Placement only blocks things that are impossible in AWS (a NAT gateway in a private subnet, a deny rule in a security group) and explains why. Bad-but-possible designs are allowed and get caught by the simulation.
4. **Transfer over memorisation.** Every mission ends with questions testing the same concepts in a *different* story.
5. **Real numbers.** CIDRs, port ranges, default timeouts, health check intervals and prices are realistic.

---

## 1. Stack and project layout

- **Vite + React 18 + TypeScript (strict)**
- **Zustand** for UI and game state, with its persist middleware writing to IndexedDB (`idb-keyval`), falling back to localStorage
- **@dnd-kit/core** for drag and drop (pointer, touch and keyboard support)
- **CodeMirror 6** with JSON mode for policy editing (Stage 2)
- **Vitest** for engine and content tests
- **vite-plugin-singlefile** so `npm run build` produces one self-contained `dist/index.html` that works from `file://`
- Charts: small hand-written SVG components (timeline, sparkline). No chart library needed.
- Styling: plain CSS with design tokens. Carry over v1's tokens (dark ops-console palette, Bricolage Grotesque / Instrument Sans / IBM Plex Mono, category colours, green public / blue private subnet tints). Bundle the fonts locally with `@fontsource`, since there are no runtime network calls.

```
src/
  engine/
    model.ts            core types (Board, Component, configs, results)
    net/cidr.ts         CIDR parse/contains, longest-prefix match
    net/routing.ts      route table resolution
    net/sg.ts           security group evaluation (stateful)
    net/nacl.ts         NACL evaluation (stateless, ordered)
    net/trace.ts        packet tracer (produces Hop[])
    iam/                policy parsing, ARN/wildcard matching, evaluator (Stage 2)
    sim/runner.ts       runs a mission's events, returns EventResult[]
    sim/events/*.ts     one module per event kind
    sim/capacity.ts     per-minute traffic/capacity model
    sim/failure.ts      outage handling, RTO/RPO calculation
    cost/pricing.ts     single pricing table
    cost/estimate.ts    monthly estimate from board + usage profile
    audit/rules.ts      reusable audit checks
    scoring.ts          stars, domain scores, incident scoring
    mastery/srs.ts      spaced repetition (Stage 4)
  content/
    services.ts         service catalog (palette)
    concepts.ts         concept IDs mapped to exam task statements
    missions/*.ts       one file per mission
    questions/*.ts      question bank by domain
    manual/*.md         Field Manual entries (imported as raw strings)
  store/                Zustand stores + persistence + schema migrations
  ui/
    board/  console/  trace/  sim/  questions/  manual/  incident/  map/  shell/
tests/
  engine/*.test.ts
  content/missions.test.ts   automated mission validation (see 2.9)
```

---

## 2. Core model (built in Stage 1, extended later)

### 2.1 Board

The board is the architecture: topology, configs and network objects.

```ts
type ZoneType = 'edge' | 'region' | 'vpcAttach' | 'subnet' | 'onprem'; // onprem added in Stage 3

interface Board {
  regions: Region[];              // Stage 1–2: exactly one (us-east-1)
  edge: ComponentId[];            // Route 53, CloudFront, WAF (global)
  components: Record<ComponentId, Component>;
  routeTables: Record<string, RouteTable>;
  securityGroups: Record<string, SecurityGroup>;
  nacls: Record<string, Nacl>;
  iam?: IamState;                 // Stage 2
}

interface Region { id: string; name: string; vpcs: Vpc[]; regionalServices: ComponentId[]; }

interface Vpc {
  id: string; cidr: string;       // e.g. 10.0.0.0/16
  azs: { id: string; name: string; subnets: Subnet[] }[];
  attachments: ComponentId[];     // IGW, gateway endpoints, VGW/TGW attachments later
}

interface Subnet {
  id: string; cidr: string; azId: string;
  routeTableId: string; naclId: string;
  components: ComponentId[];
  // "public" is DERIVED: the route table has 0.0.0.0/0 -> igw. It is never stored.
}
```

**Teaching rule:** the UI labels a subnet "Public" or "Private" only by checking its route table, and shows why ("Public: 0.0.0.0/0 → igw-1"). If the learner deletes that route, the label changes.

In Stages 1–2, missions define the VPC layout (CIDR, AZs, subnets). Learners place and configure components but don't add subnets. Stage 3 adds a second Region, a second VPC and on-prem.

### 2.2 Components

```ts
interface Component {
  id: ComponentId;
  type: ServiceType;              // 'alb' | 'ec2' | 'asg' | 'rds' | 's3' | 'sqs' | ...
  name: string;                   // e.g. "app-asg"
  placement: { kind: ZoneType; refId: string }; // the subnet, Region, VPC or edge it lives in
  subnets?: string[];             // multi-subnet resources (ALB, ASG, RDS subnet group)
  securityGroupIds?: string[];    // anything with an ENI
  config: ServiceConfig;          // discriminated union keyed by type
  locked?: boolean;               // incident missions can lock pieces
}
```

Multi-AZ resources (ALB, ASG, RDS with a standby, Aurora) are **one component spanning several subnets**, not several cards. On the board they render as a card that visually straddles the AZs it is enabled in. This fixes v1's "place the ALB twice" shortcut and matches how AWS actually works.

### 2.3 Network objects

```ts
interface RouteTable { id: string; name: string; routes: { dest: string; target: RouteTarget }[]; }
// target: 'local' | { igw: id } | { nat: id } | { vpce: id } | { pcx: id } | { tgw: id } | { vgw: id }
// dest can be a CIDR or a prefix list like 'pl-s3' for gateway endpoints.

interface SecurityGroup {
  id: string; name: string;
  inbound: SgRule[]; outbound: SgRule[];   // allow-only. No deny rules can exist.
}
interface SgRule { protocol: 'tcp'|'udp'|'icmp'|'all'; fromPort: number; toPort: number;
                   source: { cidr: string } | { sg: string } | { prefixList: string }; description?: string; }

interface Nacl {
  id: string; name: string;
  inbound: NaclRule[]; outbound: NaclRule[];  // evaluated lowest ruleNumber first. Implicit "*" deny at the end.
}
interface NaclRule { ruleNumber: number; protocol: ...; portRange: [number, number];
                     cidr: string; action: 'allow' | 'deny'; }
```

**Validation must give AWS-real errors**, and each error is a teaching moment:
- Adding a deny rule to a security group → "Security groups only support allow rules. To block traffic, use a network ACL."
- NACL rule numbers must be 1–32766 and unique per direction.
- An SG rule that references an SG from another VPC (without peering) is rejected.

### 2.4 Defaults: helpful vs. bare

Each mission sets `defaults: 'helpful' | 'bare'`.
- **helpful** (early missions): placing an ALB auto-creates `alb-sg` (443 from 0.0.0.0/0). Placing an ASG creates `app-sg` that allows 443 from `alb-sg`. Default NACLs allow everything. Public and private route tables are prewired.
- **bare** (later missions and incidents): new components get an empty SG and the learner wires everything themselves.

### 2.5 Packet tracer (`engine/net/trace.ts`), the signature feature

**Input:** `Flow { from: Endpoint; to: Endpoint; protocol; port }`. An endpoint is a component, `internet`, `onprem` (Stage 3) or an AWS service endpoint (`s3`, `dynamodb`, ...).

**Output:** `Trace { result: 'delivered' | 'dropped'; hops: Hop[]; returnHops: Hop[] }`

```ts
interface Hop {
  at: { kind: 'component'|'subnet'|'igw'|'nat'|'vpce'|'internet'|...; id: string };
  check: 'sg-out'|'nacl-out'|'route'|'igw'|'nat'|'nacl-in'|'sg-in'|'lb-listener'|'lb-target-health'
        |'public-ip'|'endpoint-policy'|'iam'; // 'iam' and 'endpoint-policy' arrive in Stage 2
  result: 'allow' | 'deny' | 'info';
  matched?: { objectId: string; ruleRef: string };  // e.g. nacl-app / outbound rule #100
  explain: string;                                  // plain English: why this hop allowed or denied
}
```

**The algorithm follows real VPC semantics:**
1. **Leaving the source:** source SG outbound, then source subnet NACL outbound, then a route lookup in the source subnet's route table (longest-prefix match on the destination IP or prefix list).
2. **Following the route target:**
   - `local`: go to the destination subnet.
   - `igw`: the source needs a public IP or EIP for internet egress. Inbound from the internet needs one too, unless traffic arrives via a load balancer.
   - `nat`: the NAT must sit in a subnet whose own route table sends 0.0.0.0/0 to an IGW. The NAT subnet's NACL applies in both directions.
   - `vpce`: the endpoint's route table association must include the source subnet.
   - Missing route: drop, with the explanation "No route to 52.x.x.x in rtb-private".
3. **Arriving at the destination:** destination subnet NACL inbound, then destination SG inbound. SG sources match by CIDR or by SG membership of the sender's ENI.
4. **Return traffic:** SGs are stateful, so return traffic is automatically allowed (shown as an `info` hop). NACLs are stateless, so the destination NACL outbound and the source NACL inbound must allow **ephemeral ports 1024–65535** back to the sender. This is where the classic NACL bug becomes visible.
5. **Load balancers are two connections.** The client-to-ALB leg checks the listener and the ALB's SG. The ALB-to-target leg is a new flow from the ALB's ENI in that AZ, needs a healthy target, and needs the target SG to allow the ALB SG. *(Refined in Stage 2.)* When **every** target is unhealthy, the ALB **fails open** and routes to all of them, as AWS does; the trace shows this as an info hop instead of a 503. A 503 from target health only happens while some targets are healthy and the rest are churning (see `fleetHealth`).
6. **Failed AZs:** components in a downed AZ are unreachable. The trace picks a surviving path if one exists.

**Trace UI:**
- Animate a dot along the path over the board (SVG overlay between element centres). Each hop pauses briefly and lights green, red or grey.
- A side panel lists hops. Clicking one opens that object's Console panel with the matched rule highlighted.
- Players can run **ad-hoc traces** at any time ("Trace from: app-asg → To: internet : 443") as well as during sim events. In incident missions, ad-hoc traces cost investigation actions.

### 2.6 Simulation runner and event kinds

```ts
interface EventSpec { id: string; name: string; desc: string; domain: Domain; concepts: ConceptId[];
                      kind: EventKind; params: any; requirementIds?: string[]; }
interface EventResult { status: 'pass'|'warn'|'fail'; summary: string; detail?: EventDetail;
                        lesson: string; manual: ConceptId[]; highlight: ComponentId[];
                        trace?: Trace; timeline?: TimelineSeries; metrics?: Record<string, number>; }
```

Event kinds are generic and parameterised, so missions are mostly configuration:

| Kind | Params | What it does |
|---|---|---|
| `reachability` | from, to, port, expect `allow`/`deny` | Runs a trace. "Database unreachable from the internet" is `expect: deny`. |
| `traffic` | profile `[{min, rps}]`, SLOs (error rate, p95 latency) | Per-minute capacity model (2.7). Produces a timeline chart. |
| `azOutage` | az, startMin, required RTO/RPO | Fails the AZ and computes measured RTO/RPO per tier (2.8). |
| `audit` | rule IDs | Runs reusable checks: `dbNotPublic`, `noSshFromWorld`, `s3BlockPublicAccess`, `encryptionAtRest`, `appTierPrivate`, `wafOnPublicEntry`... |
| `queueBehavior` | processingTimeSec, failureRate, arrivals | SQS semantics: visibility timeout shorter than processing time causes duplicates; no DLQ means poison messages loop forever; FIFO ordering and throughput. |
| `bill` | usage profile | Cost estimate (2.10) against the budget, with line items. |
| `iamAccess` (Stage 2) | principal (role, user, component or `service:<principal>`), action, resource (component, KMS key or role), objectKey?, context?, expect | Runs the network leg for VPC callers, then the IAM evaluator (including the chained KMS call for SSE-KMS objects), and shows every step as trace hops. |
| `fleetHealth` (Stage 2) | entry, loadRps, durationMin, crashed?, appBootSec, SLO | Minute-by-minute target health: EC2 vs. ELB health check type, grace period, replacement churn and "zombie" instances whose app has crashed. Passes when the error rate meets the SLO and the fleet ends at desired capacity. |
| `regionOutage`, `dataLoss`, `migration`, `connectivity` (Stage 3) | see Stage 3 | |
| `custom` | check function | Escape hatch. Use sparingly. |

Requirements in the mission brief link to events, so the brief's checklist ticks or crosses after a run.

### 2.7 Capacity model (`sim/capacity.ts`)

Tick once per simulated minute.
- **Instance capacity:** each instance type has a request rate at 70% CPU (for example, t3.medium = 200 rps). Utilisation = demand / capacity. p95 latency = base × 1/(1 − min(util, 0.95)). Demand above 100% capacity becomes errors.
- **ASG:** min/max/desired, plus a policy (`targetTracking` on CPU %, `step`, `scheduled`). Target tracking sets desired = ceil(current × util / target), capped at max. New instances add capacity only after the **instance warmup** (default 300s). Health check type is `EC2` or `ELB`. With `EC2`, a hung app is never replaced (this becomes an incident in Stage 2).
- **Lambda:** scales per request up to a concurrency limit (account default 1,000, with a configurable reserved concurrency). Cold start adds latency.
- **SQS:** queue depth = arrivals − consumer throughput. Age of oldest message is tracked. Messages are never lost unless retention expires.
- **Databases:** an RDS instance class has a max connection count and throughput cap. Read replicas add read capacity only. DynamoDB on-demand absorbs spikes; provisioned mode throttles above its capacity.
- **Static stability:** when an AZ fails, surviving capacity must carry the load until the ASG replaces instances. A two-AZ design sized at exactly 100% fails SLOs during an outage. Surface this lesson explicitly.

### 2.8 Failure model, RTO/RPO (`sim/failure.ts`)

For an AZ outage, compute per tier and report the worst:
- **ALB:** must be enabled in a surviving AZ. Detection time = health check interval × unhealthy threshold (defaults 30s × 2).
- **Compute:** surviving instances carry load immediately. Replacement capacity arrives after warmup. Degraded periods count against SLOs.
- **RDS Multi-AZ:** failover in about 60–120s, RPO 0 (synchronous replication).
- **RDS Single-AZ:** if backups are enabled, RTO = point-in-time restore time (model 30–60 min based on size) and RPO = up to 5 minutes. If backup retention is 0: total data loss, automatic fail.
- **NAT gateway:** AZ-scoped. Private subnets routed to a dead NAT lose outbound access. Report it as a degraded dependency.
- **ElastiCache (single node):** cache is lost, so database load spikes from a cold cache. This can cascade into a DB overload.

Results show "Measured RTO: 94s (requirement ≤ 5 min) ✓, RPO: 0 ✓".

### 2.9 Mission format and automated validation

```ts
interface Mission {
  id: string; stage: 1|2|3|4; mode: 'build'|'incident'|'diff'|'refactor';
  title: string; client: string; users: string; brief: string;
  requirements: { id: string; text: string; target?: { rtoSec?: number; rpoSec?: number; budget?: number; p95Ms?: number } }[];
  budget: number; usage: UsageProfile; defaults: 'helpful'|'bare';
  layout: VpcLayout;              // CIDRs, AZs, subnets, starting route tables/NACLs
  startingBoard?: Board;          // incidents/refactors start from a full prebuilt board (built with BoardBuilder, so it is validated)
  palette?: ServiceType[];        // restrict available services if needed
  events: EventSpec[];
  questions: QuestionId[];        // transfer questions shown after the run
  concepts: ConceptId[];
  reference: Board;               // a correct solution
  mistakes: { name: string; board: Board; expectFail: string[] }[]; // common wrong designs + which events must catch them
  keywords: string[];             // exam signal phrases ("least operational overhead" → serverless)
  incident?: IncidentSpec;        // Stage 2
  diff?: DiffSpec;                // Stage 2
}
```

**`tests/content/missions.test.ts` must check, for every mission:**
1. The reference board passes every event (3 stars).
2. The empty board fails every event except ones explicitly marked otherwise.
3. Each entry in `mistakes` fails exactly the events listed in `expectFail`.
4. Every concept and question ID referenced exists.

Checks 2 and 3 apply to build missions. Incidents and Spot the Difference rounds have their own suites (`incidents.test.ts`, `diffs.test.ts`, see Stage 2).

This harness is what keeps scenario quality high as content grows. Write it in Stage 1.

### 2.10 Cost model

One pricing table in `cost/pricing.ts`, approximate us-east-1 values. Verify each value against AWS pricing before encoding. Starting points:
- EC2 t3.medium ≈ $0.0416/hr
- NAT gateway ≈ $0.045/hr + $0.045/GB processed
- ALB ≈ $0.0225/hr + LCU charges
- Public IPv4 address ≈ $0.005/hr
- Data transfer out to the internet ≈ $0.09/GB; cross-AZ ≈ $0.01/GB in each direction
- S3 Standard ≈ $0.023/GB-month, plus request charges
- Gateway endpoint: free. Interface endpoint ≈ $0.01/hr per AZ + $0.01/GB.
- RDS db.t3.medium ≈ $0.068/hr (Multi-AZ roughly doubles it)
- SQS ≈ $0.40 per million requests; Lambda ≈ $0.20 per million requests + compute (GB-seconds)

The mission's `UsageProfile` (requests per month, GB stored, GB transferred, and the path data takes) drives data charges. That's how "S3 traffic through a NAT = $900" falls out of the model instead of being hard-coded.

### 2.11 Questions

```ts
interface Question {
  id: string; domain: Domain; concepts: ConceptId[];
  stem: string;                   // exam style: a scenario followed by "Which solution meets these requirements MOST cost-effectively?"
  options: { id: string; text: string; why: string }[];  // EVERY option explains why it's right or wrong
  correct: string[];              // more than one = "Choose TWO"
  difficulty: 1|2|3;
}
```

After each mission, show 3–5 transfer questions (2–3 after a Spot the Difference round, which is already a question), one at a time. After each answer, reveal every option's explanation and link to the Field Manual. Transfer questions must use a different story from the mission they follow.

### 2.12 Persistence

One persisted store with a `schemaVersion` and migration functions. It holds:
- Board per mission
- Best result per mission
- Question history
- Concept evidence (Stage 4)
- Settings
- Incident progress per mission: investigation actions taken, diagnosis, when it was verified (Stage 2, schema v2)
- Spot the Difference answers (Stage 2, schema v2)

Every schema bump ships a migration and a test that an older export imports without losing boards or scores.

Export and import of the whole store go through a JSON file (download via Blob, upload via file input). Wrap all storage access in try/catch, so the app still works if storage is unavailable.

---

## STAGE 1 — Depth: Console, Packet Tracer, real simulation

**Goal:** the four v1 missions, rebuilt on the new engine and played at configuration depth.

### Build
1. **Project scaffold** (stack above), with v1's visual identity ported: top bar with mission chips, three-column layout, the board, the palette, the sim drawer, toasts, and mobile behaviour (bottom palette tray, tap-to-place).
2. **Engine:** `cidr`, `routing`, `sg`, `nacl`, `trace`, sim runner with event kinds `reachability`, `traffic`, `azOutage`, `audit`, `queueBehavior` and `bill`, plus the capacity model, failure model, cost model and scoring.
3. **Board v2:** subnets with CIDRs and derived public/private labels. Multi-AZ components straddle AZs. Clicking a subnet shows its route table and NACL.
4. **Console panels.** Selecting a component or subnet opens a right-hand drawer (a bottom sheet on mobile), with tabs **Config · Networking · Exam notes**:
   - **Subnet:** route table association, NACL association
   - **Route table editor:** add/remove routes; targets are a dropdown of valid targets
   - **Security group editor:** inbound/outbound rules; source can be a CIDR, an SG or a prefix list
   - **NACL editor:** numbered rules, allow/deny, inbound/outbound; an evaluation-order preview
   - **ALB:** enabled subnets (at least two AZs, enforced with the AWS error message), listener port/protocol, target group, health check path/interval/thresholds, cross-zone load balancing
   - **EC2 / ASG:** subnets, SGs, instance type, public IP on/off, min/max/desired, scaling policy, target CPU, warmup, health check type
   - **RDS:** instance class, Multi-AZ on/off (the standby subnet is chosen automatically in another AZ), backup retention (0–35 days), read replica count, publicly accessible flag
   - **S3:** Block Public Access, versioning, default encryption (SSE-S3 / SSE-KMS), read-only bucket policy view (editable in Stage 2)
   - **SQS:** Standard / FIFO, visibility timeout, message retention, DLQ with maxReceiveCount
   - **NAT gateway, IGW, gateway endpoint:** associated route tables
   - **Lambda, API Gateway, DynamoDB, CloudFront (with OAC), Route 53, WAF:** the key settings each event needs
5. **Packet tracer UI** (2.5): animated, hop list, click a hop to jump to its rule. A "Trace" button lets players run ad-hoc traces.
6. **Sim drawer v2:** each event shows its result, a measured metric (RTO/RPO, error rate, cost) and a small timeline chart for traffic events. "Show trace" replays the packet path. "Fix it" opens the relevant config.
7. **Field Manual v1:** a browsable panel. Failed events link to their entries. Each entry covers: what it is, how it actually works, a comparison table where relevant, the numbers that matter, common exam traps, and related concepts. Write entries for every concept the Stage 1 missions use (around 20).
8. **Transfer questions** after each mission: 5 per mission, 20 total.
9. **Persistence** plus export/import.

### Missions (rebuilt at depth)
1. **The static portfolio:** S3 + CloudFront + OAC. Bucket policy granting only CloudFront. Block Public Access. Latency trace from Sydney.
2. **The six-hour outage (Ledgerly):** ALB across two AZs, ASG in private subnets, RDS Multi-AZ, NAT per AZ, SG chaining (ALB SG → app SG → DB SG), WAF. Events: reachability, DB `expect: deny` from the internet, patch outbound via NAT, month-end traffic with ASG warmup, AZ outage with RTO ≤ 5 min / RPO ≤ 1 min, audit, bill. Mistakes to catch: DB publicly accessible, ASG in one AZ only, single NAT, app SG open to 0.0.0.0/0, max capacity too low for the surge.
3. **The flash sale (Dropshop):** API Gateway + Lambda + SQS + DynamoDB. `queueBehavior` with 45s processing time, so a 30s visibility timeout causes duplicate charges. DLQ needed for poison messages. Lambda concurrency limits.
4. **The mystery line item (Northwind):** private batch fleet, gateway endpoint associated with *both* private route tables, the NAT data-processing cost emerging from the usage profile. Mistake: endpoint associated with only one route table, so AZ-b traffic still goes through the NAT.

### Acceptance criteria
- `npm run dev` works. `npm run build` produces a single `dist/index.html` that plays correctly from `file://`.
- Engine unit tests cover: CIDR matching and longest-prefix match; NACL rule ordering and the implicit deny; SG statefulness vs. NACL ephemeral return traffic; trace through IGW, NAT, gateway endpoint and ALB; ASG warmup timing; RTO/RPO for Multi-AZ vs. single-AZ with and without backups; the NAT data-processing cost.
- The mission validation harness passes for all four missions, including their `mistakes`.
- A player can complete every mission on a phone using tap-to-place and the bottom-sheet console.

---

## STAGE 2 — Investigation: Incident Room, IAM, Spot the Difference

**Goal:** diagnosis skills. Learn to find out *why* something fails, especially in networking and permissions.

### Build
0. **Mode tabs** in the top bar: Build · Incidents · Spot the Difference, each with its own mission chips.
1. **Incident mode.** The mission starts from a prebuilt, broken board. The board shows the symptom as an alert banner (for example "ALB returning 502 · target group 0/4 healthy").
   - **Investigation budget** (for example, 8 actions) with a **par** (the number of actions a good investigator needs). Each of these costs one action, **the first time only**: opening an object in the console (component, SG, NACL, route table, subnet, role, key, SCPs), running a distinct ad-hoc trace or API-call simulation, reading a log source. Re-opening is free, and so is the IAM overview (it is a directory, not evidence). Going over budget is allowed but scores 0 for investigation.
   - **Logs view:** canned but realistic log lines per incident (ALB access logs with status codes, VPC Flow Log lines with ACCEPT/REJECT, CloudTrail AccessDenied events, CloudWatch metrics).
   - **Diagnose:** the player points at the root cause by picking the exact rule set or setting from a suspect list built from the starting board (every SG and NACL direction, every route, subnet associations, diagnosable service settings, resource policies, attached roles, role policies, boundaries, trust policies, key policies, SCPs), then applies a fix. "Run simulation" becomes **Verify fix** and needs a diagnosis; the diagnosis locks at the first verify, so the report can't be used to guess.
   - **Suspects and changes share one key format** (`nacl:<id>:outbound`, `route:<rt>:<dest>`, `config:<component>:<field>`, `policy:<role>`, `keypolicy:<key>`, ...), so the diagnosis, the board diff and each incident's `allowedChanges` all line up.
   - **Scoring:** correct root cause 50; fix 30 when every event passes (15 when only the symptom events pass and something else broke); investigation 10 at or under par, falling linearly to 0 at the budget; collateral 10, minus 5 per change outside `allowedChanges`, and 0 if any change is dangerous (for example "you opened port 22 to the world"). Investigation and collateral points only count once the symptom is fixed, so changing nothing can't score 20. Stars: ≥ 90 → 3, ≥ 70 → 2, ≥ 40 → 1. The report shows each part with the root cause explained.
2. **IAM model and evaluator** (`engine/iam/`):
   - Components get an attached **role** (EC2 instance profile, Lambda execution role). Some incidents also include a developer user.
   - Policies are JSON with this subset: `Effect`, `Action` / `NotAction` with wildcards, `Resource` / `NotResource` with ARN wildcards (matched per ARN section), `Principal` (resource and trust policies; `NotPrincipal` is rejected), and `Condition` with `StringEquals`, `StringNotEquals`, `StringLike`, `StringNotLike`, `Bool`, `IpAddress`, `NotIpAddress`, `ArnEquals`, `ArnNotEquals`, `ArnLike`, `ArnNotLike`, plus the `...IfExists` suffix. Keys: `aws:SecureTransport`, `aws:MultiFactorAuthPresent`, `aws:SourceIp`, `aws:SourceVpce`, `aws:SourceVpc`, `aws:PrincipalOrgID`, `aws:PrincipalArn`, `aws:PrincipalAccount`, `aws:SourceArn`, `aws:SourceAccount`, `kms:ViaService`, `s3:x-amz-server-side-encryption`. Key names match case-insensitively; a missing key makes positive operators false and negated ones true, as in AWS. *(Refined: the negated and ARN operators and `aws:PrincipalArn` were added because the classic "deny unless from the VPC endpoint, except for the ops role" fix needs them.)*
   - **Evaluation order** (show every step in a trace like the packet tracer):
     1. An explicit deny in any applicable policy → **deny**.
     2. If the account is in an organization, SCPs must allow the action.
     3. A **VPC endpoint policy**, when the request travels through a gateway endpoint, must allow it. *(Added in Stage 2: endpoint policies are exam material and an incident lever.)*
     4. Resource-based policy allow. In the same account, it grants on its own when it names the principal itself; naming the account (root) only delegates to IAM. Cross-account access needs both the identity policy and the resource policy. KMS key policies and role trust policies are mandatory: without them nothing else counts.
     5. A permissions boundary, if present, must allow.
     6. Identity policy allow.
     7. Otherwise → **implicit deny**.
   - **KMS:** the key policy must allow the principal, or delegate to IAM by allowing the account root. S3 objects with SSE-KMS need `kms:Decrypt` (to read) and `kms:GenerateDataKey` (to write), evaluated as a second, chained call. The AWS managed key `aws/s3` is always usable by principals in the account.
   - Role assumption: trust policy + caller permission for `sts:AssumeRole`. Implement it in the evaluator now; Stage 3 missions use it.
   - **Policy editor:** CodeMirror JSON with validation (JSON syntax inline, policy grammar errors worded like AWS's `MalformedPolicyDocument`), attached to role policies, boundaries and trust policies, and to S3 bucket, SQS queue, KMS key and gateway endpoint policies. SCPs are shown read-only (they belong to the organization's management account). An **IAM** button opens roles, users, keys and SCPs; components that run code get a Permissions tab to attach a role.
   - New event kind `iamAccess`. Traces gain an `iam` hop, so one end-to-end trace shows both "can the packet get there" and "is the call allowed." The tracer gets an **API call** mode (caller, action, resource, object key) next to the network mode, and each `iam` hop expands into the step-by-step evaluation.
3. **Spot the Difference mode:** two read-only boards side by side, nearly identical. Both run the same event; one survives. The player picks the cause (multiple choice built from real config differences), then sees the explanation and both results. Each option lists the board-diff keys it describes, and a test checks the options cover exactly the real differences, so no option can be made up. Clicking any object opens a side-by-side inspector that highlights differing settings. The first answer counts: correct → 3 stars, wrong → 1.
4. **Field Manual additions:** 15 entries: IAM policy evaluation, resource vs. identity policies, IAM roles, condition keys, permissions boundaries, SCPs, KMS key policies, VPC endpoint policies, SG vs. NACL, VPC Flow Logs, CloudTrail, ALB error codes (502 / 503 / 504), ASG health checks, blackhole routes, CloudWatch metrics. (SQS visibility timeout and DLQ already exist from Stage 1.)
5. **Questions:** 32 more (52 total): 3 per incident, 2 per Spot the Difference round.

### Incidents (8)
1. **The packet that never came back:** NACL on the app subnet allows inbound 443 but has no outbound rule for ephemeral ports 1024–65535.
2. **Patch Tuesday, again:** private route table's 0.0.0.0/0 points at a NAT gateway that was deleted (blackhole route).
3. **0/4 healthy:** ALB health check path is `/health`, but the app serves `/healthz`. *(Refined.)* Because an ALB fails open when every target is unhealthy, the symptom is not a clean outage: with ELB health checks on the ASG, instances are replaced as soon as their grace period ends, so the fleet churns and users see intermittent 503s (checked with `fleetHealth`).
4. **The wrong door:** DB SG allows 3306 from the *ALB's* SG instead of the app SG.
5. **AccessDenied at 2 a.m.:** Lambda role allows `dynamodb:GetItem` but the code calls `PutItem`. CloudTrail shows the denied call.
6. **The key that wouldn't turn:** EC2 role has full S3 access, but the bucket uses SSE-KMS with a customer-managed key whose key policy doesn't include the role.
7. **Locked out by your own policy:** the bucket policy denies everything unless `aws:SourceVpce` matches, so console uploads by the team fail. The fix must keep the VPC restriction for the app.
8. **The zombie fleet:** ASG health check type is `EC2`, so instances whose app has crashed stay in service. Fix: use `ELB` health checks plus a grace period.

### Spot the Difference rounds (4)
- Multi-AZ RDS vs. a read replica during an AZ outage
- SG vs. NACL blocking the same traffic (one stateful, one not)
- Gateway endpoint associated with one route table vs. both
- Target tracking vs. scheduled scaling for a spike that arrives at 9:00 every morning

### Acceptance criteria
- IAM evaluator unit tests: explicit deny overrides allow; same-account resource policy grants alone; cross-account needs both sides; SCP restricts even an admin; permissions boundary caps the identity policy; KMS key policy is required; condition keys work.
- Each incident has tests: the starting board fails with the stated symptom; the reference fix passes; at least one plausible wrong fix fails (for example, opening the NACL fully "works" but is flagged as collateral).
- The logs view and the investigation budget work on mobile.
- Each incident also checks: the root cause is in the suspect list, a perfect run scores 100, and changing nothing scores only the 50 diagnosis points.
- Each Spot the Difference round checks: the survivor passes and the other side fails the event, and the options' change keys equal the board diff.

---

## STAGE 3 — Breadth: multi-Region DR, hybrid, storage, data

**Goal:** cover the rest of the exam guide with the same depth.

### Board expansion
- **Second Region** panel (for example us-west-2), collapsible.
- **Second VPC** with **VPC peering**: peering is not transitive, both sides need routes, and CIDRs can't overlap. **Transit Gateway** for hub-and-spoke routing, with its own route tables.
- **On-prem data centre** zone with a customer gateway. The tracer supports the on-prem endpoint over VPN and Direct Connect.
- **Accounts:** an optional AWS Organizations layer (management account, workload accounts, SCPs) for cross-account missions.
- *(Refined in Stage 3.)* Layouts gain `extraVpcs` (more VPCs, in this Region or others; a Region may have no VPC at all) and `onprem` (name, CIDR, internet uplink in Mbps). Every Region renders as its own panel with its own regional-services zone; VPC headers show name, CIDR and, when VPCs belong to different accounts, the account. A peering connection lives in the requester VPC's attachments and shows as a ghost on the accepter side. The second Region is not collapsible: stacking panels was clearer on mobile than a toggle.
- *(Refined.)* The accounts layer is an `accountId` on VPCs and components (default: the board's IAM account). It drives three rules: a transit gateway must be **shared through RAM** before another account's VPC can attach; a replica bucket or backup copy in **another account** survives stolen admin credentials; cross-account SG references are not modelled. SCPs stay the Stage 2 IAM feature.
- *(Refined.)* Peering: routes must point at the connection on both sides, CIDRs can't overlap (AWS-worded error), no transitive or edge-to-edge routing (a peered VPC can't use the other VPC's IGW, NAT, VPN or DX), and SG rules may reference a peer's SG only within one Region. Transit Gateway: VPC, VPN and DX attachments, one **association** per attachment, any number of **propagations**, static and blackhole routes, longest-prefix match; for equal prefixes static beats propagated and DX beats VPN. VGW route propagation into VPC route tables is not modelled (players add the static route), and TGW attachment subnets and centralised egress are out of scope.
- *(Refined.)* The tracer accepts `onprem` as an endpoint (host `.10` of the on-prem CIDR). Traffic takes the DX link when one exists and falls back to the VPN when the DX is failed; the return path is checked in the VPC route table and, through a TGW, in the destination's TGW route table. Mission refs gain `type@region` (`alb@us-west-2`), `type#vpc-id` (`ec2#vpc-prod`) and `"name"`.

### New services and their configs
- **Route 53 routing policies:** simple, weighted, latency, failover, geolocation, geoproximity, multivalue. Health checks and TTL. TTL counts toward failover RTO.
- **Aurora:** writer + readers, reader endpoint, failover around 30s, **Aurora Global Database** (cross-Region replication typically under 1s), Aurora Serverless v2.
- **DynamoDB:** global tables, DAX, on-demand vs. provisioned, point-in-time recovery.
- **S3:** storage classes (Standard, Intelligent-Tiering, Standard-IA, One Zone-IA, Glacier Instant / Flexible / Deep Archive, with retrieval times and minimum storage durations), lifecycle rules, Cross-Region Replication (needs versioning), Object Lock, MFA Delete.
- **Block and file storage:** EBS gp3 / io2 / st1 / sc1 (IOPS and throughput attributes, AZ-scoped), snapshots, EFS (multi-AZ, shared), FSx for Windows File Server and FSx for Lustre. **AWS Backup** plans, including cross-Region copies.
- **Hybrid:** Site-to-Site VPN (up in minutes, about 1.25 Gbps per tunnel, over the internet), Direct Connect (weeks to provision, consistent bandwidth, not encrypted by default), DX + VPN backup, Storage Gateway, DataSync, the Snow family.
- **Messaging and streaming:** SNS (fan-out to SQS), EventBridge, Kinesis Data Streams (shards, ordering per shard), Kinesis Data Firehose (delivery to S3 / Redshift / OpenSearch).
- **Data:** Athena, Glue, Redshift at a "pick the right tool" level.
- **Security services:** Secrets Manager (rotation) vs. Parameter Store, Cognito (user pools vs. identity pools), Shield, GuardDuty, Macie and Inspector at a "which one fits" level.
- *(Refined in Stage 3.)* A service becomes a board component only when an event reads its configuration. New components: `aurora`, `pcx`, `tgw`, `vgw`, `cgw`, `vpn`, `dx`, `backup`, `kinesis`, `firehose`, `athena`, `snow`, `datasync`, `dms`, plus Stage 3 fields on RDS (`replicaOf`), S3 (storage class, lifecycle, expiration, Object Lock, MFA Delete, replication), DynamoDB (replica Regions, DAX), Lambda (Kinesis source, enhanced fan-out) and Route 53 (policy, records with health checks, alias/TTL, health-check interval and threshold). EBS/EFS/FSx, Storage Gateway, SNS/EventBridge, Glue/Redshift, Secrets Manager/Parameter Store, Cognito, Shield/GuardDuty/Macie/Inspector are taught through the Field Manual and questions only, because no mission event needs to simulate them.
- *(Refined.)* Validation mirrors AWS: IA transitions need ≥ 30 days, transitions only go down the waterfall, expiration after the last transition, Object Lock / MFA Delete / replication need versioning (both buckets), versioning can't be suspended with Object Lock or on a replication destination, read replicas need backups on the source, Aurora Global secondaries live in another Region, MACsec needs a 10/100 Gbps port, Parquet conversion needs a ≥ 64 MiB Firehose buffer.

### New event kinds
- **`regionOutage`:** RTO = DNS detection (health check interval × threshold) + TTL + time to bring up whatever isn't already running in the DR Region. Model: scaling an ASG from zero ≈ 10–15 min; restoring a DB from a snapshot ≈ 30–60+ min; promoting an Aurora Global secondary ≈ about 1 min. RPO comes from the replication mechanism: snapshot copy frequency, async CRR lag, Aurora Global (<1s), DynamoDB global tables (around 1s). The UI then **names the DR strategy the player built**: backup and restore, pilot light, warm standby, or multi-site active-active.
- **`dataLoss`:** accidental deletion, corruption or ransomware at time T. Checks versioning, Object Lock, PITR, backup retention and cross-Region copies. Reports what was recoverable and to what point in time.
- **`migration`:** data size, link bandwidth and deadline. Shows the arithmetic (for example, 80 TB over 100 Mbps ≈ 74 days → Snowball).
- **`connectivity`:** requirements like "connected by tomorrow," "consistent 10 Gbps," or "encrypted," plus link-failure events.
- *(Refined in Stage 3.)* Model numbers: scale from zero = 10 min + warmup; a running but small fleet = launch + boot + warmup; RDS cross-Region replica promotion 5 min with 60 s lag; Aurora Global promotion 1 min with 1 s lag; DynamoDB global tables 0 RTO with 1 s lag; snapshot restore 30–40 min; DNS = interval × threshold (30 s × 3 default) + TTL (60 s for alias records), counted only for users who were served from the failed Region. RTO = DNS + max(data, compute); data and compute recover in parallel. A record without a health check is never withdrawn. The strategy is named from what the board does: data only as backups → backup and restore; replicated data, fleet at zero → pilot light; fleet running below the needed size, or at full size behind failover routing → warm standby ("hot standby" counts here); full size behind an active/active policy → multi-site. The DR path is traced too (internet → DNS → DR entry, DR app → DR database).
- *(Refined.)* `dataLoss` scenarios: accidental delete, malicious delete with stolen admin keys, early delete under retention, Region loss, corruption discovered later. Governance mode, same-account replicas and unlocked vaults fail the malicious case; compliance mode, a cross-account replica, MFA Delete, Vault Lock (compliance) or a cross-account backup copy pass it.
- *(Refined.)* `migration` scopes: bulk files (best of the usable network links at 100% utilisation vs. Snowball: ship 2 d + copy at ~4 Gbps + ship 2 d + import 1.5 d, ~80 TB per device), delta (a scheduled DataSync task must carry the daily change rate), database (DMS full load + CDC with ~5 min cut-over; full load alone fails; DMS needs a VPN or DX ready before the deadline). DX takes 30 days to provision, a VPN minutes.
- *(Added in Stage 3.)* Three more event kinds, because the leaderboard, scans and clickstream missions need them: **`globalLatency`** (where Route 53 sends each city, city-to-Region and Region-to-Region RTT, the nearest table replica, DAX 1 ms vs. DynamoDB 5 ms; or a hot key against the ~6,000 reads/s partition limit unless DAX), **`storageLifecycle`** (retrieval time per age band, retention via expiration, single-AZ classes, steady-state cost with retrieval, transition and minimum-duration charges) and **`streamIngest`** (shards = max(MB/s, records/s ÷ 1,000); every standard consumer, Firehose included, shares 2 MB/s per shard, enhanced fan-out is dedicated; ordering, replay retention, Firehose buffer delay and Athena on the bucket).
- *(Refined.)* Cost model additions: inter-Region transfer for multi-Region boards, TGW attachment-hours and per-GB processing, VPN hours, DX port-hours and cheaper data out, Aurora instances/ACUs, DynamoDB replicated writes and DAX nodes, storage-class prices, Kinesis shard and PUT-unit pricing, Firehose ingestion in 5 KB increments plus Parquet conversion, Athena per TB (Parquet scans ~10% of JSON), Snowball jobs, DataSync per GB (changes only when a Snowball job carries the bulk), DMS instance hours. The same API deployed in several Regions splits the request charges between them.

### Missions (8)
1. **Region down:** an RPO of 15 min and an RTO of 1 hour must be met at the lowest cost (the best answer is pilot light or warm standby, and the sim proves it).
2. **The global leaderboard:** DynamoDB global tables, Route 53 latency routing, DAX.
3. **The branch office:** VPN now, Direct Connect later, VPN as DX backup. A link failure event.
4. **Twelve VPCs and counting:** peering mesh vs. Transit Gateway; the transitive-routing trap.
5. **The deleted invoices:** versioning, Object Lock, MFA Delete, CRR, AWS Backup.
6. **Seven years of scans:** S3 lifecycle across storage classes with retrieval-time requirements; minimum storage duration charges.
7. **The clickstream firehose:** Kinesis Data Streams vs. Firehose vs. SQS; shard count from throughput; delivery to S3 + Athena.
8. **80 TB by Friday:** migration with Snowball vs. DataSync vs. DX; DMS for the database.

Add about 25 Field Manual entries and 40 questions (90 total).

*(Built in Stage 3.)* Mission ids and the lesson each mistake proves:

| # | Id · title | Reference | Mistakes (events they fail) |
|---|---|---|---|
| 1 | `dr-region` · The Region went dark | Pilot light: cross-Region RDS replica, DR ASG at 0, failover routing with health checks | backup and restore (region-outage: RPO 24 h) · simple routing · no health checks · same-Region replica (region-outage) · multi-site (bill) |
| 2 | `leaderboard` · Lag on the leaderboard | API + Lambda in 3 Regions, global table with DAX, latency routing with health checks | single-Region table (latency) · simple routing (latency) · no DAX (hot-key) · no health checks (region-outage) |
| 3 | `branch-office` · Payroll by Friday | VGW + VPN + 1 Gbps DX with IPsec, route to on-prem | DX only (within, failover) · VPN only (bandwidth, failover) · DX unencrypted (encrypted) · no return route (all connectivity) |
| 4 | `twelve-vpcs` · Spaghetti peering | RAM-shared TGW, rt-prod / rt-dev / rt-shared, VPN on the TGW | peering hub + VGW (onprem-prod) · one TGW route table (dev-prod) · no return route in shared (prod-shared, dev-shared) · VPN not propagated (onprem-prod) |
| 5 | `invoices` · Seven years, no excuses | Versioning, Object Lock compliance 7 y, CRR to another account, PITR | versioning only (retention, ransomware, region-loss) · governance mode (retention) · same-account replica (retention, ransomware) · no PITR (corruption) · SRR (region-loss) |
| 6 | `scans` · The ever-growing archive | Standard → Glacier IR @30 → Deep Archive @365 → expire @2555 | Deep Archive @30 (retrieval) · Standard forever (cost) · One Zone-IA (resilience) · Glacier Flexible (cost) · expire @5 y (retention) |
| 7 | `clickstream` · Every click, twice | 15 shards, two Lambda consumers, Firehose → Parquet (120 s) → S3, Athena | 5 shards (ingest, fanout) · 10 shards (fanout) · SQS (ordering, fanout, replay) · JSON (bill) · 900 s buffer (analytics) |
| 8 | `migration80` · 80 TB by the end of the lease | Snowball + daily DataSync + VPN + DMS full load and CDC | DataSync only (bulk, bill) · order DX (bulk, bill) · no DataSync (delta) · DMS full load (database) · no VPN (database) |

Each Stage 3 mission lists 5 questions (40 in `questions/stage3.ts`, 92 in the bank) and 29 new concepts with Field Manual entries (73 in total). Stage 3 adds no persisted top-level state, so the save schema stays at v2; new board fields are optional.

### Acceptance criteria
- Tracer tests: peering non-transitivity, TGW route tables, on-prem over VPN, overlapping CIDRs rejected.
- `regionOutage` produces the correct RTO/RPO and strategy name for reference boards of each of the four DR strategies.
- All 8 missions pass the validation harness, mistakes included.
- *(Built.)* `tests/engine/stage3.test.ts` covers peering (delivered, non-transitive, return route, overlap rejected), TGW segmentation and propagation, on-prem over DX with VPN failover and the missing return route, Route 53 failover / latency / geolocation without a default, and `regionOutage` for backup and restore, pilot light, warm standby, multi-site and no DR.

---

## STAGE 4 — Retention: mastery map, spaced repetition, refactors, exam mode

**Goal:** make the learning stick and show readiness for the exam.

### Build
1. **Concept map.** Map every `ConceptId` to an exam task statement. The current SAA-C03 domains are listed below; verify them and their weights first.
   - **1. Design Secure Architectures (30%):** 1.1 secure access, 1.2 secure workloads, 1.3 data security controls
   - **2. Design Resilient Architectures (26%):** 2.1 scalable and loosely coupled, 2.2 highly available and fault-tolerant
   - **3. Design High-Performing Architectures (24%):** 3.1 storage, 3.2 compute, 3.3 database, 3.4 network, 3.5 data ingestion and transformation
   - **4. Design Cost-Optimized Architectures (20%):** 4.1 storage, 4.2 compute, 4.3 database, 4.4 network

   The visual is a map grouped by domain, with each concept shown as a node coloured by mastery. Clicking a node shows its evidence history, its Field Manual entry and a "Practice this" button.
2. **Evidence and mastery.** Every event result, question answer, incident diagnosis and Defend round writes evidence `{conceptId, source, correct, weight, at}`. Mastery = weighted recent accuracy, decayed over time.
3. **Spaced repetition (`mastery/srs.ts`):** Leitner boxes 1–5 with intervals of 1, 2, 4, 8 and 16 days. Correct evidence moves a concept up a box; incorrect evidence moves it back to box 1. Pure functions, unit-tested with injected dates.
4. **Daily session (about 10 minutes):** built from due concepts, weakest first. Mixes transfer questions, a Spot the Difference round and a mini-incident. Shows a streak.
5. **Surprise incidents:** when a player replays a build mission, inject one extra event drawn from a due concept (for example, a NACL ephemeral-port failure appears in the Dropshop mission).
6. **Defend rounds (no backend):** after selected events, the player types a 1–2 sentence justification. Then the app reveals a model answer and a 3–4 point rubric, the player ticks which points they covered, and that counts as evidence (weighted lower than objective checks). Add a **"Copy for Claude"** button that copies the scenario, design summary and answer as a ready-made prompt for grading in a Claude chat.
7. **Refactor mode:** start from a working but expensive or fragile board, with a requirement change. Score on meeting every requirement at the lowest cost.
8. **Exam mode:** 65 questions in 130 minutes, drawn from the bank with the domain weighting above. Flag-for-review, a review screen, and an approximate scaled score (100–1000, pass at 720) with a breakdown by domain that feeds evidence. Explain that the score is an estimate.
9. **Onboarding:** a 3-minute guided first mission (place, configure, trace, simulate). Also an accessibility pass (keyboard paths for everything, focus states, reduced motion) and a performance pass.

- *(Refined in Stage 4.)* The domains and weights were checked against the current SAA-C03 exam guide and are unchanged. Every concept carries a task id (14 task statements in `content/concepts.ts` as `TASKS`), and a test checks each concept's domain matches its task's domain; `dms` moved from cost to performant (task 3.5). The map is a modal from the top bar: domains as panels, task statements as groups, concepts as pills coloured new / weak / learning / strong, with a "due" badge. A concept's detail shows mastery, its review box and next review date, where it is taught, its last 15 pieces of evidence, the Field Manual link and "Practice this" (up to 5 bank questions on that concept).
- *(Refined.)* Evidence `source` is `<kind>:<id>` with kinds `event`, `surprise`, `question`, `exam`, `daily`, `incident`, `diff`, `defend`. Weights: 1 for events, surprises, questions, exam and daily answers; 1.5 for incident diagnoses and Spot the Difference rounds (one carefully reasoned answer); 0.5 for Defend rounds (self-graded). A warn result counts as correct at half weight. Evidence is deduplicated per (source, concept, local day): re-running the same simulation keeps the day's last result, everything else keeps the first answer, so grinding one mission can't inflate mastery. Mastery = decayed weighted accuracy with a 30-day half-life and a 50% prior of weight 1; levels: weak < 0.5 ≤ learning < 0.75 ≤ strong.
- *(Refined.)* SRS: evidence sharing a timestamp is one review (correct only if all of it is). A correct review promotes a card only when it is due (no cramming a box ahead); an incorrect one sends it to box 1, due the next day. Due dates come from the last review, so the schedule is a pure function of the evidence and is restored exactly by import.
- *(Refined.)* Daily session: 5 focus concepts (due ones weakest first, then concepts never seen, then the weakest of the rest); 5 questions (unanswered first), 1 Spot the Difference round and 1 mini-incident, ordered q, q, diff, q, q, incident, q. A mini-incident shows the alert and logs and asks for the root cause from 4 options (the real one plus 3 deterministic distractors from the suspect list). The plan is frozen when first opened each local day; the streak counts consecutive days with every item answered. Daily answers are saved and count as evidence immediately, so a session can be finished later the same day.
- *(Refined.)* Surprise events: 11 specs in `content/surprises.ts` (AZ outage, ephemeral ports, DB probe, patch download, SSH from the internet, SG chaining, private DB, encryption, Block Public Access, WAF, accidental delete), each tied to concepts. On a replay of a build mission the player already has a result for, one is drawn from a concept that is due, among those the mission's reference design passes (so a surprise is always fair). It shows as a dashed "SURPRISE" result card, counts as evidence and never changes stars.
- *(Refined.)* Defend rounds: 17 prompts in `content/defend.ts`, keyed `missionId/eventId`, each with a model answer and a 3–4 point rubric. "Defend it" appears on passing result cards that have a prompt. Saving needs at least 10 characters; the round counts as correct when at least half the rubric is ticked. "Copy for Claude" copies the brief, requirements, event, simulated result, a one-line-per-component design summary, the answer and the rubric; when the clipboard is blocked (file:// in some browsers), the prompt appears in a selectable text box.
- *(Refined.)* Exam mode: the draw is per domain by largest remainder (65 → 19 / 17 / 16 / 13), seeded with the attempt id (mulberry32), shuffled within and across domains; it throws if the bank is short. The attempt is persisted as it goes (answers, flags, start time), so closing the window or reloading resumes it; the clock is wall time from the start and the attempt auto-submits at 130 minutes. Scaled score = 100 + 900 × share correct, pass at 720, labelled as an estimate. Results show a per-domain table and a review of missed questions with every option's explanation. Every question surface shows options in a stable shuffled order with letters by position (many older bank questions list the answer first); answers keep option ids.
- *(Refined.)* Onboarding is a 4-step coach card on the first build mission (place a component, open its console, trace, run the simulation) that advances when the player does each thing. New saves get it; a save migrated with progress skips it; Settings replays it. Settings also holds the reduce-motion toggle (combined with the OS preference, applied app-wide via a root class) and the keyboard shortcuts. Every new control is a real button with an accessible name, Escape closes the top-most window, and icon-only top-bar buttons keep `aria-label`s.
- *(Refined.)* The save schema is **v3**: `daily`, `defends`, `exams` and `tutorial` are new top-level fields. The 2 → 3 migration backfills evidence from the question history, Spot the Difference answers and verified incident diagnoses already in the save (only when the save has no evidence yet).

### Refactor missions (5)
1. **The always-on batch:** move to Spot instances with a fallback, and capacity-optimized allocation.
2. **Steady state:** Compute Savings Plans vs. EC2 Instance Savings Plans vs. Reserved Instances for a baseline load.
3. **Right-size the database:** overprovisioned RDS → Aurora Serverless v2, or a smaller class plus a read replica.
4. **Cold data, hot bill:** lifecycle rules and Intelligent-Tiering, including the minimum-duration traps.
5. **Chatty across AZs:** cross-AZ data transfer charges; keep traffic in the same AZ where safe, plus VPC endpoints and caching.

Bring the question bank to **150+**, balanced to the domain weights, with every option explained.

*(Built in Stage 4.)* Refactor missions are a fourth mode tab. Each starts from a production board (`startingBoard`) and a `refactor.change`; the Brief shows the change and the production cost. Score = 60 × requirements (warn counts half) + 40 × savings ratio when every requirement passes, where savings ratio = (production cost − your cost) ÷ (production cost − reference cost) over the mission's cost events. Stars: 3 at 95+ points, 2 at a ratio of 0.5 or more, 1 for all requirements; a cheaper design that breaks a requirement gets 0 stars.

| # | Id · title | Production → reference | Mistakes (events they fail) |
|---|---|---|---|
| 1 | `rf-spot` · The always-on batch | 12 On-Demand m5.large ($856) → On-Demand base 2 + Spot above it, 3 instance types, price-capacity-optimized ($400) | all Spot, lowest price, one type (crunch) · capacity-optimized with one type (crunch) · 3 types, lowest price (crunch) · half On-Demand (bill) · shrink to 6 (crunch) |
| 2 | `rf-commit` · Steady state | 8 m5.large On-Demand for a 36-month roadmap ($488 average) → 3-year Compute Savings Plan at $0.38/h ($310) | EC2 Instance SP for m5 (savings, stranded) · Standard RIs for 8 (savings, stranded) · 1-year Compute SP (savings) · Convertible RIs for 4 (savings) · Compute SP sized to today (savings, stranded) |
| 3 | `rf-db` · Right-size the database | db.r5.xlarge Multi-AZ ($990) → db.t3.medium Multi-AZ + 1 read replica ($421); Aurora Serverless v2 also passes ($423) | Single-AZ + replica (az-outage) · Multi-AZ, no replica (rush) · micro + 2 replicas (rush) · drop Multi-AZ (az-outage, bill) · one size down (bill) |
| 4 | `rf-s3` · Cold data, hot bill | photos and exports in Standard, kept forever → photos in Intelligent-Tiering expiring at 730 days, exports in Standard expiring at 14 days ($1,064 + $32) | Glacier Flexible at 90 d (retrieval) · Standard-IA at 30 d (media-cost) · exports to Standard-IA (exports-cost) · photos kept forever (media-retention) · exports deleted at 7 d (exports-retention) |
| 5 | `rf-az` · Chatty across AZs | one NAT for two AZs, S3 through NAT ($1,642) → NAT per AZ + S3 gateway endpoint on both route tables ($576) | NAT per AZ, no endpoint (bill) · endpoint on one route table (bill) · endpoint, one NAT (az-outage) · no NAT (payments) |

Model additions behind them: ASG purchase options (On-Demand base, Spot percentage above it, allocation strategy, extra instance types; Spot at 35% of On-Demand) and a `spotReclaim` event (lowest-price loses half the Spot instances with 2+ types and all of them with one; capacity-aware strategies lose none with 2+ types; the On-Demand base is never reclaimed). A `savings` component (Compute SP, EC2 Instance SP, Standard RI, Convertible RI; 1 or 3 years) and a `commitment` event that walks a month-by-month roadmap: Compute SP covers any EC2 family and Lambda, EC2 Instance SP one family, Standard RIs are size-flexible within a family, Convertible RIs can be exchanged across families; `stranded` fails when unused commitment exceeds 5% and `savings` when the average saving is under 30%. Aurora Serverless v2 is sized from the mission's average query rate (750 queries/s per ACU) and Intelligent-Tiering is read-aware (the share read each month stays in the frequent tier). Discount rates are approximate list-price ratios, documented in `engine/cost/pricing.ts`.

The bank is 152 questions (secure 46, resilient 40, performant 36, cost 30: each within 0.5 points of its weight), 60 of them new in `questions/stage4.ts`, and every concept has at least one question. 8 concepts were added (Spot, purchase options, database right-sizing, Intelligent-Tiering, cross-AZ costs, ElastiCache, ECS on Fargate, NLB and Global Accelerator), 81 in total.

### Acceptance criteria
- SRS and mastery unit tests with injected dates.
- Exam mode draws a correctly weighted set and never repeats a question within an attempt.
- Daily session is generated deterministically from the store state.
- Export → clear storage → import restores all progress and mastery exactly.
- *(Built.)* `tests/engine/mastery.test.ts` covers evidence dedupe, mastery decay and levels, Leitner promotion and demotion with injected dates, deterministic daily plans and streaks, weighted exam draws without repeats, surprise selection (only on due concepts, only surprises the reference passes) and the stable option shuffle. `tests/content/refactors.test.ts` checks each refactor's production board, reference and mistakes, and `tests/engine/persistence.test.ts` the v2 → v3 migration, backfill and an export → import round trip that compares mastery and review cards for every concept. `tests/content/missions.test.ts` checks the bank size, its domain balance and that every concept has a question.

---

## Appendix A: Content checklist per mission
- [ ] Brief written in client language, with measurable requirements (RTO, RPO, budget, latency)
- [ ] Layout and `defaults` mode set
- [ ] Events cover every requirement
- [ ] Reference board
- [ ] At least 3 `mistakes` with expected failures
- [ ] 3–5 transfer questions in a different story, every option explained
- [ ] Field Manual entries exist for every concept
- [ ] Exam keywords listed
- [ ] Facts and prices verified against AWS docs

## Appendix B: Out of scope
Accounts and login, a backend, multiplayer, real AWS API calls, AI grading inside the app (replaced by the self-graded rubric plus "Copy for Claude"), and pixel-accurate AWS console replicas. Official AWS icons and logos are not used; services are shown with the category-coloured abbreviation chips from v1.
