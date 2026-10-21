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
