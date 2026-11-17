# Sprint 6: Meeting assistant

**Size:** medium. **Starts:** UI after the design rollout merges; B2 (the reader) starts now. **Schema:** none of its own (its agent name is added to the CHECKs in 0110; see Sprint 3).

## Goal
Monday is the meeting day. After the Monday team call is imported (Fathom or Zoom), an assistant reads the transcript and, for each matter discussed, proposes a next step, an owner and a note. A person accepts each with one click. Nobody types up the meeting.

## Scope
**In**
1. **Which meeting.** The firm marks its Monday call once: a title pattern or a recurring meeting chosen in Settings → Assistants (stored in the agent's own setting or the firm brain; no schema). Only meetings that match AND were imported (`crm_meeting` with a transcript) are read. A meeting linked to a lead (a client consult) is never treated as the Monday call.
2. **B2 reader** (`src/lib/meeting-assistant/**`, starts now as new files): pure `proposeFromMeeting({ transcript, matters, members }, callModel)` → per matter `{ matterId, nextStep (≤ 200 chars), ownerUserId | null, dueDate | null, note (≤ 600 chars), quote }`. Matters and members are passed as data (id, display title, mark, number; id, first name). The model call is injected.
3. **Evidence rule** (as consult details): a suggestion is kept only when its `quote` is really in the transcript AND names the matter (its mark, client or number) or sits within the part of the transcript where it was named. An owner is kept only when their name is in the quote's neighbourhood and they are a current staff member; else `null` ("Unassigned"). A due date is kept only when the words state it; it is a TASK due date, never a deadline.
4. **Agent `meeting-assistant`** (Sonnet tier in `AGENT_MODEL_TIER`), run after the meetings import (the agents cron, track B, and Run now), `runOneAgent` budget, `AGENT_POLICY` first in the prompt, transcript and matter data inside inert tags. One run per meeting (keyed by meeting id). Writes one `crm_activity` `ai_insight` row per matter suggestion (`source: "meeting-assistant"`, `meeting_id`, the suggestion), org from the meeting row.
5. **Review screen**: the meeting page gets "Suggestions from this meeting" (and the Weekly review's detail panel shows a matter's pending one). Each row: matter, next step, owner, due, note, the quote on hover. **Accept** = `createTask` (type `custom`, assignee = owner, due) plus `addMatterNote` with the note, as the person, then a decision row (`source: "meeting-assistant-review"`, `suggestion_id`, accepted). **Edit then accept** changes the fields first. **Dismiss** records the decision and touches nothing else. "Accept all" accepts the shown rows one by one, reporting any that fail.
**Out**
- Any deadline or deadline suggestion. Any send or client email draft. Lead / consult meetings (Sprint 7 and the existing "Draft follow-up" cover those). Stage moves (the assistant may mention one in the note; it never moves).

## Files likely touched
- `src/lib/meeting-assistant/**` (B2), new `src/lib/agents/meeting-assistant/run.ts`, `src/lib/agents/runner.ts`, `types.ts`, `readiness.ts`, `run-now.ts`, `src/lib/ai/agent-models.ts`.
- `src/lib/meetings/read.ts` (read the marked meeting), `src/app/dashboard/meetings/[id]/page.tsx` and `actions.ts`, `src/lib/review/detail-load.ts`, `src/components/review/ReviewPanel.tsx`.
- `src/lib/matters/tasks.ts`, `src/lib/matters/notes.ts` (called, not changed), `src/lib/ui/words.ts`.
- Tests: `tests/meeting-assistant/`, `tests/agents/meeting-assistant/`.

## Acceptance tests
1. A suggestion whose quote is not in the transcript is dropped; one whose quote doesn't name or sit near the matter is dropped.
2. An owner not in the member list, or named nowhere near the quote, becomes Unassigned.
3. A date the transcript doesn't state is dropped; no output path creates a `crm_matter_deadline` row (grep test over `src/lib/meeting-assistant/` and the agent).
4. The same meeting run twice writes suggestions once.
5. Accept creates one task (assignee, due) and one note, logged as the person; a second Accept on the same suggestion does nothing.
6. Dismiss writes only the decision row.
7. Roles: only `MATTER_WRITE_ROLES` see Accept / Dismiss; the actions re-resolve the role; a viewer sees the suggestions read-only.
8. The transcript and suggestion text are never logged and never in `agent_run`, failure alerts or cron JSON; counts only.
9. Before 0110 (agent CHECK), Settings and Run now say the assistant isn't switched on for the firm yet; nothing is written.
10. With no Monday call marked, the agent ends `skipped` with that sentence; no model call.
11. Tests never call Fathom, Zoom or the model (injected fakes). Tests, lint, build.

## New schema
None. The agent name is in 0110 (Sprint 3). Suggestions are `crm_activity` `ai_insight` rows, as the Stage Keeper's are.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Marked meeting / transcript | suggestions made | no meeting marked; transcript still processing | agent run counted failed; no suggestions |
| Suggestions on a page | rows | before 0110: not switched on | "Couldn't load", never "no suggestions" |
| Open matters and members (agent input) | used | (n/a) | run ends with no suggestions written (never guess an owner) |

## MUST NEVER HAPPEN
- A send to a client. Legal advice (notes record what was said; no opinions added by the model). **A deadline written** (task due dates only, never `crm_matter_deadline`). A cross-firm read. The service role in dashboard code. A raw error shown. A module gate failing open. A task created without a person's click.

## Dependencies and blockers
- 0110 on lectual-dev (or carry the CHECK change if this sprint merges first).
- A connected Fathom or Zoom that records the Monday call; Caitlyn names the call (`questions.md`).
- AI configured on the deployment.

## Models and evaluator
- Generator: **Sonnet** for B2, the run and the UI; **Opus** for the prompt and the evidence rule.
- Evaluator: quality pass.
