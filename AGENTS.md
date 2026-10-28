# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# lectual.app — project guidance

**What this is:** the final-MVP firm workspace for Lectual (Oath Innovation Inc). It is a new
**frontend** over the same Supabase backend as `theipgirl/lectual`. It is not a new backend.
Plan: `docs/MVP-PLAN.md`. Design: `design/` (one visual system; tokens live in
`src/app/globals.css`).

## Where the rules live
`theipgirl/lectual` owns the database, and its `AGENTS.md`, `brain/decisions.md` and
`supabase/migrations/` are binding here too. In particular:
- **No migrations in this repo.** Schema changes go in `lectual/supabase/migrations` (one chain,
  first-merged-wins numbering). Apply each one to BOTH lectual-dev and lectual-prod.
- **The tenant-isolation gate lives in `lectual`** (`tests/tenant-isolation.test.ts`), and every
  new tenant table adds a case there.
- **UPL firewall:** software, not a law firm; flat fees only; nothing implies legal advice.
- **Queue reads have three states** (`src/lib/queue/load.ts`): ok, unconfigured, unavailable. Never two.
- **Modules fail closed.** Gate the PAGE and the ACTION with `orgHasModule()`, and use `notFound()`.
  The rail (`src/lib/nav.ts`) is a courtesy, not the gate.
- **DB access:** only `getScopedClient()` (RLS on `active_org_id`). The service-role client
  (`src/lib/db/admin.ts`) is lint-fenced and only for jobs that stamp the row's own `org_id`.
- **Deploys:** production ships from `main` only. Never "Promote to Production" on a preview.

## Ported code
See `PORTED_FROM.md`. When changing a ported file, consider whether `lectual` needs the same fix.

## LawPay (per-firm) — `docs/lawpay-setup.md`
- Each firm signs in to ITS OWN LawPay account (lectual 0080 `lawpay_connection`). There is no
  deployment-wide LawPay key; never add one. Charges use the firm's own account secret, looked up
  by the quote's org_id. Sealed columns have no SELECT grant: name the columns.
- The charged amount comes ONLY from the signed snapshot (`signingChargeForQuote`), to the mapped
  OPERATING account. The account kind is never defaulted or inferred. The pending `crm_payment` row is
  written before LawPay is called; 0080's index allows one open signing charge per quote.
- Only a 401/403 on the firm's key pauses the firm's card payments (`reauth`). A refusal of one request
  never does: the payment token in it came from an anonymous visitor. A quote allows 5 failed card
  attempts, then the form is withdrawn (the link has no login and no rate limiter).
- Trust flag and mode are checked against the SEALED gateway credentials at charge time. The readable
  `accounts` column is admin-writable through the API, so it is never the last word on trust vs operating.
- Payment-state reads are five-state (received / confirming / payable / manual / unavailable). A failed
  read is never "unpaid".
- Tests never call LawPay. Unset `LAWPAY_OAUTH_*` means "not configured", and manual recording keeps working.

## Meetings (Fathom / Zoom) — `docs/meetings-setup.md`
- Each firm connects ITS OWN Fathom (API key, pasted, checked, sealed) or Zoom (OAuth, PKCE, sealed
  rotating refresh token) in lectual 0081 `meeting_source_connection`. No deployment-wide Fathom or
  Zoom credential; never add one. That is why Meetings has no module gate.
- `crm_meeting` rows are inserted only by the service-role importer, stamped with the importing
  connection's org_id. Staff change only the link columns. Transcripts are stored (privileged,
  org-scoped like consult notes).
- Meeting reads are three-state (ok / unavailable / none): a failed read is never "no meetings".
- "Draft follow-up" goes to the approval queue only (agents module + queue required). Never send.
- Tests never call Fathom or Zoom. Unset `ZOOM_OAUTH_*` means Zoom is "not set up"; Fathom still works.

## Consult details (filing basis per mark) — Aug 29 SOP §2.2
- Stored in `crm_consult_note.notes.consult_details` (jsonb, beside lectual's own keys; no schema change,
  no module gate: it is the firm's own rows). `src/lib/consult/` owns the rules; `classes`/`class_count`
  stay lectual's.
- It records what was SAID: per mark, word/design, classes with goods/services, filing basis
  `1a` / `1b` / `unknown`, first-use date if stated; plus package and discount as noted. A basis the model
  gives with no evidence is stored as `unknown`. `unknown` is shown and stored as unknown, never guessed or carried.
- Filled by the post-consult drafter and Meetings "Draft follow-up" (same call as the email, never put in
  the email). Saving it never blocks or repeats the queued draft, and never overwrites existing details.
  A meeting's details go on a note of the app's own (keyed to the meeting), never on lectual's note for the
  same recording: claiming that one would get the call drafted twice.
- A 1a/1b is kept only when the model quotes words that really are in what it was given (`sourceText`, the prompt);
  a paraphrase or invention is stored as `unknown`. Class numbers and first-use dates not found there are dropped too.
- Nothing is relied on until a person reviews it on the lead page (stamped with who and when). Saves are
  conditional on `rev`: a stale form is refused. Only REVIEWED details carry onto a matter, when it opens by
  signed quote or the hired stage, only onto a TM matter, only when the NEWEST consult details are the reviewed ones
  (a newer unreviewed or unreadable record blocks the carry), and only for the mark being filed; several marks with none chosen, or a
  mismatched mark, carry nothing, and the `matter_opened` timeline row says what was or wasn't carried.
- Reads are three-state: details / none / couldn't be loaded. Unreadable saved details are reported, not hidden.

## Intake forms: many per firm, contact first (lectual 0093)
Intake → Forms keeps an intake per event, campaign or page (`/dashboard/forms/` lists them;
`?form=<id>` edits one). Each has a name, a link (`/i/<slug>`), a source tag and its own numbers.
- **Source tag** ("UGW 2026") goes on every lead from that intake (`referral_detail`) so the firm
  knows where leads came from; Lawmatics tagging will read the same field.
- **Renaming a link** keeps the old one working: lectual's alias trigger records it and `/i/<old>`
  redirects. An old link name is never given to another intake. QR codes are made in the browser
  (`IntakeQr.tsx`), from the saved link.
- **Contact first:** name, email and consent come before any question. `startIntakeAction` files
  the person (submission with `submitted_at` null + their lead) and returns a token; Submit adds the
  answers to that row by the token's sha256. Someone who walks away is still a lead, and shows as
  "Didn't finish". Never move contact details after the questions again.
- **Assessment intakes (lectual 0095):** `kind = 'assessment'` runs RPB's booth card
  (`src/lib/assessment-card/`, ported verbatim) from the intake's link: contact first, then the card
  one question at a time. The SERVER scores it (`scoreAssessmentAnswers`) from the stored card;
  points and categories never reach the browser, and the person sees only score, band, gaps and next
  step. Hot/warm/cold is staff-only (lead note, Intake numbers, Lawmatics tag). A firm may reword a
  question; options, points and order are the card's.
- **Lawmatics (`src/lib/intake-forms/lawmatics-sync.ts`):** every intake pushes its person to the
  FIRM's own Lawmatics (0077 token, read for the org of the form the slug resolved), tagged with the
  source tag, plus "Hot Lead"/"Warm Lead"/"Cold Lead" for an assessment. Those names are contracts with
  the firm's Lawmatics automations. Runs in `after()`, never throws; `lawmatics_synced_at` /
  `lawmatics_tagged_at` stay null when a step didn't land. A firm with no connection is skipped.
- Archived intakes don't answer publicly and keep their leads. Matter intake requests use the
  firm's MAIN intake (oldest not archived).

## Answers and Results (Sprint 9, no schema)
- **Answers card** (`src/components/answers/AnswersCard.tsx`, loader `src/lib/answers/load-answers.ts`) is on the lead
  page (after the temperature card) and the matter page (aside). Three sources read on their own (a lead's intake
  submissions, a lead's `crm_booth_scorecard` rows, a matter's COMPLETED `crm_intake_request` rows); a failed one is
  named on the card and never reads as "No intake or assessment answers yet." Temperature is staff-only and labelled.
- **Intake-assessment gaps are not stored.** The submission keeps score/band/temperature and the answers as option
  LABELS, so gaps are re-derived by matching labels back to the card and re-scoring (`reread-answers.ts`). It is exact for
  answers the card produced; anything unmatched (or a score that no longer agrees) shows "Gaps unavailable", never a guess.
  Booth rows store `gaps` at capture and those are used as they are. The booth row has no variant: it is read from the
  answer ids (100 and over = Trademark & Copyright card).
- **Results tab** (`?form=<id>&tab=results`) and **event page** (`?event=<code>`, booth data, read-only, default All time)
  share the distribution blocks (`AssessmentBlocks.tsx`), fed by `AssessmentSample`s built from either source. Booth
  answers are saved only when a card is finished, so drop-off by question says "not recorded" until partial answers exist.
- **CSV** (`/dashboard/forms/export/`): a route handler is its own entry point, so it resolves the session and role
  itself (401 signed out, 403 viewer/social_media or an unreadable role, 404 foreign id, 413 over 50,000 people, never a
  header-only file on a failed read). Formula-leading cells get a `'` prefix. `src/lib/intake-forms/csv.ts` is pure.

## Choice questions, own assessment questions, step tracking (Sprint 10, lectual 0096)
- **Choice questions** (`src/lib/intake-forms/choice.ts`): a question is text (no `type` key, as ever), `single` or `multi`
  with 2 to 12 options of at most 120 characters. The browser sends LABELS; the server matches each against the stored
  options. A multi answer is stored as its labels joined with ", " in option order, so nothing may split a stored answer
  on commas. One `ChoiceControl` draws it everywhere (form, conversation, `/r/<token>`, assessment extras, editor preview).
- **Assessment extras and hidden questions** (`assessment.ts`, `assessment-card/hideable.ts`): the firm's own questions
  (max 10, letter-led ids like `qabc`) come after the card, are never scored and are stored in the same answer list; the
  re-read sets them aside by id. A card question is hideable only if it is unscored AND nothing reads it (today: Brand &
  Business team size only). `tests/intake-forms/assessment-extras.test.ts` proves the list both ways; a card change must
  keep it true, or the score, the hot/warm/cold call and the Lawmatics tag would move.
- **Step tracking**: `recordIntakeStepAction` (public, same service-role path as the other public writes) writes one `step`
  event per person and question and saves sanitised `progress`. It never throws, shows nothing, and treats a database
  without 0096 as "step data isn't recorded yet". Its rate limit is separate from the visit/start events. The visit/start
  funnel read lists its kinds so step events cannot use up its cap; step reads live in `load-steps.ts`, three-state.
- **Drop-off, medians, "Stopped at Q<n>"** come from one aggregation (`step-funnel.ts`) so Results and Performance agree.
  A person with no step events reads "not recorded" if they started before the form's first step event, else
  "Stopped before Q1".

## Documents & files (lectual 0097)
The "Documents & files" card is on the lead page (main column, just before the Timeline) and the matter
page (aside). It lists the stored files (`crm_file`) and, on a matter, the generated letters
(`crm_document_draft`, status "generated" only, and only for a firm with the `document-center` module). Internal
only: nothing is shared with a client and there is no portal.
- **Path rule:** `{org_id}/{lead|matter}/{parent_id}/{file_id}.{ext}` in the private `client-files` bucket
  (`src/lib/files/rules.ts`). `requestUploadAction` reads the parent through the scoped client and takes `org_id` from
  THAT ROW. There is no org argument and the file name is never part of the path. Upload is two steps with a direct
  browser-to-storage `PUT` between them; `confirmUploadAction` rebuilds the path, checks the object is really there,
  stores its real size, inserts the row (never `uploaded_by` or `contact_id`) and logs `file_uploaded`.
- **The extension decides the type** (13 extensions to the bucket's 12 MIME types). The browser's MIME is advisory:
  it is empty or odd for .msg, .eml and .heic, so it neither widens nor narrows what is accepted. The mapped MIME is
  what is stored and what the upload must send as its content type.
- **No service role and no module gate** for the files part: org-scoped table and storage policies, no global
  credential. Downloads are a 60-second signed URL minted through the scoped client
  (`/dashboard/files/[id]/download`; any member, a viewer included). Delete is the admin tier only
  (owner/admin/senior_admin) and removes the object first, then the row; an object that is already gone counts as removed.
- **Reads are not-set-up / unavailable aware.** Files report `ok` / `not-set-up` (table missing, judged on the error
  code) / `unavailable`; letters report `ok` / `unavailable` on their own. "Nothing here yet" is shown only when every
  read succeeded and found nothing. Errors shown to a person are fixed sentences (`FILE_MESSAGES`), never raw text.
- `crm_file` and the `file_uploaded` activity type are hand-added in `src/lib/db/types.ts` and
  `src/lib/matters/activity.ts` until the next codegen run.

## Stage reconciliation (Intake → Reconcile stages, no schema; rewritten in Sprint 26)
`/dashboard/intake/reconcile/` compares each lead's stage with what the sources say and moves the ones a person
chooses. Owner/admin/senior_admin only: the PAGE answers `notFound()` to anyone else (signed out included) and
every action (`actions.ts`: `previewReconcileAction`, `applyReconcileAction`; `create-lead.ts`: `createLeadFromReconcileAction`)
re-resolves the role on every call (`authorizeReconcile`, `src/lib/reconcile/authorize.ts`) and reads or writes nothing for a
refused one. Nothing is written to Lawmatics, anywhere on this screen, and no mail is sent or opened for its body.
- **The furthest dated evidence is proposed** (this replaced "the sheet wins"). `src/lib/reconcile/propose.ts` (`proposeStage`, pure)
  takes every status code, Lawmatics stage, note and mail, each naming a stage of the firm or none, and proposes the MOST ADVANCED
  stage that has evidence, ties to the newest. Never backwards from the lead's current stage; `declined` / `nurture` only from an
  explicit note at least as new as all progress (silence never proposes them); a fact the firm has no stage for is cited and
  proposes nothing; an undated fact is cited and never acted on. Confidence: `agree` (two or more sources at the proposed stage),
  `conflict` (a status-level reading, such as a status code older than the notes, names another stage; the proposal is still the
  most advanced), `sheet_only` / `single_source` (one source speaks), `no_evidence`. The proposal text lists every piece of evidence
  with its source and date ("Proposal sent Oct 16 (sheet note) · Follow-up sent Oct 18 (email)").
- **One milestone classifier** (`src/lib/reconcile/milestones.ts`, pure) for sheet notes, Lawmatics notes and mail: contacted <
  consult_scheduled < consult_held < questionnaire_sent < opinion_letter_sent < proposal_sent < follow_up_sent < accepted < loe_sent <
  paid / hired, plus `no_show`, `declined`, `nurture`. A table of phrase rules with negation guards ("did not attend", "not sent",
  "rescheduled"); unknown text is no milestone. Mail has a direction: only mail the firm SENT can be a milestone. A milestone names a
  stage through `stageForMilestone` (the firm brain's `stage_mapping` entry first, then ONE defaults table, `MILESTONE_STAGE_NAMES`);
  a milestone with no stage gives no proposal. Don't add a second place that maps text to a stage.
- **`needs_matter`.** A sheet status code of 7 or higher, Lawmatics "Hired"/"Hired Client", or a top milestone of accepted / paid /
  hired proposes NO stage and links to Open a matter. It outranks everything else. Any other unmapped Lawmatics stage is shown as
  unmapped; its own name is still read as a milestone ("Proposal Sent", "Consult Completed").
- **No `won` stage is ever a target** (proposal, Pick another, bulk or apply, Create lead): a move there runs the matter handoff and
  stops the lead's sequences. Apply refuses it again against the live stage list.
- **CSV only, 5 MB; the whole workbook as ONE CSV is fine.** No spreadsheet library is installed (`xlsx` lives in lectual, not here), so an
  Excel file is refused with the save-as-CSV sentence. `src/lib/intake/sheet-sections.ts` finds EVERY section by its header (the old
  reader trusted row 1, so a workbook whose first tab was a task list found no intake rows): each intake section (either layout,
  owner under `0` or `Client Name`) is parsed with its OWN header and merged by the importer's `sheet_key` rules (identical rows
  merge; rows at different codes stay apart and match as ambiguous); PNC contact lists (First Name / Last Name / Email Address) are a
  read-only source of addresses for name matching; every other section is listed as skipped (never silently dropped), in the summary
  line "Read: Trademark intake (3 sections, 1,170 rows). Skipped: Tasks, Contracts." Rows keep their WORKSHEET row number.
  `src/lib/intake/sheet-import.ts` is the port of lectual's `parseIntakeSheet` (see `PORTED_FROM.md`, one change: `Client Name`).
- **Sheet notes** are the log in `Description` and `Notes`; `splitNoteEntries` gives dated entries and each is classified. A clamped
  future date is not evidence of when.
- **Lawmatics** is read through the firm's own connection with the read-only client (`pullSource`, `listAll`, `get`). Not connected,
  failing, cut short (truncated) or missing its stage relationships are each a named state, never an empty book. **Notes**
  (`src/lib/lawmatics/notes.ts`, `GET /notes` per person, not verified against a live account) are read for the people on the table
  (at most 150 per run), swept page by page, held in memory as date + milestones + a 140-character snippet and never stored. Lawmatics
  ignores parameters silently, so every note must name its own `notable_id`; a note for someone else is dropped and notes that name no
  record are UNAVAILABLE for that person, never "no notes".
- **Email has three parts.** The stored mail the mailbox sync classified (`email_sent` / `email_received` rows, with direction and
  subject), the Stage Keeper's moves, and an on-demand read-only SEARCH of the firm's connected Microsoft mailboxes
  (`src/lib/reconcile/mailbox-search.ts`; `mailbox` module required; the caller's own scoped view of the connections, sealed tokens via
  `my-mailbox.ts` only). For each person with a real address (the lead's own, Lawmatics', or a unique match on a contact list):
  `$filter` on sender / recipient and the last 120 days, `$select` of subject, date and direction only, at most 25 messages, at most 40
  people per preview. NEVER a body, a preview or an attachment, and nothing about it is stored. States are named, never "no mail":
  ok (with truncated / unread mailboxes), no address, module off or unchecked, no mailbox, Gmail only, scope missing, reauth, failed,
  limit. A sensitive thread contributes nothing.
- **Last touch.** The newest dated evidence across the sources (milestone evidence, the sheet's newest log date, every synced or
  searched mail), never in the future, is the row's proposed last touch. Apply sets `last_activity_at` to it only for a lead the person
  applied, only when it is a real past date and NEWER than what the lead held before the apply (a move stamps now; the evidence date
  replaces that), through `bumpLeadLastTouch`.
- **Not in Lectual yet.** Sheet rows, Lawmatics records (not hired, not in a matter-opening stage, newest 100) with no lead are
  listed with a Create lead button. Nothing is created until it is pressed. `createLeadFromReconcileAction` re-validates the candidate
  the browser sends back (`parseCandidate`), uses the scoped client only, takes the org from the session, refuses a second lead for the
  same sheet key / Lawmatics id / address, files in the sheet's stage (never a `won` one) else the first open stage, sets the source to
  where the person was found, and logs `lead_created`. After that the person reconciles like any lead.
- **Matching.** A lead matches a sheet row on `sheet_key`, exactly first. `sheetKeyFor` includes the status code, so a row that moved
  on the sheet has a new key; failing an exact hit the owner and mark are also tried under every intake code 0 to 6. Two candidates for
  one lead, two leads with one `sheet_key`, or two leads reaching one row are reported as ambiguous: none of those leads gets a sheet
  reading, and the summary counts them. Never picked. A lead with no `sheet_key` has no sheet reading.
- **Apply** goes only through `moveLeadStage(id, stageId, evidenceAt?)`, which logs `stage_changed`, plus the last touch above. The
  optional third argument stamps `stage_entered_at` with the newest non-future dated evidence at the proposed stage; a person's "Pick
  another" carries no date.
- **The fingerprint covers the plan the person was shown** (SHA-256 of the rows, sorted, `fingerprint.ts`, the proposed last touch
  included). It is an integrity check, not a signature. Apply recomputes it, then re-reads every lead and stage through the scoped
  client and refuses the WHOLE apply, writing nothing, when a lead is missing or no longer in the stage the plan recorded. One request
  moves at most 200 leads.

## Lawmatics import: no person is dropped silently (Sprint 26)
`/dashboard/settings/integrations/lawmatics/` (`src/lib/lawmatics/import-plan.ts` plans, `import.ts` pulls and writes). Every person
Lawmatics holds lands in exactly one bucket with a reason, and the preview SHOWS the ones that need a person.
- **A stage the firm has no name for is imported, not dropped.** "Proposal Sent", "Consult Completed", "Hired", a stage that opens a
  matter: the person is created in the firm's FIRST open stage (lowest-ordered `open` stage) with a `stageDecision`, shown as "Imported,
  stage needs a decision: <stage>" or "Hired in Lawmatics — open a matter", and never put in a `won` stage. The alias table in
  `stage-map.ts` is not widened. The flag is recorded, with no schema, as `lawmatics_stage_unmapped` (and `hired_in_lawmatics`) in the
  payload of the lead's `lead_created` activity row, written after the insert (`recordStageDecisions`); a flag that fails to write is
  counted in the report (`flagsNotRecorded`), never thrown. A firm with no open stage keeps them in `unmapped` with that reason.
- **A Lawmatics contact with no prospect is a lead** (`contactCreates`, source "Lawmatics contact" in `referral_detail`), deduped by
  contact id within the pull and by email, case-insensitively, against existing leads and against the prospects of the same pull. The
  lead row has no place for a contact id, so a second run finds the person by the stored email. No email: skipped, with the reason.
- **The practice-area filter defaults OFF** (plan options and the checkbox). When on, every excluded person, including one with no
  practice area, is skipped WITH a name and a reason, and the lists are open on the screen. The summary line reads "N skipped, M need a
  stage decision".
- **"Find a person in this pull"** (`src/lib/lawmatics/find-in-plan.ts`, pure; the preview carries up to 6,000 people) answers which
  bucket a name, business or email is in and why; no match says "Not in this pull" and names the causes (truncated, filter on, no
  prospect). A truncated pull keeps its warning and is never presented as complete.
- The fingerprint covers the stage flags and the contact leads, and the confirm step still re-derives the plan before writing.

## Setup checklist (`/dashboard/setup`, no schema)
A ten-item "get the firm set up" page for owner/admin/senior_admin, computed from real state. The page and
the Today card only read; the "Set up" links go to pages that already exist and gate themselves.
- **Pure rules:** `src/lib/setup/checklist.ts` (`setupChecklist(state)`), `roles.ts` (`canSeeSetup`, fails closed),
  `routes.ts` (`SETUP_PATH`, shared by the Settings redirect and the Today card). `build.ts` reads each fact on its
  own; `readers.ts` is the live set (scoped client only, no service role, no write); `load.ts` is `loadSetupState()`.
- **The ten, and when each is done:** firm profile with a display name AND an email sign-off; more than one member;
  a visible Microsoft mailbox connection `active` (`mailbox` module on; personal Outlook of a colleague is invisible
  by RLS and doesn't count); Lawmatics `active`; at least one Fathom/Zoom source `active`; LawPay `active`; at least one
  enabled agent setting (`agents` module on; no row means off); an intake form with status `live`; "Packages saved" =
  an ACTIVE `legal_fee` item in the service library (`isOfferablePackage`, the intake form's own test, not the
  proposals module's package prices); the AI key set on the deployment.
- **Three states per item, never two:** done / to do / couldn't check. A read that failed (or an intake table that
  can't be asked) is `couldnt-check`, never done and never to do, and no error text reaches the screen (the reading
  keeps only "could not be read"). The module list is read by the loader itself so a failed read isn't "module off".
  A module that is off is "to do" with a link to Settings → Modules, so the count is always N of 10.
- **Settings redirect:** `/dashboard/settings` goes to the setup page for the admin tier until all ten are done (a
  couldn't-check item counts as not done), then to Integrations as before. Every other role, signed out and an
  unresolvable role go to Integrations without the loader running. The setup page's "Go to Integrations" link is the
  escape for a firm whose remaining items are Lectual's to switch on (LawPay or Zoom not set up, no AI key, a module off).
- **Today card:** `FinishSetupCard` (`src/components/setup/`) is its own async component with its own reads, so Today's
  `page.tsx` only imports and places it. It renders nothing for other roles and when complete, and still shows (with
  "N couldn't be checked") when reads fail.
- **Integrations polish:** `src/components/integrations/` holds the one header (`IntegrationHeader`), status pill
  (`StatusPill`, seven states each with its own label) and `HelpText` used by every card on Integrations and Meetings.
  The Zoom card on Meetings says Zoom isn't switched on when `zoomSetup()` isn't ready (copy in `lib/integrations/copy.ts`).

## Copilot (`/dashboard/copilot`, the floating drawer; no schema)
Read-only Q&A over the firm's own matters, leads, deadlines and activity. It changes nothing and sends nothing; the
tool set (six reads) and the retrieval-only UPL system prompt are in `src/lib/agents/matters-chat.ts`.
- **The route streams.** `POST /api/matters-chat` answers Server-Sent Events: `tool` (status, in plain words),
  `delta` (text as the model writes it), `context` (only when the drawer sent a lead or matter page: found /
  not-found / unavailable), then one closing `final` (`answer`, `citations`, `declined`, `readFailed`) or `error` (a fixed
  sentence, never raw error text). Everything that can be refused is still plain JSON BEFORE the stream opens, with the
  old statuses (400, 422, 401, 403, 503). `final` carries the authoritative answer and the browser replaces what it
  streamed with it: a short preface before a tool call can show for a moment. Wire format and parser: `src/lib/copilot/sse.ts`.
- **Model:** `copilotModel()` in `src/lib/ai/claude.ts` = `env.COPILOT_MODEL || "claude-sonnet-5"`; nothing else reads
  `COPILOT_MODEL`. The agents use `agentModel(agent)` (see Agent models below). `streamClaudeWithTools` sits beside the unchanged
  `callClaudeWithTools`, with `cache_control` on the system block and on the last tool.
- **Per question:** tool calls in one step run in parallel; `listMatters()` is read once (`search_matters` and
  `list_stalled_matters` share it, and a failure is shared too, so both report it and `readFailed` is set); the last 10
  turns are sent as `history` (text only, oldest dropped first to fit about 8k estimated tokens at 4 characters a token,
  each turn clipped; `src/lib/copilot/history.ts`). A tool that throws hands the model a fixed sentence, not the message.
- **The drawer** (`CopilotLauncher`, mounted once in the dashboard layout): a fixed bottom-right button and a right drawer
  holding the same chat. Hidden on `/dashboard/copilot` and wherever `aiConfigured()` is false. Command-J (Ctrl-J
  elsewhere) toggles, Esc closes, Tab wraps inside it, focus goes to its input on open and back to the button on close.
  Once opened it stays mounted (hidden) so a thread survives closing it. Decisions are pure and tested in
  `src/lib/copilot/launcher.ts`.
- **Page context is never trusted for data.** The browser sends the pathname (and the id it parsed); the server parses
  the pathname AGAIN (`parseCopilotContext`: only `/dashboard/leads/<uuid>` and `/dashboard/matters/<uuid>`, with any sub-path),
  ignores a client id that disagrees, and re-reads the record through `getLead` / `getMatter` (scoped client, RLS).
  Another firm's id reads as null, same as a missing one: a `not-found` status, no record data in the prompt, and the
  answer still streams. The record's fields enter the user turn as a block marked as data, never instructions.
- **Cost is logged, not stored.** One `[copilot] org=… model=… in=… out=… cacheRead=… cacheWrite=… costUsd=…` line per
  answer (`src/lib/agents/copilot-cost.ts`), org id from the session, tokens summed over the steps, price from the
  `claude-sonnet-5` table entry; never the question, answer or any record field. It is not in `agent_run`: that table's
  agent CHECK has no `copilot` until lectual migration 0098 is applied, and a signed-in role cannot write it (the
  service-role client is off limits here). Point `logCopilotCost` at it once 0098 is on. Never shown to firms as credits.
- **Landing page:** an async server page. The four glass cards (open matters, stalled matters, deadlines in the next 14
  days including overdue, approvals waiting) are separate reads; a failed read is a dash and "Couldn't load", never 0, and an
  unconnected queue says so (`src/lib/copilot/stats.ts`, queue only through `loadActiveQueue`). The hero palette lives once,
  in `src/app/dashboard/copilot/copilot.css`; the chat and launcher styles are in `src/components/copilot/copilot.css`,
  imported by the components so they load on every dashboard page.

## Outlook calendar (lectual 0098, Sprint 15)
The daily mailbox-sync cron also reads each connected Microsoft mailbox's Outlook calendar into `crm_calendar_event`,
so the calendar page, the lead page ("Consult booked") and Today's Consults card can show consults. Google stays mail-only.
There is no new cron (`vercel.json` is unchanged); the step is `syncOrgCalendars` in `src/lib/calendar/outlook-sync.ts`,
called from `runMailboxSync` after each firm's mail, with its own `calendar-sync` `agent_run` row (counts only).
- **Scope:** `Calendars.Read` is asked for at connect time but is NOT in the `required` list, so declining it still connects
  the mailbox for mail. `hasCalendarScope()` (`providers.ts`) is the one definition; a connection whose stored `scopes` lack
  it is skipped (no Graph call, counted as needing reconnect) and Integrations shows "Reconnect to read the calendar". Refresh
  sends `Calendars.Read` only for a connection that granted it: Microsoft refuses an ungranted scope, which would look like a
  dead token and take mail sync down. `freshAccessToken` keeps the caller's row current so the calendar step never replays a
  refresh token the mail step just rotated.
- **Stored, and never stored:** title, start, end, all-day, location, join URL, organizer, attendee addresses (lowercased, at most
  50), `is_consult`, `lead_id`. `OutlookEventRow` (`outlook-parse.ts`) is an explicit allow-list with no field for the body.
  `bodyPreview` is read only to find a Zoom or Teams link and dropped. Nothing (agent_run, cron JSON, logs) carries a title,
  address, location or link. The upsert key is `org_id,source,external_id`; `org_id` comes from the connection row.
- **Vanished events:** removed only after a COMPLETE read (page cap not reached, no page failed), and only rows with that
  `org_id`, `source = 'outlook'`, that `mailbox_connection_id` and a start inside the read window. The vanished ids are
  computed from a select first and deleted in small `in` chunks (a `not in` list of Graph's long ids would overflow the URL).
  A cancelled event is not stored and counts as vanished.
- **Consult and lead:** `is_consult` = title matches `strategy session|discovery call|consult|initial call`, OR a lead is linked and
  the organizer is the address of a `mailbox_connection` in the same firm. `lead_id` is the one lead whose email matches an
  attendee exactly (case-insensitive); none, or several (even one address on two leads), is null, never a guess.
- **Three states everywhere** (`outlook-read.ts`, scoped client only): `ok` / `database-update-needed` / `unavailable`. A failed
  read is never an empty calendar or "no consult booked". The Outlook reads on the three pages sit behind `orgHasModule("mailbox")`.
- **Before 0098 is applied** the columns do not exist: the sync's first refused statement (42703 / PGRST204, or 23514 on the
  `calendar-sync` agent_run insert) ends that firm's calendar step as `database-update-needed` with nothing written or deleted,
  mail sync is untouched, and every reader says "until the database update". Apply 0098 to BOTH lectual-dev and lectual-prod
  before the reads light up. Known limit: the same meeting on two connected mailboxes is stored (and shown) twice.

## Stage Keeper (Sprint 16, needs lectual 0098)
`stage-keeper` is a rule-based agent (no model call, no AI key, no queue draft, nothing sent) that places leads on the Intake
board from facts the firm already recorded: the mail the sync matched to leads (`email_sent` / `email_received` rows with their
stored type, direction, date, subject and `sensitive` flag) and the Sprint 15 Outlook consults. `targetStageFromSignals`
(`src/lib/agents/stage-keeper/target.ts`, pure) picks the furthest-forward stage the signals support; `run.ts` acts on it.
- **Autonomy:** `act` moves the lead (default for the agent); `suggest` / `draft` write a suggestion card instead. A firm still has
  to switch it on (no setting row means off), and it can only be saved once lectual 0098 is applied (the CHECK refuses it before).
- **Mapping:** the firm brain `stage_mapping` entry keyed by signal id (`consult-scheduled`, `questionnaire-sent`,
  `post-consult-sent`, `loe-invoice-sent`; stage name in `data.stage`, else the body), else the default names in `mapping.ts`
  (the one table of stage names) through `resolveStage`. An entry naming a stage the firm lacks gives nothing: no fall-back.
- **Never:** backwards or sideways; into a `won` / `lost` / `nurture` stage (those, and `welcome` / payment signals, become
  suggestion cards a person accepts); a lead already in a `won` stage; a lead with any sensitive mail or consult title in the
  30-day window; a lead a person moved in the last 7 days (a card instead); the hot / warm / cold routing columns; a send.
- **`signal_key`** is `<lead id>:<mail|calendar>:<message or event id>`. An earlier agent move OR an earlier suggestion (pending,
  accepted or dismissed) carrying it consumes it, so an undone or dismissed signal never returns. At most one action per lead per run.
- **The move** is `moveLeadStageAs(actor, ...)` (`src/lib/pipeline/move-as.ts`). A person delegates to `moveLeadStage`; the agent
  is service role, org-fenced, refuses non-`open` / non-forward / foreign destinations, and its update is conditional on the lead
  still being in its from-stage. The `stage_changed` row has `actor_type = ai`, `payload.actor = "agent:stage-keeper"`
  (`AGENT_ACTOR`, defined once in `src/lib/stage-keeper/moves.ts`) and an evidence object: mail is type, direction, date, subject;
  a consult is title and start. Never an address, body, preview or location.
- **Agent moves fire no automation rules and open no matter.** `runRules("stage_changed")` and the matter handoff run through the
  signed-in client, which the cron does not have. It cannot enter a `won` stage, so the handoff is never needed; a firm rule keyed on
  "moved to stage X" does not fire for an agent move.
- **Suggestions are `ai_insight` rows** (`source: "stage-keeper"`, `kind: "stage_suggestion"`); a person's decision is a later
  `ai_insight` row (`source: "stage-keeper-review"`, `suggestion_id`). Accept goes through `moveLeadStage` and refuses a stale card;
  Dismiss changes nothing and does not touch last touch (`logActivity(..., { touchLead: false })`). Undo moves back through
  `moveLeadStage` with the stage-entered date the agent recorded, and the move and its signal stay used.
- **Where it runs:** right after the sync, in the mailbox-sync cron (`runStageKeeperAfterSync`, wrapped so it can never change the
  route's response), on Run now, and in the agents cron (a second run is a no-op through `signal_key`). `vercel.json` is unchanged.
  The same post-sync step bumps a lead's last touch to the end of a held (past, linked) consult, forward only, whether or not the
  agent is on.
- **Seeing it:** the Intake "Moved by agent" chip and `?agent=today|7d` filter, the lead timeline line with Undo, the suggestion
  cards on the lead page, the Agents-page "N leads moved today", and the reconcile screen's "Email / calendar" source all read
  `src/lib/stage-keeper/moves.ts`, so they cannot disagree. The move read is two-state (`ok` / `unavailable`); an unreadable list
  is said out loud and never filters to "no leads".
- **Before 0098 is applied:** the calendar half of the input, the held-consult bump and saving the setting say "not available until
  the database update"; mail signals still work for a firm that managed to switch it on. A firm switching it on can see up to 30 days
  of matched mail acted on in the first run (each move forward-only and undoable).

## New agents: morning-brief, consult-prep, inbox-summary (Sprint 17, need lectual 0098)
Three in-app agents that ONLY DRAFT. Their output is an approval-queue draft (`ctx.createDraft`) or, for the inbox
summary, a draft in a person's own Outlook Drafts folder. No send call, no send scope, no automatic delivery. They run
as the service role, org-fenced, from `runAllAgents` (the existing daily `/api/cron/agents`) and from Run now; they are
NOT in the mailbox post-sync hook (that stays the Stage Keeper's) and `vercel.json` is unchanged. Every system prompt
starts with `AGENT_POLICY`, and mail, answers and subjects reach a model only inside tags with `<` and `>` made inert.
- **Autonomy:** default `draft`. `draft` and `act` behave the same. `suggest` writes the internal BRIEFING only: no
  follow-up email, no client-prep email, no Outlook draft.
- **Before 0098** the settings CHECK refuses all three (the action says "isn't available until the database update"),
  their `agent_run` rows are refused, and `crm_calendar_event` has no `is_consult` / `lead_id` / `source`. Readiness shows
  "Not available until the database update", inferred from the same column probe the calendar readiness uses
  (`readCalendarProbe`); consults say so in words, never "no consults".
- **The Mailboxes module is checked on every run**, not only on the Agents-page label. `runOneAgent` already reads
  `crm_org` for `queue_org_key`; the same select also carries `modules` (`ctx.orgModules`, `null` when the read failed or
  found no row). `mailboxModuleState` (`src/lib/agents/mailbox-gate.ts`, the one place the module is named) answers on /
  off / unreadable, and unreadable is treated as off with its own words. inbox-summary and consult-prep end `skipped`
  before any provider or calendar statement; morning-brief writes its brief with the consults section marked not read.
  A failed `crm_org` read also loses the queue key, so the agents say the firm's settings couldn't be read rather than
  that no queue is connected.
- **morning-brief** (`src/lib/agents/morning-brief/`): six sections read independently (`ok` / blocked /
  `database-update-needed` / `unavailable`), so a failed read says "Couldn't be read" and an empty one says "Nothing today".
  If no section could be read the run throws. Up to 5 stalled-lead follow-ups a run (most stalled first), none for a
  sensitive thread, a lead followed up in 7 days (a `queue_drafted` row, which does not count as contact), a lead with no
  real address, or a lead with a draft already pending. "Pending" uses the repo's three linking rules in order through
  the SAME resolver the lead pages use (`resolveBatch`, now in `src/lib/queue/resolve-batch.ts`, called by
  `lead-pending.ts` with the signed-in client and by the agent through `orgFencedReader`), then a case-insensitive client
  name. If the pending list (`ctx.listPending`) or any link lookup can't be read, NONE are drafted and the brief says why.
- **consult-prep** (`src/lib/agents/consult-prep/`): a consult in the next 24 hours, linked to a lead, with no prep
  recorded. Two `queue_drafted` rows per consult (heads_up, client_prep) carry the event id, so a second run skips it.
  The heads-up is a facts card rendered from data, not written by a model. The client email goes through the staff flow's
  builder (`buildClientPrepDraft`, with an optional injected text generator so the run's cost total sees it). That builder
  is RPB Law's wording, name and address, so the client email is written ONLY for a firm holding the `agent-toolkit`
  module (the gate `prepConsultAction` uses; `agentToolkitModuleState` in `mailbox-gate.ts`, read from `ctx.orgModules`,
  unreadable = off). Without it the run writes the heads-up only, makes no model call and says so in the summary
  ("the client-prep email template isn't set up for this firm"). Classes,
  package and price are never generated: values read from the record have refusable fragments withheld (`[omitted]`),
  the client's own answers are shown verbatim in a labelled block, and a model output carrying one is refused and counted.
  Both drafts are built before either is queued.
- **inbox-summary** (`src/lib/agents/inbox-summary/`, triage in `src/lib/inbox/triage.ts`): reads inbound mail of the last
  24 hours through `fetchNewMessages`'s optional `window` (newest first, 200 per mailbox, never the sync cursor). Bodies
  are fetched only for a message that gets a reply draft and are never stored. The reply is a NEW message addressed to
  the sender ("Re: <subject>") in a personal Outlook mailbox's Drafts, not a threaded reply, because that is what
  `createMailboxDraft` makes. None for a sensitive thread, a scam, official correspondence, an automated sender, a shared
  mailbox or a Gmail mailbox. A message that already has a "Re: <subject>" draft to that sender is skipped; a Drafts folder
  that can't be read means no reply drafts for that mailbox (fail closed).
  The digest is metadata only: no message preview or body is ever written to it. The queue row is firm-shared and a
  personal mailbox is visible only to its owner, so a message from a `personal` connection that is not filed on a lead
  or matter is only COUNTED per bucket ("N unmatched messages in personal mailboxes..."), never listed with sender,
  address, subject or link (`personalUnmatched` on the digest item). Reply drafts go to the owner's own Drafts folder.
- **Logging:** counts only in `agent_run`, the summary and every thrown message. The briefing and the digest are the
  one place names and subjects appear (a briefing for the firm; the digest only for filed or shared-mailbox mail), and
  they are internal.

## Skills page and Run now diagnostics (Sprint 18, no schema)
`/dashboard/skills` lists the seven staff-run skills the app already has and links to the existing action on a chosen
record. It reads only and writes nothing: no server action, no insert/update, no send. No migration, no new module.
- **Catalog:** `src/lib/skills/catalog.ts` (pure) is the one source: Prep a consult, Draft the engagement letter, Welcome a
  client, Filing follow-up, Opinion letter, Trademark clearance, Meeting follow-up, in that order, plus the nine Claude-only
  (Cowork) names. It is this app's own wording; nothing is read from the lectual-plugin at runtime. Each skill has a
  `href(kind, id)` that is the only place its deep-link is built (the record's id only, `encodeURIComponent`, trailing slash).
  The cards render a plain `<a>`, not `next/link`, so the href reaches the page exactly as built (Link strips the slash in tests).
- **Where each lands:** Prep -> lead page `#prep-consult` (the `<details>` panel); Welcome and Filing follow-up -> matter page
  `#client-updates`; the three letters -> `/dashboard/documents/new/<matter>/{loe,opinion-letter,trademark-clearance}/`;
  Meeting follow-up -> the lead's or matter's page (its Meetings panel), plus a plain "Open Meetings" link, because that action
  works on a recorded meeting. `tests/skills/catalog.test.ts` checks every path, that each route exists on disk, and that each
  anchor id appears exactly once in the lead and matter page sources. The filing follow-up card only appears on a matter with a mark in
  Awaiting Trademark Registration; the card says so.
- **Gates:** the page and its search need `agent-toolkit` (`notFound()` otherwise, session or not; the not-found path names no
  module). A card whose target needs a module the firm lacks (`document-center` for the three letters, `agents` for Meeting
  follow-up) shows its description and "Not switched on for this firm." with no picker, so the page never links to a 404. A role that
  cannot write leads (viewer, social media; `SKILL_RUN_ROLES`, held equal to `CAN_WRITE_LEAD` and `MATTER_WRITE_ROLES` by a test)
  sees the catalog, a role line and no picker. The destination pages re-check the role themselves.
- **Picker rules (`src/lib/skills/pick.ts`, pure):** the existing `listLeads` / `listMatters` through the scoped client, narrowed in
  memory. A term is trimmed and capped at 80 characters, matched case-insensitively against name, business, email (leads) or
  mark, title, matter number, client (matters). With no term the list is the recent records, capped at 8, with "Showing N of M".
  The term rides the URL (`?skill=<slug>&q=<term>`) and applies to that card only. Welcome a client lists only `TM` matters.
  A failed list read says "We couldn't load your leads/matters" on that card and never "No matches"; the other kind still renders.
- **Run now (`src/lib/agents/run-now.ts`, pure):** `decideRunNow` is the only place the reasons live, and both the Agents page and
  `runAgentNowAction` call it, so the page cannot offer a run the action refuses. The button is always drawn on a card whose
  settings were read; when it can't run it is disabled and the sentence is printed beside it (`aria-describedby`). Precedence, first
  that applies wins: running, role (below senior admin), database update (Morning brief, Consult prep, Inbox summary only, when
  `databaseUpdate` is `pending`), off, Autopilot paused, Autopilot unreadable, AI key (never the Stage Keeper). Autopilot "not set up"
  (0082 missing) blocks nothing. A run that finishes leaves a result line (summary and "N read, M drafts written", "Skipped. ..." or
  "The run failed: ..."), drawn as an alert only for an error. A setting that can't be read is not "off"; the action says so.
- **0098 wording is shared with readiness:** `NOT_AVAILABLE_UNTIL_UPDATE` in `readiness.ts` is the label there and the start of the
  Run now reason (`Not available until the database update (lectual 0098).`). The action probes the calendar columns the same way
  the page does (only for a firm with the Mailboxes module), so a firm that can't see the update state is never blocked on a guess.
- **Existing assertions changed on purpose:** the Morning brief card snapshot (`tests/agents/new-agents-page.test.ts`) now holds the
  Run now reason; `tests/nav.test.ts`, `tests/shell/section-label.test.ts` and `tests/reports/link-tiles.test.ts` name only SMS and
  Client portals as unbuilt, and Skills is built.

## Accepted + paid proposal -> LOE draft, and the /p/ acceptance follow-ups (Sprint 19, no schema)
Everything after a client accepts on `/p/<token>`. Internal only: nothing here sends, moves a stage, or opens a matter.
- **Every step is an `edited` event with a `step` and an `outcome`.** `client_proposal_event.type` is a closed set (no `paid`),
  its staff insert policy allows only `edited` / `revised` / `viewed`, and this repo adds no migration, so `src/lib/proposals/paid.ts`
  owns the vocabulary: steps `paid_marked`, `paid_undone`, `accept_notice`, `lawmatics_note`, `loe_draft`, `accepted_file_upload`,
  `loe_file_upload`, `custom_fields`; each has ONE success word (`STEP_SUCCESS`: marked, undone, sent, added, queued, uploaded, uploaded,
  written) and the rest are `blocked` (a person can fix it), `failed` (a call went wrong) or `skipped` (nothing to do). Staff steps are
  `actor = 'staff'`; the two that run with no session on the public path (`accept_notice`, `lawmatics_note`) are written by the service
  role as `actor = 'system'`. Readers that only know "edited" must call `describeStepEvent` / `stepActivityLabel` first (the history
  and the list's Last activity do). The consult agent's evidence reader filters `actor = 'agent'`, so step events never reach it.
- **Paid is derived, never stored.** `paidStateFromEvents`: the newest of a version's `paid_marked` / `paid_undone`. The read is three-state
  (paid / not paid / "Paid status couldn't be read"); a failed read is never "Not paid" and offers no Mark paid. Roles: owner, admin,
  senior_admin, intake (`PROPOSAL_PAID_ROLES`, a subset of the event policy's staff roles). Page and list both draw from `paid-view.ts`.
- **Acceptance follow-ups** (`accept-followups.ts`, scheduled with `after()` from `public.ts`, awaited instead when there is no request scope):
  an in-app `approval_needed` notice to the approvers named in `client_proposal_setting` who are still members, plus every `intake` member,
  same org only; payload is exactly `source: "proposal_accepted"`, `proposal_id`, `headline` ("<client> accepted <package> · legal $X", legal
  fee only), and `describeNotification` renders it as "Proposal accepted" linking to the proposal. Then a Lawmatics NOTE through the firm's own
  token. `public.ts` passes its service-role client in; the module imports no admin client. Once per version: a step that already ended in its
  success word is not repeated, one that failed is tried again. An unreadable timeline holds the note back (a second note is worse than none).
- **Note target, in order:** the proposal's `matter_id` -> `crm_matter.lawmatics_id`; its `lead_id` -> `crm_lead.lawmatics_id`; exactly one of the
  firm's own leads whose email equals the client's (case-insensitive) and that has a `lawmatics_id`. A record with no `lawmatics_id` falls through;
  two matches or none is no note, with the reason on the timeline. All are Lawmatics matters (`notable_type: "Prospect"`). No contact sweep is built.
- **LOE draft** (`loe-adapter.ts`, `paid-flow.ts`): only through `generateTrademarkLoe` (the LOE form's own path, `ENGAGEMENT_LETTER` queue item,
  draft payload carries `proposalId`). Drafted only when a matter exists (`matter_id`, else the single matter for the lead; two is "draft it from
  the right matter"; none is "Open the matter to draft the LOE."), the firm has Document Center, the package is on the firm's CURRENT list
  (`client_proposal_setting.pricing` through `normalisePackages`; otherwise "Choose the LOE template", never guessed; an unreadable list is its
  own state; `legacy` is never chosen), and EXACTLY ONE brand name was accepted (`TrademarkLoeInput` is one mark). Legal fee and USPTO fees are
  separate figures; gov fees are the quote's own number, printed as "$700 ($350 × 2 classes)" when the math agrees.
- **Once per version, and the race.** Done-ness is read from the version's own timeline (and, for the LOE draft, the matter's drafts whose payload
  has this `proposalId`). There is no database constraint behind it, so two truly simultaneous Mark paid clicks could queue two drafts; a re-click,
  undo then mark again, and a reload create exactly one. Undo deletes and withdraws nothing.
- **Uploads.** The accepted-proposal docx uploads at "marked paid" (`POST /v1/files`, `documentable_type=matter`, `documentable_id` = the matter's
  Lawmatics id, `file`, `path[]=Engagement`; multipart, no Content-Type set by us). The approved LOE uploads only from the approve hook
  (`loe-upload.ts`), and only for a draft whose payload carries `proposalId`; other letters are untouched. An upload failure never changes the
  approval or the stored document. Retry re-reads the stored docx. The token is `firmLawmaticsToken()` (signed-in, active connection only) or
  `firmToken(admin, orgId)` on the public path, never a deployment-wide one.
- **LOE fields (stretch), OFF by default.** Stored with no migration under `client_proposal_setting.pricing.lawmatics_loe_fields`
  (`{ enabled, map: { <name>: <Lawmatics custom field id> } }`); `withPackages` and `parseSettingsPricing` keep it. At "marked paid", when
  enabled, one `PUT /v1/prospects/:id` with `custom_fields: [{id, value}]` for the mapped names only (no stage, no tag). Settings ->
  Integrations -> Lawmatics, admin tier + proposals module; a failed field list keeps the saved matches.
- **NOT verified against a live Lawmatics:** the `/files` multipart shape, the custom-field write shape and the `/notes` body come from the
  public API reference. Every non-2xx is "not done" and the page says the shape hasn't been checked; every 2xx is "done".

## New proposal picker and pre-fill (Sprint 20, no schema)
`/dashboard/proposals/new/` starts from a lead or matter. Internal only: nothing here sends, moves a stage or opens a matter.
- **"Who is this for?"** (`WhoIsThisFor.tsx`, rules in `src/lib/proposals/new-picker.ts`, pure): a Leads | Matters switch, a plain GET
  search, recent first capped at 8 with "Showing N of M", and "Start blank" (`?blank=1`: no list, the same blank form). It reuses
  `src/lib/skills/pick.ts` as it is (`leadRecord`, `matterRecord`, `normalizeTerm`, `pickRecords`, `PICK_LIMIT`; every matter type is offered) over
  `listLeads()` / `listMatters()`. The lead label is `leadOptionLabel`, moved to `lead-label.ts` (pure) and re-exported by `lead-options.ts`.
  A failed read is that kind's own "We couldn't load your leads/matters." alert, never "No matches"; the other kind still works.
- **Choosing is a link**: `?lead=<id>` or `?matter=<id>` (id URL-encoded, plus the person's own `&q=` so Change can return to the search; nothing
  else about the record is in a URL). The server re-reads the record through the scoped client, so another firm's id is "couldn't be found" and the
  picker stays. Once resolved the picker collapses to "For: <label> · Change". The matter wins when both are given. `kind` (`lead`|`matter`) and `q`
  only choose which list and search the picker shows.
- **Pre-fill** (`src/lib/proposals/prefill.ts`, pure): the client and first brand name from the lead (`mark_text`, else `business_name`) or matter
  (`mark_text`, else `title`, else its lead's). The first brand name keeps the firm's default word/logo descriptions; the mark text is the name,
  never a description. **No price is read from any record**: not the matter's `package_name`, not a consult's discount. The price fields are the chosen
  package's. **The pay link starts EMPTY** (Sprint 25): nothing fills it, not even the firm default.
- **Consult details fill more ONLY when the newest record is REVIEWED** (`loadReviewedConsult`, through `consult-prefill-load.ts`, the one place
  this feature reads them): each mark (grouped by `markKey`, so word + design of one name is one brand name with both marks; type not stated gets the
  default pair), its classes as the goods text (no class number is carried; at most 3 per brand name, the rest counted in the "Filled from" line; blank
  goods skipped), at most 10 names, all ticked. A package fills only when its name equals (trimmed, case-insensitive) one on the firm's CURRENT list; it
  then selects the dropdown and the five fields exactly as picking it by hand does. Otherwise the first package stays and, if the consult named one,
  "Package from the consult (<name>) isn't on your list. Choose one." With the settings unreadable there is no dropdown and no package note.
- **One line says why nothing was filled**: not reviewed (with a link to the lead), unreadable or failed read, reviewed with no usable mark, matter
  with no linked lead. No consult details at all has no line (the consult strip says so). The "Filled from" line names only the sources used.
- **The action does not trust the browser.** The form posts one checkbox (`useConsult`, ticked by default); `createProposalAction` re-reads the lead's
  consult details itself and refuses (creates nothing: "The consult details changed since this page loaded...") unless the newest is still reviewed.
  A ticked box with no lead id is ignored. With it off, the content is exactly the single typed brand name. The typed first brand name combines with the
  consult marks: a match (by `markKey`) is that mark's name and the others follow; no match stays first with the default pair; blank creates only the
  consult marks.
- **Entry points**: Quotes & proposals "New proposal" -> the picker; `LeadProposalsCard` -> `?lead=`; the matter page's small aside card
  (`MatterProposalCard`, Proposals module on AND a proposals-writing role; an unreadable module state shows nothing) -> `?matter=`.

## Agent run time budgets (2026-10-22 fix, no schema)
RPB's cron was killed at `maxDuration = 300` mid-morning-brief (row left "running", consult-prep and inbox-summary never
ran), intake triage failed on one truncated answer, and Run now could not be clicked. The rules now:
- **Every run has a budget** (`src/lib/agents/budget.ts`). `runOneAgent` races the agent against it; past it the run's
  `AbortController` aborts in-flight model calls and context fetches, the row is closed as error
  `Did not finish within the time limit` (`DID_NOT_FINISH_ERROR`), and a late result is ignored. Run now uses
  `AGENT_RUN_BUDGET_MS` (240 s) and answers `RUN_NOW_TIME_LIMIT` on the card. Agents read `ctx.timeLeftMs` /
  `budgetNearlySpent` and stop starting new items first (morning-brief follow-ups, intake-triage leads), saying so in the summary.
- **The cron** has one wall budget (`CRON_WALL_BUDGET_MS`, 270 s) and runs each firm's agents on `CRON_TRACKS`: track A in
  dependency order (stage-keeper, post-consult, morning-brief, consult-prep), track B (inbox-summary, email-intel,
  intake-triage) beside it. Each agent gets at most `CRON_AGENT_CAP_MS`; one with under `MIN_AGENT_START_MS` left gets a
  `skipped` row saying the run ran out of time. Don't put the agents back in one sequential loop.
- **A row still `running` 15 minutes after `started_at` reads "Didn't finish"** (`src/lib/agents/run-status.ts`) on the
  Agents page, its cards and the digest. Nothing waits on run rows: Run now is blocked only by its own request in flight.
- **Every outbound call has a deadline**: `callClaude`/`askClaude` (120 s, one retry, the run's signal), the queue API, Graph/
  Gmail/OAuth fetches (`src/lib/http/timeout.ts`), and the agents' service-role client (`getAdminClient({ timeoutMs })`).
- **`callClaude` checks `stop_reason` before parsing** (`readStructuredResponse`); the SDK's `parse()` parsed first, so a
  max_tokens cut-off surfaced as "Failed to parse structured output". `AiOutputError.kind` is refusal/truncated/shape, and a
  list agent skips the one item (`isUnusableModelAnswer`). Intake triage asks for 16000 tokens.
- **Run now's button stacks above the card footer** (`.lx-agent-slot-run` has `position: relative; z-index: 1`). It shares
  the footer's grid cell and comes first in the markup, so without that the footer took every click.

## Onboarding tour (Sprint 21, no schema)
A first-sign-in guided tour: a spotlight on the rail, bell, account menu and Copilot button, with a centered card whenever a target is
missing, hidden, off-screen or the window is under 768px wide. Internal only: it reads and links, and writes one preference.
- **Flag:** `user_metadata.lectual_tour = { version, seen_at, outcome }` (`finished` | `skipped`) on the person's own account, so it follows
  them across devices. `TOUR_VERSION = 1` (`src/lib/onboarding/tour.ts`); a missing, malformed or lower version shows the tour, and bumping
  it shows a new tour again. It is user-editable, so it decides only whether the tour is DRAWN, never what anyone may see or do.
- **Who and when:** everyone, once, on the first dashboard render that says "not seen" (current members included). The layout computes
  `open` from the `user` it already has (`shouldShowTour(user.user_metadata) && !actingAsStaff`), so a platform admin inside a firm they do
  not belong to never sees it. On the client it also stays closed when a visible `aria-modal` element is up on load (the hidden Copilot drawer
  does not count) or when the sessionStorage guard is set; in the modal case nothing is written, so it shows on the next page.
- **Steps:** `tourSteps({ role, navItems, aiConfigured })` is pure. Rail steps come from the same filtered `items` the rail gets, so a section the
  firm lacks is never mentioned; Copilot only with AI; the setup/settings step for the admin tier only (`canSeeSetup`), and it is never
  dropped for them (no Settings row means a centered card with the `SETUP_PATH` link). Queue wording follows `canApproveQueue`; viewer,
  social_media and any unknown role get the read-only wording.
- **One action:** `markTourSeenAction(outcome)` (`src/lib/onboarding/actions.ts`) uses `getScopedClient()` and `auth.updateUser`, merges the
  existing metadata, refuses signed-out and a bad outcome, and returns fixed sentences. Never the service role; no user or org argument.
- **"Show tips again"** is a button in the account menu. The menu and the tour are joined by a window event, `SHOW_TOUR_EVENT`; the tour
  restarts at step 1 whatever the flag or guard says. Finishing or skipping writes the flag again.
- **Fail open for the session:** closing is optimistic (`closeTour` in `engine.ts`): the tour goes away, the sessionStorage guard is set, then
  the outcome is saved. A rejected or failed save is swallowed and shows nothing; the flag stays unwritten, so a later sign-in can show it again.
- **Hooks:** `data-tour` tokens are `rail`, `nav-<slug>` (Today is `nav-today`), `bell`, `account`, `copilot`. A rail parent row carries its
  children's tokens, so a collapsed rail can still be spotlighted. A step cannot point at nothing: `tests/onboarding/tour.test.ts` greps the sources.
- **Tested without a browser:** the behaviour is in pure functions (`engine.ts`) and the dialog is checked with `renderToStaticMarkup`
  (there is no DOM test environment). Walk it once on desktop and under 768px.

## UI/UX fixes from the Oct 20 test notes (Sprint 22, no schema)
Display and derivation only: no data is rewritten, nothing is sent, no new dependency.
- **Titles:** every `page.tsx` under `src/app/dashboard` exports `metadata` (`pageTitle("Calendar")` = "Calendar · Lectual") or
  `generateMetadata`; `src/lib/ui/page-title.ts` is the one builder and `tests/ui/page-title.test.ts` walks the directory and fails
  for a page without one. Lead and matter pages read the record through `getLead` / `getMatter` (scoped client) and fall back to
  "Lead" / "Matter" when the read fails or finds nothing (`recordPageTitle`), so another firm's id gives the same tab as a missing one.
- **Navigation feedback:** `src/app/dashboard/loading.tsx` (skeleton, `PageSkeleton`, design tokens only) plus `NavProgress`, a
  dependency-free top bar that appears only after 150 ms (`src/lib/ui/nav-progress.ts`) and ends when the URL changes. `error.tsx` beside
  it says "This page couldn't be loaded" with Try again, so a failed navigation is never a stale or blank page. With a `loading.tsx` in
  place, Next prefetches dynamic dashboard routes only down to the skeleton.
- **Calendar:** every `<Link>` on the calendar page has `prefetch={false}` (a month grid is ~70 links to dynamic payloads). A month or week
  whose every read failed shows "couldn't be loaded", never an empty grid (`calendarReadState`); a partial failure keeps its banner.
- **Public intake link:** `shareState(status)` (`src/lib/intake-forms/share.ts`) decides whether Copy link, the QR code, Preview and the Share
  panel are offered. Only `live` is. Draft and archived show "Not live yet. Publish the form to share it." and a disabled control with
  `aria-describedby`. Anywhere a new place offers `/i/<slug>`, it asks `shareState`.
- **Counts:** the rail's Intake badge is the PNC list's length (intake-category stage, trademark or unset practice area;
  `INTAKE_PRACTICE_AREA_FILTER` in `src/lib/intake/counts.ts` is shared by the list and the badge). The Pipeline's first column is a
  different question (leads not yet at a consult, any practice area, plus form submissions not yet leads), so it is labelled, not forced
  equal: the badge has a tooltip and the column hint says why they differ.
- **Period comparison:** `periodDelta` withholds a percentage beyond +/-500% and a collapse to under a tenth of a prior period of 20 or more;
  `comparisonText` always gives the prior count ("2 vs 168 in the previous 7 days") and `KpiTile` prints it. Prior 0 shows a plain "+N".
- **Days in stage (Pipeline cards):** `stageAgeDisplay` (`src/lib/lifecycle/stage-age.ts`): the import rule applies only to a record carrying an import marker (lead: `lawmatics_id`,
  `lawmatics_synced_at` or `sheet_key`; matter: `lawmatics_id` or `lawmatics_synced_at`); a form or manual record whose
  stage date equals its created time counts days ("0d in stage"). For a marked record, a `stage_entered_at` that is not the created or Lawmatics-synced time
  counts days from itself (reconcile dates, Undo and plain moves set it on purpose, so a newer `stage_changed` row never overrides it); when it IS that import
  stamp, the newest `stage_changed` activity is the entry, and with none it reads "In stage since import" (no count).
- **Role-neutral copy:** nothing rendered to every firm names a person. The intake chip and badge read "Needs attorney" and hide the
  chip's count at zero. `tests/intake/role-neutral-copy.test.tsx` greps visible text. RPB-specific modules (consult proposal email,
  welcome, prep-consult, document templates, the ported assessment card) keep Rebecca's name on purpose.
- **Matter titles:** `matterDisplayTitle` (`src/lib/matters/display-title.ts`) treats `TM-enisha-smith` / `TM-97123456` (or a title equal to the
  matter number) as a generated key and shows the mark, then the client (`owner_name`), keeping the stored title only when neither exists.
  `matterLabel` uses it, so lists, cards and the header agree.
- **Module list:** `activeOrgModules` is wrapped in React `cache`, one `crm_org` read per request across the layouts and the page.
  Settings -> Modules keeps its two reads in sequence on purpose: Mailboxes off must not read connections.

## Getting started hub (Sprint 23, no schema)
`/dashboard/getting-started/` ("Getting started · Lectual") is a set of guided flows over the real screens, open to every member.
Internal only: a flow points at things and explains them; it never clicks, moves or sends anything. The one write is the person's own progress flag.
- **Catalog:** `src/lib/onboarding/hub.ts` (pure). The Intake track's five flows need a staff role (`requires.staff`: not viewer, not social_media, not unknown), so those roles lose the track. Five tracks (`intake`, `consults`, `matters`, `approvals`, `admin`), each a list of flows, each flow a
  list of steps `{ id, path, target, title, body }`. `hubTracks({ role, modules, aiConfigured })` filters: a flow needs named rail sections to be visible
  (`visibleNav`, the rail's own data, so module gates fail closed), `admin: true` needs `canSeeSetup`, `ai: true` needs the AI key. An unknown role sees
  nothing, an unreadable module list (`null`) is treated as none and the page says some guides couldn't be checked, and a track with no flow left is dropped.
  The queue step's wording follows `canApproveQueue` (like the tour): every role that cannot approve, and any unknown role, gets the non-approver wording; it lives in the step's `bodyReadOnly` (the queue step). A test checks every path exists on disk
  and every target is a `data-tour` hook in the sources, so a step cannot point at nothing; copy is denylist-tested (no advice, no "will send", no names).
- **Progress:** `user_metadata.lectual_hub = { version: 1, done: string[], hidden_card?: true }`, written only by `hub-actions.ts` (`markHubFlowAction`,
  `resetHubProgressAction`, `hideHubCardAction`) through `getScopedClient()` + `auth.updateUser`, merged with every other key (the Sprint 21 `lectual_tour` flag
  included), fixed-sentence errors, no user or org argument. Unknown, repeated or non-string ids and another version read as empty. Reset also clears `hidden_card`.
  Counts only include flows the person currently sees. It decides what is drawn, never what anyone may see or do.
- **No rail entry (decision):** `NAV` rows carry a `step`, and the Sprint 21 tour and `tests/nav.test.ts` derive from the same list, so a row is not a one-line
  edit. The page is reached from the account menu ("Getting started", beside "Show tips again") and the Today card (`GettingStartedCard`, its own async
  component with its own read; hidden when every visible flow is done or after Hide; a failed read still shows the link, with no count).
- **Runner:** `GettingStartedRunner` is mounted once in the dashboard layout. It is closed on load unless sessionStorage holds a valid `lectual_hub_flow` =
  `<flowId>:<index>` (`resumeFlow`: malformed, unknown or no-longer-visible clears it; a bad index restarts the flow). Records picked at start live in
  `lectual_hub_records` (ids are charset-checked before they reach a path). Next/Back to a step on another page navigates with the router and the new
  `flowId:index` is stored first; leaving the step's page by hand ends the flow (not done); Skip/Esc never marks done; Finish marks done optimistically and a
  failed save only keeps the check locally (`lectual_hub_local_done`). Decisions are pure in `hub-runner.ts`; the popover is Sprint 21's `TourView`
  (with optional `finishLabel`/`skipLabel`) and `tour.css`.
- **Record steps:** the first lead (most recent last activity) and first matter the person can see are read at flow start by `pickHubRecordsAction`
  (scoped client, read only, `limit(1)`, three states per kind: ok / none / unavailable). With no record the step becomes a centered card saying what the
  page would show ("Nothing here yet." or "Your records couldn't be loaded."), never an error and never another firm's record. The page shows the same
  note under such flows.
- **Sprint 21's tour is unchanged** (its props, flag, guard and wording); the hub only adds the runner beside it. `data-tour` hooks added by this sprint are
  attribute-only: `lead-head`, `lead-prep`, `lead-timeline`, `matter-head` (on the page head, not the h1), `matter-deadlines`, `matter-updates`,
  `matter-aside`, `intake-board`, and `*-head` on the h1 of the forms, reconcile, calendar, proposals, new proposal, matters, meetings, queue, agents, setup,
  integrations, team, modules and firm pages.

## Agent models (Sprint 24, no schema)
No model call defaults to Opus. `src/lib/ai/agent-models.ts` (pure, env passed in) holds `AGENT_MODEL_TIER`: intake-triage and
email-intel are `haiku` (classification and extraction); inbox-summary (its one call writes reply drafts; its triage is rule-based),
post-consult, morning-brief and consult-prep are `sonnet`; `staff` (a model call that is not an agent run: the letters, prep drafts,
public intake screening, Meetings "Draft follow-up" is `post-consult`) is `sonnet` and is named at each call site. The Stage Keeper makes no
model call and is not in the table.
- `agentModel(subject)` in `src/lib/ai/claude.ts` takes a required subject. `StructuredRequest.agent` carries it; `runOneAgent` fills it in
  from the run's own agent id, and each agent's call also names itself. `askClaude` requires `agent`.
- Defaults `claude-sonnet-5-5` ($2 / $10 per million tokens) and `claude-haiku-5-5` ($0.10 / $0.50; $0.50 / $2.50 when the prompt is over 100k
  tokens, which `costFor` applies), the newest of each per platform.claude.com/docs/en/about-claude/models/overview, where `claude-sonnet-5` and
  `claude-haiku-4-5` are listed as legacy. Both stay in `PRICES` so old runs still price. The Opus ids stay in `PRICES` only so
  old `agent_run` costs still price. Overrides: `AGENT_MODEL_HAIKU`, `AGENT_MODEL_SONNET`; `AGENT_MODEL` is now ONLY the Sonnet-tier override
  (`AGENT_MODEL_SONNET` wins over it) and no longer forces every agent. An override naming a `claude-opus*` id is ignored with one log line.
- `supportsEffort` is false only for `claude-haiku-4-*` (the API refuses it there); `claude-haiku-5-5` takes `effort` (triage sends `low`).
  `max_tokens` is clamped by `maxOutputFor` (128k for the 5.5 ids, 64k for older; triage asks 16k).
  A cut-off answer is still `AiOutputError` `truncated`, which skips the one lead. Cost is priced from `response.model`, the model that answered.
- Not verified against the live API in this environment (no key): the ids, prices and effort rule come from the models and effort docs. Check the first Haiku triage run.

## Agent failure alerts (Sprint 24, no schema)
A run closed as `error` (cron, Run now and the time-limit close all go through `runOneAgent`) emails Lectual, internal only.
- Firms: `failureAction` (`digest.ts`) keeps its actions for the fixable causes (reconnect a mailbox or meeting source, try Run now later). Every
  other cause, a queue 500 included, is "Lectual has been told and is looking into it." with `href: null`: the card draws plain text, never a
  link, and "Open the run log" no longer exists. Today's needs-you row points those at the Agents page.
- Lectual: `src/lib/agents/failure-alert.ts`. Recipients come ONLY from `AGENT_FAILURE_ALERT_TO` (comma-separated), from
  `AGENT_FAILURE_ALERT_FROM` (default `Lectual alerts <noreply@lectual.app>`), through Resend's HTTP API with `RESEND_API_KEY` (a plain `fetch`, no
  new dependency). Either unset = no read, no email. Subject `[Lectual bug] <agent> failed for <firm name>`; body: firm, org id, agent, run id,
  started/finished, `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA`, and the stored error cut to 2,000 characters. Its input type has no summary or client
  field, and anything shaped like an email address is replaced with `[email]`.
- Dedupe, no new table: at most one email per org + agent + error signature (first sentence, digit runs normalised) per UTC day, judged from
  that day's earlier `agent_run` error rows through the runner's own org-fenced client. An unreadable history sends (a duplicate beats silence).
  Sending never throws into the run and never changes its status; a failure is one log line with no content.
- Taylor sets `AGENT_FAILURE_ALERT_TO` (bugs@lectual.app and/or the ClickUp list's email address) and `RESEND_API_KEY` on the deployment.

## Copilot history (Sprint 24, needs lectual 0099)
`/dashboard/copilot` is a full-page chat (no "IP.OS" label or title block; a visually hidden h1) with "Past conversations" beside it. The four
stat cards stay in the empty state inside the chat column, each its own read ("Couldn't load" on failure). "Nothing sends without your approval."
is on the page.
- Tables `copilot_conversation` / `copilot_message` (lectual 0099) are PRIVATE TO THE AUTHOR by RLS: nobody else, admins and owners included.
  `src/lib/copilot/history-store.ts` takes the scoped client only and never names a user (`user_id` has no INSERT grant; it takes `auth.uid()`).
  Titles, content and citations are never logged. `history-pure.ts` holds the rules (title = first question clipped to 80 characters, content cut
  at 40,000, citations kept whole under 60 KB, relative dates, the delete confirmation).
- Reads are three-state: ok / not-set-up (error code 42P01 or PGRST205) / unavailable. "No saved chats yet." only for ok.
  Not set up reads "Saved chats aren't available until the database update."; unavailable reads "Saved chats couldn't be loaded." and New chat still works.
- Saving (`save-turn.ts`, called by the route AFTER it has sent `final`): the question, then the final answer, one insert per message, never the
  deltas. SSE gains `saved` ({ conversation_id }) or `save_failed` after `final`; the browser shows the quiet, non-alert line "This chat isn't
  being saved right now." A save failure never changes `final`. A question is kept only with its answer (if the answer cannot be saved the question,
  or the chat this call created, is removed). A conversation id the caller cannot see starts a new saved chat. A stream that ends in `error` saves
  nothing. The drawer saves too. The body accepts an optional `conversationId` (uuid).
- The page: `?c=<id>` opens a past chat (the server re-reads it; messages and citations come back as done exchanges and the next question sends
  its last turns as `history` and the same `conversationId`). Delete is a server action (`actions.ts`) with a confirm step; it refuses signed-out and
  a non-uuid id with fixed sentences. No rename.
- Before 0099 is applied the chat still answers and the list says it is not available until the database update.

## New document picker (Sprint 24, no schema)
`/dashboard/documents/new/` starts with the SAME "Who is this for?" as New proposal: `WhoIsThisFor` and `src/lib/proposals/new-picker.ts` take a
destination (`PickerDestination`: base path, choose link, optional blank link) instead of being forked; `src/lib/documents/new-picker.ts` supplies
the letter destination. Leads | Matters (opens on Matters), search, 8 recent, "Showing N of M", a failed read is its own alert, no "Start blank".
- A matter goes to `/dashboard/documents/new/<matterId>/`. Open matters only, as the page always offered. A lead goes to `?lead=<id>`: its OPEN
  matters (`listMatters({ leadId })`, scoped): none = "Letters are drafted on a matter. Open a matter for <lead> first." with a link to the lead; one =
  redirect to that matter's template choice; several = a short list. A failed read for the lead's matters is an alert, never the "none" sentence.
- The Document Center gate stays in the segment `layout.tsx`; the per-matter pages and actions are untouched.

## Send feedback and the pay link (Sprint 25, no schema)
- **Pay link is a plain input.** New proposal and the proposal editor show "Pay link" with the placeholder "Enter custom pay link"; it starts empty and
  nothing copies `client_proposal_setting.default_pay_url` into a proposal (not `createProposalAction`, not the editor, not the consult-proposal drafter,
  whose `pay_url` is null and whose flag is always "Add the client's pay link before approving."). A new VERSION keeps its own proposal's link. Approval
  still needs one ("Add the pay link before approving."). The **"Default pay link" field was removed from Settings -> Client proposals** because nothing
  reads it any more; the column stays (no schema change), and the settings save passes the stored value through untouched so nothing is lost.
- **Send feedback** (account menu and the Getting started footer -> `SHOW_FEEDBACK_EVENT` -> the ONE `FeedbackDialog` in the dashboard layout, with
  `FeedbackTrailRecorder` beside it). Type (Bug / Request / Question / Other), a description of at most 5,000 characters, the fixed disclosure sentence.
  Esc closes, Tab wraps (the tour's `tourKeyAction`), focus returns to the opener.
- **The transcript** (`src/lib/feedback/trail.ts`, pure) is a ring buffer in sessionStorage under one key, at most 20 KB (oldest dropped first): the last 30
  dashboard route paths with times (query string and hash dropped, uuid segments kept), the last 20 client errors (message and file:line, 300 characters each,
  email-shaped text replaced with `[email]`, no stack), viewport, user agent, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` if exposed. It never reads the DOM, page
  text, form values, record names or other storage. The server re-sanitises whatever is posted (`sanitizeTrail`), so a forged client cannot add anything.
- **The action** (`sendFeedbackAction` -> `sendFeedback` in `src/lib/feedback/submit.ts`, dependencies injected): any signed-in member, every role; session only,
  no database client, no service role, no write, not an approval-queue item. Sends ONE email through `sendInternalMail` to `FEEDBACK_TO` (comma-separated;
  unset or no `RESEND_API_KEY` = "Feedback isn't set up yet.") from `FEEDBACK_FROM` (default `Lectual feedback <noreply@lectual.app>`), `reply_to` the
  sender's own session address. Subject `[Lectual feedback] <Type>: <first 60 characters>`. Firm, org id, sender, role and deployment come from the session
  and env, never the form. Errors are fixed sentences; Resend's reply and exception text are never returned or logged.
- **Rate limit:** 5 per person per rolling hour, in memory per server instance (`rate-limit.ts`), so on serverless it is a courtesy limit, not a hard cap.
  Keyed by the session user id. A failed send does not use a slot.
- **One mailer:** `src/lib/mail/internal-mail.ts` is the only file that names Resend; the Sprint 24 failure alerts and feedback both use it.
- Taylor sets `FEEDBACK_TO` and `AGENT_FAILURE_ALERT_TO` to the Resend inbox's receiving address (bugs@lectual.app forwards there). Not verified here: a real
  delivery, and that `noreply@lectual.app` is a verified sending domain on the key's Resend account.

## Proposal maker wording, one-step link, the firm's own domain (Sprint 27, no schema)
"Approve" sat next to the client's "Accept" and the client link was a dead URL until a second button nobody knew about. Now:
- **Vocabulary is one file** (`src/lib/proposal-editor/vocabulary.ts`): draft "Draft", approved "Saved", sent "Link live", accepted
  "Accepted by client", superseded "Replaced", withdrawn "Withdrawn"; "Save and create link", "Turn on the link", "Edit again",
  "Start a new version", "Ask <names> to create the link", settings "Who may create client links". The list labels, history lines and
  `display-status.ts` read it. The DB statuses and RPCs are unchanged. **"Link live" is not a send:** `sent` only means the client link
  opens; nothing here emails a client, and no UI text may say it did (`tests/proposal-editor/vocabulary.test.ts` greps).
- **`createLinkAction`** (`create-link.ts` holds the logic, dependencies injected) = the approve transition, then `sendProposal`. Approve failing never
  calls the second step; approve ok and the second failing returns "Saved, but the link couldn't be turned on. Try again." and the
  page then reads "Saved" with "Turn on the link" (`sendAction`, kept as the recovery). It imports no mail, queue or service-role code.
  Decision: for a consult-agent proposal with its email still pending in the queue, the one-step button still turns the link on (a live
  link is not a client send); only the old `sendAction` keeps its queue refusal, and `queueNote` is reworded text only.
- **The link box** (Copy, Open) shows only for `sent` / `accepted`; a saved-but-not-live version shows the button instead of a dead URL.
- **`clientLinkOrigin(orgId)`** (`src/lib/proposals/client-link-origin.ts`) is the ONLY place a `/p/<token>/` URL is built (grep test). Env
  `FIRM_CLIENT_LINK_ORIGINS` = JSON `{ "<org_id>": "https://proposals.firm.com" }` (https, origin only, invalid entries ignored; parsing is in the
  import-free `client-link-config.ts`); otherwise `getSiteOrigin()`. The proposal page and the consult-proposal email (`run.ts`) both use it.
  `next.config.ts` adds the same hosts to `serverActions.allowedOrigins` so Accept works when the request arrives through the firm's domain
  (the old `lectual` project rewrites `/p/<token>/`, `/_next/static` and `/brand` there, see its AGENTS.md). Old app.lectual.app links keep working.
- **The client page may only reference root-relative assets under `/_next/static/` or `/brand/`** (the only prefixes lectual rewrites on a
  proposals host; the logo is `/brand/rpb-logo-cream.png`). `tests/proposals/public-assets.test.ts` fails on any other `src="/..."` or `url(/...)`
  in `src/app/p` or `src/components/client-proposal`. A new asset type needs a rewrite in lectual's `next.config.ts` first.

## Change the pay link on a live proposal (needs lectual 0100, no schema here)
A version whose link is live ("Link live", status `sent`) shows a "Change pay link" card (input + Save) to the proposal-writing
roles (`PROPOSAL_STAFF_WRITE_ROLES`). Never for accepted, replaced or withdrawn versions, and never to viewer / social_media.
- `changePayLinkAction` -> `runChangePayLink` (`src/lib/proposal-editor/pay-link.ts`, pure, deps injected like `create-link.ts`):
  `gateStaffAction` (module `notFound()`, role), `parseLivePayLink` (required, https, no whitespace, at most 2,000 characters, the
  0089 CHECK's rules), then `changeLivePayLink` in the store: scoped client, role re-read, refuses any status but `sent`, writes
  `pay_url` ALONE fenced on `status = sent` and the rendered `updated_at`. It writes no event: lectual 0100's trigger logs
  `edited` `{field: "pay_url", from_host, to_host}` (hosts only), which the history reads as "changed the live pay link from A to B".
- Fixed sentences: "Pay link updated.", the validation lines, and before 0100 is applied (the 0089 trigger answers
  `client_proposal_frozen` for this exact write) "Changing the pay link needs a database update." The 0100 refusal prefixes
  (`client_proposal_pay_link_frozen` / `_staff_only` / `_required`) are mapped in `src/lib/proposals/errors.ts`.
- Nothing is emailed and the offer itself (content, prices, expiry) stays frozen; any other change is still a new version.

## JSX text spacing: keep the `{" "}`
Next 16.2.7's compiler DROPS the leading space of JSX text that contains an HTML entity
(`&apos;`, `&amp;`, `&rsquo;`…) and runs onto another line, even if that is only the line
break before the closing tag: `{email} is signed in, but isn&apos;t…` rendered as
"…gmail.comis signed in", and Today's "couldn't be read" warning lost its space the same
way. An explicit `{" "}` survives,
so never "tidy" one away. The `lectual/no-glued-jsx-text` lint rule (`eslint-rules/`) catches
this and plain-JSX line-break glue (`{name}↵word`); `pnpm lint --fix` writes the `{" "}`.

## Commands
`pnpm build` · `pnpm lint` · `pnpm test`. Env: copy `.env.example` to `.env.local` and fill it in
from lectual-dev.
