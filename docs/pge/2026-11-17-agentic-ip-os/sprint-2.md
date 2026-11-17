# Sprint 2: Stage alignment to the SOP

**Size:** small. **Starts:** after the design rollout merges AND Caitlyn confirms the stage list. **Schema:** lectual 0108.

**BLOCKED** on Caitlyn's confirmed stage list (names, order, and who each stage waits on). Nothing in this sprint guesses a stage name.

## Goal
Lectual holds the true stage (decision 1), so its lead stages must be the firm's SOP stages, each saying who it waits on (us, the client, nobody). Consults that end in a no-show or a reschedule have a clear place, and the three missing consult outcomes can be logged.

## Scope
**In**
- Lead stages match Caitlyn's list. The firm's `crm_stage` rows are firm DATA: they are changed through Settings (or a one-off operator step the owner runs), never by a migration with content.
- Each lead stage carries `waiting_on` (`firm` | `client` | `none`). The Weekly review's "Waiting on" and the Leads list's "Our turn / Waiting on them" use it before guessing from mail (a stage's own value wins, as C1 did for matter stages).
- A No Show / Reschedule stage (exact name from Caitlyn). The existing outcomes (`no_show`, `reschedule_requested`, `rebooked_after_no_show`) can move the lead there through `moveLeadStage` on a person's click (offered, not automatic).
- Three new consult outcomes: **Proposal to send**, **Not a fit**, **Referred out**. Logged like today's (`logConsultOutcome`, one `call_logged` row, notify). "Not a fit" and "Referred out" offer a move to the firm's `lost` stage only through the person's own click (decision 8: Lost only on a clear no; these are a clear no only when the person says so). "Proposal to send" offers the move to the proposal stage.
- The Stage Keeper's default stage names (`src/lib/agents/stage-keeper/mapping.ts`, `MILESTONE_STAGE_NAMES` in `src/lib/reconcile/milestones.ts`) follow the new names through the firm brain `stage_mapping` entries, not new aliases in code, unless Caitlyn's names are the standard ones.
**Out**
- Any automatic move into `lost`, `won` or `nurture` (Stage Keeper rules stand). Any Lawmatics stage write (decision 1). Matter docket stages. Time targets (Sprint 8).

## Files likely touched
- `src/lib/pipeline/consult-outcome-labels.ts`, `src/lib/pipeline/consult-outcome.ts`, the lead page's "Log a consult outcome" form.
- `src/lib/pipeline/stages.ts`, `src/lib/pipeline/stage-order.ts` (read `waiting_on`), Settings stage editor if present.
- `src/lib/review/waiting.ts`, `src/lib/intake/views.ts` (`touchStampFor`).
- `src/lib/agents/stage-keeper/mapping.ts`, `src/lib/stage-keeper/signals.ts` (only if names change).
- `src/lib/db/types.ts` (hand-added `waiting_on` until codegen), `src/lib/ui/words.ts`.
- Tests: `tests/pipeline/`, `tests/review/`, `tests/stage-keeper/`.

## Acceptance tests
1. With Caitlyn's list loaded on a test firm, the Leads board's columns are those stages in that order (`stage-order.ts` tie rule unchanged).
2. A lead stage with `waiting_on = client` makes the Weekly review row read "Waiting on client" even when our mail was last; `firm` reads "Us"; `none` falls back to today's mail rule.
3. Before 0108 is applied, every page still renders and reads `waiting_on` as absent (42703 / PGRST204 by code), never as an error.
4. Logging "Not a fit" writes one `call_logged` row and offers "Move to Lost"; nothing moves without the click. The same for "Referred out".
5. "Proposal to send" is a choosable outcome and offers the move to the proposal stage.
6. The Stage Keeper never moves a lead into a `lost`, `won` or `nurture` stage, including the new ones (existing tests still pass; one new test per new stage).
7. Only `CAN_MOVE_STAGE` roles see the move offers; the action re-resolves the role.
8. Tests, lint, build; isolation case passes on lectual-dev.

## New schema: lectual 0108
- `alter table crm_stage add column waiting_on text null check (waiting_on in ('firm','client','none'))`. No default content.
- Grants: same as the table's existing columns (staff update only through the existing admin-tier stage policy).
- If consult outcomes turn out to be a DB enum (check `crm_discovery_outcome` and the `call_logged` payload), add the three values here. If they live only in the payload, nothing more.
- Tenant-isolation: a case that a member of firm A cannot read or update firm B's `crm_stage.waiting_on`.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Stage list with `waiting_on` | columns and waits | before 0108: waits absent, old rule used | the page's existing failure state; no board drawn as empty |
| Consult outcomes on the lead timeline | rows | (n/a) | "Couldn't load", never "no outcome" |

## MUST NEVER HAPPEN
- A send to a client. Legal advice (outcome labels are facts, not advice). A deadline written. A cross-firm read. The service role in dashboard code. A raw error shown. A module gate failing open. A stage move into `lost` / `won` / `nurture` by an assistant.

## Dependencies and blockers
- **Caitlyn's confirmed stage list** (names, order, waits-on, which stage is No Show / Reschedule). See `questions.md`.
- Design rollout merged.

## Models and evaluator
- Generator: **Opus** for the migration; **Sonnet** for library and UI. Evaluator: quality pass.
