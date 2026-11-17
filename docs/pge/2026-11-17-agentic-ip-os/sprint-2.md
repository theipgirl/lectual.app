# Sprint 2: Stage alignment to the SOP

**Size:** small. **Starts:** after the design rollout merges. **Schema:** lectual 0109 (one column). **Stage names and numbers are DATA**, changed through a reviewed plan file and a dry run, never hard-coded and never in a migration.

Source: Caitlyn's SOP (Taylor, Nov 17: "it's in the SOP"; v0.4 for pre-filing) and the Nov 12 call. **Where the SOP contradicts itself, or the live board and the SOP disagree, the item is a named question (`questions.md`, S2-*) and this sprint ships the unambiguous part first.**

## Goal
Lectual holds the true stage (decision 1), so its stages must be the SOP's, each saying who it waits on. This sprint makes the INTAKE stages exactly the eight settled on Nov 12, adds "who it waits on" to lead stages, adds the three missing consult outcomes, and records the pre- and post-filing differences as a reviewed plan, applying only what is unambiguous.

## What the SOP settles, and what it doesn't

### Intake (settled on the Nov 12 call): ships in this sprint
| # | Stage | Note |
|---|---|---|
| 1 | Potential New Client | the new-enquiry stage (`NEW_ENQUIRY_STAGE_NAMES` already matches) |
| 2 | Preliminary Search | |
| 3 | Consultation Scheduled | a rescheduled consult STAYS here |
| 4 | Post Consultation Email Sent | |
| 5 | Undecided / Questions | on hold: not in a sequence, not chased (below) |
| 6 | LOE & Invoice Sent | |
| 7 | Signed LOE / Deposit Received | |
| 8 | Long-Term Nurture | its own column, reachable only from lead stages; already live |

Who each stage waits on comes from the SOP's text, written into the plan file and shown in the dry run. A stage the SOP does not state is `none` and is listed in the dry run for Caitlyn to confirm; it is never guessed.

**Open (intake), not changed until answered:**
- **S2-1** "Follow-Up" is a live unnumbered column holding 31 leads: keep it, or fold it into 1 (Potential New Client)? Until answered it stays exactly as it is.
- **S2-2** No Show / Reschedule: a stage or a mark? Until answered: a mark only, i.e. the existing consult outcomes (`no_show`, `reschedule_requested`, `rebooked_after_no_show`); a rescheduled consult stays in Consultation Scheduled as the Nov 12 call says. No new stage. (Replaces C2.)
- **S2-3** The Intake board still has thirteen old columns copied from the matter list, holding zero leads. They are removed from Intake only once Taylor says yes, through the plan file. **A stage that holds a lead is never deleted** (checked at dry run AND again at apply).

### Pre-filing (matter docket stages), live today
8 Questionnaire Complete, 9 Comprehensive Search, 10 Preparing Opinion Letter, 11 Opinion Letter Sent, 12 Application Preparation, 13 Consent to File Application, 14 Application Ready for Filing, 15 Send Invoice for Remaining Balance, 16 Full Balance Received.
- SOP v0.4 merges 9 and 10 into one stage and numbers pre-filing 8 to 16; Caitlyn said "9 to 17 or whatever the counts are" on Nov 12.
- **Open, nothing changes in this sprint:** **S2-4** the numbers; **S2-5** the merged stage's name; **S2-6** which stage waits for the balance. The plan file lists the live stages as they are, so the dry run shows "no change" for pre-filing.

### Post-filing (matter docket stages), live today
17 Application Filed, 18 Awaiting Trademark Registration, 19A–19I, 20A–20E, 21A–21E, 22 Publication for Opposition, 23 Trademark Abandoned, 24 Trademark Registered, 25 Lost/Nurture, 26 No Longer Moving Forward.
- The SOP adds 27 Maintenance and keeps 23 open during the revival window.
- The SOP's table calls 19D "Payment for OA Response Sent" while its text describes the invoice-sent stage (live name "Invoice for OA Response Sent", waiting on the client).
- **Open, nothing changes in this sprint:** **S2-7** keep 17 separate; **S2-8** add 27 Maintenance; **S2-9** the exact 19D / 19H / 19I names; **S2-10** an "SOU Filed" stage; **S2-11** whether 23 stays `is_open` during the revival window. Live names stay; the 19D live name ("Invoice for OA Response Sent", waiting on client) stands until answered.

## Scope
**In**
1. **The plan file and dry run** (the data-change pattern). This repo has no stage-alignment script yet, and the "tracker alignment" plan file was not found here; the nearest patterns are the Lawmatics import (`src/app/dashboard/settings/integrations/lawmatics/actions.ts`: everything is a dry run unless an explicit confirm carries a matching fingerprint and a ticked acknowledgement), Reconcile's fingerprinted plan (`src/lib/reconcile/fingerprint.ts`, `plan.ts`) and the tracker import (pure parse layer `src/lib/matters/tracker-import.ts`, writer in lectual's `scripts/import-tracker.ts`). Follow them:
   - `docs/rpb/stage-plan.json` (data, reviewed in a PR): for each lead stage and docket stage, the target name, order, category, `waiting_on`, and an action (`keep` / `rename` / `reorder` / `remove`). Names live ONLY here and in the database.
   - `src/lib/pipeline/stage-plan.ts` (pure): reads the plan and the live stages, returns the diff, the refusals (a `remove` on a stage holding a lead or matter; a `remove` of a `won` / `lost` / `nurture` stage; an unknown stage; a duplicate name) and a SHA-256 fingerprint of the diff.
   - `scripts/align-stages.mts` (operator-run, never a page): **dry run by default** (prints the diff, the counts per stage, the refusals and the fingerprint; writes nothing). `--apply --org <id> --fingerprint <sha>` re-reads the live stages and counts, recomputes, refuses on any difference or refusal, then applies in one transaction per firm. lectual-dev first; **production only after Taylor has reviewed the dry run.** The script is the only service-role user, stamps `org_id` from the stage rows, and logs counts only.
   - Renames keep the row id, so leads, matters, history and `stage_entered_at` are untouched.
2. **`waiting_on` on lead stages** (0109). The Weekly review's "Waiting on" and the Leads list's "Our turn / Waiting on them" use a lead stage's own value before guessing from mail (as C1 did for docket stages). `on_hold` (Undecided / Questions) means nobody chases: the morning brief's stalled-lead follow-up, Sprint 7's follow-ups and campaign enrolment skip a lead in an `on_hold` stage.
3. **Three new consult outcomes:** **Proposal to send**, **Not a fit**, **Referred out**, logged like today's (`logConsultOutcome`: one `call_logged` row, notify). "Proposal to send" offers the move to Post Consultation Email Sent; "Not a fit" and "Referred out" offer the move to the firm's `lost` stage. Every move is the person's own click through `moveLeadStage` (decision 8: Lost only on a clear no, said by a person).
4. **Stage Keeper** names: the defaults in `src/lib/agents/stage-keeper/mapping.ts` already include the SOP's names (Consultation Scheduled, Post Consultation Email Sent, LOE & Invoice Sent, Signed LOE / Deposit Received). Preliminary Search and Undecided / Questions get NO Stage Keeper signal (a person moves leads there). No new aliases in code.

**Out**
- Every open item above (S2-1 to S2-11). Matter docket changes of any kind. Any automatic move into `lost`, `won` or `nurture`. Any Lawmatics stage write (decision 1). Time targets (Sprint 8).

## Files likely touched
- New: `docs/rpb/stage-plan.json`, `src/lib/pipeline/stage-plan.ts`, `scripts/align-stages.mts`.
- `src/lib/pipeline/consult-outcome-labels.ts`, `consult-outcome.ts`, the lead page's "Log a consult outcome" form.
- `src/lib/pipeline/stages.ts`, `stage-order.ts` (read `waiting_on`), `src/lib/review/waiting.ts`, `src/lib/intake/views.ts` (`touchStampFor`).
- `src/lib/agents/morning-brief/rules.ts`, `src/lib/campaigns/` enrolment (skip `on_hold`).
- `src/lib/db/types.ts` (hand-added `waiting_on` until codegen), `src/lib/ui/words.ts`.
- Tests: `tests/pipeline/stage-plan.test.ts`, `tests/pipeline/consult-outcome.test.ts`, `tests/review/waiting.test.ts`, `tests/stage-keeper/`.

## Acceptance tests
1. The dry run writes nothing (spied client: no insert, update or delete) and prints the diff, per-stage counts, refusals and the fingerprint.
2. `--apply` with a wrong or stale fingerprint, or a live state that changed since the dry run, writes nothing.
3. A plan that removes a stage holding one lead or one matter is refused at dry run and at apply; so is removing any `won` / `lost` / `nurture` stage.
4. A rename keeps the stage id; leads in it keep `stage_entered_at`; running the same plan twice is a no-op.
5. After apply on a test firm, the Leads board shows the eight intake stages in order 1 to 8 with Long-Term Nurture last; "Follow-Up" is unchanged while S2-1 is open; the thirteen old columns remain until Taylor's yes is in the plan.
6. **Grep test:** no SOP stage name added by this sprint appears in `src/` outside the existing alias tables; the plan file is the only new place.
7. A lead stage with `waiting_on = client` makes the Weekly review read "Waiting on client" even when our mail was last; `firm` reads "Us"; `none` falls back to today's mail rule; `on_hold` reads "On hold" and is skipped by the stalled-lead follow-up and campaign enrolment.
8. Before 0109 is applied, every page renders and reads `waiting_on` as absent (42703 / PGRST204, by code), never as an error.
9. "Not a fit" writes one `call_logged` row and OFFERS "Move to Lost"; nothing moves without the click. Same for "Referred out". "Proposal to send" offers the move to Post Consultation Email Sent.
10. The Stage Keeper never moves a lead into `lost`, `won` or `nurture`, or into Preliminary Search or Undecided / Questions.
11. Only `CAN_MOVE_STAGE` roles see the move offers; the action re-resolves the role.
12. Tests, lint, build; 0109's isolation case passes on lectual-dev.

## New schema: lectual 0109
- `alter table crm_stage add column waiting_on text null check (waiting_on in ('firm','client','none','on_hold'))`. No content, no default values written.
- Grants follow the table's existing columns (staff update only through the existing admin-tier stage policy).
- If the consult outcomes turn out to be a DB enum (check `crm_discovery_outcome` and the `call_logged` payload), the three values are added here; if they live only in the payload, nothing more.
- Tenant-isolation: a member of firm A cannot read or update firm B's `crm_stage.waiting_on`.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Stage list with `waiting_on` | columns and waits | before 0109: waits absent, old rule used | the page's existing failure state; never an empty board |
| Per-stage counts (dry run and apply) | counts | (n/a) | the script stops and writes nothing |
| Consult outcomes on the timeline | rows | (n/a) | "Couldn't load", never "no outcome" |

## MUST NEVER HAPPEN
- A send to a client. Legal advice (outcome labels are facts). A deadline written. A cross-firm read or write (the script works one org at a time, org from the rows). The service role in dashboard code (only the operator script uses it). A raw error shown. A module gate failing open. A stage holding a lead or matter deleted. A stage name hard-coded in app code. A production data change Taylor has not reviewed. A move into `lost` / `won` / `nurture` by an assistant.

## Dependencies and blockers
- Design rollout merged (the outcome form and board).
- The SOP text for `waiting_on` per intake stage (director holds it; Caitlyn confirms).
- Taylor's review of the dry run before production; Taylor's yes for S2-3.
- Pre- and post-filing changes wait on S2-4 to S2-11 (a later plan file, same script).

## Models and evaluator
- Generator: **Opus** for 0109, the plan/diff/fingerprint rules and the apply script; **Sonnet** for the outcome form, waits and UI.
- Evaluator: quality pass, strict on the script's refusals (no deletion of a stage in use, no apply without the reviewed fingerprint).
