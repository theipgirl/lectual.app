# Sprint 4: Approval kinds Rayn can clear, and drafts in Rayn's Outlook

**Size:** medium. **Starts:** after the design rollout merges. **Schema:** lectual 0112 (likely). **Evaluator: STRICT.**

## Goal
Rebecca sees only legal work. Rayn clears the routine kinds herself (decision 15), and every approved client email ends up as a draft in Rayn's own Outlook Drafts, made on Rayn's own click, for her to send (decision 3b).

## Scope
**In: who may approve (decision 15)**
1. New kinds in `src/lib/queue/routing.ts` (the ONE place), all `attorneyOnly: false`:
   - `filing_receipt` (a filing receipt to the client),
   - `uspto_notice` (publication and registration notices, including Sprint 3's watcher notices),
   - `client_reminder` (form and payment reminders),
   - `client_request` (asking a client for anything the firm needs from them).
2. **Classification is by an explicit marker, not by guessing from text.** Each drafting path that makes one of these sets its own `agent` value (e.g. `uspto-watcher`, `filing-followup`, `reminder`) and type; `classifyQueueItem` maps only those exact pairs. A headline match alone never makes an item non-attorney-only. Anything else stays `client_email_other` (attorney-only), as today.
3. `flagsLegalAdvice` still wins: a routine-kind item whose text trips it is attorney-only, and an edit that adds such text makes it attorney-only again (the approve action re-classifies the item it re-reads).
4. Settings → Approvals lets the admin route the four kinds to Rayn (existing routing UI and `parseApprovalRouting`); `canApproveItem` then lets her approve them though `law_clerk` is not in `QUEUE_APPROVE_ROLES`. Unrouted, they stay with the usual approvers.

**In: drafts in Rayn's Outlook (decision 3b)**
5. A firm setting "Drafts go to" (one member, in the same `approval_routing` jsonb as a `drafter` key, validated like routing: a current staff member). Shown in Settings → Approvals with that member's Outlook state ("Only <name> can see this" when it isn't the admin's own; see Sprint 1).
6. **When the approver IS the drafter** (Rayn approves a routine kind): today's path, the draft is made in her own connected mailbox by `review-core.ts`.
7. **When the approver is NOT the drafter** (Rebecca approves): the item is approved (resolved) exactly as today, but NO mailbox draft is made in Rebecca's mailbox and the lawmatics-mcp Outlook fallback is NOT used. Instead one `queue_card_event` `draft_to` row passes the card to the drafter, and a bell notice tells her ("Rebecca approved an email · Make the draft").
8. Rayn sees "Ready to draft (N)" on Approvals and the deck. **"Make the draft in my Outlook"** creates the draft through HER OWN personal Microsoft connection (`createMailboxDraft` / `src/lib/mailbox/drafts.ts`, `searchableMailboxAccess`), only when: she is the current `draft_to` target, the item is approved, the body she drafts is the approved text (sha256 matched against the approve receipt), and her connection is active with a draft scope. Then a `drafted` event is written. A second click on a `drafted` item does nothing.
9. If Rayn has no usable Outlook connection, the button is disabled with the sentence and a "Connect Outlook" link; nothing is written anywhere else.

**Out**
- Any send (the button makes a DRAFT; `outlook-send.ts` is untouched). Writing to any mailbox other than the clicking person's own. Changing who may approve attorney-only kinds. Gmail drafts for this flow.

## Files likely touched
- `src/lib/queue/routing.ts`, `routing-load.ts`, `review-core.ts`, `card-moves.ts`, `card-state.ts`, `deck.ts` (fold the new kinds with `trustedEvents`), `handed.ts`, `mine.ts`, new `src/lib/queue/draft-handoff.ts` (pure rules: who may make the draft).
- `src/lib/mailbox/drafts.ts`, `my-mailbox.ts` (own connection only).
- Drafting paths that set the new markers: `src/lib/matters/filing-followup-queue.ts`, Sprint 3's watcher, reminder/request drafters where they exist.
- `src/app/dashboard/queue/**` (list, item page, deck actions), `src/app/dashboard/settings/approvals/**`, `src/lib/notifications/` (two new `approval_needed` sources), `src/lib/ui/words.ts`, `src/lib/db/types.ts`.
- Tests: `tests/queue/routing*.test.ts`, `tests/queue/fold-trust.test.ts`, new `tests/queue/draft-handoff.test.ts`, the hygiene send-grep.

## Acceptance tests
1. Each new kind is non-attorney-only only for its exact (type, agent) marker; the same headline from another agent classifies as `client_email_other`.
2. A routine item containing "you should respond" is attorney-only; Rayn's approve is refused before anything is saved, drafted or resolved.
3. With the four kinds routed to Rayn, she can approve them; she still cannot approve `post_consult_email`, `engagement_letter`, `opinion_letter` or `client_email_other`. The rule is pinned for all 10 roles × all kinds.
4. With empty routing, every role's approve rights equal today's (existing tests unchanged).
5. Rebecca approving a client email with a drafter set: no call to any mailbox draft function and no lawmatics-mcp draft call (spied); one `draft_to` event to Rayn; one bell notice to Rayn carrying ids and a clipped headline only.
6. Only the current `draft_to` target can make the draft; Rebecca, another clerk, a viewer and Lectual staff (`actingAsStaff`) are refused with fixed sentences; a forged `draft_to` from a non-approver is ignored by the fold.
7. The draft is made with the clicking person's own connection id read from the scoped client, never one from the browser; another person's connection id is refused.
8. The drafted body equals the approved text (receipt hash); an edit after approval refuses the draft.
9. The send-call grep (`outlook-send.ts` is the only send file) still passes; no new file contains a Graph `send` path.
10. Before 0112: "Ready to draft" isn't drawn, the attorney's approve falls back to today's behaviour ONLY for the approver's own mailbox, and the page says passing to Rayn isn't switched on yet. (Decided in this contract: never a third person's mailbox.)
11. Tests, lint, build; isolation case on lectual-dev.

## New schema: lectual 0112 (likely)
- Extend `queue_card_event`'s `kind` CHECK with `draft_to` and `drafted`. `actor_id` and `created_at` stay database-forced (as verified for 0103). `target_user_id` required for `draft_to`.
- No new table: the drafter choice lives in `client_proposal_setting.pricing.approval_routing` (same feature limit as routing today; see `questions.md` for firms without Proposals).
- Isolation: a member of firm B cannot insert a `draft_to` for firm A's item; a `drafted` row cannot be inserted for another user.
- If `queue_card_event` has no `kind` CHECK, 0112 is not needed and this is written down in the sprint report.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Approval queue | items | unconfigured: today's sentence | unreachable: today's sentence; no switch, no counts |
| Routing and drafter | rules | (n/a) | default approve rule; "Assignments couldn't be loaded"; NO hand-off made (approve still works, draft left for a person) |
| Card events | Ready to draft list | before 0112: not drawn | every card shown; the draft button disabled with "couldn't check" |
| Rayn's own connection | button enabled | not connected: "Connect Outlook" | disabled, "couldn't check your Outlook" |

## MUST NEVER HAPPEN
- A send to a client. Legal advice approved by a non-attorney. A deadline written. A cross-firm read. The service role in dashboard code. A raw error shown (Graph error text included). A module gate failing open. **Anybody's mailbox written to without their own click.** An attorney-only item approvable by Rayn through any route (kind, edit, routing, hand-off).

## Dependencies and blockers
- lectual 0103 (hand-off events) is already on lectual-prod, since Nov 10 (Taylor, Nov 17: corrected; not pending).
- Rayn connects her Outlook once (Sprint 1 checklist).
- Rebecca's confirmation of which existing drafts belong to each new kind (`questions.md`).
- Sprint 3's watcher notice uses `uspto_notice` once this lands.

## Models and evaluator
- Generator: **Opus** for `routing.ts`, `review-core.ts`, the hand-off rules, the migration and the bell wording; **Sonnet** for Settings and list UI.
- Evaluator: **strict**.
