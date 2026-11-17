# Sprint 8: Time targets per stage, the "over time" list, and the billing view

**Size:** medium. **Starts:** after Sprint 2 (stages and who they wait on) and the design rollout. **Schema:** lectual 0114.

## Goal
Every stage has a time target in calendar days (decision 3). Anything over its target is on ONE "over time" list, and the assistant has already made the follow-up task and drafted the nudge, so a person only approves. Dawn gets a billing view: invoices and an unpaid list from the firm's Lawmatics, where "paid in Lawmatics" counts as cleared (decision 4).

## Scope
**In: time targets**
1. **Targets.** Lead stages use `crm_stage.aging_threshold_days` (exists). Matter docket stages get `crm_matter_stage.target_days` (0114); when null, the existing `STALE_THRESHOLD_DAYS` by `waiting_on` stays the fallback (`src/lib/matters/stage-rules.ts`). Caitlyn's numbers are entered in Settings by the admin tier; nothing is seeded by a migration.
2. **Days in stage** = calendar days on the firm's calendar from `stage_entered_at` (the existing `stageAgeDisplay` rules: an import stamp with no later move is "in stage since import" and is NOT counted as over time).
3. **One "over time" list**: a Weekly review strip and filter (`?over=1`), and one count on Today. Each row: record, stage, days / target, who it waits on (Sprint 2 / docket `waiting_on`), the next step. One list for leads and matters; the same rule (`src/lib/review/over-time.ts`, pure) feeds every place.
4. **The assistant acts** (the morning brief agent; no new agent name): for each record newly over time, at most once per stage entry (keyed `<record>:<stage>:<stage_entered_at>`):
   - if no open task exists, create one ("Over time in <stage>"), assignee = the record's assignee, due today;
   - if the stage waits on the CLIENT, draft a nudge email to the queue (template per stage, from `questions.md`; kind `client_reminder` / `client_request` so Rayn can clear it, Sprint 4); if it waits on us, the USPTO or a court, no email, the task only.
   - Capped per run; sensitive threads, merged leads, `won` / `lost` / `nurture` stages and closed matters skipped.

**In: billing view (decision 4)**
5. `/dashboard/billing/`: every invoice of the firm from Lawmatics (`/invoices`, swept with `listAll`, one shared deadline), matched to Lectual matters by the invoice's own prospect relationship = `crm_matter.lawmatics_id` (the existing matter card's rule: never trust the filter). Columns: client, matter, number, issued, due, total, paid, balance, status. An "Unpaid" tab: not void, not draft, balance > 0, oldest due first; an invoice paid in Lawmatics is cleared. Totals row. "Open in Lawmatics" link only for an https URL Lawmatics gave.
6. **Access.** Owner, plus the members on the firm's billing access list (0114), managed by the admin tier in Settings → Team. `canSeeBilling` becomes a check of role OR list membership; the page and every action re-check; others get `notFound()`. The matter page's Billing card follows the same rule. Taylor is getting Dawn access (Taylor, Nov 17, T6); her role is still open, so the list stays the default and Dawn is added to it once she is a member.

**Out**
- Writing to Lawmatics (no invoice created, edited or marked paid). LawPay changes. Money arithmetic beyond summing cents for the totals row. Any send. Automatic stage moves on over-time.

## Files likely touched
- `src/lib/matters/stage-rules.ts`, `stages.ts`, `src/lib/lifecycle/stage-age.ts`, new `src/lib/review/over-time.ts`, `src/lib/review/load.ts`, `strips.ts`, `params.ts`, `src/components/review/`, `src/lib/today/`, `src/components/today/`.
- `src/lib/agents/morning-brief/{run,rules,follow-ups,render}.ts`, `src/lib/matters/tasks.ts`.
- Settings: the stage editors (lead and docket), `src/app/dashboard/settings/team/`.
- Billing: `src/lib/billing/{can-see,load,invoices}.ts`, new `src/lib/billing/firm-invoices.ts`, `src/app/dashboard/billing/page.tsx`, `src/components/billing/`, `src/lib/nav.ts` (a rail row only for those who may see it; the page still gates itself).
- `src/lib/ui/words.ts`, `src/lib/db/types.ts`. Tests: `tests/review/over-time.test.ts`, `tests/agents/morning-brief/`, `tests/billing/`.

## Acceptance tests
1. A lead 11 calendar days in a stage with target 10 is over time; 10 days is not. Weekends count.
2. A matter stage with no `target_days` uses the `waiting_on` fallback; with one, its own number.
3. An imported record with no later move is never over time.
4. The over-time strip, the filter and Today's count agree on every fixture (one rule).
5. The assistant creates one task and (client-waiting only) one draft per stage entry; a rerun creates nothing; a record that leaves and re-enters the stage can be nudged again.
6. A failed task or activity read makes no task or draft for that record and the brief says so.
7. Billing: an invoice whose own prospect id differs from the matter's is not shown on that matter; void and draft invoices are left out of Unpaid and totals; an invoice paid in Lawmatics never appears in Unpaid.
8. A failed or cut-short Lawmatics read says so ("Couldn't load invoices" / "Showing the first N"), never an empty Unpaid list and never "all paid".
9. A member not on the list (and not owner) gets `notFound()` on the page and nothing from the action; the rail row is not drawn for them.
10. No Lawmatics write call exists in the billing files (grep).
11. Tests never call Lawmatics. Tests, lint, build; isolation case on lectual-dev.

## New schema: lectual 0114
- `alter table crm_matter_stage add column target_days integer null check (target_days between 1 and 3650)`.
- `crm_billing_access`: `org_id`, `user_id`, `granted_by` (forced `auth.uid()`), `created_at`; unique (`org_id`, `user_id`); RLS: members read their firm's; insert/delete admin tier only, `user_id` must be a member of the same org.
- Isolation: firm A cannot read or write firm B's `target_days` or access rows; a non-admin cannot grant access.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Targets | numbers | before 0114: matter targets fall back to `waiting_on` | no over-time marks; note says targets couldn't load |
| Over-time list | rows | (n/a) | "Can't show this right now", never "Nothing over time" |
| Lawmatics invoices | rows / totals | not connected: "Connect Lawmatics" | "Couldn't load invoices"; cut-short says so |
| Billing access list | gate decided | before 0114: owner only | owner only; others `notFound()` |

## MUST NEVER HAPPEN
- A send to a client. Legal advice in a nudge. A deadline written. A cross-firm read (invoices matched only to this firm's matters). The service role in dashboard code. A raw error shown (Lawmatics text included). A module gate failing open (billing fails closed to owner-only). A stage moved because it is over time. A Lawmatics write.

## Dependencies and blockers
- **Sprint 2** (stage list and `waiting_on`). Caitlyn's target days per stage. Rebecca's nudge texts. Taylor on Dawn's access model and role (`questions.md`). Sprint 4 for who clears the nudges.

## Models and evaluator
- Generator: **Opus** for the billing gate, the migration and nudge wording; **Sonnet** for the over-time rule, lists and the billing page.
- Evaluator: quality pass (strict on the billing gate's access tests).
