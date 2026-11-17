# Lectual as the agentic IP OS: product spec (Nov 17, 2026)

Owner's direction: **"we want Lectual to be the agentic IP OS."**

**The test for every sprint:** an assistant does the work, and a person only approves.
**Nothing in any sprint sends anything to a client.** Assistants draft. People approve. A person presses Send in their own mail client.

This spec covers eight sprints (`sprint-1.md` to `sprint-8.md`) and the open questions (`questions.md`). It adds to `AGENTS.md`. It does not replace it. Where the two disagree, `AGENTS.md` and lectual's `brain/decisions.md` win until the owner changes them.

## Who is who

| Person | Role in the firm | Lectual role (today) | What changes for them |
|---|---|---|---|
| Taylor | Founder and operator of Lectual | platform admin | Decides scope, merges, production migrations |
| Rebecca | The firm's attorney | attorney-tier (exact role checked in Sprint 1) | Approves legal work only; overrides a close with an open deadline |
| Caitlyn | The firm's operations lead | to be confirmed (`questions.md`) | Confirms stage list, time targets, accounts |
| Rayn | Law clerk | `law_clerk` (checked in Sprint 1) | Approves routine kinds (decision 15); gets approved drafts in her Outlook Drafts and sends them (3b) |
| Dawn | Billing | to be confirmed | Gets a billing view (decision 4) |

## Decisions on record (owner, Nov 17). Copied as given.

1. Lectual holds the true stage; Lawmatics keeps only what its automations need.
2. The Stage Keeper keeps moving intake stages forward on its own (logged, undoable).
3. Stall times are in calendar days first.
3b. Approved drafts land in the law clerk's (Rayn's) Outlook Drafts, and she sends them. When the attorney (Rebecca) approves, the card passes to Rayn, and the draft is made on Rayn's own click (nobody's mailbox is written to without them). Rayn connects her Outlook once.
4. The billing person (Dawn) gets a billing view (invoices, unpaid list); "paid in Lawmatics" counts as cleared.
5. Closing a matter with an open USPTO deadline is blocked, with an override for Rebecca.
6. A client reply stops a follow-up sequence; staff re-enrol. No build.
7. Proposal follow-up: Day 1, 2, 4, 6 and 7 as tasks, each with a draft for approval.
8. Lost only on a clear no. Silence goes to Long-Term Nurture after the grace period (proposal valid 7 days, about two weeks' grace).
9. Manual leads are entered in Lectual.
10. The proposal email states the last day; it does not repeat the fee total.
11. Adobe Sign signs the engagement letter when the firm has connected it. The in-app signature (lectual 0106, on dev only) stays as the fallback. Only the client signs. Order: the letter and invoice go out with the proposal; the client accepts, signs, then pays; signed and paid = hired.
12. Agentic builds in this plan: the USPTO watcher, the signed-and-paid chain with Adobe Sign, and the meeting assistant.
14. The Lawmatics thank-you and nurture emails that Forms tags trigger are approved firm emails.
15. Rayn (law clerk) may approve without Rebecca: filing receipts, publication and registration notices, form and payment reminders, and asking a client for anything the firm needs from them. Everything with legal content stays attorney-only.
- Client portal: parked. Intake is trademark-only for now. Monday is the meeting day.

(There is no decision 13 on record. Do not invent one.)

## The three agentic builds (decision 12)

| Build | Sprint | The assistant does | The person does |
|---|---|---|---|
| USPTO watcher | 3 | Reads each filed matter's USPTO status nightly, spots a mismatch with Lectual's stage, suggests the stage move, the deadline and a client notice draft | Accepts the stage move; adds the suggested deadline (it lands **unconfirmed**); an attorney confirms it; approves the notice |
| Signed-and-paid chain | 5 | Builds one approval card (proposal + letter + email); sends the letter to Adobe Sign on approval; on signed **and** paid, opens the matter, drafts the welcome email, queues the questionnaire | Approves the card; approves the welcome email; Rayn sends from Outlook |
| Meeting assistant | 6 | After the Monday call is imported, proposes a next step, owner and note per matter from the transcript | One click accepts each (or edits / dismisses) |

The rest (Sprints 1, 2, 4, 7, 8) is the ground these builds stand on: true stages, who waits on whom, who may approve what, follow-up tasks with drafts, and time targets.

## Rules every sprint keeps (from AGENTS.md; binding)

- **No send.** No code path sends mail to a client. The only send call stays `src/lib/mailbox/outlook-send.ts`, pressed by a person (pinned by `tests/agents/new-agents-hygiene.test.ts`). Approving creates a **draft** only.
- **UPL firewall.** Software, not a law firm. Flat fees only. No text implies legal advice. Model prompts start with `AGENT_POLICY` (`src/lib/agents/policy.ts`); record and mail text reach a model only inside inert tags.
- **Deadlines.** Lectual never creates or confirms a deadline on its own (`src/lib/matters/deadlines.ts`, `deadline-rules.ts`). Every row comes from a person's action; `attorney_confirmed` flips only through `confirmDeadline` (attorney/owner, database trigger too). A suggestion is labelled unconfirmed everywhere.
- **Who may approve** lives in ONE file, `src/lib/queue/routing.ts` (`classifyQueueItem`, `KIND_INFO`, `canApproveItem`, `flagsLegalAdvice`). `reviewQueueAction` / `src/lib/queue/review-core.ts` re-checks on every approve. Attorney-only kinds need `QUEUE_APPROVE_ROLES`.
- **Database access.** Dashboard code uses `getScopedClient()` only (RLS on `active_org_id`). The service role (`src/lib/db/admin.ts`) is for crons and agents that stamp the row's own `org_id`, never in dashboard code.
- **Reads have three states** (ok / not set up or unconfigured / couldn't be read). A failed read is never shown as empty, zero, "none" or "unpaid".
- **Modules fail closed.** Gate the page and the action with `orgHasModule()`; `notFound()`. The rail is a courtesy.
- **Words.** Firm-facing names live in `src/lib/ui/words.ts`. No build words (`tests/ui/no-build-words.test.ts`). No raw error text (`tests/ui/no-raw-error-text.test.ts`); fixed sentences only.
- **Agents.** Run through `runOneAgent` with a time budget (`src/lib/agents/budget.ts`), cron tracks (`CRON_TRACKS`), the New York hour guard (`src/lib/cron/ny-hour.ts`), counts-only `agent_run` rows, `agentModel()` (no Opus default), failure alerts. `vercel.json` cron pairs change together.
- **Stage Keeper** rules stand: forward only, never into `won`/`lost`/`nurture`, sensitive guard, 7-day person-move card, one action per lead per run, `signal_key` consumption.
- **Merged leads (0107).** Every `crm_lead` read goes through `live(...)` or carries a `// live-guard:` reason (`tests/leads/live-guard.test.ts`). New writers follow `keeperForWrite`.
- **LawPay, Lawmatics, Fathom, Zoom, Microsoft, Adobe Sign:** each firm connects its OWN account. No deployment-wide credential. Sealed columns have no SELECT grant. Tests never call the provider.
- **Engagement letter (0106).** The signed text, fingerprint and guards in `src/lib/loe/` stand. 0106 is on lectual-dev only; production needs the owner's OK.
- **Schema.** No migrations in this repo. Each goes in `lectual/supabase/migrations`, next free number **0108**, lectual-dev first, production only with the owner's OK, plus a case in lectual's `tests/tenant-isolation.test.ts` for every new tenant table or policy.

## Planned migrations (lectual repo, in sprint order)

| No. | Sprint | Holds | Certain? |
|---|---|---|---|
| 0108 | 2 | `crm_stage.waiting_on` (lead stages: who each stage waits on); consult outcome values only if they are a DB enum | Yes (column); enum part to be checked |
| 0109 | 3 | Matter close guard: trigger refusing `status = closed` with an open USPTO deadline unless closed through the override function (`crm_close_matter_with_override`, override roles only, reason required); `crm_matter_close_override` log | Yes |
| 0110 | 3 | `uspto_status_check` (latest USPTO read per matter) and `uspto_finding` (suggestions: stage, deadline, notice; pending / accepted / dismissed); agent CHECKs gain `uspto-watcher` and `meeting-assistant` | Yes |
| 0111 | 4 | `queue_card_event` kinds `draft_to` / `drafted` (the card passes to Rayn for her draft click) | Likely; decided at the start of Sprint 4 |
| 0112 | 5 | `adobe_sign_connection` (per firm, sealed tokens) and `adobe_sign_agreement` (proposal version, agreement id, status, signed time, webhook events) | Yes |
| 0113 | 8 | `crm_matter_stage.target_days` (matter stage time targets; lead stages reuse `crm_stage.aging_threshold_days`) and `crm_billing_access` (who besides the owner sees billing) | Yes (access table depends on Taylor's answer) |

Sprints 1, 6 and 7 plan no migration. If one turns out to need one, it takes the next free number at that time and this table is updated. Numbers are first-merged-wins in lectual: if another branch takes 0108 first, renumber in order.

## Design rollout comes first

The design rollout now running restyles most dashboard pages. **UI work in Sprints 1 to 8 starts only after it has merged.** Until then, only new files with no UI may start. Three pieces start now, as new files only (no edits to existing files, no imports from pages):

- **B1, USPTO status reader** in `src/lib/uspto/**`: a pure parser and a fetcher for one serial number's status, fixtures only, no key needed for tests. Feeds Sprint 3.
- **B2, meeting-assistant reader** in `src/lib/meeting-assistant/**`: from an imported meeting and the firm's open matters, a pure function that proposes per-matter next step, owner and note (model call injected). Feeds Sprint 6.
- **B3, Adobe Sign design note** at `docs/pge/2026-11-17-agentic-ip-os/adobe-sign-design.md`, written by another agent. Sprint 5 builds from it.

## How every sprint runs

1. A generator builds to the contract. **Sonnet** for UI and library code; **Opus** for permissions, money, signatures, migrations and client-facing wording (named per part in each contract).
2. Full `pnpm test`, `pnpm lint`, `pnpm build`.
3. Any schema change: the migration in lectual, applied to lectual-dev, with the tenant-isolation case passing there.
4. An independent evaluator pass: a quality pass for every sprint, **strict for Sprints 3, 4 and 5** (deadlines, who may approve, signatures and money). Strict means: the evaluator reads every changed line on those paths, tries to make each "must never happen" happen, and fails the sprint on any hit.
5. A plain-words report for the owner: what changed, what was not verified, what needs a key or a decision.
6. Merge only on the owner's yes. Production migrations only with the owner's OK.

## Order and dependencies

```
Design rollout merges ─┬─ S1 (small)
                       ├─ S2 (small) ── needs Caitlyn's stage list ──┬─ S8
                       ├─ S3 (medium; B1 now; live needs USPTO key)  │
                       ├─ S4 (medium; needs 0103 on prod) ── S5 (large; B3; Adobe Sign; 0106 prod OK)
                       ├─ S6 (medium; B2 now)
                       └─ S7 (medium; best after S4 so Rayn can clear the drafts)
```

## Out of scope for this plan

Client portal (parked). Practice areas other than trademark at intake. Sequence stopping on a reply (decision 6: no build). Any automatic send. Any deadline written without an attorney.
