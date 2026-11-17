# Lectual as the agentic IP OS: product spec (Nov 17, 2026)

Owner's direction: **"we want Lectual to be the agentic IP OS."**

**The test for every sprint:** an assistant does the work, and a person only approves.
**Nothing in any sprint sends anything to a client.** Assistants draft. People approve. A person presses Send in their own mail client.

This spec covers eight sprints (`sprint-1.md` to `sprint-8.md`), a ninth sprint (`sprint-9.md`, the lead page where Lectual does the step), a tenth approved by Taylor (`sprint-10.md`, editable cards on Intake and Matters and the opened card), and the open questions (`questions.md`, with Taylor's answers of Nov 17 at the end). It adds to `AGENTS.md`. It does not replace it. Where the two disagree, `AGENTS.md` and lectual's `brain/decisions.md` win until the owner changes them.

## Who is who

| Person | Role in the firm | Lectual role (today) | What changes for them |
|---|---|---|---|
| Taylor | Founder and operator of Lectual | platform admin | Decides scope, merges, production migrations |
| Rebecca | The firm's attorney | attorney-tier (exact role checked in Sprint 1) | Approves legal work only; overrides a close with an open deadline |
| Caitlyn | The firm's operations lead | in the SOP (Taylor, Nov 17) | Owns the SOP (stage list, roles); time targets; gets the deadline alerts (Taylor, Nov 17) |
| Rayn | Law clerk | `law_clerk` (checked in Sprint 1) | Approves routine kinds (decision 15); gets approved drafts in her Outlook Drafts and sends them (3b); gets the deadline alerts (Taylor, Nov 17) |
| Dawn | Billing | to be confirmed; Taylor is getting her access (Taylor, Nov 17) | Gets a billing view (decision 4) |
| Amor | (to be confirmed) | account and role to be confirmed (`questions.md`) | Receives the Day 1/2/4/6/7 proposal follow-up tasks (Taylor, Nov 17) |

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

## Taylor's answers (Nov 17), as folded into the plan

Full table at the end of `questions.md`. Each change in a sprint file is marked "(Taylor, Nov 17)".

- **T1, production migrations: answered.** The director verified 0106 is already on lectual-prod (since 2026-11-12) and 0103 since Nov 10. Nothing is outstanding.
- **T2:** Taylor gets the USPTO key. **T3:** Rebecca's own Adobe Sign account (per-firm connection).
- **T4:** Lectual creates no invoice. "The invoice goes out with the proposal" = the firm's custom Lawmatics pay link on the proposal.
- **T5:** signed and paid moves the lead to `won`: a SECOND, narrow, named exception beside the hired-matter sync (Sprint 5 states it).
- **T6:** Dawn's access is coming; her role is still open. **T7:** owners can see which mailbox a colleague has connected (address and status only); Sprint 1 gets a small schema change.
- **C1 / C7:** the stage list and roles are in the SOP (Sprint 2 is contracted from it). **C4:** follow-up tasks go to Amor. **C8:** deadline alerts go to Rayn, Caitlyn and Rebecca.
- **R8:** the welcome email is the one in the trademarks@ mailbox, used as it stands; Caitlyn or Taylor pastes the text; it is never invented.
- **Still open:** T6 (Dawn's role), T8, C2, C3, C5, C6 (the Monday call's account and title), R1 to R7, and the questionnaire half of R8.

## The three agentic builds (decision 12)

| Build | Sprint | The assistant does | The person does |
|---|---|---|---|
| USPTO watcher | 3 | Reads each filed matter's USPTO status nightly, spots a mismatch with Lectual's stage, suggests the stage move, the deadline and a client notice draft | Accepts the stage move; adds the suggested deadline (it lands **unconfirmed**); an attorney confirms it; approves the notice |
| Signed-and-paid chain | 5 | Builds one approval card (proposal + letter + email); creates the client-only Adobe Sign agreement when the client signs (in-app signature as fallback); on signed **and** paid, opens the matter, drafts the welcome email, queues the questionnaire | Approves the card; approves the welcome email; Rayn sends from Outlook |
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
- **Engagement letter (0106).** The signed text, fingerprint and guards in `src/lib/loe/` stand. 0106 is on lectual-prod (since 2026-11-12, verified Nov 17); 0103 since Nov 10.
- **Schema.** No migrations in this repo. Each goes in `lectual/supabase/migrations`, next free number **0108**, lectual-dev first, production only with the owner's OK, plus a case in lectual's `tests/tenant-isolation.test.ts` for every new tenant table or policy.

## Planned migrations (lectual repo, in sprint order)

| No. | Sprint | Holds | Certain? |
|---|---|---|---|
| 0108 | 1 | Owner-only view of colleagues' mailbox connections: a security-definer function returning id, owner user, provider, address and status only (Taylor, Nov 17, T7) | Yes |
| 0109 | 2 | `crm_stage.waiting_on` (lead stages: who each stage waits on: firm, client, none, on_hold); consult outcome values only if they are a DB enum | Yes (column); enum part to be checked |
| 0110 | 3 | Matter close guard: trigger refusing `status = closed` with an open USPTO deadline unless closed through the override function (`crm_close_matter_with_override`, override roles only, reason required); `crm_matter_close_override` log | Yes |
| 0111 | 3 | `uspto_status_check` and `uspto_finding`; agent CHECKs gain `uspto-watcher` and `meeting-assistant` | Yes |
| 0112 | 4 | `queue_card_event` kinds `draft_to` / `drafted` (the card passes to Rayn for her draft click) | Likely; decided at the start of Sprint 4 |
| 0113 | 5 | Adobe Sign, as designed in `adobe-sign-design.md` (`adobe_sign_connection`, `client_proposal_esign_request`, the new `client_proposal_signature` columns, `client_proposal_adobe_complete`). That note calls it "0108" because it was written on its own; in sprint order it is 0113 | Yes |
| 0114 | 8 | `crm_matter_stage.target_days` and `crm_billing_access` (who besides the owner sees billing) | Yes (access table depends on T6) |

Renumbered on Nov 17 when Sprint 1 gained its migration (Taylor, Nov 17, T7). Sprints 6, 7, 9 and 10 plan no migration. If one turns out to need one, it takes the next free number at that time and this table is updated. Numbers are first-merged-wins in lectual: if another branch takes a number first, renumber in order. The Stage 2 stage names and numbers are DATA, not a migration (see `sprint-2.md`).

## Design rollout comes first

The design rollout now running restyles most dashboard pages. **UI work in Sprints 1 to 10 starts only after it has merged.** (Sprint 10's Part 1, new files with no UI, may start now.) Until then, only new files with no UI may start. Three pieces start now, as new files only (no edits to existing files, no imports from pages):

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
                       ├─ S4 (medium; 0103 already on prod) ── S5 (large; B3; Adobe Sign; 0106 prod OK pending)
                       ├─ S6 (medium; B2 now)
                       ├─ S7 (medium; best after S4 so Rayn can clear the drafts)
                       ├─ S9 (after S4 and S7, S5 for its signed/paid states; engine in src/lib/lead-step/, branch s9-engine)
                       └─ S10 (approved: editable cards and the opened card; Part 1 now, new files only;
                               Part 2 after the rollout; needs S9 Part 1's engine and S2's S2-2 for no-show)
```

## Out of scope for this plan

Client portal (parked). Practice areas other than trademark at intake. Sequence stopping on a reply (decision 6: no build). Any automatic send. Any deadline written without an attorney.
