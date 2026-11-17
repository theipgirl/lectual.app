# Sprint 3: Deadline safety, then the USPTO watcher

**Size:** medium. **Starts:** Part A after the design rollout merges; B1 (the reader) starts now. **Schema:** lectual 0109 and 0110. **Evaluator: STRICT.**

## Goal
No filed trademark slips: every filed matter has an open deadline or is flagged; deadlines 30 and 7 days out are in front of people every morning; a matter cannot be closed with an open USPTO deadline unless Rebecca overrides (decision 5). Then an assistant checks each filed matter's USPTO status every night and, when the USPTO and Lectual disagree, suggests the stage move, the deadline and a client notice for approval. **Lectual never writes a deadline itself.**

## Scope
**In: Part A, deadline safety**
1. **Filed with no open deadline.** A matter is "filed" when it is open, its type is TM, and it has a `serial_number` or `filing_date`. A filed matter with no `crm_matter_deadline` row of status `open` is flagged "No open deadline" on the matter page, the Matters list, and the Weekly review (a tag; never changes a bucket).
2. **30- and 7-day alerts.** Today gets a "Deadlines" card: open deadlines due within 7 days (first) and within 30 days, overdue on top, each labelled "Unconfirmed" when `attorney_confirmed` is false. The morning brief's deadlines section (`DEADLINE_DAYS` today is 14) shows the same two windows.
3. **Deadlines list on the Weekly review.** A strip like "Proposals out": every open deadline in the filtered rows, soonest first, confirmed / unconfirmed, linking to `?open=`.
4. **Close guard.** Setting a matter to `closed` with an open deadline of a USPTO kind is refused with a fixed sentence naming the deadline. Rebecca can override: a confirm with a required reason (max 300 characters), recorded and shown on the timeline. Enforced in the app action AND by a database trigger (0109).

**In: Part B, the USPTO watcher (decision 12)**
5. **B1 reader** (`src/lib/uspto/**`, starts now as new files): fetch one serial number's status, parse it to `{ status code, status text, status date, prosecution events (code, date), registration number, documents list metadata }`. Pure parser, injected fetch, fixtures only in tests, 15 s timeout, no body text stored beyond the parsed fields.
6. **Agent `uspto-watcher`** (rule-based, no model call for the check), in the daily agents cron (track B), on Run now, `runOneAgent` budget and caps (at most N matters a run, least recently checked first). For each filed matter: read status, store the check (0110), compare with Lectual's docket stage through ONE table `src/lib/uspto/stage-map.ts` (USPTO status → expected docket stage code), and on a mismatch write ONE finding per (matter, USPTO status date).
7. **A finding suggests, never does.** It carries: the suggested stage, the suggested deadline (kind, anchor date from the USPTO event, due date from `deadline-rules.ts` reference intervals, `calculation_basis` in words), and a draft client notice.
   - **Stage:** "Accept" moves through `updateMatterStage` as the person.
   - **Deadline:** "Add to docket" calls `createDeadline` as the person with `source = 'official_notice'`, `attorney_confirmed = false`. It stays "Unconfirmed" until an attorney uses the existing `confirmDeadline`. No path sets `attorney_confirmed` here.
   - **Notice:** a client notice draft goes to the approval queue (`ctx.createDraft`), facts only (what the USPTO recorded and when), from a template, never written by a model, no advice, no recommended action. Kind classified in `routing.ts` (Sprint 4 decides who clears it; until then it is attorney-only through `client_email_other`).
   - **Dismiss** records who and when; the same USPTO status date never raises it again.
8. Findings appear on the matter page ("USPTO says…"), as a tag on the Weekly review, and in the morning brief.

**Out**
- Any deadline row written by an agent or a cron. Any `attorney_confirmed` change outside `confirmDeadline`. Any send. Office-action content analysis or response drafting (legal content). TSDR document downloads. Non-trademark matters.

## Files likely touched
- Part A: `src/lib/matters/deadlines.ts`, `docket-summary.ts`, `matters.ts` (`updateMatterStatus`), `status.ts`, `src/app/dashboard/matters/[id]/actions.ts` and page, `src/app/dashboard/matters/page.tsx`, `src/lib/today/` (new `deadline-alerts.ts`, pure), `src/components/today/`, `src/lib/agents/morning-brief/sections.ts` and `render.ts`, `src/lib/review/load.ts`, `strips.ts`, `tags.ts`, `src/components/review/`.
- Part B: `src/lib/uspto/**` (B1), new `src/lib/agents/uspto-watcher/{run,compare,finding}.ts`, `src/lib/agents/runner.ts` / `types.ts` (register the agent, track B), `src/lib/agents/readiness.ts`, `run-now.ts`, new `src/lib/uspto/findings-store.ts` (scoped reads for pages), the matter page's findings card, `src/lib/queue/routing.ts` (classify the notice), `src/lib/ui/words.ts`, `src/lib/db/types.ts` (hand-added types).
- Tests: `tests/matters/`, `tests/today/`, `tests/uspto/`, `tests/agents/uspto-watcher/`, hygiene greps.

## Acceptance tests
1. A filed TM matter with no open deadline shows "No open deadline" on the matter page, Matters list and Weekly review; a matter with only `satisfied` / `waived` deadlines is flagged too.
2. If the deadlines read fails, no matter is flagged "No open deadline" and the page says the deadlines couldn't load.
3. Today's Deadlines card lists due-in-7 above due-in-30, overdue first, each unconfirmed one labelled; a failed read is "Couldn't load", never "No deadlines".
4. Closing a matter with an open USPTO-kind deadline returns the fixed refusal and changes nothing; the same write sent straight to the database (scoped client) is refused by the 0109 trigger.
5. The override is offered only to the override role(s) (see `questions.md`); it needs a reason; it writes one override row and one timeline entry; a paralegal posting the override form is refused.
6. **Grep test:** no file under `src/lib/agents/uspto-watcher/` or `src/lib/uspto/` inserts into `crm_matter_deadline` or names `attorney_confirmed`.
7. "Add to docket" creates a row with `source = official_notice`, `attorney_confirmed = false`, `created_by` = the person; the matter page shows it "Unconfirmed"; only `confirmDeadline` confirms it.
8. A mismatch found twice for the same USPTO status date writes one finding; a dismissed finding does not return.
9. The notice draft contains only USPTO facts and the firm's sign-off; `flagsLegalAdvice` is false on it; no model is called to write it.
10. With no USPTO key set, the agent's readiness says it isn't switched on, Run now says why, and no fetch happens. Tests never call the USPTO.
11. A USPTO read that fails or times out writes no finding for that matter and is counted; the run continues.
12. The finding store and every page read use the scoped client; the agent uses the org-fenced service role and stamps `org_id` from the matter row.
13. Tests, lint, build; isolation cases for both migrations pass on lectual-dev.

## New schema
**0109, matter close guard**
- Trigger `crm_matter_close_guard` (BEFORE UPDATE of `status` on `crm_matter`): to `closed` with any `crm_matter_deadline` of that matter with `status = 'open'` and a USPTO kind → raise `matter_close_open_deadline`, unless the update runs inside the override function below (a transaction-local setting the function sets; a client cannot set it through PostgREST).
- Function `crm_close_matter_with_override(p_matter_id, p_reason)` (SECURITY DEFINER, `search_path` pinned): checks the caller is in the matter's org and holds an override role, writes the override row, then closes the matter, in one transaction. The app's override action calls only this.
- Table `crm_matter_close_override`: `id`, `org_id`, `matter_id`, `deadline_ids uuid[]`, `reason text (1..300)`, `actor_id` (forced to `auth.uid()`), `created_at` (forced `now()`). RLS: org members read; no direct insert, update or delete for `authenticated` (only the function writes it).
- Isolation: firm A cannot read firm B's overrides or call the function on firm B's matter; a non-override role's call is refused; a direct insert is refused for everyone.

**0110, USPTO checks and findings**
- `uspto_status_check`: `org_id`, `matter_id`, `serial_number`, `status_code`, `status_text`, `status_date`, `events jsonb` (codes and dates only), `checked_at`, `outcome` (`ok` / `not_found` / `failed`). Written by the service role only (no insert/update policy for `authenticated`); members read their firm's.
- `uspto_finding`: `org_id`, `matter_id`, `check_id`, `uspto_status_date`, `kind` (`stage` / `deadline` / `notice`), `suggested jsonb`, `state` (`pending` / `accepted` / `dismissed`), `decided_by`, `decided_at`; unique on (`matter_id`, `kind`, `uspto_status_date`). Insert service role only; staff may update `state` / `decided_*` only (column grants), `decided_by` forced to `auth.uid()`.
- Extend the `agent_setting` and `agent_run` agent CHECKs with `uspto-watcher` AND `meeting-assistant` (Sprint 6's agent), so Sprint 6 needs no migration of its own. If Sprint 6 merges first, it carries this CHECK change as the next free number instead.
- Isolation: cross-firm read and write cases for both tables; a staff member cannot insert a finding or change `suggested`.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Open deadlines (Today, review, brief) | the list | (n/a) | "Couldn't load", no "No open deadline" flags |
| Close guard pre-check | allowed / refused | before 0109: app check still refuses | refuse the close ("couldn't check the deadlines") |
| USPTO status (agent) | parsed status | no key: agent not switched on | counted as failed; no finding |
| Findings (pages) | cards | before 0110: "isn't switched on for your firm yet" | "Couldn't load", never "no findings" |

## MUST NEVER HAPPEN
- A send to a client. Legal advice (the notice states facts only; no "you should respond"). **A deadline written without an attorney** (a person adds it unconfirmed; only an attorney confirms; an agent writes none). A cross-firm read. The service role in dashboard code. A raw error shown (USPTO response text included). A module gate failing open. A matter closed past the guard without a recorded override.

## Dependencies and blockers
- Design rollout merged (Part A UI). B1 starts now.
- **USPTO API key** for live runs (not for tests). Who holds it is a question for Taylor.
- Rebecca's call on which USPTO statuses map to which docket stage, and which deadline kinds count as "USPTO" for the guard (`questions.md`).
- Agents cron budget: the watcher must fit beside the others in `CRON_WALL_BUDGET_MS`.

## Models and evaluator
- Generator: **Opus** for the close guard, both migrations, the finding acceptance path and the notice wording; **Sonnet** for B1's parser, the Today card and the review strip.
- Evaluator: **strict**.
