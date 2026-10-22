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

## Stage reconciliation (Intake → Reconcile stages, no schema)
`/dashboard/intake/reconcile/` compares each lead's stage with three sources and moves the ones a person
chooses. Owner/admin/senior_admin only: the PAGE answers `notFound()` to anyone else (signed out included) and
BOTH actions (`actions.ts`: `previewReconcileAction`, `applyReconcileAction`) re-resolve the role on every call
and read or write nothing for a refused one. Nothing is written to Lawmatics, anywhere on this screen.
- **The sheet wins.** `src/lib/reconcile/propose.ts` (`proposeStage`, pure) proposes only the sheet's stage.
  Lawmatics and mail can only corroborate: `agree` (another source names the same stage and none names a
  different one), `conflict` (any source differs; the proposal is still the sheet's), `sheet_only`, or
  `no_evidence` (no usable sheet row: no proposal, however loudly the others agree). A source that could not be
  read is `unavailable` on every row and in the reasons; it is never "none".
- **`needs_matter`.** A sheet status code of 7 or higher, or Lawmatics "Hired"/"Hired Client" (the two names
  `stage-map.ts` deliberately leaves unmapped), proposes NO stage and links to Open a matter. It outranks the sheet.
  Any other unmapped Lawmatics stage ("Discovery Call No Show") is shown as unmapped and does not vote.
- **No `won` stage is ever a target** (proposal, Pick another, bulk or apply): a move there runs the matter
  handoff and stops the lead's sequences. Apply refuses it again against the live stage list.
- **CSV only, 5 MB.** No spreadsheet library is installed (`xlsx` lives in lectual, not here), so an Excel file is
  refused with a sentence telling the person to save as CSV (`src/lib/intake/sheet-read.ts`). The parse is the port of
  lectual's `parseIntakeSheet` (`sheet-import.ts`, see `PORTED_FROM.md`). `next.config.ts` raises the
  server-action body limit to 6 MB so the file reaches the action.
- **Matching.** A lead matches a sheet row on `sheet_key`, exactly first. `sheetKeyFor` includes the status code, so
  a row that moved on the sheet has a new key; failing an exact hit the owner and mark are also tried under every
  intake code 0 to 6. Two candidates for one lead, two leads with one `sheet_key`, or two leads reaching one row
  (a stale duplicate from an earlier status code plus the current lead) are all reported as ambiguous: none of those
  leads gets a sheet stage or a proposal, and the summary counts them. Never picked. Sheet rows with no lead are
  listed, never created. A lead with no `sheet_key` has no sheet reading.
- **Email is the stored mail, not mail.** The mailbox sync already classified each message it matched and wrote the
  type, `sensitive` and date onto the lead's `email_sent`/`email_received` timeline row. `src/lib/reconcile/email.ts`
  maps four types to stage names (strategy-session link, discovery call, post-consult, LOE and invoice), resolved
  with `resolveStage`; a sensitive thread, an unlisted type or a stage the firm lacks gives no vote. No mail is fetched.
- **Lawmatics** is read through the firm's own connection with the read-only client (`pullSource`). Not connected,
  failing, cut short (truncated) or missing its stage relationships are each a named state, never an empty book.
- **Apply** goes only through `moveLeadStage(id, stageId, evidenceAt?)`, which logs `stage_changed`. The optional
  third argument stamps `stage_entered_at` (and the timeline payload's `evidence_at`) with the sheet's newest
  non-future dated entry; a future or invalid date is ignored. A person's "Pick another" carries no date.
  `last_activity_at` still becomes now, as for every move.
- **The fingerprint covers the plan the person was shown** (SHA-256 of the rows, sorted, `fingerprint.ts`). It is an
  integrity check, not a signature. Apply recomputes it, then re-reads every lead and stage through the scoped client
  and refuses the WHOLE apply, writing nothing, when a lead is missing or no longer in the stage the plan recorded.
  One request moves at most 200 leads.

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
  `COPILOT_MODEL`. The other agents still use `AGENT_MODEL`. `streamClaudeWithTools` sits beside the unchanged
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
