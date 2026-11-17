# Sprint 7: Intake follow-through

**Size:** medium. **Starts:** after the design rollout merges; best after Sprint 4 (so Rayn can clear what she is allowed to). **Schema:** none planned.

## Goal
Once a proposal is out, nobody has to remember to chase it: on Day 1, 2, 4, 6 and 7 a task appears with a draft follow-up ready for approval (decision 7). When the client goes silent past the grace period, the assistant suggests Long-Term Nurture (decision 8). The duplicate check catches repeat enquirers by phone and among nurture and lost leads. The proposal email states the last day (decision 10).

## Scope
**In**
1. **Proposal follow-up schedule.** Day 0 = the firm calendar day the proposal version's link went live (`sent`). On Day 1, 2, 4, 6 and 7 (calendar days, decision 3) the morning brief agent (no new agent name, so no CHECK change) creates, for each live proposal with no acceptance:
   - one `crm_task` "Proposal follow-up · Day N" on the lead, assigned to **Amor** (Taylor, Nov 17, C4), due that day. The assignee is a member the admin tier picks in Settings (no name in code). Amor's Lectual account and role are still to be confirmed (`questions.md`, C9); until Amor is a member and picked, the task goes to the lead's assignee, else unassigned, and the brief says so;
   - one queue draft (a follow-up email; Day 7 says it is the last day). Wording from a firm-approved template per day (`questions.md`), never written freehand by a model; the link is the proposal's own (`clientLinkOrigin`).
   - Created on the day, never ahead. Keyed `<proposal family>:<version>:day<N>` on a `queue_drafted` activity marker, so a rerun or Run now never makes a second one.
2. **Stops.** No further day is created when the proposal is accepted, withdrawn, replaced, deleted, or expired past Day 7; when the client has replied since Day 0 (inbound mail on the lead, `email_received`, firm-sent cc excluded by `firm-sender.ts`); when the lead is merged (follow the keeper) or out of an open stage; or when a thread is sensitive. Open tasks already made are left for a person.
3. **Approval kind.** The drafts carry the proposal link, so they classify as `post_consult_email` (attorney-only) unless Rebecca says Rayn may clear them (`questions.md`); if she does, a `proposal_followup` kind is added in `routing.ts` with an explicit marker (Sprint 4's rule) and the legal-advice override still applies.
4. **The morning brief's stalled-lead follow-up** skips a lead that has a live proposal on this schedule (one chase at a time).
5. **Long-Term Nurture suggestion.** A lead whose newest proposal expired (valid 7 days) and stayed silent through the grace period (about two weeks; exact number from `questions.md`, held in one constant) with no clear no gets a suggestion card "Move to Long-Term Nurture" (the Stage Keeper's suggestion pattern: `ai_insight`, `signal_key`, Accept through `moveLeadStage`, Dismiss). Never moved automatically. Lost is never suggested from silence (decision 8).
6. **Duplicates.** `src/lib/intake/duplicates.ts` also matches the same phone number (digits only, last 10, at least 10 digits; extensions and short numbers ignored) and also looks at nurture and lost leads (a compact `live(...)` read of id, names, email, phone for those stages, paged). The marker says what matched and where: "Possible duplicate · same phone · Lost lead".
7. **Proposal email states the last day.** `renderProposalEmail` and `renderGeneralProposalEmail` gain a `{last_day}` slot: the proposal's `expires_on` in the firm's zone ("Friday, November 20"). The fee total is not in the email (decision 10); a test pins that no money figure appears in the rendered body. The firm's saved template gets the slot only if Rebecca approves the sentence (`questions.md`); the default template carries it.

**Out**
- Sequence stopping on reply (decision 6: no build). Any send. Lost moves by an assistant. Lawmatics thank-you / nurture emails (decision 14: they are the firm's approved Lawmatics emails; nothing to build). Manual lead entry (decision 9: already in Lectual).

## Files likely touched
- New `src/lib/proposals/follow-up-schedule.ts` (pure: which day, which stop applies), `src/lib/agents/morning-brief/{run,rules,follow-ups,sections,render}.ts`, `src/lib/matters/tasks.ts` (an org-fenced insert path for the agent, or a shared builder), `src/lib/queue/routing.ts` (only if item 3 is answered yes).
- New `src/lib/intake/nurture-suggestion.ts` (pure), the Stage Keeper suggestion readers in `src/lib/stage-keeper/` and the lead page cards.
- `src/lib/intake/duplicates.ts`, `src/lib/intake/compare-load.ts`, a new compact nurture/lost read beside `src/lib/intake/lost.ts`.
- `src/lib/consult-proposal/email.ts`, `manual-email.ts`, the general email renderer.
- `src/lib/ui/words.ts`. Tests under `tests/proposals/`, `tests/agents/morning-brief/`, `tests/intake/`, `tests/consult-proposal/`.

## Acceptance tests
1. A proposal live on Monday Nov 2 (firm zone) gets tasks and drafts on Nov 3, 4, 6, 8 and 9, and none on other days; two runs on one day make one of each.
2. Acceptance on Day 3 means no Day 4, 6 or 7; a client reply on Day 2 means no Day 4 onward; an expired-and-replaced version stops the old schedule.
3. A failed read of inbound mail or of the proposal's status makes NO draft that day (fail closed) and says so in the brief.
4. The follow-up drafts contain no fee figure and no legal-advice phrase; they are queue drafts only.
5. The stalled-lead follow-up never drafts for a lead on this schedule.
6. Nurture suggestion appears only after expiry + grace with no inbound mail and no acceptance; Accept moves through `moveLeadStage` as the person; Dismiss never returns for the same proposal.
7. Duplicates: same phone in two formats matches; a 7-digit number never matches; a Lost lead with the same email is shown with "Lost lead"; merged leads never match.
8. A failed nurture/lost read shows open-lead duplicates as today and a note that older leads weren't checked; never "no duplicates".
9. The rendered proposal email includes the last day in the firm's zone and no dollar amount.
10. Tests, lint, build.

## New schema
None planned. Markers are `crm_activity` rows; tasks use `crm_task`. If the agent cannot insert `crm_task` org-fenced without a new grant, stop and add the next free migration number.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Live proposals and their events | schedule built | Proposals feature off: section not shown | no follow-ups that day; brief says why |
| Inbound mail since Day 0 | stop or continue | Mailboxes off: schedule continues, brief notes replies can't be seen | no draft that day |
| Nurture/lost leads for duplicates | matched | (n/a) | note "older leads weren't checked" |

## MUST NEVER HAPPEN
- A send to a client. Legal advice in a follow-up. A deadline written. A cross-firm read. The service role in dashboard code. A raw error shown. A module gate failing open. A lead moved to Lost or Nurture by an assistant. A follow-up drafted after a client replied or accepted.

## Dependencies and blockers
- Sprint 4 (who clears the drafts; Rayn's Outlook).
- Rebecca: the five follow-up texts, the last-day sentence, whether Rayn may clear proposal follow-ups. Caitlyn: Amor's account and role (C9), the exact grace period (C5) (`questions.md`). Sprint 2's `on_hold` stage (Undecided / Questions) is skipped by this schedule.

## Models and evaluator
- Generator: **Opus** for email wording and the routing change; **Sonnet** for the schedule, duplicates and UI.
- Evaluator: quality pass.
