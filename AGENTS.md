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
