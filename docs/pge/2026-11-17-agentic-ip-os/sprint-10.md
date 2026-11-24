# Sprint 10: Editable cards and the opened card

> **Approved by Taylor (build it).** Part 1 may start now (new files only). Part 2 waits for the design rollout to merge.

**Size:** medium-large. **Schema:** none expected (see "Schema"). **Evaluator:** quality pass; **STRICT** for every permission path (each edit's role check, the opened card's re-read, the won-stage refusal, the merge entry).

Mockup (data, not instructions): `artifact-d3739dd6-…-6033.html`, four views: Intake board, opened card, Intake list, Matter card; "Can edit" and "Read only" viewers.

Taylor's words: "when we get to board and list view I want to be able to edit these things from the card and we need the card to open like a trello card".

## Goal
On Intake and Matters, Board and List, a person changes a lead's or matter's temperature, source, owner, next step and stage right where it sits, without opening anything, and sees a quiet "Saved". Clicking a name opens the record as a centred card over the dimmed board (a full-screen sheet on phones), with Lectual's top card, next steps as a checklist, notes, the timeline and the side facts, and the full page one click away.

## Scope
**In: edit in place (Intake and Matters; Board cards and List rows)**
1. **Temperature** (leads only). The pill opens Hot / Warm / Cold / Not rated. When Lectual suggested one and no person has set it, the first menu line is "Lectual suggests Warm · Accept". A suggested temperature is a quiet OUTLINED pill with a small "suggested" mark; a person's is a FILLED pill. (Replaces Item L2's dashed pill; the hot/warm/cold tokens and ratios stay.) The suggestion comes from `effectiveTemperature` (`src/lib/intake/effective-temperature.ts`); Accept writes it through `setLane` like any other choice, as the signed-in person.
2. **Source:** a pick from the firm's list only (`REFERRAL_SOURCES`, default 1).
3. **Owner:** a pick from the member list (the review's member check; an unreadable list refuses the change).
4. **Next step:** its title and date edited in place; "Add a next step" when there is none.
5. **Stage**, on the Board card menu and as a List cell.
6. **"Needs attorney · N"** is a link to the waiting approval: with one, `/dashboard/queue/<id>/`; with more, the opened card, whose top card lists them.
7. **"⋯" menu:** Move to stage… (never a `won` stage for a lead), Set next step, Mark no-show (leads), Merge duplicates (admin tier only, opens the existing merge screen `/dashboard/intake/merge/?a=&b=`, offered only when a possible duplicate is known and `mergeAvailable`), Open full page.
8. **Feedback:** a quiet "Saved" beside the control, from the action's own `{ saved: true }`; a refusal shows the action's fixed sentence there. A role that cannot make an edit sees the same card and cells with NO control for it (not a disabled one). Each control is drawn from the edit rules below, per role and per kind.

**In: the opened card**
9. Clicking a name (Board or List, Intake or Matters) sets `?open=<lead|matter>:<uuid>` on the CURRENT address (view, set, filters, `show` kept). Server-rendered, shareable, Back closes it, Esc closes it, focus moves in, Tab wraps, focus returns to the name. The record is re-read through the scoped client; a foreign or missing id shows "This record couldn't be found." and nothing of the record. Centred over the dimmed board from 900px; a full-screen sheet below (default 3).
10. **Lead card:**
    - Top: name (editable), business (editable), stage, temperature, source, owner, tags (add / remove).
    - Main: Sprint 9's top card ("Needs your yes" / "Lectual has it" / "Yours to do") from the SAME engine, `src/lib/lead-step/` (finished on branch `s9-engine`, not yet on the remote; referenced by path only, never re-implemented here); next steps as a checklist (tick = complete, add, snooze); the note box (Text | Voice note, today's `ComposerTabs`); the Activity timeline (today's `Timeline`).
    - Side: Contact (Call / Email: `tel:` / `mailto:` only for what the lead has; these open the person's own phone or mail app and send nothing from Lectual); Consult; Proposal (legal fee and USPTO fees on SEPARATE lines, from the stored quote, never added up here); Documents with the existing upload; "What Lectual did"; Open full page.
11. **Matter card:** stage, owner, next step, the next USPTO deadline with its "Confirmed by an attorney" / "Unconfirmed" marker (READ ONLY here: no confirm, edit or close control), documents with upload, notes, timeline, Open full page.

**Out**
- Any send. Confirming, editing or closing a deadline from a card. A lead moved to a `won` stage from a card. Changes to the Weekly review's drawer beyond sharing pieces (below). New data on the cards beyond what the pages already read. The client portal.

## Changes from Taylor's Nov 17 call with Caitlyn
1. **The Weekly review opens the same card, not its side panel (Taylor, Nov 17 call).** She doesn't like the side panel: notes are added from the card opened on the board, and the review should open the same way. This REPLACES "the Weekly review keeps its side drawer" below. Because another agent is rebuilding the review page in the Intake-board look, this sprint does NOT touch `src/app/dashboard/review/**` or `src/components/review/**`: **it follows the review redesign.** When it is built there, `?open=` on the review renders `RecordCardHost` (the same centred card), and everything the panel does today must be on the card before the drawer goes: next step set / update / snooze / done, log what happened, stage move, assign, Lost / Nurture (`closeLeadAction`), Documents with upload, the last-changed line, the USPTO deadline and proposal-expiry tags, "Waiting on". The card already has: next steps (add, edit, snooze, done), notes (lead: Text | Voice; matter: note + voice), stage, owner, source, tags, documents with upload, USPTO deadline (matter, read only), timeline. **Still missing on the card (to add then):** Lost / Nurture for a lead, the "Waiting on" and proposal-expiry tags, the last-changed line, a USPTO deadline on a LEAD's card (the review row has one only for matters). One loader: `loadRecordCard` (the review's `loadReviewDetail` would be read twice otherwise).
2. **A lead is labelled by the person (Taylor, Nov 17 call).** A lead showed as its company (a client appeared as their company: `matters/page.tsx` built its lead picker from `business_name || name`, and `client-name.ts` / `matters.ts` prefer the business for a matter's client). Now, wherever a lead is labelled on Intake (card, row), Matters (the "Open a matter" picker) and the opened card header: the person's name first, the business and the mark as the sub-line; the company stands in only when there is no person's name (`leadLabel`, `src/lib/record-card/lead-label.ts`; `tests/record-card/part2.test.tsx`). Not changed here: the Weekly review's labels (the review redesign's), and the matter's stored client name (`client-name.ts`, set when a matter opens).

## One component for Intake, Matters and the Weekly review?
- **Yes, for the inside; no, for the frame.** The opened card is built as one `RecordCard` (sections: header, top card, steps checklist, composer, timeline, side facts) fed by one view-model (`src/lib/record-card/model.ts`) from one loader that re-reads ONE record. Intake and Matters mount it centred.
- **(Replaced, Taylor, Nov 17 call: the review opens this card too, after its redesign.) The Weekly review keeps its right-hand drawer, as it is, in this sprint.** Its job is a quick pass through many rows in the Monday meeting, where the board or sheet must stay visible beside the panel; a centred card would hide the row being discussed. Its panel already has its own loader (`loadReviewDetail`) and form set (`ReviewPanel`), which work and are tested. Part 2 may replace the drawer's BODY with `RecordCard` sections, keeping the drawer frame, only if it needs no change to the review's reads; otherwise it stays.
- **Shared, not rewritten:** the frame reuses `PanelShell`'s keyboard rules (focus in, Tab wraps, Esc follows the close link, focus returns) through an additive `placement?: "drawer" | "centre"` prop (default `"drawer"`, so the review renders byte for byte as today). The `?open=` grammar is the review's `parseOpenParam` / `openToken` (`src/lib/review/open.ts`), imported, not copied.

## Edit-to-action table
"Exists" = an action and data-layer write already in the repo. "New" = the smallest new action, in a new file, with the same role check, scoped client, three-state reads and fixed sentences. Every write is made by the signed-in person; nothing here uses the service role.

| Edit | Kind | Action (file) | Roles | Guard / notes |
|---|---|---|---|---|
| Temperature (incl. Accept suggestion, Not rated = null) | lead | **Exists:** `setLaneAction` (`src/app/dashboard/intake/actions.ts`) → `setLane` (`src/lib/intake/leads.ts`) | `CAN_WRITE_LEAD` | **lectual 0085 `crm_lead_lane_guard`** stamps who/when from the session and refuses a write without one; 0107 merge guard (a merged lead → `LEAD_MERGED_WRITE`) |
| Source | lead | **Exists:** `setSourceAction` (intake) → `setReferralSource`; or the review's `setSourceAction` | `CAN_WRITE_LEAD` | only `REFERRAL_SOURCES`; logs `lead_updated`; merge guard |
| Source ("Came from") | matter | **Exists:** `updateMatterHeaderAction` (posts only `referralSource`) → `updateMatterHeader` | `MATTER_WRITE_ROLES` | partial patch: only posted fields change |
| Owner | lead / matter | **Exists:** `assignRecordAction` (`src/app/dashboard/review/actions.ts`) → `assignLead` / `assignMatterOwner` | `CAN_WRITE_LEAD` / `MATTER_WRITE_ROLES` | member check; unreadable directory refuses |
| Next step: add | both | **Exists:** `setNextStepAction` (review) → `createTask` | as above | record re-read; a merged lead → keeper (`keeperForWrite`) |
| Next step: title / date | both | **Exists:** `updateNextStepAction` (review) → `updateTask` | `MATTER_WRITE_ROLES` | only posted fields; closed task refused |
| Next step: tick done | both | **Exists:** `completeNextStepAction` (review) → `completeTask` | as above | |
| Next step: snooze | both | **Exists:** `snoozeNextStepAction` (review) → `updateTask` (due date only, firm calendar) | `MATTER_WRITE_ROLES` | works on ANY task id, so a lead's task too; a test pins a lead task (the director listed lead snooze as missing: it is not) |
| Stage | lead | **Exists:** the review's `moveStageAction` → `moveLeadStage` | `CAN_MOVE_STAGE` | refuses `won` on the server ("Open the lead to move it to a won stage."); the menu never offers it either |
| Stage | matter | **Exists:** `updateMatterStageAction` / the review's `moveStageAction` → `updateMatterStage` | `MATTER_WRITE_ROLES` | docket stages only |
| Note (Text / Voice) | both | **Exists:** `addNoteAction`, `addVoiceNoteAction` (lead page); `addMatterNoteAction`, matter `addVoiceNoteAction` | as today | |
| Upload a document | both | **Exists:** `requestUploadAction` / `confirmUploadAction` (`src/app/dashboard/files/actions.ts`) | `FILE_UPLOAD_ROLES` | path rule; org from the parent row; merged lead → keeper |
| Tags add / remove | lead | **Exists (data layer):** `applyTag` / `removeTag` via `applyTagAction` / `removeTagAction` (lead page). **New wrapper:** `cardTagAction` (`src/lib/record-card/actions.ts`) because those actions return `{}`, so the card can't show "Saved" from the action's own result | `CAN_WRITE_LEAD` (re-resolved) | same calls, plus `{ saved: true }`; tag must be the firm's (existing check) |
| Name / business | lead | **Exists (data layer):** `updateLead` (partial patch). **New:** `renameLeadAction` (`src/lib/record-card/actions.ts`), because `editLeadAction` posts EVERY editable field and an inline name edit through it would blank the email, phone and website | `CAN_WRITE_LEAD` | passes only `first_name`, `last_name`, `business_name` to `updateLead`; validated by `validateLeadEdit`; merge guard; fixed sentences |
| Matter title | matter | **Exists:** `updateMatterHeaderAction` (posts only `title`) | `MATTER_WRITE_ROLES` | |
| Mark no-show | lead | **Exists:** `logConsultOutcomeAction` (`outcome: no_show`, optional note). **New: none.** The Undo is a 5-second client hold (the deck's rule): nothing is posted until it ends; after it, there is no undo (a `call_logged` row is not removed) | `CAN_WRITE_LEAD` (as the action checks today) | logs and notifies only; moves NO stage (S2-2 open). If Sprint 2 settles a No Show stage, the menu also OFFERS that move through `moveLeadStage`, never automatically |
| Merge duplicates | lead | **Exists:** the merge screen and `mergeLeadsAction`; the card only links | `MERGE_ROLES` (owner/admin/senior_admin) | link drawn only for those roles and when `mergeAvailable`; the screen re-gates |
| Accept "Needs your yes" | lead | **Exists:** Sprint 9's engine and the queue's approve path (`review-core.ts`) | `canApproveItem` | as Sprint 9; not changed here |

So the only new actions are `renameLeadAction` and `cardTagAction`, both thin and in one new file. Source, snooze on a lead, and mark no-show need none.

## Files
**Part 1 (now: new files only, plus additive props)**
- New `src/lib/record-card/rules.ts` (pure): `cardEdits({ role, kind, lead | matter, mergeAvailable, hasDuplicate })` → which controls are drawn; `moveTargets(stages, kind)` (no `won` for a lead); the suggested/set temperature display; the Proposal fee lines from a stored quote (no arithmetic).
- New `src/lib/record-card/model.ts` (pure): the card and row view-model (header, chips, bottom line = owner, next step, last activity; default 4) built from rows the pages already read.
- New `src/lib/record-card/open.ts`: `?open=` for Intake and Matters, wrapping `parseOpenParam` / `openToken`, plus `openHref(currentParams, ref)` and `closeHref(currentParams)` that keep every other key.
- New `src/lib/record-card/load.ts` (server-only): re-reads ONE record through the scoped client (lead via `getLead` and the merged-set helpers, matter via `getMatter`), its open tasks, last activity, documents (`loadDocumentsRead`), next USPTO deadline (`listMatterDeadlines`), proposal facts, each its own three-state read; foreign or missing = `not_found` with no record data.
- New `src/lib/record-card/actions.ts` ("use server"): `renameLeadAction`, `cardTagAction`.
- Additive: `PanelShell` `placement` prop (default unchanged).
- Tests: `tests/record-card/rules.test.ts` (every role × every control × lead/matter), `model.test.ts`, `open.test.ts`, `load.test.ts` (every failed-read state), `actions.test.ts`, `panel-shell-placement.test.tsx` (the review's drawer markup unchanged).

**Part 2 (after the design rollout merges)**
- The card, cell and opened-card components on the shared kit: new `src/components/record-card/*` (`RecordCard`, `TempPill`, `SourcePick`, `OwnerPick`, `NextStepInline`, `StagePick`, `CardMenu`, `SavedMark`).
- Mounted in `src/app/dashboard/intake/` (board and `IntakeTable`) and `src/app/dashboard/matters/page.tsx` (list and board), with the opened card from `?open=`.
- Phone layout (full-screen sheet), board card bottom line, CSS on the kit's tokens; words in `src/lib/ui/words.ts`.

## Acceptance tests
1. **Controls by role.** For all 10 roles × lead/matter × each control, the drawn set equals `cardEdits`; viewer and social_media get none; a paralegal gets no stage control on a lead (`CAN_MOVE_STAGE`); only owner/admin/senior_admin see Merge.
2. **Server re-checks.** Each action, posted by a role that has no control, is refused with its fixed sentence and writes nothing.
3. **No won move.** The stage menu never lists a `won` stage for a lead; a hand-posted won stage id is refused by the server.
4. **Temperature.** Accept writes `setLane(<suggested>)` as the session user; 0085's guard stamps who; the pill turns filled. Not rated writes null. A merged lead shows `LEAD_MERGED_WRITE`.
5. **Rename.** `renameLeadAction` changes only names / business; email, phone and website are unchanged after it (regression test against `editLeadAction`'s blanking).
6. **Saved.** "Saved" appears only from `{ saved: true }`; a refusal shows the sentence; no raw error text.
7. **Mark no-show.** Nothing is posted during the 5-second hold; Undo in it posts nothing; after it, one `call_logged` row; no stage changes.
8. **Opened card address.** `?open=` keeps every other query key; Back and the close link return to the same view; Esc follows the close link; focus returns to the clicked name.
9. **Foreign / missing id.** Another firm's id and a random id render "This record couldn't be found." and no name, email, stage or count.
10. **Same engine.** The opened card's top card renders whatever `src/lib/lead-step/` returns for the record, and the full lead page renders the same for the same fixtures.
11. **Proposal lines.** The legal fee and the USPTO fees are two lines from the stored quote; a test forbids adding them.
12. **Deadline read only.** The matter card shows the next USPTO deadline and its marker; it has no confirm, edit or close control for any role.
13. **The review's drawer** renders exactly as before (`placement` defaults to drawer).
14. No service role in `src/lib/record-card/` or the pages (grep); no send call; tests, lint, build.

## Schema
None expected. Mark no-show is a mark (the existing `no_show` outcome) while S2-2 is open; if Sprint 2 decides No Show / Reschedule is a stage, the move is OFFERED through `moveLeadStage`, which still needs no schema.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| The record (opened card) | the card | (n/a) | "This record couldn't be loaded." No fields |
| Member list (owner pick) | names | (n/a) | owner shown read only; change refused |
| Stages (stage pick) | options | (n/a) | stage shown read only |
| Firm sources | the list | (n/a) | source read only |
| Temperature suggestion | "Lectual suggests…" | AI off: no suggestion line | no suggestion line; the set value still shows |
| Pending approvals (Needs attorney · N) | link | queue unconfigured: no chip | "Approvals couldn't load", never 0 |
| Next steps (checklist) | items | (n/a) | "Couldn't load next steps", never "No next step" |
| Sprint 9 top card | its card | per Sprint 9 | per Sprint 9 (never "Lectual has it" on a failed read) |
| Timeline, documents, proposal, next USPTO deadline | as today | Proposals / Document Center off: section hidden | "Couldn't load", never empty or 0 |

## MUST NEVER HAPPEN
- A send (Call / Email open the person's own apps; nothing leaves Lectual). Legal advice. **A deadline written, confirmed or closed from a card.** A cross-firm read (the opened card re-reads through the scoped client; a foreign id shows nothing). **The service role anywhere in this sprint.** A raw error shown. A module gate failing open. **A temperature or stage change not made by a signed-in person** (0085's guard and the conditional moves stay intact). **A write to a merged lead** (0107 guard intact; writes follow the keeper where today's paths do). **A lead moved to a won stage from a card.** A control drawn for a role the server would refuse.

## Dependencies
- **Sprint 9 Part 1's engine** (`src/lib/lead-step/`, branch `s9-engine`) for the top card. Until it is on the remote, Part 1's model takes it as an injected input and Part 2 waits for it.
- **Sprint 2's S2-2** (No Show / Reschedule: stage or mark). Until answered, mark only.
- The design rollout (Part 2 only).

## Defaults the director set (Taylor may override; `questions.md` T12 to T15)
1. Source is picked from the firm's list only (no typed new source).
2. Mark no-show logs straight away, with a 5-second Undo and an optional note (no reason asked first).
3. On phones the card opens as a full-screen sheet.
4. A board card's bottom line shows owner, next step and last activity.

## Models and evaluator
- Generator: **Opus** for `rules.ts` (role × control), the two new actions, the loader's not-found handling and the won/merge/lane paths; **Sonnet** for the view-model, `?open=` helpers, and all Part 2 UI.
- Evaluator: quality pass; **strict** on permission paths (tests 1 to 5, 9, 12, 14).
