# Tracy's Dashboard — Research & Build Plan

> Status: **research + plan only** this session. No code shipped.
> Target repo: `theipgirl/lectual.app` (standalone app, reads `lectual-prod` Supabase)
> Branch: `claude/mycase-dashboard-tracy-bwdfp4`

---

## Context

Tracy (Tracey Cabanis) is a solo Florida attorney running two unrelated practices at once:
**consumer-debt / credit litigation** (FDCPA-style, referral-fed, high volume, deadline-dense)
and **trademark prosecution** (low volume, long horizon, flat fee).

She has been paying for **MyCase** since April (~$240/yr, 2 users) without ever really
adopting it. Her real system of record is a spreadsheet that is already out of date.
The consequence is not theoretical: **she missed a pretrial conference in Marion County.**
That single miss is the wound this dashboard exists to heal.

All ~35 of her matters have already been seeded into Lectual from a court docket
spreadsheet, but they are thin — filing details, deadlines and notes are not filled in.

The existing Lectual dashboard was shaped around **Rebecca's** trademark practice
(Pipeline / Pre-filing / Post-filing / Contracts / General Counsel / Maintenance tabs,
approvals queue, co-pilot). **We are explicitly not reusing it.** Tracy gets a
purpose-built dashboard whose two practices sit side by side as equals.

Intended outcome: a dashboard where Tracy can open one screen and immediately know
what is due, what is overdue, what is owed to her, and what needs her signature —
without opening a spreadsheet, a court portal, or MyCase.

---

## Part 1 — Tracy's requirements (evidence-based)

Sourced from Granola meeting notes, Aug 13–28 2026. Every item below traces to a
specific call. Ranked by how much pain it is causing her today.

### P0 — Deadline & docket survival

| Need | Evidence |
|---|---|
| Every deadline for every matter on one screen, ranked by urgency | Missed Marion County pretrial (Aug 14 call) |
| Calendar view with **day-of-week context**, not raw dates | Aug 25 (Caitlyn): "actual calendar view requested" |
| Color coding: red = overdue, yellow = due this week, blue = further out | Aug 28 (Rebecca/dashboard review) |
| Deadlines at the **top** of the screen, not buried | Aug 25: "deadlines to move to the top of the Today tab" |
| **Answer-deadline math**: serve date + 20 days → answer due → default eligible | Aug 24 9:17am — she currently uses timeanddate.com by hand |
| "File for default" prompt one day after the answer deadline passes | Aug 24 9:17am — "defaults sometimes prompt defendants to come forward" |
| Weekly automated docket sweep (Miami-Dade), files renamed and loaded | Aug 19 (Rebecca) |
| **Text/SMS notification, not email** — she has no 7:30am inbox habit | Aug 19 — explicitly contrasted with Rebecca |

### P1 — The two pipelines, side by side

Debt litigation stages (from her actual workflow):
`Intake → Pre-filing → Filed → Served → Answer window → Default → Demand/Settlement → Closed`

Trademark stages:
`Intake → Pre-filing → Filed → Under examination → Office action → Statement of use → Registered → Maintenance`

Notes:
- Intake was **missing** from the existing pipeline and must be present (Aug 28).
- Paths are **not linear** — matters skip stages (e.g. 1A vs 1B trademark filings).
- Cards should carry an assignee label (Aug 28).
- Maintenance/renewals need a long-horizon home (6-year marks).

### P1 — Money

| Need | Evidence |
|---|---|
| **Demand queue** — cases sitting waiting for a demand to go out; they stall | Aug 20: 20% of settlement, ~$2k/case at $10k settlements |
| Referral-partner pipeline: $750 flat, $150 hardship rate, partner admin fee | Aug 18 + Aug 19 |
| Flat-fee trademark: $1,000 earned on approval + $350 filing fee into **trust** | Aug 24 9:17am |
| CC Tracy on every signed retainer and every payment received | Aug 14 |
| Track consultations that **did not** convert, not just wins | Aug 14 |
| Outstanding balances (ABC Legal showed ~$14k overdue, wrong card on file) | Aug 14 |

### P1 — Intake

- **Two separate intake forms**: consumer debt/credit litigation, and trademark.
- **Referral-partner intake**: partner submits client info → matter auto-created →
  system emails the client (**in Spanish** where needed) with a booking link.
  Her debt clients come from credit-repair companies in Tampa, not direct leads.
- Post-intake: discovery call → payment link email → automated LOE → workflow with
  human checkpoints.
- Notification the moment an intake lands.

### P2 — Everything else she asked for

- Central document storage (Google Drive shares keep failing / landing in spam).
- Professional call handling — RingCentral routes to her cell voicemail today;
  wants push notifications, appointment booking, Spanish support.
- Approvals queue: drafts awaiting her legal sign-off, replacing subject-line hunting.
- Process-service tracking (ABC Legal): filings, rejections, and **why** they were
  rejected — two of her filings bounced on summons formatting alone (Aug 24).

### Explicit non-goals for v1

- Do not rebuild intake CRM wholesale — Rebecca's direction is Lawmatics stays the
  CRM for her firm. Tracy's situation differs (no Lawmatics), so her intake is in scope,
  but full nurture/drip automation is not.
- No trust accounting ledger in v1 — show trust *balance* only.

---

## Part 2 — Feature matrix: Lectual vs MyCase

Lectual = `theipgirl/lectual` @ `3a47e4a`. MyCase = live product + help centre, verified Aug 2026.

### Where MyCase wins outright — Lectual has nothing

| Module | MyCase | Lectual |
|---|---|---|
| **Time tracking** | 3 web / 5 mobile timers, contextual "add time entry" everywhere, **Smart Time Finder** (passively logs actions, surfaces the ones missing a time entry) | **Nothing.** No table, no columns. |
| **Billing / invoicing** | Invoices, batch billing, LEDES 1998B, UTBMS, payment plans w/ auto-charge, aging invoices | **Nothing.** Fees exist only as verbatim strings inside `crm_activity.payload` |
| **Payments** | LawPay: card / ACH / Apple Pay, 2.99%+$0.30, payment links, trust-vs-operating routing | **Nothing.** No payment rail at all |
| **Trust / IOLTA** | Included in **every** tier: per-client ledgers, commingling block, three-way reconciliation | **Nothing** |
| **E-signature** | Unlimited, built in, audit trail (Pro+) | **Nothing** |
| **Client portal** | Case info, docs, invoices, secure messaging, in-portal payment | **Nothing** |
| **Document management** | Unlimited storage, folders, versioning, tagging, full-text search | Generation only. No upload UI, no folders, no versioning |
| **Calendar sync** | Two-way Google + Outlook | **None.** No calendar-events table at all |
| **Court rules** | "Add Court Rule" → LawToolBox, 50 states, ~80 deadlines off one trigger | Manual entry + hand-run spreadsheet importers |
| **Contacts UI** | Full directory, companies, custom fields, conflict check | Schema shipped (`crm_contact`), **no UI at all** |
| **Tasks page** | Tasks tab, bulk actions, workflow templates | `crm_task` exists; no tasks page |
| **Custom fields** | 7 types, scoped per practice area | **None** — schema is fixed |
| **Scheduled automation** | Workflow templates w/ date + dependency triggers | **Nothing runs on a schedule anywhere.** No cron, no worker, no edge function |
| **Mobile apps** | iOS + Android | None |
| **Process service / e-filing** | InfoTrack + Proof — affidavits and expenses sync back to the case | None |

### Where Lectual wins — MyCase has no equivalent

| | Lectual |
|---|---|
| **Approval queue as the product spine** | Every AI output lands as a draft for attorney sign-off. MyCase's AI writes into the editor with no review gate |
| **Public AI intake assessment** | Scored funnel (`/assessment`, `/a/[slug]`) that routes to an attorney by budget/practice — MyCase intake forms are static |
| **AI lead enrichment** | 3-layer enrichment w/ a full append-only audit log (`crm_ai_enrichment`: model, prompt version, input hash, cost) |
| **Firm Brain** | Per-firm memory + a claim library gating advertising claims |
| **IP-native matter fields** | mark text, serial no., int'l classes, filing basis, USPTO status + as-of date, examining attorney. **MyCase has zero IP support** |
| **USPTO deadline rules** | 9 IP deadline kinds + 7 Florida litigation kinds, extension counters |
| **Tenant isolation rigour** | RLS on a JWT claim, composite `(id, org_id)` FKs, append-only triggers that block even the service role, an 1800-line isolation test as a CI gate |
| **Per-firm theming + modules** | Firms get their own brand and their own feature set |

### The honest read

MyCase is a **complete practice-management system** that is weak at AI and has *zero* IP support.
Lectual is an **AI-native matter and intake system** with no money layer whatsoever.

For Tracy specifically, MyCase Basic ($50/user/mo annual) gives her none of what she needs —
workflows, texting, intake forms, mobile and Smart Time Finder are all **Pro+** ($100), and the
court-rules engine she'd actually want is **LawToolBox, a paid third-party bolt-on on top of that**.
She is paying for a tier that cannot solve her deadline problem.

**MyCase features worth copying for Tracy, in priority order:** the Court-Rule trigger→deadline
cascade, the fixed dashboard widget set (Timesheet / My tasks / Today's events / Quick actions),
color-coded event types with a staff filter, payment plans with auto-charge, and the Statute of
Limitations field + report. **Worth deliberately not copying:** the dashboard being
non-customizable, and gating everything useful behind a higher tier.

## Part 3 — What's already true (and constrains everything)

Tracy is **already live in `lectual-prod`** as tenant `cabanis-law`. This is not a greenfield build.

- **53 matters**: 34 litigation (`type='LIT'`) + 19 payroll-collections. 15 stages, 7 deadlines, 50 open tasks.
- **22 of the 34 litigation matters have `stage_id IS NULL`** — deliberately unplaced, awaiting her judgment.
  Any board that keys on `stage_id` silently drops 65% of her live litigation.
- **Two deadlines are intentionally overdue** — lapsed appeal windows, `status='open'` with a past
  `due_date`, so they render red rather than being quietly closed. Do not "clean them up."
- Her `crm_matter.matter_number` **is** the court case number (`26-CC-011354`).
- Litigation ladder: `SERVED · ANSWER · MOT_PENDING · HEARING_SET · DISCOVERY · TRIAL_SET · JUDGMENT · POST_JUDGMENT · CLOSED`
- Collections ladder: `PC10 Document Review · PC20 File Summons · PC30 File Complaint · PC40 Pursuing Related · PC80 Not Pursuing · PC90 Complete`
- **No trademark stage ladder exists for her yet** — she has TM matters, so this must be seeded.

**What the schema does not have at all:** time tracking, invoices, payments, trust/IOLTA,
settlement/demand amounts, fee arrangements, referral-partner entities, notification preferences,
and any calendar-events table. Fees exist only as **verbatim strings** inside `crm_activity.payload`
(`"$4,750"`) that are never parsed or re-summed. There is also **no scheduler anywhere** — no cron,
no edge function, no background worker.

### Decisions taken

| Question | Decision |
|---|---|
| Practice layout | **Tabs / toggle**, not side-by-side panes — Litigation · Collections · Trademark |
| Trademark | She has open TM matters; needs a stage ladder seeded |
| Calendar | **Lives on the home dashboard**, not only on its own page |
| Outlook | **Two-way-visible sync in scope** — her Outlook events appear alongside deadlines |
| Docket sweep | **Deferred** |
| SMS | **Not in this build** |

Consequence: **the matter/deadline/pipeline half of v1 needs no database migration.** The only
schema work is one small migration to store her Outlook connection (below), plus seeding her
trademark stage ladder, which is content rather than schema.

### The Outlook integration is new work — it cannot reuse what exists

The app already talks to Microsoft Graph, but **none of it is reusable here**, and this is worth
being precise about before it gets scoped as "already done":

- The existing Graph integration is **mail only**, and it lives in a **separate deployed service**
  (`lawmatics-mcp`), reached over HTTP with a shared bearer token — not in this codebase.
- It is **single-tenant by construction.** `/home/user/lectual/src/lib/inbox/api.ts` says so directly:
  the mailboxes are *"a property of the lawmatics-mcp deployment itself, not of any one `crm_org`
  row… This surface only ever makes sense for whichever firm that deployment belongs to."* That firm
  is not Cabanis Law.
- `crm_connected_account` exists and is the right home for a calendar connection, but its `category`
  CHECK is `('notetaker','crm','email','esign','invoicing')` — **there is no `'calendar'` value**.

So Outlook calendar means: a real Microsoft OAuth flow (delegated, `Calendars.Read` +
`offline_access`), encrypted refresh-token storage, and Graph `/me/calendarView` reads — plus a
one-line migration adding `'calendar'` to that CHECK, PR'd to the main repo.

⚠️ **Sequencing risk worth naming now:** as of the Aug 19 and Aug 25 calls, her email was still being
consolidated and moved under her own org (`info@`/`tracy@attorneytracy.com`), with passwords being
rotated. Connecting a calendar to a mailbox that is mid-migration will break the token. **Confirm her
Outlook account is settled before building the OAuth flow** — everything else in this plan ships
without it.

---

## Part 4 — Dashboard design

### `/` — Today

**The deadline hero is the first element in the DOM.** Nothing above it but the title bar. It spans
all practices — deadlines are never hidden behind a tab.

```
┌───────────────────────────────────────┬──────────────────────────────┐
│  DEADLINES        7 open · 2 overdue  │  SEPTEMBER 2026      ‹  ›    │
│  ───────────────────────────────────  │  ──────────────────────────  │
│  ● OVERDUE                            │  Su Mo Tu We Th Fr Sa        │
│   Mon 18 Aug  Appeal window           │  31  1  2  3  4  5  6        │
│               26-CC-011354            │      ·  ●  ·  ◆              │
│   Thu 21 Aug  Appeal window           │   7  8  9 10 11 12 13        │
│               26-CC-009882            │            ·     ●           │
│  ● THIS WEEK                          │  14 15 16 17 18 19 20        │
│   Thu  4 Sep  Hearing 10:00 AM EDT    │  21 22 23 24 25 26 27        │
│               26-CC-011401            │      ●                       │
│  ● LATER                              │  28 29 30                    │
│   Mon 22 Sep  Motion response         │  ─────────────────────────   │
│               26-CC-010774            │  ● deadline  ◆ Outlook  · task│
└───────────────────────────────────────┴──────────────────────────────┘
   ↑ ranked list — what's on fire        ↑ month shape — what's coming

┌──────────────────────────────────────────────────────────────────────┐
│  UP NEXT · next 14 days                                              │
│  Wed  2 Sep  ·  Task: file default, Barrios          26-CC-010992    │
│  Thu  4 Sep  ●  Hearing 10:00 AM EDT · Pinellas      26-CC-011401    │
│  Thu  4 Sep  ◆  Client call — Nicole (Outlook)       2:00 PM         │
│  Mon  8 Sep  ·  Answer due                            26-CC-011354   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  [ Litigation 34 ]  [ Collections 19 ]  [ Trademark n ]              │  ← tabs
│  ──────────────────────────────────────────────────────────────────  │
│  UNPLACED 22  │ SERVED 3 │ ANSWER 2 │ MOT_PENDING 1 │ HEARING_SET 2  │
│  ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────────┐ ┌──────────────┐  │
│  │26-CC-...│ │        │ │        │ │            │ │              │  │
│  └──────────┘ └────────┘ └────────┘ └────────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────┬──────────┬──────────┬──────────┐
│ Demands  │ Unconf.  │ Stalled  │ Consults │
│ waiting  │ dates    │ cases    │ not conv.│
│    6     │    3     │    8     │    4     │
└──────────┴──────────┴──────────┴──────────┘
```

**Rules this layout encodes**

- **Every date shows a weekday** — `Tue 2 Sep`, never `9/2`. One `formatDocketDate()` used everywhere.
- **Three urgency bands**: overdue (red) / due within 7 days (yellow) / later (blue). **Overdue always
  wins its bucket** regardless of how far past — a blown date is never hidden in a quieter section.
  Color is never the only signal; each band carries a text label.
- **`UNPLACED` is a pinned first lane, always rendered, even at zero.** This is the 22-matter defense.
  Reuse `buildBoard` from `/home/user/lectual/src/lib/matters/board.ts`, which already returns
  `unstaged` as a required (not optional) field. Add a conservation test:
  `open + closed + unstaged === total`.
- **Tabs are a registry array**, so adding or reordering a practice is a one-line data change. No
  practice is hardcoded as primary.

**Why both a ranked list and a month grid, side by side.** They answer different questions and
neither substitutes for the other. The list answers *"what is on fire right now"* — it is ordered by
urgency and ignores the calendar shape entirely. The grid answers *"what does my month look like"* —
the day-of-week context she explicitly asked for, where a cluster of three hearings in one week is
visible at a glance. `UP NEXT` sits under both as the linear 14-day reading. Clicking any day in the
grid filters `UP NEXT` to that day.

**Outlook events are visually distinct and never counted as deadlines.** A `◆` marker, a different
weight, and they are excluded from the "7 open · 2 overdue" counts. An Outlook event is context, not
an obligation the firm is tracking — conflating the two would let a lunch appointment look like a
court date.

### Practice resolution — pure, no new column

`src/lib/practice/resolve.ts`:
```
LIT + stage.code starts with "PC"          → collections
LIT + (LIT-ladder code | stage_id is null) → litigation
TM                                          → trademark
```
A `LIT` matter with `stage_id IS NULL` resolves to **litigation** — deliberate, and gets its own test.

### The calendar — one engine, two surfaces

The month grid on `/` and the full `/calendar` page are the **same component** with different
density. `/calendar` adds week/day views, filtering by source and practice, and a printable agenda.

**Four sources, merged and deduped** in `src/lib/calendar/rows.ts`:

| Source | Field | Renders as |
|---|---|---|
| Deadlines | `crm_matter_deadline.due_date` (civil date, no time) | ● urgency-colored |
| Hearings | `crm_litigation_detail.next_hearing_at` (timestamptz) | ● with court wall-clock time |
| Tasks | `crm_task.due_at` (timestamptz) | · muted |
| **Outlook** | Graph `/me/calendarView` | ◆ distinct, never counted |

**Court time is not a formatting detail.** Hearings render in `America/New_York` with the zone named
("10:00 AM EDT"). Mirror `/home/user/lectual/src/lib/matters/court-time.ts` verbatim — her Pinellas
hearing is stored `2026-08-25T14:00:00Z`; rendering it in UTC shows "2:00 PM" for a hearing she must
attend at 10:00. Outlook events carry their own timezone from Graph and are converted the same way.

**Dedupe rules:**
- A `hearing`-kind deadline and a `next_hearing_at` on the same matter and civil date render as **one**
  row — prefer the deadline row, annotated with the time.
- An Outlook event whose subject contains a matter number already on the docket that day is
  **collapsed into** the docket row rather than duplicated. Everything else stays separate.

### Outlook sync — read-only, one direction, v2

**Scope: her Outlook events appear in Lectual. Lectual does not write to Outlook.** One-way keeps
the failure modes small: a bad sync shows a stale event, it never creates or deletes anything in her
real calendar. Two-way write-back is a later decision, not this build.

- **Auth:** Microsoft OAuth authorization-code flow, delegated scopes `Calendars.Read` +
  `offline_access` + `User.Read`. Refresh token stored encrypted in `crm_connected_account`
  (`category='calendar'`, `provider='microsoft'`), org-scoped by RLS like every other row.
- **Read:** Graph `/me/calendarView?startDateTime=…&endDateTime=…` bounded to the visible window —
  never a full-mailbox pull. Cache briefly; refresh on page load.
- **Fail closed and say so.** If the token is missing, expired, or revoked, the calendar renders her
  Lectual deadlines normally with a "Outlook not connected — reconnect" chip. It must **never** render
  an empty calendar that looks like she has nothing on. That failure mode is exactly what a missed
  pretrial looks like.
- **No autonomous writes, no invites, no sends.** Reading a calendar is not practising law; writing
  to it on her behalf is a step this build does not take.

### The answer clock — a suggestion, never a docket entry

`src/lib/deadlines/answer-clock.ts`, a **pure module that returns a suggestion and never writes**:

```
computeAnswerClock({ servedOn }) → {
  answerDue:         servedOn + 20 days,
  defaultEligibleOn: answerDue + 1 day,
  answerDueWeekday:  "Saturday",        // surfaced, never auto-rolled
  basis: "20 days from the date of service; default considered the following day.
          Attorney's own standing rule — verify against the applicable rule and the docket.",
  kind: "suggestion"
}
```

Non-negotiable constraints:

1. **Never write `source='calculated'`.** Every litigation deadline kind has `interval: null` in
   `/home/user/lectual/src/lib/matters/deadline-rules.ts` on purpose — encoding a procedural period
   there would assert a legal determination the product does not make. When she dockets a suggestion,
   write `source='manual'`, `anchor_event='service'`, `anchor_date=<servedOn>`, the basis sentence in
   `calculation_basis`, and `attorney_confirmed=false`.
2. **A suggestion is not on the docket until she clicks.** Dashed border, "Suggested — not on the
   docket", with *Docket this date* / *Dismiss*. Never in the hero, never on the calendar, never counted.
3. **No weekend or holiday rolling.** Rolling a date forward is a legal determination. Show the
   weekday; let her decide.
4. `0053` enforces one open deadline per kind per litigation matter — catch the unique violation and
   offer "there's already an open one, supersede it?" rather than surfacing a Postgres error.

### Screens

| Route | Purpose |
|---|---|
| `/` | Today — deadline list + month calendar side by side, Up Next, practice tabs, attention strip |
| `/calendar` | Full calendar — month/week/day, source + practice filters, printable agenda |
| `/pipeline/[practice]` | Full board, unplaced lane pinned first |
| `/matter/[id]` | Case file: header, deadlines + answer clock, litigation detail, tasks, contacts, activity, fees (verbatim) |
| `/demands` | Demand queue |
| `/intake` | Referral sources + consults that did not convert |
| `/sign-in`, `/auth/callback` | Magic link |

---

## Part 5 — Implementation

### Architecture: standalone app, main repo keeps the schema

`lectual.app` is a standalone Next.js app authenticating against `lectual-prod`
(`qpbogzkdpynhhqmaradu`). It contains **no `supabase/` directory and no migrations** — CI fails if
`supabase/migrations/**` ever appears there.

Why this split works:
- The custom access token hook `public.custom_access_token_hook` is **project-level**, so any app
  authenticating against `lectual-prod` gets the `active_org_id` claim automatically. Tenancy is
  inherited for free; RLS does all the scoping and app code never writes an `org_id` filter.
- Migration numbering is "first-merged-wins, check `main` for the highest number" — a rule that is
  unenforceable across two repos with no shared history. Two files at `0055_` would break replay.
- The tenant-isolation compliance gate already lives in the main repo, so any new table already
  requires a PR there. Putting the SQL there too costs nothing extra.

**Where it hurts, stated plainly:** ~5 auth files (~250 lines) get mirrored verbatim; the Supabase
**Redirect URL allowlist is shared project config** — if the new origin isn't allowlisted, Tracy's
magic links land on the main app's marketing homepage; and both apps share a cookie name, so signing
out of one invalidates the other's refresh-token family. Never set an explicit cookie `domain`.

**Types:** do not copy the main repo's hand-patched `src/lib/db/types.ts` (2,706 lines). Generate
fresh from `qpbogzkdpynhhqmaradu` into `src/lib/db/types.generated.ts` with a `pnpm db:types` script.

### Structure

```
lectual.app/
├─ AGENTS.md                 # states: no migrations here; schema PRs go to theipgirl/lectual
├─ next.config.ts            # trailingSlash: true — must match; the mirrored callback assumes it
└─ src/
   ├─ proxy.ts               ★ verbatim ← lectual/src/proxy.ts
   ├─ lib/
   │  ├─ db/scoped-client.ts ★ verbatim ← lectual/src/lib/db/scoped-client.ts
   │  ├─ db/types.generated.ts        ⟳ generated, not copied
   │  ├─ auth/roles.ts       ★ verbatim ← lectual/src/lib/auth/roles.ts
   │  ├─ auth/session.ts     ◆ new — fail-closed; logic extracted from lectual (firm)/layout.tsx
   │  ├─ practice/resolve.ts ◆ new, pure
   │  ├─ board/board.ts      ★ ← lectual/src/lib/matters/board.ts  (the unstaged lane)
   │  ├─ deadlines/{read,kinds,answer-clock,urgency}.ts
   │  ├─ calendar/rows.ts    ★ ← lectual/src/lib/matters/calendar-rows.ts + hearings + dedupe
   │  ├─ court-time.ts       ★ verbatim ← lectual/src/lib/matters/court-time.ts
   │  └─ fees.ts             ★ ← lectual/src/lib/matters/fees.ts (verbatim strings, never parsed)
   ├─ app/                   ◆ all new — see screens table
   └─ components/            ◆ all new — DeadlineHero, PracticeTabs, StageLane, UnplacedLane,
                               CalendarGrid, AnswerClockCard, SuggestionChip, UrgencyBadge
```
★ mirror · ◆ new · ⟳ generated

**Do not mirror** `Shell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `firm.css`, or the nine-font block in
`(firm)/layout.tsx` — that is precisely the UI being replaced.

### Milestones

**M0 — Skeleton + auth.** Next 16 / React 19, mirrored `proxy.ts` + `scoped-client.ts`, generated
types, magic-link sign-in, fail-closed session resolution. Ships one page: "Signed in as X at Cabanis
Law." Add the new origin to Supabase Redirect URLs *before* this ships, and **prove the 1-hour
session survives** before building on top.

**M1 — Deadline list + calendar on home.** Read-only. Urgency bands, weekday formatting, the month
grid beside the ranked list, `UP NEXT`, court-time hearings, and the full `/calendar` page off the
same engine. This is the P0 that heals the missed-pretrial wound — and it ships **without** Outlook.

**M2 — Practice tabs + case file.** `resolvePractice`, `buildBoard` with the pinned unplaced lane,
`/pipeline/[practice]`, read-only `/matter/[id]`.

**M3 — First writes.** Create/confirm/satisfy a deadline; move a matter to a stage (including
unplaced → staged); create/complete tasks; edit litigation detail; append a note. Every write reads
`org_id` off the parent row, never from the form.

**M4 — Answer clock, demand queue, intake.** Suggestion → Docket flow. `/demands`. `/intake` reading
`referral_source` and non-converting leads.

**M5 — Trademark ladder.** Seed her TM stage ladder via a hand-run script in the **main** repo
(`scripts/seed-matter-stages.ts`) — content, never a migration. Stage `code`s are immutable upsert
keys: pick once, never change.

**M6 — Outlook calendar.** *Gated on her mailbox migration being finished.* One migration to the main
repo adding `'calendar'` to the `crm_connected_account.category` CHECK; Microsoft OAuth flow;
encrypted refresh-token storage; Graph `/me/calendarView` read bounded to the visible window; `◆`
events merged into the existing calendar engine, excluded from deadline counts, with a
"reconnect" chip on token failure. Read-only — Lectual never writes to her Outlook.

**Deferred by decision:** docket sweep, SMS, and all v2 schema (`crm_demand`,
`crm_referral_partner`, `crm_fee_arrangement`, `crm_notification_pref`).

**Interim demand queue:** a `crm_task` with `type='custom'` and a `Demand: ` title prefix, with
`/demands` as a filtered task view. This is a string convention and a deliberate smell — it exists so
v1 is useful on day one, and a future `crm_demand` backfills from exactly these rows.

---

## Part 6 — Verification

**Tenant isolation from a second app.** Port `/home/user/lectual/tests/helpers/seed.ts` *and its
`assertNotProduction` guard*. Point `.env.test` at **`lectual-dev`**, never prod. Assert: (1) signed in
as org A, reads of `crm_matter` / `crm_matter_deadline` / `crm_litigation_detail` / `crm_task` return
only A's rows; (2) every write path rejects a forged `org_id`; (3) **the JWT actually carries
`active_org_id` when minted from the new app** — this is the load-bearing assumption, so assert it
rather than trusting it; (4) a signed-in non-member sees the fail-closed screen, not an empty dashboard.

**Session persistence.** Sign in, fast-forward past token expiry, assert a rotated refresh cookie is
written and the request still authenticates — then assert it *fails* with the proxy disabled. A test
that cannot fail proves nothing.

**Pure-logic suites (no DB):**
- `board.test.ts` — conservation: `open + closed + unstaged === total`; 22 unstaged matters land in
  `unstaged`; a matter pointing at an invisible stage still lands somewhere.
- `urgency.test.ts` — a past-due open deadline is `overdue` regardless of distance; boundary at
  exactly 7 days; a DST-crossing week.
- `answer-clock.test.ts` — 20-day arithmetic across a month boundary and a leap day; result is always
  `kind:'suggestion'`; the module exports no writer.
- `court-time.test.ts` — `2026-08-25T14:00:00Z` renders "10:00 AM EDT".
- `practice.test.ts` — `LIT + stage_id null → litigation`; `LIT + PC30 → collections`.
- `calendar-rows.test.ts` — a hearing deadline and a `next_hearing_at` on the same matter/date
  collapse to one row; an Outlook event is **never** included in the overdue/open counts; a failed
  Outlook fetch still returns every Lectual row (assert this by injecting a throwing fetch — the
  "empty calendar looks like nothing is due" failure mode must be impossible).
- **Grep test:** no source file writes `source: 'calculated'`. Cheap, and it enforces the UPL rule structurally.

**Manual walkthrough with Tracy, read-only, before any write ships.** Confirm all 34 litigation
matters are visible with 22 in Unplaced; both overdue appeal windows are red at the top of the hero;
the Pinellas hearing shows the correct wall-clock time; total matter count reads 53.

---

## Part 7 — Risks

**Live production data for a working attorney.** Every write is a real docket entry on a real case.
M1–M2 are read-only and go in front of her first. No bulk operations, no "apply to all," no
background writer. `crm_activity` is trigger-blocked against UPDATE/DELETE **even for the service
role** — a mistake in the timeline is permanent.

**The 22 unstaged matters.** The single highest-consequence rendering bug available: any board, count
or filter keyed on `stage_id` silently drops 65% of her live litigation. Defended structurally by the
always-rendered Unplaced lane, `unstaged` being a required return field, and the conservation test.

**The intentionally-overdue deadlines.** Do not filter `due_date >= today`, do not auto-satisfy. Any
horizon filter bounds the **far** end only.

**The UPL firewall.** Lectual is software, not a law firm. Nothing sends autonomously; computed dates
are visually-distinct suggestions that are never counted and never on the calendar until she dockets
them; no weekend rolling; `attorney_confirmed` is flippable only by attorney/owner, and the DB trigger
drops the confirmation if the date later moves.

**Shared project config.** A misconfigured Redirect URL breaks magic links for *both* apps. Change it
in a low-traffic window and verify both immediately.

**A silently-empty calendar.** The worst bug this dashboard could ship is a calendar that renders
blank because an Outlook token expired — it looks exactly like "nothing is due," which is the precise
condition that cost her the Marion County pretrial. Outlook is an *additive overlay*: its failure is
always visible as a reconnect chip, and Lectual's own deadlines render regardless. This is enforced
by test, not by care.

**Her mailbox is mid-migration.** Building the OAuth flow against an account whose password and org
are still being moved will produce a token that breaks. M6 is gated on that settling; nothing else in
the plan depends on it.
