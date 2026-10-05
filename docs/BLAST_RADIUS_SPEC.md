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
5. **Load balancers are two connections.** The client-to-ALB leg checks the listener and the ALB's SG. The ALB-to-target leg is a new flow from the ALB's ENI in that AZ, needs a healthy target, and needs the target SG to allow the ALB SG.
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
| `iamAccess` (Stage 2) | principal, action, resource, expect | Runs the IAM evaluator and shows its trace. |
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
  startingBoard?: Partial<Board>; // incidents/refactors start from a prebuilt board
  palette?: ServiceType[];        // restrict available services if needed
  events: EventSpec[];
  questions: QuestionId[];        // transfer questions shown after the run
  concepts: ConceptId[];
  reference: Board;               // a correct solution
  mistakes: { name: string; board: Board; expectFail: string[] }[]; // common wrong designs + which events must catch them
  keywords: string[];             // exam signal phrases ("least operational overhead" → serverless)
  incident?: IncidentSpec;        // Stage 2
}
```

**`tests/content/missions.test.ts` must check, for every mission:**
1. The reference board passes every event (3 stars).
2. The empty board fails every event except ones explicitly marked otherwise.
3. Each entry in `mistakes` fails exactly the events listed in `expectFail`.
4. Every concept and question ID referenced exists.

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

After each mission, show 3–5 transfer questions, one at a time. After each answer, reveal every option's explanation and link to the Field Manual. Transfer questions must use a different story from the mission they follow.

### 2.12 Persistence

One persisted store with a `schemaVersion` and migration functions. It holds:
- Board per mission
- Best result per mission
- Question history
- Concept evidence (Stage 4)
- Settings

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
1. **Incident mode.** The mission starts from a prebuilt, broken board. The board shows the symptom as an alert banner (for example "ALB returning 502 · target group 0/4 healthy").
   - **Investigation budget** (for example, 8 actions). Each of these costs one action: opening a Console panel, running an ad-hoc trace, viewing logs.
   - **Logs view:** canned but realistic log lines per incident (ALB access logs with status codes, VPC Flow Log lines with ACCEPT/REJECT, CloudTrail AccessDenied events, CloudWatch metrics).
   - **Diagnose:** the player points at the root cause by selecting the exact rule or setting, then applies a fix.
   - **Scoring:** correct root cause (50%), fix resolves the symptom when the sim reruns (30%), actions used (10%), no collateral changes (10%, based on a diff against the starting board: changes that weren't needed are flagged, including things like "you opened port 22 to the world").
2. **IAM model and evaluator** (`engine/iam/`):
   - Components get an attached **role** (EC2 instance profile, Lambda execution role). Some incidents also include a developer user.
   - Policies are JSON with this subset: `Effect`, `Action` / `NotAction` with wildcards, `Resource` with ARN wildcards, `Principal` (resource policies), and `Condition` with `StringEquals`, `StringLike`, `Bool` (`aws:SecureTransport`, `aws:MultiFactorAuthPresent`), `IpAddress` (`aws:SourceIp`), `aws:SourceVpce`, `aws:PrincipalOrgID`.
   - **Evaluation order** (show every step in a trace like the packet tracer):
     1. An explicit deny in any applicable policy → **deny**.
     2. If the account is in an organization, SCPs must allow the action.
     3. Resource-based policy allow. In the same account, this can grant access on its own; cross-account access needs both the identity policy and the resource policy.
     4. A permissions boundary, if present, must allow.
     5. Identity policy allow.
     6. Otherwise → **implicit deny**.
   - **KMS:** the key policy must allow the principal, or delegate to IAM by allowing the account root. S3 objects with SSE-KMS need `kms:Decrypt` (to read) and `kms:GenerateDataKey` (to write).
   - Role assumption: trust policy + caller permission for `sts:AssumeRole`. Implement it in the evaluator now; Stage 3 missions use it.
   - **Policy editor:** CodeMirror JSON with validation, attached to roles and to S3, SQS and KMS resource policies.
   - New event kind `iamAccess`. Traces gain an `iam` hop, so one end-to-end trace shows both "can the packet get there" and "is the call allowed."
3. **Spot the Difference mode:** two read-only boards side by side, nearly identical. Both run the same event; one survives. The player picks the cause (multiple choice built from real config differences), then sees the explanation and both traces.
4. **Field Manual additions:** about 15 entries covering IAM evaluation logic, resource vs. identity policies, KMS key policies, SG vs. NACL, VPC Flow Logs, ALB health checks and error codes (502 / 503 / 504), ASG health check types, SQS visibility timeout and DLQ.
5. **Questions:** 30 more (50 total).

### Incidents (8)
1. **The packet that never came back:** NACL on the app subnet allows inbound 443 but has no outbound rule for ephemeral ports 1024–65535.
2. **Patch Tuesday, again:** private route table's 0.0.0.0/0 points at a NAT gateway that was deleted (blackhole route).
3. **0/4 healthy:** ALB health check path is `/health`, but the app serves `/healthz`. Symptom: 503s.
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

---

## STAGE 3 — Breadth: multi-Region DR, hybrid, storage, data

**Goal:** cover the rest of the exam guide with the same depth.

### Board expansion
- **Second Region** panel (for example us-west-2), collapsible.
- **Second VPC** with **VPC peering**: peering is not transitive, both sides need routes, and CIDRs can't overlap. **Transit Gateway** for hub-and-spoke routing, with its own route tables.
- **On-prem data centre** zone with a customer gateway. The tracer supports the on-prem endpoint over VPN and Direct Connect.
- **Accounts:** an optional AWS Organizations layer (management account, workload accounts, SCPs) for cross-account missions.

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

### New event kinds
- **`regionOutage`:** RTO = DNS detection (health check interval × threshold) + TTL + time to bring up whatever isn't already running in the DR Region. Model: scaling an ASG from zero ≈ 10–15 min; restoring a DB from a snapshot ≈ 30–60+ min; promoting an Aurora Global secondary ≈ about 1 min. RPO comes from the replication mechanism: snapshot copy frequency, async CRR lag, Aurora Global (<1s), DynamoDB global tables (around 1s). The UI then **names the DR strategy the player built**: backup and restore, pilot light, warm standby, or multi-site active-active.
- **`dataLoss`:** accidental deletion, corruption or ransomware at time T. Checks versioning, Object Lock, PITR, backup retention and cross-Region copies. Reports what was recoverable and to what point in time.
- **`migration`:** data size, link bandwidth and deadline. Shows the arithmetic (for example, 80 TB over 100 Mbps ≈ 74 days → Snowball).
- **`connectivity`:** requirements like "connected by tomorrow," "consistent 10 Gbps," or "encrypted," plus link-failure events.

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

### Acceptance criteria
- Tracer tests: peering non-transitivity, TGW route tables, on-prem over VPN, overlapping CIDRs rejected.
- `regionOutage` produces the correct RTO/RPO and strategy name for reference boards of each of the four DR strategies.
- All 8 missions pass the validation harness, mistakes included.

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

### Refactor missions (5)
1. **The always-on batch:** move to Spot instances with a fallback, and capacity-optimized allocation.
2. **Steady state:** Compute Savings Plans vs. EC2 Instance Savings Plans vs. Reserved Instances for a baseline load.
3. **Right-size the database:** overprovisioned RDS → Aurora Serverless v2, or a smaller class plus a read replica.
4. **Cold data, hot bill:** lifecycle rules and Intelligent-Tiering, including the minimum-duration traps.
5. **Chatty across AZs:** cross-AZ data transfer charges; keep traffic in the same AZ where safe, plus VPC endpoints and caching.

Bring the question bank to **150+**, balanced to the domain weights, with every option explained.

### Acceptance criteria
- SRS and mastery unit tests with injected dates.
- Exam mode draws a correctly weighted set and never repeats a question within an attempt.
- Daily session is generated deterministically from the store state.
- Export → clear storage → import restores all progress and mastery exactly.

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
