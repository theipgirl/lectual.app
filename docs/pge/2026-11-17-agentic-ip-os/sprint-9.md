# Sprint 9: the lead page where Lectual does the step

> **AWAITING TAYLOR'S "BUILD IT". NOT APPROVED.** This is a contract for review only. No code starts until Taylor says "build it" (`questions.md`, T10).

**Size:** large. **Starts:** only after "build it", the design rollout, Sprint 4 and Sprint 7 (Sprint 5 for the signed / paid states). **Schema:** none planned. **Evaluator:** quality pass; **STRICT** for the approval and permission parts (the top card's Yes, Edit and Not this, the outcome-from-recording yes, every Undo).

## Goal
One page for ONE lead where Lectual has already done the next step and the person only says yes. Taylor's verdict on the first mockup: it was "still implementing manual steps". The revised page (mockup: `artifact-0795a141-…-ec7c.html`, six states: new enquiry, consult booked, consult happened, proposal out day 2 of 7, accepted not paid, a person-only overdue step) puts the finished work at the top:

- **The top card is exactly one of two things.**
  - **"Needs your yes"**: Lectual has already drafted the reply, the follow-up, the proposal or the payment nudge, and shows it INLINE (To, Subject, body; or the proposal summary) with **Yes / Edit / Not this**. After Yes, the card says: "The draft is in Rayn's Outlook. Nothing is sent until Rayn presses Send." Yes is a 5-second hold with Undo (the deck's rule); nothing is posted until it ends.
  - **"Lectual has it"**: nothing needs the person. It says what it is waiting for ("Waiting for Thursday's consult") and what it will do next and when ("On Thu Nov 19, after the consult ends, Lectual reads the recording and drafts the proposal, then asks for your yes.").
- **Below it: "What Lectual did"**, newest first, with Undo where the app can undo it. It replaces the stage-suggestion cards.
- **After a consult**, Lectual reads the recording and says "Reads as: proposal to send", with its reasons (each a short quote-backed line), and shows the draft proposal for a yes. The manual outcomes become a fallback: "It went differently" → Not a fit / Referred out / No-show.
- **A person-only step** (a call, for example) shows prepared talking points with **Mark done / Snooze / "Or have Lectual draft an email instead"**. Talking points never answer a legal question: the mockup's rule stands, "Note it as a question for the attorney; do not answer it yourself."
- **The rest stays:** the four facts (Last contact, Consult, Proposal, Waiting on), the composer, the timeline, the one-line sections (consult, proposal, answers, files, sequence, source), and the side column (a collapsed "Details and tags" on phones).
- A viewer who cannot approve (the mockup's "Someone who cannot") sees the same card read-only, with who it is waiting on, and no Yes / Edit / Not this.

## What already exists to reuse
| Need | Existing code |
|---|---|
| Reply to a new enquiry | Intake triage (`src/lib/agents/intake-triage.ts`) scores and summarises; the first-reply draft path is the morning brief / email-intel queue drafting (`src/lib/agents/email-intel.ts`, `ctx.createDraft`) |
| Consult prep sheet and client prep email | `src/lib/agents/consult-prep/{run,facts}.ts`, `src/lib/prep-consult/{generate,drafts,prep-consult}.ts` |
| Proposal from a consult | Post-consult drafter (`src/lib/agents/post-consult.ts`) and `runConsultProposal` (`src/lib/consult-proposal/run.ts`, `draft.ts`, `manual-email.ts`); the builder `buildDraftContent` (`src/lib/proposals/draft-spec.ts`) |
| Follow-ups | Morning brief stalled follow-ups (`src/lib/agents/morning-brief/follow-ups.ts`, `planFollowUps`); Sprint 7's Day 1/2/4/6/7 schedule |
| Stage moves and Undo | The Stage Keeper (`src/lib/agents/stage-keeper/{run,target}.ts`), its moves and suggestions (`src/lib/stage-keeper/moves.ts`: `parseAgentMove`, `AGENT_ACTOR`, `SUGGESTION_SOURCE`), the lead page's Undo / Accept / Dismiss (`src/app/dashboard/leads/[id]/stage-keeper-actions.ts`, `src/components/leads/StageKeeperControls.tsx`) |
| Who may approve, and approving | `src/lib/queue/routing.ts` (`classifyQueueItem`, `canApproveItem`, `flagsLegalAdvice`), `src/lib/queue/review-core.ts`, the deck's actions (`src/app/dashboard/queue/deck/` `approveCardAction`, `rejectCardAction`), the 5-second hold, the queue's pending-by-lead read (`src/lib/intake/pending-approvals.ts`, `src/lib/queue/lead-pending.ts`, `resolve-batch.ts`) |
| Lead page today | `src/app/dashboard/leads/[id]/page.tsx`; `NeedsAttentionCard` (`src/components/leads/NeedsAttentionCard.tsx`, rule `src/lib/leads/needs-attention.ts`), `LeadStatusRow` (`src/lib/leads/status-row.ts`), `ComposerTabs`, `Timeline` (`src/components/timeline/Timeline.tsx`), `ConsultDetailsSection`, `LeadProposalsCard`, `SequencesCard`, `ConsultOutcomeForm` (`src/lib/pipeline/consult-outcome.ts`), `CollapsibleAside` |
| Proposal facts | Opens (`listProposalOpens` in `src/lib/proposals/store.ts`, `src/lib/proposals/opens.ts`), paid (`paidStateFromEvents` in `src/lib/proposals/paid.ts`, `paid-view.ts`), signed (`isSignedSnapshot`, `src/lib/loe/signed-card.ts`), expiry (`src/lib/review/proposal-expiry.ts`) |
| Meetings | `src/lib/meetings/read.ts`, `follow-up.ts` (the existing "Draft follow-up") |

## What is missing (this sprint builds it, or depends on it)
1. **Reading a consult recording into an outcome with reasons.** New `src/lib/consult/outcome-read.ts` (pure, model call injected, Sonnet tier): from the consult meeting's transcript, `{ outcome: proposal_to_send | not_a_fit | referred_out | unclear, reasons: [{ text, quote }] }`. A reason is kept only when its quote is really in the transcript (the consult-details `sourceText` rule); no kept reason = `unclear` (the card then shows the manual outcomes, not a guess). Stored as an `ai_insight` row on the lead (`source: "consult-outcome-read"`). It is a SUGGESTION: the outcome is logged, and any stage move made, only on the person's Yes, through `logConsultOutcome` and `moveLeadStage`. The proposal shown with it is `runConsultProposal`'s draft (no client link until Yes).
2. **"What Lectual will do next, and when"** (the scheduler view). New `src/lib/leads/next-actions.ts` (pure): from the facts already read (booked consult end time, Sprint 7's follow-up schedule, proposal expiry, paid / signed state, the agents' run hours from `vercel.json` / `ny-hour.ts`), the next assistant action and its time, e.g. "Tomorrow, about 5:30 AM: drafts the day-4 follow-up". It states only what a real scheduled job will do; an action whose job is off (agent setting off, feature off) is not promised. One rule shared by the card and the tests.
3. **Undo coverage per action.** New `src/lib/leads/undo-map.ts` (pure): for each "What Lectual did" row type, whether it can be undone and how, using only existing undo paths: Stage Keeper move → its Undo; a queue draft still pending → reject with a note (the draft is withdrawn); a Yes within 5 seconds → the hold's Undo. Everything else (a filed email, a prep sheet, an approved draft after the hold, a link turned on) shows no Undo. No new "undo" write is invented.
4. **Inline edit of a queue draft on the lead page.** Edit uses the queue's existing save-edit path (`QUEUE_EDIT_ROLES`), then Yes approves the edited text through `review-core.ts`; the approve re-reads the item and re-classifies it (an edit can make it attorney-only).
5. **The Rayn Outlook handoff:** Sprint 4 (the "draft is in Rayn's Outlook" line is only drawn when Sprint 4's hand-off or own-mailbox draft really happened; otherwise the card says exactly what did happen).
6. **The Day 1/2/4/6/7 follow-ups:** Sprint 7.
7. **Person-only step with talking points.** New `src/lib/leads/talking-points.ts`: up to 3 points built from the lead's own record (the open task, the consult details, filed emails' subjects), written by a model with `AGENT_POLICY` and the rule "a legal question is noted as a question for the attorney, never answered"; each point passes `flagsLegalAdvice` or is dropped. Mark done = `completeTask`; Snooze = the review's `snoozeNextStepAction` rule; "Or have Lectual draft an email instead" queues a draft (normal routing), never sends.

## Dependencies
- **Taylor's "build it" (T10).** The design rollout merged.
- **Sprint 4** (who may approve each kind; the draft passing to Rayn). Without it the top card cannot honestly say where the draft went.
- **Sprint 7** (the follow-up schedule the "Lectual has it" card describes).
- **Sprint 5 and Adobe Sign** for the "accepted, signed, not paid" and signed/paid states; until then those states show the in-app signature and paid facts as today.
- **Sprint 2** for "Proposal to send / Not a fit / Referred out" as outcomes.
- AI configured on the deployment (the outcome read and talking points); without it the card falls back to today's manual outcome form.

## Scope
**In:** the top card (both kinds), "What Lectual did" with Undo per the map, the outcome-from-recording read and its yes, inline edit, the person-only step, the four facts, layout changes on `/dashboard/leads/<id>/` at desktop and 375px.
**Out:** any send; any new agent name (the outcome read runs on the post-consult drafter's schedule and on page open "Read the recording" by a person); matter pages; the client portal; any change to who may approve.

## Files likely touched
- `src/app/dashboard/leads/[id]/page.tsx`, `actions.ts`, `outcome-actions.ts`, `proposal-actions.ts`, `stage-keeper-actions.ts`.
- New `src/components/leads/{TopCard,NeedsYourYes,LectualHasIt,WhatLectualDid,OutcomeRead,PersonStep}.tsx`; changed `NeedsAttentionCard.tsx` (replaced by the top card), `LeadStatusRow.tsx` (the four facts), `StageKeeperControls.tsx` (folded into "What Lectual did").
- New `src/lib/leads/{top-card,next-actions,undo-map,talking-points}.ts`, `src/lib/consult/outcome-read.ts`.
- `src/lib/queue/review-core.ts` (called, not changed), `src/lib/ui/words.ts`, `lead-page.css`.
- Tests: `tests/leads/top-card.test.ts`, `next-actions.test.ts`, `undo-map.test.ts`, `outcome-read.test.ts`, `talking-points.test.ts`, page render tests for the six mockup states.

## Acceptance tests
1. **One card.** For each of the six mockup states (fixtures), exactly one top card renders, of the right kind; never both, never neither (a failed read renders the "couldn't check" card, below).
2. **Yes posts nothing for 5 seconds**; Undo in that window posts nothing at all. After the hold, the approve goes through `review-core.ts` with every existing check; a refusal shows its fixed sentence and the card stays.
3. **Who may say yes** is `canApproveItem` for the item as re-read on the server: a law clerk sees no Yes on a `post_consult_email`; a viewer sees the card read-only; Lectual staff acting as a firm are refused (`staffPreviewRefusal`). Pinned for all 10 roles × the kinds the card can show.
4. **After Yes** the card's sentence names only what really happened: "in Rayn's Outlook" only when Sprint 4's hand-off or own-mailbox draft returned success; otherwise the true state ("Approved. The draft goes to Rayn when she makes it.").
5. **Edit** saves through the queue's save-edit path; an edit that adds advice text makes the item attorney-only and removes Yes for a non-approver.
6. **Not this** rejects with a required note and never sends; the lead's next card is recomputed.
7. **Outcome read:** a reason whose quote isn't in the transcript is dropped; none left → `unclear` and the manual outcomes show. The outcome is logged and any stage move made only on Yes, through `logConsultOutcome` / `moveLeadStage` (`CAN_MOVE_STAGE`). No `lost` move without the person choosing "Not a fit" or "Referred out" and confirming.
8. **"Lectual has it"** promises only actions whose job is on: with the agent setting off, the feature off or AI not configured, no future action is promised, and the card says what a person needs to do instead.
9. **Undo** appears only for row types in the undo map, and each Undo calls the existing path (Stage Keeper undo, reject, the hold's Undo). Grep: no new update of an approved queue item.
10. **Talking points**: every point passes `flagsLegalAdvice`; a client's legal question appears as "Question for the attorney: …", never answered; at most 3 points; "draft an email instead" queues a draft only.
11. **Three states** per card (table below): a failed read never shows "Lectual has it" or "nothing needs you".
12. **Merged leads**: the page reads the keeper and its merged set as today; drafts and moves land on the keeper.
13. No send call (the send grep passes); no deadline write; no service role in the page or its actions; no raw error text; tests, lint, build; the page at 375px has no sideways scroll.

## Reads with three states
| Card / read | ok | not set up | couldn't be read |
|---|---|---|---|
| Top card: pending approvals for the lead | "Needs your yes" with the draft | queue unconfigured: "Lectual has it" is NOT shown; card says approvals aren't connected | "Can't show what needs you right now." No "Lectual has it" |
| Top card: next scheduled action | "Lectual has it" with what and when | the job is off: no promise; what a person should do | "Can't show what Lectual will do next." |
| Outcome read | "Reads as: …" with reasons | AI off or no recording: manual outcomes | "Couldn't read the recording." + manual outcomes |
| What Lectual did (activity) | rows with Undo per map | (n/a) | "Couldn't load", never "Nothing yet" |
| Four facts (contact, consult, proposal, waiting on) | values | Mailboxes off: "Contact from mail isn't switched on" | "Couldn't load" per fact, never "No contact yet" |
| Proposal opens / paid / signed | facts | Proposals off: section hidden | "Couldn't load", never "Not opened" or "Not paid" |
| Talking points | up to 3 points | AI off: the task alone | the task alone, with "Couldn't prepare talking points." |

## MUST NEVER HAPPEN
- **A send to a client** (Yes makes a draft; Rayn sends).
- **An outcome logged or a stage applied without a person's yes**, beyond what the Stage Keeper already does on its own (decision 2).
- **Legal advice in talking points or reasons**: a legal question is noted for the attorney and never answered.
- A deadline written. A cross-firm read. The service role in dashboard code. A raw error shown. A module gate failing open. A Yes available to someone `canApproveItem` refuses. A promise of an action no job will take.

## Models and evaluator
- Generator: **Opus** for the top card's approve / edit / reject wiring, the outcome-read prompt and evidence rule, talking-points prompt and every client-facing word; **Sonnet** for the layout, the four facts, "What Lectual did", the next-actions and undo maps.
- Evaluator: quality pass overall; **strict** on approvals and permissions (tests 2 to 7, 9).
