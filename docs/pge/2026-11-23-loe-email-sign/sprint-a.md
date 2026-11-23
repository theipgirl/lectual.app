# Sprint A contract: the emailed signing link and the signing (PGE, STRICT)

**Status:** v1, written by the planner (Nov 23). Not yet ratified. Nothing is built.
**Size:** large, one agent, one session. **Branch:** `claude/loe-email-sign` (never `main`; no push, no PR).
**Schema:** lectual **0117**, a PROPOSAL FILE ONLY (`docs/pge/2026-11-23-loe-email-sign/0117-proposed.sql.txt`, written with this
contract). Nothing is applied to lectual-dev or lectual-prod. **Evaluator: STRICT** (signatures, client email).
**Binding input:** `spec.md` in this folder (the owner's decisions 1-7 and firm rules). Where this contract and the spec disagree, the
spec wins and the generator stops and asks. Where neither covers a choice, the generator writes it under "Open questions" in
`questions.md` and takes the conservative path (the emailed path stays OFF; the client signs in-app as today). It does not pick.

## Goal
A firm that Lectual has switched on, that has approved signing words and a sender address of its own, gets the owner's flow: on step 3
the client reviews the final letter and presses a button; Lectual emails a 7-day signing link (with the review PDF attached) to the
client email on the proposal; the link opens the letter read-only on `/p/<token>/?sign=<signing token>`; the first click is the consent;
then a drawn or typed signature plus the typed full legal name; **Sign** signs and accepts in one database transaction; a done screen
leads to Pay. Every other firm, and any firm the moment one condition fails, sees the page exactly as it is today (0106 in-app signing,
byte for byte). The signed-copy email, the certificate page, the Lectual file and the staff card states are Sprint B.

## Blockers (copied into the PR description; nothing here can be cleared by the generator)
1. **0117 is not applied.** Until it is, every 0117 read answers 42P01 / PGRST205 / 42883 / PGRST202 and the gate is off (in-app).
   Apply to lectual-dev, run the 22 isolation cases, then prod with the owner's OK. `LOE_EMAIL_SIGNING` stays unset until then.
2. **Resend sending domain per firm.** The firm's from-address must be on a domain verified on `RESEND_API_KEY`'s account. Not verified here.
3. **The attorney's words.** The path stays off for a firm until its named approver approves signing words (spec rule). Lectual writes none.
4. **Open questions Q1-Q4 in `questions.md`** are decided conservatively below (D3, D4, D9, D10); the owner may overrule them before merge.

## Scope In

### The gate (one function, fail closed)
1. **`src/lib/loe/email-signing/gate.ts`** (`server-only`): `emailSigningGate(orgId, deps)` returns
   `{ on: true, words: ApprovedSigningWords, from: string }` or `{ on: false, reason }` with `reason` one of `switch_off`, `not_set_up`,
   `no_mail`, `no_words`, `unreadable`. ON only when ALL hold, checked in this order:
   - `process.env.LOE_EMAIL_SIGNING === "on"` exactly (anything else, unset included, is `switch_off`; no read is made);
   - `RESEND_API_KEY` set AND `FIRM_CLIENT_MAIL_FROM` has an entry for this org id (else `no_mail`);
   - the firm's approved signing words read as the service role fenced on `org_id` (42P01 / PGRST205 / 42883 / PGRST202 by CODE =
     `not_set_up`; no approved row = `no_words`; any other failure = `unreadable`).
   Every `on: false` means today's in-app path. Pure decision part in `gate-rules.ts` (`gateDecision(facts)`), tested without I/O.
2. **Per-proposal readiness** (`src/lib/loe/email-signing/ready.ts`, pure over read facts): the gate is on AND the proposal carries `loe`
   AND the proposal row's `client_email` passes the address check AND `letterLiveCheck` (`src/lib/loe/live-guard.ts`) answers `current`
   (D10). Otherwise this proposal signs in-app as today.
3. **`FIRM_CLIENT_MAIL_FROM`** (add to `src/lib/env.ts` as optional, documented beside `FIRM_CLIENT_LINK_ORIGINS`): JSON
   `{ "<org_id>": "Firm Name <signing@firm-domain.com>" }`, parsed in the import-free `src/lib/loe/email-signing/mail-config.ts`
   (`parseFirmMailFrom`): org ids must be uuids; the value must be a single address (display name optional, no CR/LF, at most 320
   characters); an address whose domain is `lectual.app` or any subdomain of it, or the host of `SITE_URL`, is dropped (no
   deployment-wide sender for client mail). Invalid entries are ignored. There is no default sender.
4. **`LOE_EMAIL_SIGNING`** added to `src/lib/env.ts` (optional string). `.env.example` gains both vars, commented, unset.

### Signing words (the attorney's, per firm)
5. **Store** `src/lib/loe/signing-words-store.ts`: scoped client only (no service role), modelled on `templates-store.ts`
   (`listWordsVersions`, `getWordsVersion`, `createWordsDraft`, `saveWordsDraft`, `approveWordsDraft`), three-state reads
   (ok / not-set-up by code / unavailable). Inserts never name `version`, `status`, `created_by`, `approved_*`. The public path's read of
   the APPROVED version lives in `gate.ts` (service role, fenced on the org).
6. **Pure rules** `src/lib/loe/signing-words.ts`: the eight fields and their length limits (same numbers as 0117's CHECK), the merge-field
   rule mirrored from `client_proposal_signing_words_fields_ok` (`{{signing_link}}` exactly once in the link body; `{{client_name}}`,
   `{{firm_name}}`, `{{link_expires}}` (link email only); none on the page fields), `wordsSha256(words)` (sha256 of the eight fields joined by
   U+001F in 0117's order), `consentSha256(consentText)`, and `renderEmailWords(template, values)` (a single pass, values never re-merged;
   plain text, no HTML). Errors in `src/lib/loe/signing-words-errors.ts` map 0117's prefixes (`signing_words_not_approver`,
   `_edit_admin_only`, `_frozen`, `_bad_transition`, `_fields_invalid`, 23505, 42501, missing table) to fixed sentences.
7. **Actions** `src/lib/loe/signing-words-actions.ts` (deps injected, like `letter-actions.ts`: `runStartWordsDraft`, `runSaveWordsDraft`,
   `runApproveWords`): feature gate (`proposals` module, `notFound()`) and role re-resolved BEFORE any read; admin tier
   (`PROPOSAL_ADMIN_ROLES`) edits; Approve shown and allowed only to a named approver with a proposal-writing role; fixed sentences only;
   no `console.*` with words text.
8. **Settings page** `/dashboard/settings/proposals/signing-words/` (`page.tsx`, `actions.ts`), linked from
   `/dashboard/settings/proposals/` next to the Engagement letter link. Every member of a proposals firm reads; the eight fields with
   labels that NAME each field ("Consent button line", "Consent text", "Line beside Sign", "Line under the signature box", "Signing link
   email subject/body", "Signed copy email subject/body"); no placeholder or sample text that reads like consent or legal wording. A
   status line says plainly whether the emailed link is on for the firm and why not, from the gate's reason: `switch_off` / `not_set_up`
   / `no_mail` -> `notReadyYet("Emailed signing links")` (platform voice); `no_words` -> "Clients sign on the proposal page until a named
   approver approves these words."; `unreadable` -> `CANT_SHOW`. Words in `src/lib/ui/words.ts` (`SIGNING_WORDS_*`). Not a Setup
   checklist item.

### Sending the link (the client presses the button)
9. **`sendSigningLinkAction(token, selection, clientClasses, details)`** in `src/app/p/[token]/actions.ts`, thin wiring over
   `src/lib/loe/email-signing/send.ts` `sendSigningLink(input, deps)` (deps injected: db, mailer, clock, random bytes, limiters). Order:
   1. rate limits checked before any read: `sendTokenLimiter` (5 per proposal token per hour) and `sendAddressLimiter` (20 per address
      per hour), new in `src/lib/loe/review-limit.ts`, in memory (courtesy limits; say so in the file);
   2. `readPublicProposal(token)`: live (`sent`), unexpired, carries `loe`; the gate and readiness (items 1-2) are ON, else refuse with
      `SEND_MESSAGES.unavailable` and nothing written;
   3. `quoteForAcceptance` (the ONE function; missing descriptions / nothing selected refused as today), `cleanSigningDetails` +
      `missingDetails` (refused `details_required`);
   4. the agreement is built HERE exactly as `signAndAccept` builds it, factored into ONE shared function
      `buildServerAgreement({ read, content, quote, details, signerName, now })` in `src/lib/proposals/public.ts` that `signAndAccept`
      also calls (its behaviour unchanged, pinned by the baseline test): `letterDateText(now, firm zone)`, `buildExhibit`,
      `assembleAgreement` with `typedName = details.client_name` (D3), `agreementTextSha256`, `canonicalFingerprint`;
   5. the snapshot: `buildAcceptedSnapshot({ ..., signed: { agreement: { signature_id: null, signer_name: details.client_name, ... },
      signing: { details, date_text, client_email } } })` (the database fills the agreement block and `accepted_at` at signing);
   6. the token: `randomBytes(32)` base64url (43 characters); only `sha256(token)` hex leaves this function apart from the email;
   7. `expires_at` = the earlier of now + 7 days and the end of the proposal's `expires_on` day in the firm's zone (`isProposalExpired`'s
      rule);
   8. ONE `rpc("client_proposal_signing_open", ...)` (service role, the client `public.ts` already uses), which closes any earlier link
      for the version (`resent`) and returns the request id;
   9. the review PDF from the STORED text: `buildLetterPdf` gains `storedText` support in `review` mode (`src/lib/loe/pdf.ts`; the review
      mark stays on every page; nothing else in review or signed mode changes, pinned by `tests/loe/pdf.test.ts`); its sha256 is written
      once to `review_pdf_sha256` (the one direct update 0117 allows);
   10. the email (item 10) with `idempotencyKey = "signing-link:" + requestId`;
   11. `client_proposal_signing_mark_sent(requestId, sent)`. A failed send -> `false` (closed `send_failed`, no open request) and the
       client sees `SEND_MESSAGES.send_failed` = "We couldn't send the email. Try again." Never Resend's text.
   Returns `{ ok: true, sentTo: maskedEmail, expiresText }` or `{ ok: false, message }`. `maskEmail` ("s•••@example.com") is pure in
   `src/lib/loe/email-signing/mask.ts` (D9). Nothing in this function logs the address, the token, the letter or the words.
10. **The mailer** `src/lib/mail/internal-mail.ts`: header comment renamed to say it is the one Resend caller for internal mail, the
    worksheet AND the two owner-approved client emails (spec decision 7); `InternalMail` gains optional
    `attachments?: { filename: string; content: Uint8Array; contentType: "application/pdf" }[]` sent as Resend's
    `attachments: [{ filename, content: <base64> }]` (at most 2 attachments, at most 10 MB total, else `failed` with no request made).
    Existing callers unchanged (their payloads pinned). No second Resend caller anywhere (a grep test). The link email itself is built by
    the pure `src/lib/loe/email-signing/link-email.ts`: subject and body are the approved words rendered with `renderEmailWords`
    (`signing_link` = `clientLinkUrl(await clientLinkOrigin(orgId), publicToken)` + `?sign=` + the token, built only there; `client_name`
    = details.client_name; `firm_name` = `firmDisplayName`; `link_expires` = the firm-zone date text), text only, `to` = the request's
    `sent_to` (the proposal row's `client_email`), `from` = the firm's `FIRM_CLIENT_MAIL_FROM` entry, attachment = the review PDF
    (`<signer>-engagement-letter-review.pdf`). Builders add no sentence of their own to the email.

### The signing page (`?sign=`)
11. **`src/app/p/[token]/page.tsx`** reads `searchParams.sign` (a Promise in this Next version: read
    `node_modules/next/dist/docs/` for `searchParams` first). Without it, the page renders exactly as today. With it, the page renders
    `SignByLinkPage` (`src/components/client-proposal/sign-link/`) from `readSigningLink(token, signToken, audit)`
    (`src/lib/loe/email-signing/link-read.ts`, service role): token shape check (base64url, 43 characters) -> `open`/`sign` limiters
    (`linkTokenLimiter` 30 per signing token per hour, `linkAddressLimiter` 60 per address per hour, courtesy) -> sha256 ->
    `rpc("client_proposal_signing_opened")` -> the request read by `token_sha256` with its proposal's `public_token` compared to the
    page's token in CONSTANT TIME (`timingSafeEqual` over equal-length buffers; unequal length = mismatch). A wrong, expired, closed or
    other-proposal token, a gate that is off, or any read failure renders ONE state, `LINK_UNAVAILABLE` = "This link is no longer
    available." with no detail and a link back to `/p/<token>/` (never which reason). A `signed` request renders the done screen only
    when the proposal is accepted with `accepted_snapshot.agreement.signing_request_id` equal to it; otherwise `LINK_UNAVAILABLE` (D11).
12. **Read-only letter first.** The letter is the request's STORED `agreement_text`, verified against its stored `agreement_sha256`
    before drawing (mismatch = `LINK_UNAVAILABLE` and one `logSignedMismatch(proposalId, "signing_link")` line), drawn as plain
    paragraphs like `storedSignedLetterView` (React text only). No field, checkbox or signature box is in the markup before consent.
13. **Consent is the first click.** The button's text is the request's snapshotted `consent_line`; the full `consent_text` is shown
    above it (a `<details>` open by default). `recordConsentAction(token, signToken, consentSha256)` -> `rpc("client_proposal_signing_consent")`
    with the sha256 of the text the page drew. Only after it answers does the page show the signature box. Refusals are fixed sentences.
14. **The signature box** (`SignatureBox.tsx`, client component, no dependency): a `<canvas>` with pointer events (mouse, pen and touch;
    `touch-action: none` on the canvas only), Clear, and "Type it instead" (a radio between drawn and typed; typed draws the typed legal
    name in one of two styles, `script` or `print`, rendered with fonts already served from `/_next/static/`). Keyboard users use the typed
    alternative (it is the default focus order). The drawn PNG is exported at most 600 x 200 px; a PNG over 100 KB is refused on the
    page and on the server. The typed full legal name input is always required. Under the box: the snapshotted `box_note`; beside Sign:
    the snapshotted `sign_line`. Assets only from `/_next/static/` or `/brand/` (`tests/proposals/public-assets.test.ts` stays green).
15. **`signByLinkAction(token, signToken, typedName, signature)`** -> `src/lib/loe/email-signing/sign.ts` `signByLink(input, deps)`:
    limiters -> token shape -> `cleanTypedName` -> the signature payload checked (`drawn`: a data URL `image/png` base64, decoded, PNG
    magic, at most 102,400 bytes, its sha256 computed HERE; `typed`: style in `script|print`, hash = sha256(style + U+001F + name)) -> ONE
    `rpc("client_proposal_signing_sign", ...)` with the ip (`parseInet`) and browser (400 characters). Mapped refusals:
    `signing_name_mismatch` -> `SIGN_LINK_MESSAGES.name_mismatch` ("Type your full legal name as it appears on the letter."),
    `signing_no_consent` -> back to consent, `signing_link_closed` / `signing_changed` -> `LINK_UNAVAILABLE`, 42883 / PGRST202 ->
    `LINK_UNAVAILABLE`, anything else -> "We couldn't record your signature. Please try again." On `signed_now = true`:
    `notifyFirmOfAcceptance` and the acceptance follow-ups exactly as the in-app path schedules them (`after()`), so the firm notice, the
    Lawmatics note, `signed_loe_upload` and `address_to_lawmatics` run as today. A repeat (`signed_now = false`) runs nothing.
16. **Done screen and Pay.** "Signed" (step word) with `signedLineText(signed_at, firm zone, signer)`, the pay button (`PAY_LABEL`) to the
    row's `pay_url` through `safeHttpsUrl`, and the existing signed download (`downloadSignedLetterAction`). No "are you sure?" dialog
    anywhere; steps say what comes next (spec decision 3).

### The proposal page's step 3 when the path is on
17. `src/components/client-proposal/LoeSignPanel.tsx` / `LoeSideAction.tsx` / `loe-flow.ts`: when `view.letter.emailSigning` (a boolean
    the public read sets from item 2; the browser never gets a reason) is true, step 3 shows the letter as today (read-only) and, in place
    of the typed name / tick / Sign, a button "Email me a link to sign" (`EMAIL_LINK_LABEL`) and after success "We emailed a signing link
    to s•••@example.com. It works for 7 days." (`linkSentNote`). Pressing it again sends a fresh link (the old one closes; the page says
    the same). New choices or details after a send: pressing the button again is the only way on (the old link closes on the next send;
    the old link's letter stays the one it was sent with). With `emailSigning` false the panel is byte for byte today's.
18. **In-app signing is refused while the path is on** for that proposal: `signAndAccept` re-evaluates the gate and readiness and returns
    the existing `signing_required` refusal (no write) when they are on, so a hand-built POST cannot skip the email. When the gate is off
    (or flips off) the in-app path is exactly today's; a link still open then simply loses the race (0117 section 7 closes it when the
    proposal is accepted in-app).

### Words, hygiene, docs
19. Step and status words only, in `src/lib/loe/client-words.ts` (`EMAIL_LINK_LABEL`, `linkSentNote`, `LINK_UNAVAILABLE`, `SEND_MESSAGES`,
    `SIGN_LINK_MESSAGES`, `CONSENT_STEP_NAME`, `SIGNATURE_STEP_NAME`, `CLEAR_LABEL`, `TYPE_INSTEAD_LABEL`, `DRAW_INSTEAD_LABEL`) and
    `src/lib/ui/words.ts` (`SIGNING_WORDS_*`). No sentence about what consent, a signature or a letter means.
20. **Hand-added types** in `src/lib/db/types.ts` for the three 0117 tables (Row / Insert / Update matching 0117's grants: words Insert has
    only the eight fields and `org_id`; request and event have no Insert or Update for the app) and the seven functions under `Functions`,
    with the same "hand-added until codegen" comment as 0106's.
21. **AGENTS.md:** one short section "Engagement letter by emailed link (lectual 0117; Sprint A)" stating: off by default and the four
    conditions; the owner-approved exception that Lectual now emails a client by itself (the signing link, because the client pressed the
    button; Sprint B adds the signed copy) and nothing else; the attorney's words rule; the token rule; tests never send. Sprint B extends it.

## Data
Lectual 0117 (proposal file, this folder). Summary: `client_proposal_signing_words` (versioned, admin-tier drafts, named-approver approve,
one draft and one approved per firm, frozen once approved); `client_proposal_signing_request` (token sha256 unique, status
`sending|open|signed|closed` with a closed reason, the final text and its sha256, the frozen details/selection/snapshot/date, the words
snapshot with `consent_sha256`, one in-flight row per proposal, changes only through functions); `client_proposal_signing_event`
(append-only evidence: sent / opened / consent / signature / signed / closed, database clock, staff-readable like 0106's signature row);
functions `signing_open`, `signing_mark_sent`, `signing_opened`, `signing_consent`, `signing_close`, `signing_sign` (INVOKER, the one
signing transaction) and a trigger closing an in-flight link when the version leaves `sent`. 0106 is not amended.

## Decisions
- **D1 Where the attorney's words live:** a versioned, approver-gated table in 0117 (`client_proposal_signing_words`), modelled on 0106's
  `client_proposal_loe_template`, not in `client_proposal_setting.pricing` jsonb: the words need versions, a named approver, a freeze and
  an approval the database enforces, and each request snapshots text + sha256 so a later approval never changes an open link.
- **D2 One shared agreement builder.** `buildServerAgreement` is factored out of `signAndAccept`; both paths call it. The in-app path's
  results are pinned byte for byte (baseline test, item T1).
- **D3 The name on the letter (Open question Q1):** the letter is final when the link is sent, so `{{signer_name}}` is merged with the
  full legal name the client gave in "Your details" (`details.client_name`, `letterValues`' existing fallback). At signing the typed full
  legal name must equal it with case and runs of spaces folded (checked in `signByLink` AND in `client_proposal_signing_sign`). A
  mismatch is refused with a step sentence; the client corrects the name or sends a fresh link from the proposal page.
- **D4 The letter's dates (Open question Q2):** both `{{date}}` and `{{signed_date}}` are the firm-zone date on which the link was sent
  (the text is final then). The real signing time is the signature row's `signed_at` and goes on the certificate (Sprint B).
- **D5 0106 is not amended.** No double signing is possible: whichever path signs first moves the proposal to `accepted`; the other is
  refused by its own `status = 'sent'` fence, and 0117's trigger closes the open link.
- **D6 The token** is 32 random bytes, base64url, compared only as sha256 hex in the database lookup plus a constant-time comparison of
  the proposal token in the app. Never logged, never stored, never in an error or step payload.
- **D7 The address** is the proposal row's `client_email` as stored; the browser sends no address. No address on file = in-app (item 2).
- **D8 Rate limits** are in-memory courtesy limits per server instance (like the existing `/p/` limiters), separate counters for send,
  open and sign.
- **D9 The address on the page is masked** ("s•••@example.com"): the proposal link is a bearer link and need not reveal the full address
  (Open question Q3; conservative).
- **D10 A letter the firm has since replaced** (`letterLiveCheck` not `current`) is not emailed: the proposal signs in-app as today
  (Open question Q4; conservative: a client is never left without a way to sign, and no link is sent for a superseded letter).
- **D11 A signed link** shows the done screen only while the proposal is accepted by THAT request's signature; after a reset it is
  "no longer available".
- **D12 Failed send leaves no open request:** the request is `sending` until the email is confirmed; a refusal closes it `send_failed`.

## Out of scope (Sprint B or never)
The signed-copy email, the certificate page, the Lectual file step and the staff card states (Sprint B). Attorney countersignature.
Any other email to a client. SMS. An iframe. Applying 0117 anywhere. A deployment-wide sender. `pricing.ts` changes. Re-pricing a snapshot.
Copying Lawmatics' consent text. A Setup checklist item.

## Tests (vitest; `env -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_URL pnpm test`; nothing sends)
- **T1 Baseline:** with `LOE_EMAIL_SIGNING` unset, and separately with it `on` but each other condition failing, the `/p/` page markup for
  the letter fixtures equals `tests/client-proposal/__baseline__/` (the existing `loe-baseline.test.tsx`), and `acceptPublicProposal`'s
  in-app path writes the same rpc arguments as before (snapshot of the args for the fixture).
- T2 `gateDecision`: every combination of the four conditions; code-based not-set-up (42P01, PGRST205, 42883, PGRST202); `unreadable` is off.
- T3 `parseFirmMailFrom`: valid entry, lectual.app and its subdomains dropped, SITE_URL host dropped, CR/LF refused, bad org id ignored.
- T4 Words rules: lengths, `{{signing_link}}` exactly once, unknown/unclosed fields, `wordsSha256` equals a hand-computed value, one-pass render.
- T5 Words actions: role before read; admin edits; non-approver Approve refused; prefixes mapped; no words text in any log (spy).
- T6 Send: limiter before read; no write when the gate is off; the agreement equals `signAndAccept`'s for the same inputs except the
  date fields; token is 43 base64url characters and only its sha256 reaches the rpc; mailer called once with idempotency key, the stored-
  text review PDF attached, `to` = proposal `client_email` (a browser-sent address is ignored); failed send -> `mark_sent(false)` and the
  fixed sentence; no address/token/letter in any log (spy on console).
- T7 Mailer: attachments base64-encoded; size and count limits; existing callers' request bodies unchanged; grep: `api.resend.com`
  appears only in `internal-mail.ts`.
- T8 Link read: wrong/expired/closed/other-proposal token all render the identical `LINK_UNAVAILABLE` markup; constant-time compare used;
  a stored text that fails its sha256 is not drawn.
- T9 Page states: before consent the markup has no input, canvas or Sign; after consent the box, typed name, `box_note`, `sign_line`.
- T10 Sign: name folding (accept "  sam   CLIENT " for "Sam Client"; refuse "Sam Clients"); PNG checks; refusal mapping; follow-ups
  scheduled only when `signed_now = true`; nothing logged with content.
- T11 In-app refused while the path is on (`signing_required`, no rpc call).
- T12 Hygiene: `tests/proposals/public-assets.test.ts` green; no new dependency in `package.json`; `pricing.ts` has no diff; the only
  `/p/<token>/` URL builder is still `client-link-origin.ts`; client-words grep for denied phrases ("legally binding", "electronic
  signature act", "ESIGN", "UETA", "consent to") in builder-written strings.
- `pnpm lint`, `pnpm test`, `pnpm build` green.

## Known limits
- In-memory limits are per server instance. Two sends at the very same moment: the second `signing_open` closes the first (`resent`),
  so at most one link is open, but two emails may go out; only the newer link works.
- The emailed review PDF and the page are drawn from the stored text as plain paragraphs (no letter styles), because only the words are
  stored; the signed PDF in Sprint B keeps `verifySignedCopy`'s rebuild-first rule.
- A client whose name differs from "Your details" must send a fresh link (D3).

## NOT verified (listed, not hidden)
A real browser (canvas drawing by mouse, pen and touch; focus order; 375px), a real database with 0117 (every function and the 22
isolation cases), real email delivery and Resend attachments, the firm's verified sending domain, the `next build` trace of fonts for the
new server actions (`next.config.ts` already covers `/p/*`), and 0106's lifecycle accepting the new function's transaction (see 0117's
"BEFORE APPLYING").
