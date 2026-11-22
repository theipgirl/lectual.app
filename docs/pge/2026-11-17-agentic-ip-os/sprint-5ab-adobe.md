# Sprint 5a/5b contract: Adobe Acrobat Sign for the engagement letter (PGE, STRICT)

**Status:** DRAFT for the director's review (Nov 22). Not approved; nothing is built.

**Size:** two sprints (5a, then 5b). **Schema:** lectual **0113**, a PROPOSAL FILE ONLY (`docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt`). Nothing is applied to lectual-dev or lectual-prod. **Evaluator: STRICT** (signatures). **Design input:** `adobe-sign-design.md`. That note calls its migration "0108". In plan numbering it is 0113. If the note and this contract disagree, the generator stops and asks. It does not pick (see Open questions).
**Out of this contract, ON HOLD:** Sprint 5 items 1–3 and 6–8: the one-card approval, the pay link and invoice, the email, pay, the signed-and-paid hired chain, and the won move.

Number check (Nov 22): this folder has 0108, 0110 and 0112 proposal files. No file or branch in the worktree uses 0113–0116. 0115 is taken by another session. **0113 is free here.** The generator re-checks `lectual/supabase/migrations` before copying (numbers are first-merged-wins).

## Goal
When a firm has connected **its own** Adobe Acrobat Sign account, a client who presses Sign on `/p/<token>` signs the engagement letter in Adobe's embedded signing page. The letter they sign is built byte-for-byte the way 0106 builds it: the same agreement text, canonical fingerprint and `pdf.ts` renderer. "Signed" is what Adobe returns when we re-read the agreement ourselves. One idempotent database function then records the signature and the acceptance together. Adobe's signed PDF and audit report are stored as files, and Adobe's signed PDF is filed in Lawmatics.
A firm that has not connected Adobe sees exactly what clients see today: the in-app signature (0106), unchanged to the byte.

## Blockers (written into the contract; AGENTS.md gets the same paragraph in 5a)
1. **RPB's plan has no API.** RPB's Adobe account is an **Acrobat Pro** subscription registered to the managing attorney. Per Adobe's FAQ, API access is only for enterprise or developer tier accounts. The Acrobat Sign individual plan bundled with Pro has no integration (API) feature. So RPB cannot connect today. Production for RPB needs one of these. **Taylor and Rebecca decide; this contract does not pick:**
   - (a) RPB moves to an Acrobat Sign plan with API access (Business/Enterprise/"Solutions"); or
   - (b) Lectual's PARTNER app is **certified by Adobe** and RPB's account is one it may reach. Whether a non-API plan can authorize a certified partner app at all is unverified. Adobe must confirm it.
   Until then, Adobe stays "not set up" in production. RPB keeps the in-app signature (0106). Nothing in 5a/5b depends on the decision.
2. **Development uses a free Acrobat Sign DEVELOPER account.** Taylor/Lectual creates it under a **non-attorney email**, and it must not be the Pro subscription's email. The test OAuth app and every manual sandbox run live there. No client data and no real client email is used: test signers are Lectual-controlled addresses. Developer-account agreements are for testing only (Adobe watermarks them; verify in the spike).
3. **Sandbox spike before 5a merges** (in the developer account, by a person, results written into the PR). It checks the note's unverified items:
   - email suppression actually holds;
   - text-tag syntax;
   - `signingUrls` timing after create;
   - which field carries the completion time;
   - the `GET /users/me` shape;
   - whether PKCE is accepted.
   Any item that fails stops the sprint and goes back to the director.
4. **Taylor/Rebecca must also answer** before any production use: the "never sends" questions (note §3 a–c), the sender account (note Q3: the managing attorney's own identity versus a firm account), and the plan/certification route (item 1).

## Scope In

### 5a: connection, agreement creation, embedded signing
1. **Config** (`src/lib/esign/adobe-config.ts`). Env holds only `ADOBE_SIGN_OAUTH_CLIENT_ID` and `ADOBE_SIGN_OAUTH_CLIENT_SECRET`, plus the optional redirect URI and authorize URL.
   - Either of the first two unset means "not set up": the Settings card is disabled with `SWITCH_ON_WORDS`, and every proposal signs in-app.
   - There is no deployment-wide Adobe token, account or API key, and no env var for one.
2. **Per-firm OAuth connection** (`src/lib/esign/adobe-connection.ts`, `adobe-oauth.ts`, modelled on `payments/lawpay-connection.ts`).
   - Sealing: `sealToken(…, "lectual-adobe-sign")`. Add the context to `SealContext` in `src/lib/mailbox/crypto.ts`.
   - State: a signed `state` cookie bound to the user and firm, valid 10 minutes.
   - Connect and callback routes enforce the admin tier on the page AND in the route.
   - The callback validates `api_access_point` and `web_access_point` against the host rule (`https://`, host ending `.adobesign.com` / `.echosign.com`, no path), reads `/users/me`, and writes the row through the **scoped client**.
   - Sealed columns are read only by the service role, fenced on the `(id, org_id)` a scoped read returned. On the public and webhook paths the fence is the proposal or request row's own `org_id`.
   - Refresh happens when the token has under 5 minutes left. Adobe's refresh token does **not** rotate: keep the stored one.
   - A 401, or `invalid_grant` on refresh, sets `reauth`. A 4xx about one agreement never pauses the firm.
   - Disconnect order: a scoped update to `revoked` (the trigger clears both secrets), then revoke at Adobe, then delete the row.
3. **Settings → Integrations card**, "Adobe Acrobat Sign" (`IntegrationRow`). Three states: connected ("Connected as …") / not connected / couldn't check. Plus `reauth` → Reconnect. It is optional and not a setup-checklist item. Words go in `src/lib/ui/words.ts`.
4. **One shared "build the agreement" half.** Factor out the first half of `signAndAccept` (`src/lib/proposals/public.ts`); do not copy it:
   - the token read (`sent`, unexpired, carries `loe`);
   - `quoteForAcceptance`, `buildExhibit`, `assembleAgreement`;
   - the server's date in the firm's zone;
   - `canonicalFingerprint` equal to the browser's.
   The in-app path calls the factored function and its behaviour is unchanged. On the Adobe path `typedName` is `""`, so `{{signer_name}}` falls back to the cleaned `client_name` (`letterValues`), and there is no tick.
5. **`pdf.ts` `for-signature` mode.** The words are exactly `agreementText` (`agreementText(blocks, exhibit)`). There is no review banner and no signature record. One appended signature block carries Adobe text tags (one signer), drawn outside the words. Review and signed modes are unchanged.
6. **`startAdobeSigning(token, selection, clientClasses, details, fingerprint)`** is a public server action and token-only.
   - Readiness: the connection is `active`, there is no open request for this version, `letterLiveCheck` returns `current`, and the client email is a real address.
   - It inserts a `client_proposal_esign_request` row as `creating` **before** calling Adobe. The row stores the agreement text (signed date = `FINGERPRINT_DATE` placeholder), the canonical fingerprint, the sha256 of the uploaded PDF bytes, and the frozen selection, snapshot, details and signer email.
   - Adobe calls:
     - transientDocuments;
     - agreements, with exactly ONE `SIGNER` participant set (the client's email), all five `disabledNotificationTypes`, `emailOption.sendOptions` all `NONE`, no reminders, `externalId` = the request uuid, `expirationTime` = the proposal expiry, and a `postSignOption` redirect to `/p/<token>/?signed=adobe`;
     - a RESOURCE webhook. A failure here is non-fatal and recorded as `webhook_not_registered`;
     - `signingUrls`, with a short retry on 404 not-yet-processed.
   - The `esignUrl` goes to the browser only: never stored or logged.
   - A failure → the request goes to `failed`, a half-made agreement is cancelled at Adobe (cancellation emails off), and nothing is accepted.
   - Pressing Sign again with changed choices cancels the old agreement and makes a new request.
7. **Path choice on `/p/<token>` step 3** (`src/lib/esign/path.ts`, pure):
   - env unset, no row, `revoked`, `reauth`, or the read failed → in-app (0106) with no mention of Adobe;
   - `active` → Adobe.
   Client words go in `src/lib/loe/client-words.ts`. The firm-facing wording for the Adobe path goes in `words.ts`.
8. **Error mapper** `src/lib/esign/adobe-errors.ts`: Adobe `code` → our fixed codes and sentences. Raw Adobe text is never shown, logged, or stored in `last_error`.
9. **0113 proposal file** (Data, below) and a hand-added type in `src/lib/db/types.ts`. Every 0113 read is three-state: a missing table or function (42P01 / PGRST205 / 42883 / PGRST202, matched by code) means "not set up", which means in-app.

### 5b: completion, files, Lawmatics, fallback rules
10. **Webhook** `GET|POST /api/adobe-sign/webhook/` (public; route prefix is an open question).
   - GET: echo the client id (header and JSON body) on a constant-time match, otherwise 403.
   - POST: a wrong client id gets a non-2xx. Otherwise read only `event` and `agreement.id`, cap the body at 64 KB, answer 2xx with the echo at once, and do the work in `after()`.
   - The work: find the request by `adobe_agreement_id` (service role); an unknown id does nothing. Re-read `GET /agreements/{id}` with **that request's firm's** token at its checked `api_access_point`, and act only on Adobe's status.
   - The org always comes from our request row.
   - Logs carry only the event name and the request uuid.
11. **Return check** `checkAdobeSigning(token)`. It is token-only, polls at most every 20 s for up to 3 min, and honours 429 / `Retry-After`. `?signed=adobe` is a hint only.
12. **Daily sweep.** This is a budgeted step inside an existing daily cron route (no new cron, and `vercel.json` is unchanged). Per firm with an active connection:
   - at most 50 `out_for_signature` requests, oldest first, within 60 s overall;
   - complete, expire, cancel or leave each one;
   - a 429 stops that firm for the run;
   - keep-alive refresh when `last_refreshed_at` is over 30 days old;
   - counts only in the cron JSON.
13. **One completion path** (`src/lib/esign/complete.ts`). Every caller (webhook, return check, sweep) goes through it:
   - re-read the agreement;
   - only Adobe status `SIGNED` proceeds;
   - write the final text from the stored text, with only the signed-date placeholder replaced (the firm's zone, the completion date);
   - call `client_proposal_adobe_complete` once.
   On success it runs `runAcceptanceFollowups` and the new step `adobe_signed_files`. A refusal leaves everything unchanged. `proposal_changed` puts the request in `failed` and shows the staff sentence.
14. **Stored files** (`adobe_signed_files`, success word `stored`, added to `RETRYABLE_STEPS`).
   - Download `combinedDocument?attachAuditReport=false` and `auditTrail`. Each must start with `%PDF-` and be at most `MAX_FILE_BYTES`.
   - Store them in the private `client-files` bucket under `{org_id}/{lead|matter}/{parent_id}/{file_id}.pdf`, with `crm_file` rows. The service role stamps the request row's org.
   - Record `signed_pdf_sha256` and `audit_sha256` on the request.
   - A failure never changes acceptance or paid.
15. **`signed_loe_upload` provider switch** (`loe-signed-upload.ts` / `accept-followups.ts` `buildPdf`):
   - `lectual` → `buildVerifiedSignedPdf`, as today;
   - `adobe_sign` → the stored signed PDF, whose sha256 must equal `signed_pdf_sha256`, or the step is `blocked` with `STEP_TEXT.signedMismatch`;
   - files not stored yet → `failed`, retried after `adobe_signed_files`.
16. **Fallback rules.**
   - Not connected, `reauth` or `revoked` → in-app.
   - While a request for this version is `creating` / `out_for_signature`, in-app signing is refused, by the page AND by the amended `client_proposal_sign_and_accept`. Its new error prefix maps to a fixed sentence and never falls through to `unavailable` text.
   - A firm is never left with no way to sign (see open questions for disconnect and reauth with an open request).
17. **Staff and receipt wording:**
   - signed: "Signed by <name> on <date/time zone> with Adobe Acrobat Sign";
   - out for signature: "Out for signature with Adobe Acrobat Sign since <date>";
   - read failed: "Signing status couldn't be loaded" (never "Not signed").
   `isSignedSnapshot`, `verifySignedCopy`, "Read it again" and `buildVerifiedSignedPdf` stay unchanged for both providers. The snapshot stays `schema: 2`, with optional `agreement.provider` / `adobe_agreement_id`.

## Out
The one-card approval, the pay link and invoice, pay, the hired chain, the won move (Sprint 5 items 1–3 and 6–8, ON HOLD). A second signer, a firm countersign, `HOST` / `IN_PERSON_SIGNER`, `x-api-user`, `:group` / `:account` scopes. Adobe email signing. `EMAIL_OTP`. Mutual-TLS webhooks. Applying 0113 anywhere. A deployment-wide Adobe credential. `pricing.ts` changes. Sending the audit report to Lawmatics (note Q6). Any production Adobe connection for RPB (Blocker 1).

## Data: 0113-proposed.sql.txt (proposal only; header in the 0112 style: "PROPOSAL ONLY… NOT APPLIED ANYWHERE")
- **`adobe_sign_connection`**
  - Columns: `id` pk, `org_id` unique → `crm_org`, `status` CHECK `active|reauth|revoked`, `api_access_point` not null (CHECK host rule), `web_access_point` (same rule), `account_email`, `scopes text[]`, `access_token_enc`, `refresh_token_enc`, `access_expires_at`, `last_refreshed_at`, `last_verified_at`, `last_error` (a code only), `connected_by`, `created_at`, `updated_at`.
  - Grants: column-level SELECT to `authenticated` on every column EXCEPT the two `_enc` columns. INSERT/UPDATE grants name columns.
  - Policies: any member of the org selects. `owner`/`admin`/`senior_admin` insert/update/delete within their org.
  - Trigger: `status → revoked` nulls both `_enc` columns.
- **`client_proposal_esign_request`**
  - Columns: `id`, `org_id` (from the proposal), `proposal_id`, `family_id`, `version`, `connection_id`, `provider` CHECK `adobe_sign`, `adobe_agreement_id` unique null, `canonical_fingerprint`, `agreement_text`, `sent_pdf_sha256`, `signed_pdf_sha256`, `audit_sha256`, `selection`, `snapshot`, `details` jsonb, `signer_email`, `status` CHECK `creating|out_for_signature|completed|cancelled|expired|declined|failed`, `signature_id`, `signed_pdf_file_id`, `audit_file_id`, `last_checked_at`, `last_error`, `created_at`, `completed_at`.
  - Partial unique index on `(proposal_id)` WHERE status IN (`creating`, `out_for_signature`).
  - Grants: SELECT to `authenticated` on the non-text columns only. No grant on `agreement_text`, `details`, `signer_email`, `snapshot` (the note names only `agreement_text`; see open questions). No insert/update/delete for `authenticated`: service role only.
  - Policy: select for `SIGNATURE_READ_ROLES` of the org.
- **`client_proposal_signature`**: add nullable columns `provider text default 'lectual'` CHECK `lectual|adobe_sign`, `adobe_agreement_id text`, `esign_request_id uuid` → request. No insert/update for `authenticated` (the 0106 rule).
- **Function:**
  ```sql
  client_proposal_adobe_complete(p_request_id uuid, p_agreement_id text, p_signed_at timestamptz,
                                 p_agreement_text text, p_agreement_sha256 text) returns uuid
  ```
  SECURITY DEFINER, `search_path` pinned. REVOKE from `public`, `anon`, `authenticated`; GRANT EXECUTE to `service_role`.
  - It locks the request row.
  - Already `completed` → return its `signature_id`.
  - Require: `out_for_signature`, the agreement id matches, the proposal has the same org/family/version, status `sent`, not expired, `sha256(p_agreement_text) = p_agreement_sha256`, and the text equals the stored text with only the signed-date placeholder replaced.
  - Then: insert the signature (`provider='adobe_sign'`), set the proposal `accepted` with the FROZEN selection and snapshot plus the agreement block, and set the request `completed`.
  - Refusal prefixes: `esign_request_closed`, `esign_proposal_changed`, `esign_text_mismatch`.
- **Amend `client_proposal_sign_and_accept`:** refuse (prefix `loe_sign_esign_open`) while an open request exists for the proposal.
- **Isolation cases to add to lectual's `tests/tenant-isolation.test.ts`** (written into the file, not run):
  1. Firm B's member selects A's connection → 0 rows.
  2. A's member selects `access_token_enc` or `refresh_token_enc` → permission denied.
  3. A's paralegal insert/update/delete → refused. A's admin cannot set `org_id` to B.
  4. B's admin updates A's row → 0 rows.
  5. Requests: B reads 0 rows of A's. `authenticated` cannot insert, update or delete. A's staff selecting `agreement_text` → permission denied.
  6. `client_proposal_adobe_complete` is not executable by `anon` or `authenticated`.
  7. The new signature columns: no insert/update for `authenticated`.
  8. The function's idempotency (a second call returns the same id) and its three refusals leave rows unchanged.
  9. `sign_and_accept` is refused while a request is open, and allowed once it is `failed` or `cancelled`.

## Files likely touched
New: `src/lib/esign/{adobe-config,adobe-oauth,adobe-connection,host-rule,payload,adobe-client,adobe-errors,path,start,complete,webhook,sweep,files}.ts`, `src/app/api/adobe-sign/{connect,callback,webhook}/route.ts`, `docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt`, `tests/esign/**`.
Changed:
- `src/lib/proposals/public.ts` (factored agreement half; refusal mapping);
- `src/lib/loe/pdf.ts` (`for-signature`);
- `src/lib/loe/client-words.ts`, `src/lib/ui/words.ts`;
- `src/lib/mailbox/crypto.ts` (`SealContext`);
- `src/lib/proposals/{accept-followups,loe-signed-upload,paid}.ts`;
- `src/app/p/[token]/**` (step 3, return check);
- `src/app/dashboard/settings/integrations/page.tsx`;
- the staff `EngagementLetterCard` / `signed-card.ts`;
- one existing cron route (sweep step);
- `src/lib/db/types.ts`, `next.config.ts` (route trace if needed);
- `AGENTS.md` (blocker paragraph; correct the stale "0106 NOT on prod" lines).

## Acceptance tests (unit tests with fakes; no test calls Adobe, Lawmatics or a database; `ADOBE_SIGN_OAUTH_*` unset unless a test sets it)
1. **In-app pin.** With Adobe not set up, the `/p/<token>` letter steps and receipt render byte-for-byte equal to a baseline taken from this sprint's base commit. The `client_proposal_sign_and_accept` RPC is called with exactly the same arguments as before (spy) for the same inputs. The existing `loe-baseline`, signing and signed-pdf tests pass unchanged.
2. **Same text, same fingerprint.** For one fixture, the Adobe path's `agreement_text` (placeholder date) and `canonicalFingerprint` equal the in-app path's with `typedName = client_name`. `for-signature` PDF text extraction equals `agreementText`, and the signature block lies outside it. Pinned fixture sha256.
3. **Stale.** A browser fingerprint ≠ the server's → `stale`, no request row, no Adobe call.
4. **Payload.** Exactly one participant set, role `SIGNER`, one member (the client email). All five notification types disabled. All three `sendOptions` are `NONE`. No `reminderFrequency`. `externalId.id` = the request uuid. The proposal token appears nowhere in the body or name. The name is ≤ 255 characters.
5. **Host rule.** Accepts `https://api.na1.adobesign.com/`. Refuses `evil.com`, `adobesign.com.evil.com`, `http://…`, a path, and userinfo. A token is never sent to a refused host (fake fetch records no call).
6. **Env unset** → the Settings card is disabled with `SWITCH_ON_WORDS` and the path is in-app. A connection read that fails → in-app on `/p`, "couldn't check" in Settings.
7. **OAuth.** A bad, expired or other-user/other-firm `state` is refused. A non-admin is refused in the route even with the page bypassed. Tokens are sealed under `lectual-adobe-sign`. The scoped insert never names an `_enc` column in a select.
8. **`reauth` / `revoked`** → in-app with no Adobe words. A 401 on a call sets `reauth`. A 4xx about one agreement does not.
9. **Create failure** (5xx, timeout, 429 at create or at signingUrls) → request `failed`, cancel attempted on a created agreement, no acceptance, the fixed sentence shown, and the `esignUrl` absent from every `console.*` spy and every stored column.
10. **Open request** → the in-app action is refused (page). A fake RPC returning `loe_sign_esign_open` maps to its own fixed sentence.
11. **Webhook GET/POST:**
    - GET echoes header and body for our id; others get 403;
    - POST with a wrong id → non-2xx;
    - unknown agreement → 2xx and no write;
    - a forged "completed" while the fake Adobe answers `OUT_FOR_SIGNATURE` → no write;
    - a body over 64 KB is refused;
    - the org used is the request row's, even when the body names another.
12. **Replay.** Two completions (webhook + return check, or webhook twice) call the completion once to effect and return the same signature id. Follow-ups run once.
13. **Completion refusals** (fake function): `esign_proposal_changed` → request `failed`, staff sentence, nothing accepted. `esign_request_closed` / `esign_text_mismatch` → nothing written.
14. **Return check** never marks signed from `?signed=adobe`. It polls no faster than 20 s and stops at 3 min. A read failure shows "couldn't check", not "not signed".
15. **Sweep.** It respects 50 per firm and 60 s. A 429 stops that firm only. It refreshes a connection at more than 30 days. Its output is counts only.
16. **Files.** Both stored under the request's org path with `%PDF-` and the size cap. A non-PDF or oversize file → `failed` and retried. A failure leaves acceptance unchanged.
17. **Lawmatics switch.** Adobe → the stored PDF is uploaded. A hash mismatch → `blocked` with `signedMismatch`. Not stored yet → `failed`. `lectual` → `buildVerifiedSignedPdf` (spy).
18. **Hygiene greps over `src/lib/esign` and the new routes:**
    - no mail import or send call;
    - no `"ALL"` email option;
    - no `/reminders`;
    - no `x-api-user`;
    - no `HOST` / `IN_PERSON_SIGNER`;
    - no `:account` / `:group`;
    - no `includeSignedDocuments`;
    - no service role outside the listed public, webhook and sweep files;
    - no `getServiceClient` under `src/app/dashboard`;
    - no `ADOBE_SIGN_*TOKEN*` / API-key env name.
19. **Staff card three states** for an Adobe signature, and "couldn't be loaded" on a failed read. No raw Adobe text on any page (`no-raw-error-text`). No build words.
20. `pnpm test`, `pnpm lint`, `pnpm build` pass. `pricing.ts` has no diff. The 0113 file exists, is marked not applied, and holds every isolation case above.

## MUST NEVER
- Any email to a client caused by Lectual code. Any Adobe notification left on. Any reminder.
- Any signer other than the client. A staff path that creates, opens or fetches a signing URL. A staff "sign" button.
- A deployment-wide Adobe credential, or an Adobe call in a test.
- A signature recorded whose text does not match the stored text or fingerprint. A signed state taken from a webhook body, a redirect parameter or the browser.
- A change to what the in-app signature renders, hashes or sends for a firm without Adobe.
- A cross-firm read (the org from anywhere but our own row). A token sent to a host outside the rule.
- A token, `esignUrl`, client secret, agreement text, address or Adobe body in a log, a step payload or `last_error`.
- One version signed twice (in-app plus Adobe).
- The service role in dashboard code. A raw error shown. A migration applied, or put in this repo as a migration.
- Client names in fixtures (use made-up names).

## Open questions (disagreements between the note, Sprint 5 and this contract; the generator does not pick)
1. **Create failure → in-app?** Sprint 5 item 5 says a failure at creation falls back to in-app. The note (§5.4, Q2) leaves it open and shows only "try again".
2. **Route prefix.** Sprint 5 says `src/app/api/esign/**`. The note says `/api/adobe-sign/{connect,callback,webhook}/`.
3. **Whose account.** Sprint 5 (T3) says "Rebecca's own account". The new facts say that account (Pro, the managing attorney's) has no API, and dev must use a different email. The note's Q3 (sender identity) is still open.
4. **Blocker wording.** Sprint 5 says "Developer Edition, a PARTNER app" on Rebecca's account. The director now says the developer account is Lectual's, under a non-attorney email. Production needs plan or certification (Blocker 1).
5. **Isolation acceptance.** Sprint 5 AT14 says "0113's isolation cases on lectual-dev". This contract (proposal only) says cases are written, not run.
6. **Disconnect or `reauth` with an open request.** The note says the client "is offered the in-app signature instead" (§1.3), yet an open request refuses in-app in the database (§5.4). Who closes the open request (disconnect, sweep, page), and does Adobe get a cancel?
7. **Half-made agreement.** Sprint 5 AT6 says "cancelled or recorded as abandoned". The note says the request becomes `failed` and the agreement is cancelled. There is no `abandoned` status.
8. **Which request columns staff may read.** The note withholds only `agreement_text`. `details`, `signer_email` and `snapshot` also hold client address and PII.
9. **`signed_pdf_sha256` / `audit_sha256`.** They appear in note §5.2 but not in its §2.3 table.
10. **Signer name.** In-app `{{signer_name}}` is the typed name. Adobe uses the cleaned `client_name`. Is that right for an entity signer?
11. **`{{signed_date}}`** (Q9): our completion date versus Adobe's field date across midnight.
12. **Blank proposals** (Q8): where the files live with no lead or matter. Whether `crm_file.uploaded_by` may be null is unverified.
13. **PKCE.** The director's brief cites the Zoom PKCE/rotating pattern. The note says Adobe does not document PKCE and its refresh token does not rotate.
14. **Sweep host.** The note says "for example" `/api/cron/lawmatics-matters/`. The exact route and budget slice are not fixed.
15. **"Never sends"** (§3 a–c): accept Adobe's own copy email if the spike shows it leaks, or keep the firm in-app? Tell the firm on the Settings card?
16. **Completion function arguments.** There is no `p_org_id` (the org comes from the request row), whereas 0106's function takes `p_org_id`. Keep the asymmetry?
17. **Stale AGENTS.md.** Its letter-track headings say 0106 is "NOT on prod". Sprint 5 says it has been on prod since Nov 12. Correct it in 5a, or in a separate docs change?
