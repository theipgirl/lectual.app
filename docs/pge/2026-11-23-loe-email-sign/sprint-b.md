# Sprint B contract: after signing (certificate, signed copy, Lectual file, staff card) (PGE, STRICT)

**Status:** v2 (Nov 23): v1 refused by the strict evaluator; B6, B7, N8, N10, N11 answered below. Not yet ratified. Nothing is built.
**Starts after Sprint A is built and evaluated.** `LOE_EMAIL_SIGNING` is set to `on` only after THIS sprint ships (Sprint A D18).
**Size:** medium-large, one agent, one session. **Branch:** `claude/loe-email-sign` (never `main`; no push, no PR).
**Schema:** none new. Uses lectual 0117 as written for Sprint A (`0117-proposed.sql.txt`); if Sprint B needs a change to it, the generator
stops and asks (the file is shared with Sprint A's contract). **Evaluator: STRICT.**
**Binding input:** `spec.md` (owner decisions 4, 5, 7 and the firm rules), `sprint-a.md` (its Decisions D1-D12 hold here). Anything not
covered: write it under "Open questions" in `questions.md` and take the conservative path. Do not pick.

## Goal
When a client signs by the emailed link (Sprint A), three things follow, each a retryable acceptance follow-up step: the signed copy is
emailed to the client, it is filed on the proposal's lead or matter in Lectual (Documents & files), and (already, unchanged) in Lawmatics
(`signed_loe_upload`). The signed PDF ends with a certificate page built only from recorded evidence. Staff see the link's state on the
proposal page. The in-app (0106) path is untouched: its signed PDF has no certificate page and none of the two new steps run for it.

## Blockers
1. Sprint A built, evaluated and committed. 0117 still unapplied (every read is "not set up" until then; the steps say so and do nothing).
2. Same as Sprint A: the firm's sending domain on Resend; the firm's approved words (the signed-copy email's subject and body are the
   request's SNAPSHOTTED `copy_subject` / `copy_body`, so the words that were approved when the link went out are the ones used).

## Scope In

### The certificate page (signed copy only)
1. **`src/lib/loe/pdf.ts`:** `BuildLetterPdfInput` gains optional `certificate?: SigningCertificate` (`signed` mode only; ignored and
   refused in `review` mode). When present, ONE extra page is appended after the signature record, titled with a step-style heading
   ("Signing record", a label in `client-words.ts`, not a legal sentence), listing, label: value, in this order: sent to (the `sent` event's
   `sent_to`), sent at, opened at, consent accepted at, consent text fingerprint (sha256), signing words version, signed at (firm zone,
   named, plus the same instant in UTC ISO 8601), IP address, browser (400 characters), the letter's fingerprint, the typed legal name,
   and the signature: the drawn PNG drawn from its stored bytes (re-checked: PNG magic, at most 100 KB, sha256 equal to the recorded
   `signature_sha256`; any mismatch -> no certificate at all, see item 3) or, for a typed signature, the name in the recorded style using
   the bundled DejaVu Sans regular (`src/lib/loe/fonts/DejaVuSans.ttf`; no oblique is bundled and no font is added) with the words
   "Typed signature" beside it (v2, N9; the app records only `print`, Sprint A D16; a `script` value, which the app never writes,
   prints the same way with its style named). A value that was not recorded prints "Not recorded", never a guess. No other text.
2. **`SigningCertificate`** is built only by the pure `src/lib/loe/email-signing/certificate.ts`
   `certificateFrom({ request, events, snapshot, verifiedSha256, tz })`. **v2 (B7): it reads ONLY columns 0117 grants to
   `authenticated`, so the service-role and the staff paths read the same set and run the same checks.** Where each field comes from:
   | Field on the page | Source (both paths) |
   |---|---|
   | sent to | the `sent` event's `sent_to` (events are fully granted) |
   | sent at | the request's `sent_at` (granted) |
   | opened at | the request's `opened_at` (granted); IP/browser of the open are not printed (the `opened` event may be a scanner, Sprint A known limit) |
   | consent accepted at | the request's `consent_at` (granted) |
   | consent text fingerprint | the `consent` event's `consent_sha256` |
   | signing words version | the request's `words_version` (granted) |
   | signed at | the request's `signed_at` (granted) |
   | IP address, browser | the `signed` event's `ip`, `user_agent` |
   | the letter's fingerprint | `verifiedSha256` (what `verifySignedCopy` hashed and matched), cross-checked below |
   | typed legal name, signature | the `signature` event's `typed_name`, `signature_kind`, `signature_png`, `typed_style`, `signature_sha256` |
   The request's `agreement_sha256`, `consent_sha256` and `sent_to` are NOT read on either path (not granted). It returns null unless
   ALL hold: the request is `signed`; its `id` equals `snapshot.agreement.signing_request_id`; its `signature_id` equals
   `snapshot.agreement.signature_id`; exactly one `sent`, one `consent`, one `signature` and one `signed` event exist for it; the
   `signed` event's `agreement_sha256` equals `snapshot.agreement.sha256` AND equals `verifiedSha256`; the drawn PNG re-checks (item 1).
3. **`verifySignedCopy` rules still hold** (`src/lib/loe/signed-text-check.ts` unchanged). `buildVerifiedSignedPdf`
   (`src/lib/loe/signed-pdf.ts`) gains a **REQUIRED** `readEvidence: () => Promise<SigningEvidence | "not_set_up" | "unavailable">`
   (v2, B6; required in the input type, so no caller can leave it out by accident). Sprint A's blanket refusal of `email_link`
   snapshots (Sprint A item 12b) is replaced by this rule:
   - in-app (0106) snapshot (no `agreement.method`): `readEvidence` is never called and the PDF is byte-for-byte today's (pinned
     against `tests/loe/signed-pdf.test.ts`'s fixtures);
   - `email_link` snapshot: asked only AFTER the text is verified (`rebuilt` or `stored`); `certificateFrom(...)` with the verified
     sha256. `"unavailable"`, `"not_set_up"`, or a `null` certificate whose cause is missing evidence -> `{ ok: false, reason:
     "unavailable" }` (try again), **never a PDF without the page**; a certificate whose `signed` event's sha256 differs from the
     verified sha256, or a drawn PNG that fails its re-check -> `{ ok: false, reason: "mismatch" }` (the existing handling: blocked
     step, one `logSignedMismatch` line). A link-signed letter is never printed without its certificate (D-B1).
   **Every caller passes it (v2, B6), each with the client it already holds:**
   - `src/lib/proposals/public-letter.ts` (the client's signed download): the service-role client it already uses, fenced on the
     proposal row's org (step `client_download`);
   - `src/lib/proposals/accept-followups.ts` (`signed_loe_upload` on the follow-up run): the service-role client passed in, fenced on the
     proposal row's org;
   - `src/lib/proposals/paid-flow.ts` (`signed_loe_upload` Try again / Mark paid on the dashboard): the SCOPED client;
   - `src/lib/loe/staff-download.ts` (the staff Download): the SCOPED client;
   - `src/lib/proposals/signed-copy-email.ts` and `src/lib/proposals/signed-loe-file.ts` (new, items 6 and 8): the client they are handed.
   A grep test fails on any `buildVerifiedSignedPdf(` call whose argument object lacks `readEvidence`. Because Sprint A recorded
   `signed_loe_upload` as `failed` (not done) for any link signature, the next run or Try again uploads the letter WITH its certificate.
4. **Readers.** `src/lib/loe/email-signing/evidence-read.ts`: `readSigningEvidence(db, { proposalId, orgId, requestId })`, ONE reader for
   both paths, selecting exactly the granted request columns (`id, org_id, proposal_id, status, sent_at, opened_at, consent_at,
   signed_at, signature_id, words_version, copy_subject, copy_body`) and the events' named columns (`kind, at, ip, user_agent, sent_to,
   consent_sha256, signature_kind, signature_png, typed_style, signature_sha256, typed_name, agreement_sha256`), fenced on `org_id`,
   `proposal_id` and the request id from the snapshot (`agreement.signing_request_id`). Never `token_sha256`, `agreement_text` or any
   ungranted column, on either path (v2, B7: a grep test lists the select strings). Callers: the public/follow-up path (the service
   role it is handed, fenced on the proposal row's org) and the dashboard (scoped client; 0117 grants the eight `SIGNATURE_READ_ROLES`
   these columns and the events). Three-state: `ok` / `not_set_up` (42P01 / PGRST205 / 42883 / PGRST202 by code) / `unavailable`; for an
   `email_link` snapshot both of the latter mean no PDF (a link-signed letter without its evidence is never printed).

### The signed-copy email (step `signed_copy_email`)
5. **`src/lib/proposals/paid.ts`:** add `signed_copy_email` (success word `sent`) and `signed_loe_file` (success word `filed`) to
   `PROPOSAL_STEPS`, `STEP_SUCCESS`, `RETRYABLE_STEPS` (after `signed_loe_upload`) and the step words table (success / blocked / failed /
   skipped sentences, e.g. "emailed the signed engagement letter to the client", "filed the signed engagement letter in Lectual").
   `readEarlierSteps` (`accept-followups.ts`) adds both to its `.in("payload->>step", [...])` list.
6. **`src/lib/proposals/signed-copy-email.ts`** `runSignedCopyEmail(deps)` (deps injected: gate facts, request read, PDF build, mailer).
   Runs in `runAcceptanceFollowups` after `signed_loe_upload`, ONLY for `agreement.method === "email_link"` (decision 7: the signed copy is
   sent because the client signed by link; an in-app signature sends nothing, as today). Outcomes:
   - `sent`: one email, `to` = the `sent` event's `sent_to` (the address the link went to; never another address), `from` = the firm's `FIRM_CLIENT_MAIL_FROM` entry, subject
     and body = the request's snapshotted `copy_subject` / `copy_body` rendered with `renderEmailWords` (`client_name`, `firm_name`), the
     verified signed PDF with its certificate attached, `idempotencyKey = "signed-copy:" + requestId + ":" + round` (the reset round, so a
     re-signing after a reset is a new key);
   - `skipped`: `LOE_EMAIL_SIGNING` is not `on`, or the firm has no mail entry or no `RESEND_API_KEY` (fixed reason sentences);
   - `blocked`: the PDF is a mismatch (`STEP_TEXT.signedMismatch`) or the certificate does not verify;
   - `failed`: the mailer failed (`HTTP <status>` or "no response"), the evidence or firm facts could not be read, or the PDF could not be
     built. Retried by the next run or Try again.
   It does NOT require approved words to still exist (the request carries the snapshot). Once per round (`stepSucceeded`). Step payloads
   carry the outcome and a fixed sentence or HTTP status only: never the address, the words, the PDF or the token.
7. **Retry** (`retryProposalStep` / the staff Try again on the proposal page) for `signed_copy_email`, offered to `PROPOSAL_PAID_ROLES`,
   uses the same core on the caller's SCOPED client: the proposal row, the request's granted columns (0117 grants `copy_subject` /
   `copy_body` for this), the `sent` event's `sent_to` and the evidence are all readable by `SIGNATURE_READ_ROLES` under RLS, so no
   service role is used on the dashboard path (no `@/lib/db/admin` import in dashboard code; the existing grep test). Retrying a `sent`
   step does nothing. **v2 (N10): a staff Try again is a RETRY of the owner-approved signed copy only**: the same email (the request's
   snapshotted words, the same signed PDF), to the same `sent_to`, under the same idempotency key for the round; it cannot change the
   address, the words or the attachment, and it is never a new kind of client email. A role in `PROPOSAL_PAID_ROLES` that is not in
   `SIGNATURE_READ_ROLES` cannot happen today (the paid roles are a subset); the core still refuses when the evidence read is refused.

### The Lectual file (step `signed_loe_file`)
8. **`src/lib/proposals/signed-loe-file.ts`** `runSignedLoeFile(deps)`: runs for EVERY signed (schema 2) acceptance (in-app and link: the
   owner's decision 4 asks for the signed copy in Lectual; filing the in-app signed copy in Lectual is new for in-app signatures too, see
   Open question Q5; conservative default below). Target: the proposal's `matter_id`, else its `lead_id` (followed to its keeper with
   `keeperForWrite`; an unreadable pointer is `failed`). Neither = `blocked` with "No lead or matter to file the signed letter under yet."
   (`STEP_TEXT.signedNoParent`). Writes, as the service role fenced on the proposal row's org (the public path's client, passed in):
   - the PDF from `buildVerifiedSignedPdf` (with the certificate for a link signature) to the private `client-files` bucket at
     `buildStoragePath({ orgId, kind, parentId, fileId, ext: "pdf" })` (`src/lib/files/rules.ts`), content type `application/pdf`;
   - then one `crm_file` row (org from the proposal row, parent kind and id, the file name from `signedLetterFileName`, the real byte
     size, the mapped MIME; never `uploaded_by` or `contact_id`), then one `file_uploaded` activity row (`actor_type system`, payload the
     file id and `source: "signed_letter"` only);
   - an object written but a row refused -> the object is removed (best effort) and the step is `failed`.
   **Service role on the public path: a documented exception (v2, N8).** AGENTS.md says Documents & files uses "No service role". This
   step is the one exception: on the public/follow-up run (no session exists; the client signed by link) it writes the `client-files`
   object, the `crm_file` row and the `file_uploaded` activity with the service-role client `public.ts` already holds and passes in,
   fenced on the PROPOSAL ROW'S `org_id`, the path built by `buildStoragePath` from that org. `signed-loe-file.ts` imports no admin
   client (the client is a parameter; the existing lint fence on `@/lib/db/admin` and its grep test are unchanged and stay green). The
   AGENTS.md "Documents & files" section gains this exception in one sentence, and the new section repeats it (item 11).
   Once per round: done-ness also reads the step's `extra.file_id`; a retry after `filed` does nothing. Staff Try again runs the same
   core on the caller's SCOPED client (the `client-files` storage policies and `crm_file` RLS are org-scoped, as the dashboard upload
   already uses them); only the public/follow-up run uses the service role it is handed. Outcomes `filed` / `blocked` /
   `failed` / `skipped` (files table missing by code: "Documents & files isn't switched on for your firm yet." via `notReadyYet`).
   **Decision (D-B4):** Sprint B files the in-app signed copy too ONLY IF Q5 is answered yes before the sprint starts; otherwise the step
   runs only for `method === "email_link"` (the spec's flow) and in-app acceptances are byte-for-byte today's.

### Staff side
9. **The proposal page's Engagement letter card** (`src/components/proposal-editor/EngagementLetterCard.tsx`, view in
   `src/lib/loe/signed-card.ts`, read in a new `src/lib/loe/email-signing/request-read.ts` through the SCOPED client, granted columns
   only: `id, status, closed_reason, sent_at, expires_at, opened_at, consent_at, signed_at, created_at`): for a live (`sent`) version with
   a letter, one line from the NEWEST request: "Link sent Nov 23, 2:14 PM EST" / "Opened Nov 23, ..." / "Consent given Nov 23, ..." /
   "Signed Nov 23, ..." / "Link expired Nov 30" / "Link closed (a newer link was sent)" (a fixed sentence per `closed_reason`); no request =
   no line; a FAILED read = "Signing link status couldn't be loaded." (never "not sent"); 0117 missing (by code) = no line. Only for
   `SIGNATURE_READ_ROLES` (the read is not attempted for others). For a signed version, the card adds the two new steps' states beside the
   Lawmatics filing (`filingView`-style views, `emailCopyView`, `lectualFileView`) with Try again for `PROPOSAL_PAID_ROLES`.
10. **Confirm sentences:** Reset acceptance's confirm adds "The signing link can be sent again." The owner's delete confirm adds "The
    signing link's record is removed too." (fixed sentences in `vocabulary.ts`).

### Docs, harness
11. **AGENTS.md:** complete the Sprint A section (same heading) with: the two new steps and when each runs; the certificate page and its
    verification rule (every `buildVerifiedSignedPdf` caller passes `readEvidence`; a link signature never prints without its page);
    the staff states and the three-state read; the owner-approved client-email exception restated (the signing link and the signed
    copy, nothing else), **including that a staff Try again of `signed_copy_email` is a retry of that same owner-approved email to the
    same address, never a new kind of email (N10)**; the service-role exception for the Lectual file on the public path (N8), also as
    one sentence in the existing "Documents & files" section; NOT verified list.
12. **`docs/MASTER-TODO.md`:** items for: apply 0117 (dev, isolation cases, prod); set `FIRM_CLIENT_MAIL_FROM` and verify the firm's
    Resend domain; the firm's approver approves signing words; set `LOE_EMAIL_SIGNING=on`; walk the flow once in a real browser on
    desktop and phone; Q1-Q5 answers.
13. **Design harness** `scripts/design-harness/screens/loe-email-sign.screen.tsx`: the client states (step 3 with the email button, link
    sent, `?sign=` read-only + consent, signature box drawn/typed, name mismatch, link unavailable, done) at 1440 and 375, no sideways
    overflow, fake names and `example.com` addresses only.

## Data
No new schema. Reads 0117's request (granted columns on the staff path) and events; writes nothing to 0117. Writes `crm_file`,
`crm_activity` (`file_uploaded`), the `client-files` bucket, and `client_proposal_event` step events, all as the service role fenced on the
proposal row's org on the public/follow-up path, as `signed_loe_upload` and `address_to_lawmatics` already do.

## Decisions
- **D-B1 The certificate is drawn only from verified evidence** and only beside the verified text; a link-signed letter is never printed
  without its certificate (fail closed: no file, try again).
- **D-B2 The signed copy goes to `sent_to` only**, the address the link went to and the signer proved control of. Never another address.
- **D-B3 Words for the signed-copy email are the request's snapshot**, so a later approval of new words never changes what a signer who
  already got a link receives.
- **D-B4 The Lectual file for in-app signatures** waits on Q5 (default: link signatures only).
- **D-B6 (B7) One evidence reader, granted columns only**, on both paths; field sources are the table in item 2.
- **D-B7 (B6) `readEvidence` is required** on `buildVerifiedSignedPdf`; every caller is named (item 3).
- **D-B8 (N9) The typed signature** prints in DejaVu Sans (regular) with the words "Typed signature" beside it, the same words the
  page shows (Sprint A D16); only `print` is ever recorded by the app.
- **D-B9 (N11)** `SignedMismatchStep` gains `"signed_copy_email"` and `"signed_loe_file"` (Sprint A added `"signing_link"`).
- **D-B5 Steps order:** `accept_notice`, `lawmatics_note`, `signed_loe_upload`, `signed_loe_file`, `signed_copy_email`,
  `address_to_lawmatics`. Each is independent; none waits on another's success.

## Out of scope
Attorney countersignature (spec decision 6). Any email to a client other than the signed copy. Sending the copy to staff by email. Storing
the PDF bytes anywhere but `client-files`. A new schema. Changing `pricing.ts`, `verifySignedCopy`, or the in-app path's PDF.

## Tests (`env -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_URL pnpm test`; nothing sends)
- `certificateFrom`: null for every broken link in item 2's chain; "Not recorded" for missing values; values in order; built from the
  granted columns only (the staff fixture has no `agreement_sha256` / `consent_sha256` / `sent_to` on the request and still builds).
- `buildVerifiedSignedPdf`: an `email_link` snapshot with `readEvidence` answering `unavailable` / `not_set_up` / a broken chain gives
  NO PDF; each named caller passes `readEvidence` (grep test); `logSignedMismatch` steps type-check.
- PDF: a link-signed fixture gets one more page whose text contains the verified fingerprint; an in-app fixture's bytes (minus the
  creation date) equal today's; a certificate with a different sha256 yields `mismatch`; a PNG over 100 KB or with a different sha256 yields
  no PDF.
- `signed_copy_email`: `to` is the `sent` event's `sent_to` even if the proposal's `client_email` changed; idempotency key per round; skipped /
  blocked / failed reasons are the fixed sentences; never for an in-app signature; payloads carry no address (spy on the recorded event).
- `signed_loe_file`: path built by `buildStoragePath` with the proposal row's org; no parent = `blocked`; row refused -> object removed;
  once per round; merged lead -> keeper.
- Staff card: each request state's line; failed read is "couldn't be loaded"; not attempted for viewer / social_media.
- Retry: role gate; dashboard file imports no admin client (existing grep test).
- Harness screen renders at 1440 and 375 with no overflow.
- `pnpm lint`, `pnpm test`, `pnpm build` green.

## Known limits
- The signed copy is sent by `after()`; a crash before it runs leaves the step unrecorded until the next acceptance follow-up run or Try
  again (the same gap as `signed_loe_upload` today).
- Resend's idempotency window is 24 hours; a Try again days later after a lost response can send a second copy.

## NOT verified (listed, not hidden)
Real email delivery and Resend attachments; the firm's verified domain; a real database with 0117; Storage writes to `client-files` by
the service role in production; the certificate page in a real PDF viewer; a real browser for the harness states at 375px.
