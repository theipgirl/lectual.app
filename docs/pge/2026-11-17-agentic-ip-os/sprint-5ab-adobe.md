# Sprint 5a/5b contract: Adobe Acrobat Sign for the engagement letter (PGE, STRICT)

**Status:** v4: RATIFIED by the strict evaluator (Nov 22) after two rounds of changes; final for the director. Not built. Nothing is built.

**Size:** two sprints (5a, then 5b). **Schema:** lectual **0113**, a PROPOSAL FILE ONLY (`docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt`). Nothing is applied to lectual-dev or lectual-prod. **Evaluator: STRICT** (signatures). **Design input:** `adobe-sign-design.md`. That note calls its migration "0108"; in plan numbering it is 0113. Where the note and this contract disagree, this contract's Decisions section wins; anything not covered there, the generator stops and asks. It does not pick.
**Out of this contract, ON HOLD:** Sprint 5 items 1–3 and 6–8: the one-card approval, the pay link and invoice, the email, pay, the signed-and-paid hired chain, and the won move.

Number check (Nov 22): this folder has 0108, 0110 and 0112 proposal files. No file or branch in the worktree uses 0113–0116. 0115 is taken by another session. **0113 is free here.** The generator re-checks `lectual/supabase/migrations` before copying (numbers are first-merged-wins).

## Goal
When a firm has connected **its own** Adobe Acrobat Sign account AND Lectual has turned the Adobe signing path on (the client-path switch, D15), a client who types their name and presses "Continue to Adobe to sign" on `/p/<token>` signs the engagement letter on Adobe's signing page, reached from ours (a top-level navigation; no iframe). The letter they sign is built byte-for-byte the way 0106 builds it, with the name they typed and the date the request was made: the same agreement text, canonical fingerprint and `pdf.ts` renderer. The text is final when the request is created. "Signed" is what Adobe returns when we re-read the agreement ourselves. One idempotent database function then records the signature and the acceptance together. Adobe's signed PDF and audit report are stored as files, and Adobe's signed PDF is filed in Lawmatics.
A firm without both (connection active, switch on) sees exactly what clients see today: the in-app signature (0106), unchanged to the byte. **A firm is never left with no way to sign** (D1, D6).

## Blockers (written into the contract; AGENTS.md gets the same paragraph in 5a)
1. **OPEN BLOCKER for Taylor and Rebecca: the production account and sender (D3, D4).** RPB's Adobe account is an **Acrobat Pro** subscription registered to the managing attorney; per Adobe's FAQ it has no API. Production needs **the firm's own API-tier Acrobat Sign account** (a plan with API access, or whatever route Adobe confirms, including partner certification). **The sender is whoever owns that account**; their name appears in Adobe's audit report. Taylor and Rebecca decide which account and who owns it; this contract does not pick. Until then Adobe stays "not set up" in production and RPB keeps the in-app signature. Nothing in 5a/5b depends on the decision.
2. **Development uses the free Acrobat Sign DEVELOPER account** that **Taylor creates under a non-attorney email** (never the Pro subscription's email). The test OAuth app and every sandbox run live there. **Test signers only**: Lectual-controlled addresses, no client data, no real client email. Developer-account agreements are watermarked (confirm in the spike).
3. **Sandbox spike before 5a merges, done by a person (Taylor) once she has the developer account.** No Adobe call is made by any test or by CI. Results are written into the 5a PR. It checks:
   - email suppression holds, and **whether Adobe sends its own copy email to the client** (gates D15);
   - text-tag syntax, and a PDF whose only fields come from tags;
   - `signingUrls` timing after create, and the `esignUrl` host;
   - which field carries the completion time;
   - the `GET /users/me` shape;
   - the developer-account watermark.
   Any item that fails (other than the copy email, which D15 handles) stops the sprint and goes back to the director.
4. **The client-path switch stays OFF in production** until the spike shows no Adobe email reaches the client, or Taylor explicitly says that email is acceptable (D15), AND 0113's isolation cases pass on lectual-dev (D5).

## Scope In

### 5a: connection, agreement creation, signing on Adobe's page
1. **Config** (`src/lib/esign/adobe-config.ts`). Env holds only `ADOBE_SIGN_OAUTH_CLIENT_ID`, `ADOBE_SIGN_OAUTH_CLIENT_SECRET`, the optional `ADOBE_SIGN_OAUTH_REDIRECT_URI` and `ADOBE_SIGN_AUTHORIZE_URL`, and the client-path switch `ADOBE_SIGN_CLIENT_SIGNING`.
   - Either of the first two unset means "not set up": the Settings card is disabled with `SWITCH_ON_WORDS`, and every proposal signs in-app.
   - `ADOBE_SIGN_AUTHORIZE_URL`, when set, is checked at load: `https://` and a host ending `.adobesign.com`. A bad value means "not set up".
   - **`ADOBE_SIGN_CLIENT_SIGNING`** (D15): a NEW Adobe agreement is created only when it is exactly `on`. Anything else, unset included, means in-app for every firm (except finishing a request already open, item 8). It never stops a firm from connecting, and never stops the webhook, return check, sweep or disconnect from closing requests already open. No schema.
   - There is no deployment-wide Adobe token, account or API key, and no env var for one.
2. **Per-firm OAuth connection** (`src/lib/esign/adobe-connection.ts`, `adobe-oauth.ts`, modelled on `payments/lawpay-connection.ts`).
   - Sealing: `sealToken(…, "lectual-adobe-sign")`. Add the context to `SealContext` in `src/lib/mailbox/crypto.ts`.
   - State: a signed `state` cookie bound to the user and firm, valid 10 minutes. **No PKCE** (D13).
   - Connect and callback routes (`/api/esign/connect/`, `/api/esign/callback/`) enforce the admin tier on the page AND in the route.
   - **Host checks in the callback:** the `api_access_point` on the redirect passes the host rule (`https://`, host ending `.adobesign.com` / `.echosign.com`, no path) BEFORE the token POST (which carries `client_secret`); the token response's `api_access_point` must equal it, and its `web_access_point` passes the same rule. Then `/users/me` is read and the row written through the **scoped client**.
   - Sealed columns are read only by the service role, fenced on the `(id, org_id)` a scoped read returned. On the public, webhook and sweep paths the fence is the proposal or request row's own `org_id`.
   - Refresh happens when the token has under 5 minutes left. Adobe's refresh token does **not** rotate: keep the stored one.
   - A 401, or `invalid_grant` on refresh, sets `reauth`. A 4xx about one agreement never pauses the firm.
3. **Disconnect** (`src/lib/esign/disconnect.ts`, `disconnectAdobeAction`, admin tier re-resolved in the action; D6). In this order:
   1. Scoped read of the firm's row (the permission check).
   2. Service-role read of the sealed token, fenced on that `(id, org_id)`.
   3. For each of the firm's `creating` / `out_for_signature` requests: re-read the agreement; `SIGNED` → the one completion path (item 14), and the action awaits `adobe_signed_files` (and the acceptance follow-ups) before step 4; if that step is not `stored`, the action's result says "The signed letter for N clients is in your Adobe account; it couldn't be copied into Lectual."; otherwise `PUT /agreements/{id}/state` to `CANCELLED` **with cancellation emails off**, then the request → `cancelled`. A `creating` row with no agreement id → `cancelled`. A cancel Adobe refuses or can't be reached, **or a re-read that fails** (never treated as signed) → the request is still `cancelled` with `cancel_failed = true`, and the action's result names how many ("N letters couldn't be cancelled in Adobe. Cancel them in your Adobe account.").
   4. Scoped update to `revoked` (the trigger clears both secrets).
   5. Re-list the firm's open requests and close any it finds (one opened during step 3) as `cancelled` with `cancel_failed = true`, fenced on from-status.
   6. Revoke at Adobe; 7. delete the row (requests keep their rows; `connection_id` becomes null).
   The confirm says open letters are cancelled and those clients sign in Lectual on their next visit. **Known limit:** once the connection is revoked, nothing watches those agreements; a `cancel_failed` agreement signed later in Adobe is never seen by Lectual.
   **Known limit (follow-ups):** completion follow-ups that stop part-way (the notice, note and address steps) are retried only by Try again; the sweep covers only the files step and `signed_loe_upload`, the same gap as the in-app path today.
4. **Settings → Integrations card**, "Adobe Acrobat Sign" (`IntegrationRow`). Three states: connected ("Connected as …") / not connected / couldn't check, plus `reauth` → Reconnect with "N clients are waiting to sign until you reconnect." (N = the firm's `out_for_signature` requests, from granted columns; a failed count omits the line). When connected and the switch is off: "Clients sign in Lectual until Lectual turns on signing with Adobe." Optional, not a setup-checklist item. Words go in `src/lib/ui/words.ts`.
5. **One shared "build the agreement" half** (D10). Factor out the first half of `signAndAccept` (`src/lib/proposals/public.ts`); do not copy it:
   - the token read (`sent`, unexpired, carries `loe`);
   - the name and details check: the name-and-details half of `checkSigning` is factored into ONE function (`checkSignerFields`) that both paths call. It refuses a name under `MIN_SIGNED_NAME` (`name_required`) and a non-empty `missingDetails(details)` (`details_required`), nothing written. The in-app path keeps calling `checkSigning`, whose behaviour and results are unchanged (it still refuses without `agree`);
   - `quoteForAcceptance`, `buildExhibit`, `assembleAgreement`, with the date text `letterDateText(now, firm zone)`, exactly as `letterValues` fills both date fields today;
   - `canonicalFingerprint` equal to the browser's.
   **On the Adobe path the client TYPES their name on our page before going to Adobe**, so `{{signer_name}}` is always the typed name and `letterValues`' `client_name` fallback never applies. The signer name is **never derived from `client_name`**; the entity name is its own detail, and `letterValues` itself is unchanged (in-app pin). There is no "I agree" tick on the Adobe path: Adobe's signature act replaces it.
6. **`pdf.ts` `for-signature` mode.** The words are exactly `agreementText(blocks, exhibit)` of the stored text. No review banner, no signature record. One appended signature block carries Adobe text tags (one signer) and Adobe's own date field, drawn after and outside the words. Review and signed modes are unchanged.
7. **`startAdobeSigning(token, selection, clientClasses, details, typedName, fingerprint)`** (`src/lib/esign/start.ts`) is a public server action and token-only.
   - Readiness: switch on, the connection is `active`, no open request for this version, `letterLiveCheck` returns `current`, the client email is a real address.
   - **The text is final now (D11).** Both date fields of the stored agreement text are the firm-zone date on which this call built it. No placeholder, no later replacement. The `for-signature` PDF is rendered from that text before anything is written.
   - **Opening the request** goes through `client_proposal_esign_open(...)` (service role; Data), never a plain insert. It locks the proposal, checks it is still the same live version and that the connection belongs to the proposal's org, and inserts the row as `creating` **before** Adobe is called. The row stores the final agreement text and its sha256 (`agreement_sha256`), the canonical fingerprint, the sha256 of the PDF bytes to be uploaded, the cleaned typed name (`signer_name`), `signer_title`, `entity_name`, `address` (= `addressJson(details)`), `template_version`, and the frozen selection, snapshot, details and signer email, each computed exactly as `signAndAccept` computes 0106's arguments. A refusal (`esign_proposal_changed`) maps to the `stale` sentence; the open-request unique index (23505) maps to the `loe_sign_esign_open` sentence.
   - Adobe calls, in order:
     - transientDocuments;
     - agreements, with exactly ONE `SIGNER` participant set (the client's email, `name` = the typed name), all five `disabledNotificationTypes`, `emailOption.sendOptions` all `NONE`, no reminders, `externalId` = the request uuid, `expirationTime` = the end of the proposal's `expires_on` day in the firm's zone as an ISO instant, and `postSignOption.redirectUrl` = `clientLinkUrl(await clientLinkOrigin(org), token)` + `?signed=adobe` (the only place the token appears). File name and agreement name carry no token;
     - **as soon as `POST /agreements` returns**, ONE update sets `adobe_agreement_id` and status `out_for_signature`, before the next two calls;
     - a RESOURCE webhook to `/api/esign/webhook/`. A failure here is non-fatal: the request stays `out_for_signature` with `last_error = webhook_not_registered`;
     - `signingUrls` (no `frameParent`), with a short retry on 404 not-yet-processed. The returned `esignUrl` must be `https` with a host ending `.adobesign.com` / `.echosign.com`, otherwise it is a creation failure.
   - The browser navigates to the `esignUrl` **top-level** (no iframe, no `frameParent`, no CSP change). It is never stored or logged.
   - **A failure (D1, D7)** at any of these steps → the request goes to `failed` with a `last_error` code from item 9, a created agreement is cancelled at Adobe (cancellation emails off; a failed cancel sets `cancel_failed = true`), nothing is accepted, and the action returns `fallback: 'in_app'` (item 8) with the sentence "Adobe Acrobat Sign didn't answer, so you can sign here instead."
   - **Pressing Sign again with changed choices:** with the switch `on`, the old agreement is cancelled and a new request made; with the switch off, the old request is cancelled and the page falls back to in-app.
   - **Optional (MAY):** on a resume where the firm-zone date has changed since the request was created, cancel and re-create (switch on only). Without this rule the request keeps its start date.
8. **Path choice on `/p/<token>` step 3** (`src/lib/esign/path.ts`), first match wins:
   - the path read first closes any of this proposal's `creating` rows older than 10 minutes as `failed` (`last_error = creation_interrupted`);
   - an open request whose connection is `revoked`, missing, or whose `connection_id` is null → closed as `cancelled` with `cancel_failed = true` (fenced on from-status), then in-app;
   - an open request for this version and the connection `active` → resume (a fresh `signingUrls`, or the return check), even with the switch off, so nothing already open is stranded;
   - an open request and the connection `reauth` / unreadable → the paused sentence (D6, item 17); no in-app, no Adobe call;
   - the request read failed → the in-app form (a database refusal there maps to the `loe_sign_esign_open` sentence);
   - a failure on this visit (`startAdobeSigning` returned `fallback: 'in_app'`; client state only, nothing stored, a reload is a new visit) → the in-app form, typed name and details kept, the tick shown;
   - switch off, env unset, no row, `revoked`, `reauth`, the connection read failed, or the 0113 table/function missing → in-app (0106) with no mention of Adobe;
   - `active` → Adobe.
   The button label "Continue to Adobe to sign" and every client sentence come from `src/lib/loe/client-words.ts` (step words only); the firm-facing wording from `words.ts`.
9. **Error mapper** `src/lib/esign/adobe-errors.ts`: Adobe `code` → our fixed codes and sentences. Raw Adobe text is never shown, logged, or stored. `last_error` is one of a closed set (a CHECK in 0113): `adobe_unavailable`, `adobe_rate_limited`, `adobe_timeout`, `adobe_refused`, `creation_interrupted`, `webhook_not_registered`, `esign_proposal_changed`, `signed_after_close`. A failed cancel is the `cancel_failed` flag, never a `last_error` value.
   - **Fenced status changes.** Every request status change in app code is an update fenced on the expected from-status (and, for closing stuck rows, on `created_at < now() - 10 min`). An update that changes 0 rows is that caller's loss: start then treats it as a creation failure (cancel the agreement at Adobe if one was created, then fall back to in-app).
10. **0113 proposal file** (Data, below) and a hand-added type in `src/lib/db/types.ts`. Every 0113 read is three-state: a missing table or function (42P01 / PGRST205 / 42883 / PGRST202, matched by code) means "not set up", which means in-app.

### 5b: completion, files, Lawmatics, fallback rules
11. **Webhook** `GET|POST /api/esign/webhook/` (public).
   - GET: echo the client id (header and JSON body) on a constant-time match, otherwise 403.
   - POST: a wrong client id gets a non-2xx. An in-memory per-instance courtesy rate limit applies. A body over 64 KB is answered 2xx and ignored. Otherwise read only `event` and `agreement.id`, answer 2xx with the echo at once, and do the work in `after()`. The raw body is never stored or logged.
   - The work: find the request by `adobe_agreement_id` (service role); an unknown id does nothing. Re-read `GET /agreements/{id}` with **that request's firm's** token at its checked `api_access_point`, and act only on Adobe's status (item 14).
   - The org always comes from our request row. Logs carry only the event name and the request uuid.
12. **Return check** `checkAdobeSigning(token)` (`src/lib/esign/return-check.ts`). Token-only, up to 3 min from the browser's side. **Server-side throttle:** if the request's `last_checked_at` is under 20 s ago, it answers "waiting" with no Adobe call; otherwise it writes `last_checked_at` BEFORE the call. It honours 429 / `Retry-After`. `?signed=adobe` is a hint only.
13. **Daily sweep** (D14). A budgeted step at the end of `/api/cron/lawmatics-matters/`, after the hired-matter sync (no new cron, `vercel.json` unchanged, the route's `maxDuration` unchanged), 60 s overall and never past the route's time left:
   - for **every firm with such a row, whatever its connection status**: close `creating` rows older than 10 minutes as `failed` (`creation_interrupted`), and close open requests whose connection is `revoked`, missing, or whose `connection_id` is null as `cancelled` with `cancel_failed = true` (fenced on from-status);
   - per firm with an `active` connection: at most 50 `out_for_signature` requests, oldest first: complete, expire, cancel or leave each one (item 14);
   - per firm with an `active` connection: each `completed` request of the last 30 days whose `signed_pdf_file_id` is null → `adobe_signed_files`, then `signed_loe_upload` if that step isn't yet `uploaded` for the round;
   - a 429 stops that firm for the run;
   - keep-alive refresh when `last_refreshed_at` is over 30 days old;
   - counts only in the cron JSON (closed, completed, expired, cancelled, files stored, uploads, refreshed, rate-limited).
   A `reauth` firm's `out_for_signature` requests are skipped (they stay open, D6); after the admin reconnects, the next sweep or return check re-reads them with the fresh token.
14. **One completion path** (`src/lib/esign/complete.ts`). Every caller (webhook, return check, sweep, disconnect) goes through it:
   - re-read the agreement; only Adobe status `SIGNED` proceeds;
   - if the request is no longer open (`cancelled`, `expired`, `declined`, `failed`) and Adobe says `SIGNED`: set `last_error = signed_after_close`, accept nothing, and the staff page shows "The client signed in Adobe after this signing request was closed. Check it with them.";
   - otherwise pass the stored text and its stored sha256, with `p_signed_at` = Adobe's completion time, to `client_proposal_adobe_complete` once;
   - only when it returns `completed_now = true`: run `adobe_signed_files` FIRST, then `runAcceptanceFollowups`. A second completion (`completed_now = false`) runs nothing.
   A refusal leaves everything unchanged. `esign_proposal_changed` puts the request in `failed` with that `last_error` and shows the staff sentence (item 18).
15. **Stored files** (`adobe_signed_files`, `src/lib/esign/files.ts`, success word `stored`, added to `RETRYABLE_STEPS`, to `PROPOSAL_STEPS`, `STEP_SUCCESS` and the step words in `paid.ts`, and to `readEarlierSteps`' step list in `accept-followups.ts`).
   - Download `combinedDocument?attachAuditReport=false` and `auditTrail`. Each must start with `%PDF-` and be at most `MAX_FILE_BYTES`.
   - Store them in the private `client-files` bucket under `{org_id}/{lead|matter}/{parent_id}/{file_id}.pdf`, with `crm_file` rows (`uploaded_by` left to its default, null under the service role). The service role stamps the request row's org.
   - **A proposal with no lead or matter (D12):** nothing is downloaded; the step is `blocked` ("No lead or matter to file the signed letter under yet."), and the files stay in the firm's Adobe account. It runs again (sweep or Try again) once a lead or matter is linked.
   - Record `signed_pdf_sha256` and `audit_sha256` on the request (D9).
   - **Try again** is offered to `PROPOSAL_PAID_ROLES`; the dashboard action re-reads the proposal through the scoped client and calls `files.ts`, which alone uses the service role (fenced on the request row's org). No `@/lib/db/admin` import in dashboard code.
   - A failure never changes acceptance or paid.
16. **`signed_loe_upload` provider switch** (`loe-signed-upload.ts` / `accept-followups.ts` `buildPdf`):
   - `lectual` → `buildVerifiedSignedPdf`, as today;
   - `adobe_sign` → the stored signed PDF, whose sha256 must equal `signed_pdf_sha256`, or the step is `blocked` with `STEP_TEXT.signedMismatch`;
   - files not stored yet → `failed`, retried after `adobe_signed_files` (item 13). The audit report is not sent to Lawmatics.
17. **Fallback rules.**
   - Not connected, `revoked`, switch off, or creation failed on this visit → in-app.
   - While a request for this version is `creating` / `out_for_signature`, in-app signing is refused, by the page AND by the amended `client_proposal_sign_and_accept`. Its prefix `loe_sign_esign_open` maps to a fixed sentence and never falls through to `unavailable` text.
   - **`reauth` with an open request (D6):** the request stays open and the client sees "Signing is paused for a moment. Please come back later." (no Adobe call, no in-app). Settings says Reconnect and how many clients are waiting. Once reconnected, the next sweep or return check re-reads it: signed → completed; expired, cancelled or declined → closed, and the client gets in-app on the next visit.
   - **Disconnect with an open request (D6):** item 3 closes it first, so the client gets in-app on the next visit.
   - **A stuck `creating` row** is closed after 10 minutes (items 8, 13), so it never blocks in-app for long.
18. **Staff and receipt wording:**
   - signed: "Signed by <typed name> on <date/time zone> with Adobe Acrobat Sign" (time = `signed_at`, Adobe's completion time);
   - out for signature: "Out for signature with Adobe Acrobat Sign since <date>";
   - `esign_proposal_changed`: "The client signed in Adobe after this proposal changed. Check it with them.";
   - `signed_after_close`: "The client signed in Adobe after this signing request was closed. Check it with them.";
   - files not stored: "The signed PDF from Adobe isn't stored yet. Try again.";
   - read failed: "Signing status couldn't be loaded" (never "Not signed").
   - Reset-acceptance confirm adds "The Adobe agreement stays signed in your Adobe account." The owner's delete confirm adds "The Adobe agreement and the signed files already stored are not removed."
   - **The provider is read in a separate query** (`provider`, `adobe_agreement_id`, `esign_request_id`); 42703, PGRST204, 42P01 or PGRST205 means `provider = 'lectual'`. The existing `signature-read.ts` COLUMNS read is unchanged.
   `isSignedSnapshot`, `verifySignedCopy`, "Read it again" and `buildVerifiedSignedPdf` stay unchanged for both providers. The snapshot stays `schema: 2`; `agreement.signer_name` is the typed name, plus `agreement.provider` / `adobe_agreement_id`; `signing.date_text` is the start date text.
19. **AGENTS.md "Adobe Acrobat Sign" section (5b)**, modelled on the LawPay and Meetings sections: completion only from a re-read; one open request per version; in-app refused while a request is open; the files path and the provider switch; no deployment-wide credential; the `ADOBE_SIGN_CLIENT_SIGNING` switch; tests never call Adobe. It does not touch the 0106 lines (D17).

## Out
The one-card approval, the pay link and invoice, pay, the hired chain, the won move (Sprint 5 items 1–3 and 6–8, ON HOLD). A second signer, a firm countersign, `HOST` / `IN_PERSON_SIGNER`, `x-api-user`, `:group` / `:account` scopes. Adobe email signing. `EMAIL_OTP`. Mutual-TLS webhooks. PKCE. An iframe or `frameParent`. Applying 0113 anywhere (D5). A deployment-wide Adobe credential. `pricing.ts` changes. Sending the audit report to Lawmatics. A `proposal` parent kind for files (D12). Any production Adobe connection for RPB (Blocker 1). The AGENTS.md 0106 correction (a separate docs-only commit, D17).

## Data: 0113-proposed.sql.txt (proposal only; header in the 0112 style: "PROPOSAL ONLY… NOT APPLIED ANYWHERE")
All functions are SECURITY DEFINER with `search_path` pinned to `''` and schema-qualified names; REVOKE from `public`, `anon`, `authenticated`; GRANT EXECUTE to `service_role` (except the amended `sign_and_accept`, whose grants stay 0106's). **Lock order everywhere:** a function that locks both takes the request row first, then the proposal (`FOR UPDATE`).
- **`adobe_sign_connection`**
  - Columns: `id` pk, `org_id` unique, `status` CHECK `active|reauth|revoked`, `api_access_point` not null (CHECK host rule), `web_access_point` (same rule), `account_email`, `scopes text[]`, `access_token_enc`, `refresh_token_enc`, `access_expires_at`, `last_refreshed_at`, `last_verified_at`, `last_error` (a code only), `connected_by` default `auth.uid()`, `created_at`, `updated_at`.
  - Grants: SELECT to `authenticated` on every column EXCEPT the two `_enc` columns. INSERT: `org_id`, `status`, `api_access_point`, `web_access_point`, `account_email`, `scopes`, `access_token_enc`, `refresh_token_enc`, `access_expires_at`, `last_refreshed_at`, `last_verified_at`. UPDATE: the same list minus `org_id`.
  - Policies: any member of the org selects. `owner`/`admin`/`senior_admin` insert/update/delete within their org, with `WITH CHECK` on `org_id`.
  - Trigger: `status → revoked` nulls both `_enc` columns.
- **`client_proposal_esign_request`**
  - Columns: `id`, `org_id`, `proposal_id`, `family_id`, `version`, `connection_id` (nullable), `provider` CHECK `adobe_sign`, `adobe_agreement_id` unique null, `signer_name`, `signer_title`, `entity_name`, `address jsonb`, `template_version`, `canonical_fingerprint`, `agreement_text`, `agreement_sha256`, `sent_pdf_sha256`, `signed_pdf_sha256`, `audit_sha256`, `selection`, `snapshot`, `details` jsonb, `signer_email`, `status` CHECK `creating|out_for_signature|completed|cancelled|expired|declined|failed`, `cancel_failed boolean not null default false`, `signature_id`, `signed_pdf_file_id`, `audit_file_id`, `last_checked_at`, `last_error` (CHECK null or the closed set in item 9), `created_at`, `completed_at`. There is no column for a webhook payload, an IP or a user agent.
  - Partial unique index on `(proposal_id)` WHERE status IN (`creating`, `out_for_signature`).
  - Grants (D8, following 0106): SELECT to `authenticated` ONLY on `id`, `org_id`, `proposal_id`, `family_id`, `version`, `connection_id`, `provider`, `adobe_agreement_id`, `status`, `cancel_failed`, `signer_name`, `canonical_fingerprint`, `sent_pdf_sha256`, `signed_pdf_sha256`, `audit_sha256`, `signature_id`, `signed_pdf_file_id`, `audit_file_id`, `last_checked_at`, `last_error`, `created_at`, `completed_at`. **No grant** on `agreement_text`, `agreement_sha256`, `signer_title`, `entity_name`, `address`, `template_version`, `details`, `signer_email`, `snapshot`, `selection`. No insert/update/delete for `authenticated`: service role only.
  - Policy: select for `SIGNATURE_READ_ROLES` (owner, admin, senior_admin, attorney, intake, paralegal, law_clerk, clerk) of the org. Viewer, social_media and `anon` read nothing.
- **`client_proposal_signature`**: add nullable columns `provider text default 'lectual'` CHECK `lectual|adobe_sign`, `adobe_agreement_id text`, `esign_request_id uuid`; SELECT on them to `authenticated` under 0106's existing policy. 0106's grants are not widened. No insert/update for `authenticated` (the 0106 rule).
- **Foreign keys:**

  | Column | References | On delete |
  |---|---|---|
  | request `proposal_id` | `client_proposal` | cascade |
  | request `org_id` | `crm_org` | as the other tenant tables |
  | request `connection_id` (nullable) | `adobe_sign_connection` | set null |
  | request `signature_id` | `client_proposal_signature` | set null |
  | request `signed_pdf_file_id`, `audit_file_id` | `crm_file` | set null |
  | signature `esign_request_id` | the request | set null |
  | connection `org_id` | `crm_org` | as the other tenant tables |
  | connection `connected_by` | `auth.users` | set null |

- **`client_proposal_esign_open(p_proposal_id, p_org_id, p_family_id, p_version, p_connection_id, p_signer_name, p_signer_title, p_entity_name, p_address, p_template_version, p_details, p_signer_email, p_selection, p_snapshot, p_agreement_text, p_agreement_sha256, p_canonical_fingerprint, p_sent_pdf_sha256) returns uuid`**
  - `SELECT … FROM public.client_proposal WHERE id = p_proposal_id FOR UPDATE`.
  - Require: status `sent`, not expired, carries `loe`, and `org_id`, `family_id`, `version` equal to the arguments; the connection's `org_id` equals the proposal's and it is `active`; `sha256(p_agreement_text) = p_agreement_sha256`. Otherwise raise `esign_proposal_changed`.
  - Insert the request as `creating` with `org_id` = the proposal's. A second open request fails on the unique index (23505).
- **`client_proposal_adobe_complete(p_request_id uuid, p_agreement_id text, p_signed_at timestamptz, p_agreement_text text, p_agreement_sha256 text) returns table(signature_id uuid, completed_now boolean)`** (D16: no `p_org_id`, the org comes from the request row; no signer parameters, they are the request's frozen columns)
  - Lock the request row, then the proposal (`FOR UPDATE`).
  - Already `completed` → if `adobe_agreement_id = p_agreement_id`, return `(signature_id, false)`; otherwise raise `esign_request_closed`.
  - Require: `out_for_signature` (else `esign_request_closed`); `adobe_agreement_id = p_agreement_id` (else `esign_request_closed`); the proposal has the same org/family/version and status `sent`, and is not expired **at `p_signed_at`** (0106's expiry rule evaluated at `p_signed_at`, not `now()`) (else `esign_proposal_changed`); `request.created_at <= p_signed_at <= now() + interval '5 minutes'` (clock skew; else `esign_bad_signed_at`); `p_agreement_text = request.agreement_text` exactly and `sha256(p_agreement_text) = p_agreement_sha256 = request.agreement_sha256` (else `esign_text_mismatch`).
  - Then: insert the signature with `provider = 'adobe_sign'`, `adobe_agreement_id`, `esign_request_id`, `signer_name`, `signer_title`, `entity_name`, `address`, `template_version`, `agreement_text`, `agreement_sha256` from the request's frozen columns, `ip` and `user_agent` null, `signed_at = p_signed_at`. Set the proposal `accepted`, `accepted_at = p_signed_at`, `accepted_selection` = the frozen selection, `accepted_snapshot` = the frozen snapshot with `accepted_at` set to `p_signed_at` and its `agreement` block overwritten by `{signature_id, signer_name, signed_at: p_signed_at, sha256, template_version, provider: 'adobe_sign', adobe_agreement_id}`. Set the request `completed`, `signature_id`, `completed_at = now()`. Return `(signature_id, true)`.
  - **The proposal update uses the same statement and trigger bypass as 0106's `client_proposal_sign_and_accept` (copied from lectual's 0106 migration, not re-invented).**
  - Refusal prefixes: `esign_request_closed`, `esign_proposal_changed`, `esign_text_mismatch`, `esign_bad_signed_at`. Any refusal changes nothing.
- **Amend `client_proposal_sign_and_accept`:** it takes `FOR UPDATE` on the proposal row BEFORE its open-request check, then refuses (prefix `loe_sign_esign_open`) while an open request exists for the proposal. Everything else is 0106's, unchanged.
- **Isolation cases to add to lectual's `tests/tenant-isolation.test.ts`** (written into the file, not run; D5):
  1. Firm B's member selects A's connection → 0 rows.
  2. A's member selects `access_token_enc` or `refresh_token_enc` → permission denied.
  3. A's paralegal insert/update/delete → refused. A's admin cannot set `org_id` to B (insert or update).
  4. B's admin updates A's row → 0 rows.
  5. Requests: B reads 0 rows of A's. `authenticated` cannot insert, update or delete. A's attorney reads `status`, `signer_name` and the timestamps; selecting `agreement_text`, `agreement_sha256`, `signer_title`, `entity_name`, `address`, `template_version`, `details`, `signer_email`, `snapshot` or `selection` → permission denied.
  6. A's viewer and A's social_media select requests → 0 rows.
  7. `client_proposal_esign_open` and `client_proposal_adobe_complete` are not executable by `anon` or `authenticated`.
  8. The new signature columns: no insert/update for `authenticated`.
  9. Completion: a second call returns the same `signature_id` with `completed_now = false`; a completed request called with another agreement id → `esign_request_closed`; the stored `signer_name`, `entity_name`, `address`, `template_version` equal the request's; `signed_at = accepted_at = p_signed_at`; the snapshot's `accepted_at` = `p_signed_at`; a `p_signed_at` up to 5 minutes ahead of `now()` is accepted; each of the four refusals (text mismatch, `p_signed_at` before `created_at` or more than 5 minutes in the future, expired at `p_signed_at`, wrong status) leaves rows unchanged.
  10. `sign_and_accept` is refused while a request is open, and allowed once it is `failed` or `cancelled`.
  11. `esign_open` with an `org_id` that differs from the proposal's, or a connection of another org → `esign_proposal_changed`, no row.
  12. `esign_open` for a proposal that is not `sent` (accepted, withdrawn, superseded) or expired → refused, no row.
  13. The owner's family delete succeeds with a `completed` request (the request goes by cascade; the signature's `esign_request_id` and the files survive as the FKs say), and the connection delete succeeds with closed requests (`connection_id` becomes null).
  14. `anon` selects 0 rows from both new tables.
  15. Two sessions: session 1 runs `sign_and_accept` and session 2 runs `esign_open` on the same proposal concurrently; exactly one succeeds, the other is refused (`loe_sign_esign_open` or `esign_proposal_changed`), and the proposal is never both signed in-app and holding an open request.

## Files likely touched
New: `src/lib/esign/{adobe-config,adobe-oauth,adobe-connection,disconnect,host-rule,payload,adobe-client,adobe-errors,path,start,complete,return-check,webhook,sweep,files}.ts`, `src/app/api/esign/{connect,callback,webhook}/route.ts`, `docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt`, `tests/esign/**`.
Changed:
- `src/lib/proposals/public.ts` (factored agreement half; refusal mapping); `src/lib/loe/signing.ts` (`checkSignerFields`, `checkSigning` unchanged in behaviour);
- `src/lib/loe/pdf.ts` (`for-signature`);
- `src/lib/loe/client-words.ts`, `src/lib/ui/words.ts`;
- `src/lib/mailbox/crypto.ts` (`SealContext`);
- `src/lib/proposals/{accept-followups,loe-signed-upload,paid}.ts` (step lists, provider switch);
- `src/app/p/[token]/**` (step 3, return check);
- `src/app/dashboard/settings/integrations/page.tsx`;
- the staff `EngagementLetterCard` / `signed-card.ts` (provider read), the reset and delete confirms;
- `src/app/api/cron/lawmatics-matters/route.ts` (sweep step);
- `src/lib/db/types.ts`, `next.config.ts` (route trace if needed), `.env.example` (the five names, switch commented as off);
- `AGENTS.md`: 5a, the blocker paragraph and the switch; 5b, the "Adobe Acrobat Sign" section (item 19). The stale "0106 NOT on prod" lines are corrected in a **separate docs-only commit**, not in 5a or 5b (D17).

## Acceptance tests (unit tests with fakes; no test calls Adobe, Lawmatics or a database; `ADOBE_SIGN_*` unset unless a test sets it)
1. **In-app pin.** With Adobe not set up, and separately with a connection `active` but the switch off, the `/p/<token>` letter steps and receipt render byte-for-byte equal to a baseline taken from this sprint's base commit. The `client_proposal_sign_and_accept` RPC is called with exactly the same arguments as before (spy) for the same inputs. `checkSigning` returns what it returned before for the existing cases. The existing `loe-baseline`, signing and signed-pdf tests pass unchanged. With 0113 missing (the provider query answering 42703 / PGRST204 / 42P01 / PGRST205), the staff card renders as before and the `signature-read.ts` COLUMNS string is unchanged.
2. **Same text, same fingerprint (typed name, start date).** For one fixture with typed name "Jordan Sample" and a different `client_name` and entity name, the Adobe stored `agreement_text` and its sha256 equal in-app `assembleAgreement(...).text` (and its sha256) for the same typed name, details, selection and date text; both date fields are the start date; no placeholder remains. `{{signer_name}}` renders the typed name, never `client_name`; the participant `name` is the typed name. An empty or too-short typed name → `name_required`, and missing required details → `details_required`, each with no request row and no Adobe call. **PDF:** the `for-signature` PDF's extracted text, with page chrome removed and `squash`ed, equals `squash(agreementText)` up to the start of the signature block, and the text-tag strings appear only after it (helpers from `tests/loe/full-letter-fixture.ts`). Pinned fixture sha256.
3. **Stale.** A browser fingerprint ≠ the server's → `stale`, no request row, no Adobe call. `esign_open` refusing `esign_proposal_changed` → the `stale` sentence.
4. **Payload.** Exactly one participant set, role `SIGNER`, one member (the client email, the typed name). All five notification types disabled. All three `sendOptions` are `NONE`. No `reminderFrequency`. `externalId.id` = the request uuid. **The token appears exactly once**, in `postSignOption.redirectUrl` (= `clientLinkUrl(clientLinkOrigin(org), token)` + `?signed=adobe`), and nowhere else (name, externalId, participant, file name). `expirationTime` = the end of `expires_on` in the firm's zone (a fixture across a DST date). The name is ≤ 255 characters. The webhook URL is `/api/esign/webhook/`. `signingUrls` has no `frameParent`.
5. **Host rule.** Accepts `https://api.na1.adobesign.com/`. Refuses `evil.com`, `adobesign.com.evil.com`, `http://…`, a path, and userinfo. A token is never sent to a refused host (fake fetch records no call). In the callback, a bad `api_access_point` on the redirect means no token POST (no `client_secret` sent), and a token response whose `api_access_point` differs from the redirect's is refused with nothing stored. An `esignUrl` that is `http` or on another host → a creation failure (request `failed`, cancel attempted, in-app fallback); a good one is returned for top-level navigation.
6. **Env and switch.** Client id or secret unset, or a bad `ADOBE_SIGN_AUTHORIZE_URL` → the Settings card is disabled with `SWITCH_ON_WORDS` and the path is in-app. `ADOBE_SIGN_CLIENT_SIGNING` unset or any value but `on` → in-app with an active connection, Settings shows the "clients sign in Lectual" line, and the webhook, sweep and disconnect still close open requests. With the switch off and an open request: unchanged choices resume; changed choices cancel the old request and give in-app, with no new Adobe agreement. A connection read that fails → in-app on `/p`, "couldn't check" in Settings.
7. **OAuth.** A bad, expired or other-user/other-firm `state` is refused. A non-admin is refused in `/api/esign/connect/` and `/api/esign/callback/` even with the page bypassed. Tokens are sealed under `lectual-adobe-sign`. The scoped insert never names an `_enc` column in a select. No `code_challenge` is sent.
8. **`reauth` / `revoked` with nothing open** → in-app with no Adobe words. A 401 on a call sets `reauth`. A 4xx about one agreement does not.
9. **Create failure → in-app for that visit** (5xx, timeout, 429 at create or at signingUrls; a bad `esignUrl` host): request `failed` with the matching `last_error` from the closed set, cancel attempted on a created agreement (`cancel_failed = true` when it fails, never a `last_error` value), no acceptance, `fallback: 'in_app'` returned and the in-app form shown with the typed name and details kept; nothing about the fallback is stored, and a fresh render (reload) chooses the path again; the in-app RPC is then allowed (the fake function sees no open request). `adobe_agreement_id` and `out_for_signature` are written before the webhook call (spy order); a webhook-registration failure leaves the request `out_for_signature` with `webhook_not_registered`. The `esignUrl` is absent from every `console.*` spy and every stored column.
10. **Open request** → the in-app action is refused (page). A fake RPC returning `loe_sign_esign_open`, or `esign_open` failing on the unique index, maps to its own fixed sentence. A failed request read on `/p` gives the in-app form.
11. **Disconnect with open requests** (fakes): order is scoped read → token read → per request re-read → cancel (cancellation emails off) or complete → requests `cancelled` → scoped `revoked` → re-list and close → revoke → delete (spy order). A request Adobe reports `SIGNED` is completed, not cancelled, with spy order completion → `adobe_signed_files` → scoped `revoked`; a files step that is not `stored` puts the "couldn't be copied into Lectual" sentence with its count in the result. A request opened between steps 3 and 4 is closed by the path read and by the sweep; the next `/p` render is in-app. A cancel Adobe refuses, AND a re-read that fails, each mark the request `cancelled` with `cancel_failed = true`, never signed; the count is in the result. Afterwards `path.ts` gives in-app for that proposal. A non-admin is refused before any read.
12. **`reauth` with an open request**: the request stays `out_for_signature`; `/p` shows the paused sentence with no Adobe call and no in-app form; Settings shows "N clients are waiting to sign until you reconnect."; the sweep skips the firm's open requests. After reconnect (fake `active` with a new token), the sweep and the return check re-read with the NEW token: `SIGNED` → completed; `EXPIRED` → `expired`, and the next `/p` render is in-app.
13. **Webhook GET/POST** (`/api/esign/webhook/`):
    - GET echoes header and body for our id; others get 403;
    - POST with a wrong id → non-2xx;
    - unknown agreement → 2xx and no write;
    - a forged "completed" while the fake Adobe answers `OUT_FOR_SIGNATURE` → no write;
    - a body over 64 KB → 2xx and ignored (no read, no write); the rate limit answers without work; the body appears in no log and no column;
    - the org used is the request row's, even when the body names another.
14. **Replay.** Two completions (webhook + return check, or webhook twice): the first returns `completed_now = true`, the second `completed_now = false` with the same signature id; `adobe_signed_files` and the follow-ups run once, and no step event is written twice. `adobe_signed_files` runs before `runAcceptanceFollowups` (spy order). The signature's `signer_name` is the request's typed name.
15. **Completion refusals** (fake function): `esign_proposal_changed` → request `failed` with that `last_error`, its staff sentence, nothing accepted. `esign_request_closed` / `esign_text_mismatch` / `esign_bad_signed_at` → nothing written. Adobe `SIGNED` on a closed request → `last_error = signed_after_close`, the function not called, its staff sentence.
16. **Return check** never marks signed from `?signed=adobe`. With a fake clock: a call within 20 s of `last_checked_at` answers "waiting" with no Adobe call; otherwise `last_checked_at` is written before the call (spy order). It stops at 3 min and honours `Retry-After`. A read failure shows "couldn't check", not "not signed".
17. **Sweep** (inside the `lawmatics-matters` route, after the hired sync). It respects 50 per firm, 60 s and the route's time left. A 429 stops that firm only. It refreshes a connection at more than 30 days. It closes `creating` rows over 10 minutes old for firms whatever their connection status (`reauth`, `revoked`-then-deleted with `connection_id` null included). For a `completed` request of the last 30 days with no `signed_pdf_file_id` it runs `adobe_signed_files`, then `signed_loe_upload` only if not yet `uploaded`; older ones are left. Its output is counts only. `vercel.json` has no diff.
18. **Files.** Both stored under the request's org path with `%PDF-` and the size cap. A non-PDF or oversize file → `failed` and retried. No lead or matter → `blocked` with its sentence and no download. A failure leaves acceptance unchanged. `adobe_signed_files` is in `PROPOSAL_STEPS`, `STEP_SUCCESS` (`stored`), `RETRYABLE_STEPS` and `readEarlierSteps`' list. Try again is offered only to `PROPOSAL_PAID_ROLES`.
19. **Lawmatics switch.** Adobe → the stored PDF is uploaded. A hash mismatch → `blocked` with `signedMismatch`. Not stored yet → `failed`. `lectual` → `buildVerifiedSignedPdf` (spy).
20. **Hygiene greps over `src/lib/esign` and `src/app/api/esign`:**
    - no mail import or send call;
    - no `"ALL"` email option;
    - no `/reminders`;
    - no `x-api-user`;
    - no `HOST` / `IN_PERSON_SIGNER`;
    - no `:account` / `:group`;
    - no `includeSignedDocuments`;
    - no `code_challenge`, no `frameParent`, no `<iframe`;
    - no `/api/adobe-sign/` path anywhere in `src`;
    - imports of `@/lib/db/admin` only in `adobe-connection.ts`, `start.ts`, `path.ts`, `complete.ts`, `files.ts`, `webhook.ts`, `sweep.ts`, `disconnect.ts`, `return-check.ts` and `src/app/api/esign/webhook/route.ts`;
    - no import of `@/lib/db/admin` under `src/app/dashboard`;
    - no `ADOBE_SIGN_*TOKEN*` / API-key env name.
21. **Staff card states** for an Adobe signature (signed line with the typed name, out for signature, `esign_proposal_changed`, `signed_after_close`, files not stored, couldn't be loaded). The staff read selects only granted request columns (never the withheld list in Data), and only for `SIGNATURE_READ_ROLES`; the provider comes from its own query with the 0113-missing fallback (test 1). No raw Adobe text on any page (`no-raw-error-text`). No build words.
22. `pnpm test`, `pnpm lint`, `pnpm build` pass. `pricing.ts` has no diff. The 0113 file exists, is marked not applied, and holds every function, grant, FK and isolation case above. Neither sprint's diff touches AGENTS.md's 0106 lines; 5b's diff adds the "Adobe Acrobat Sign" section.
23. **Stuck `creating`.** A `creating` row 11 minutes old is closed as `failed` (`creation_interrupted`) by the `/p` path read and by the sweep; the client then gets in-app. A row 9 minutes old is left and in-app stays refused. start's `out_for_signature` update after the path closed the row changes 0 rows, and start cancels the created agreement and returns `fallback: 'in_app'`.
24. **Reset and delete.** The reset confirm on an Adobe-signed version carries "The Adobe agreement stays signed in your Adobe account."; after a reset, `startAdobeSigning` opens a new request (the old one stays `completed`). The owner's delete confirm carries its Adobe sentence.
25. **Lock order and the race (unit, fakes).** `start.ts` calls `client_proposal_esign_open`, never an insert on the table (grep); the 0113 file shows `FOR UPDATE` on the proposal in `esign_open` and in `sign_and_accept` before its open-request check, and request-then-proposal in `adobe_complete`; `search_path = ''` on every function.

## MUST NEVER
- Any email to a client caused by Lectual code. Any Adobe notification left on. Any reminder. A new Adobe agreement created with the switch off.
- Any signer other than the client. A signer name taken from `client_name` or from anything but the name the client typed. A staff path that creates, opens or fetches a signing URL. A staff "sign" button. An iframe of Adobe's page.
- A deployment-wide Adobe credential, or an Adobe call in a test or CI.
- A signature recorded whose text is not exactly the stored text, or whose sha256 does not match the stored one. A signed state taken from a webhook body, a redirect parameter or the browser. Acceptance from an agreement signed after its request was closed.
- A change to what the in-app signature renders, hashes or sends for a firm on the in-app path.
- A firm left with no way to sign once nothing is open (a creation failure, a disconnect, a stuck `creating` row).
- A cross-firm read (the org from anywhere but our own row). A token, or `client_secret`, sent to a host outside the rule. A browser sent to an `esignUrl` outside the rule.
- A token, `esignUrl`, client secret, agreement text, address, raw webhook body or Adobe body in a log, a step payload or `last_error`. Any `last_error` value outside the closed set. Any withheld request column readable by `authenticated`.
- One version signed twice (in-app plus Adobe), or an open request beside an in-app signature.
- The service role in dashboard code. A raw error shown. A migration applied, or put in this repo as a migration.
- Client names in fixtures (use made-up names).

## Decisions (replaces the open questions)
1. **Agreement creation fails → in-app for that visit.** The request is recorded `failed` with a fixed reason code; a firm is never left with no way to sign. "This visit" is client state from `startAdobeSigning`'s result; nothing is stored. (director, Nov 22; visit rule: strict evaluator, Nov 22)
2. **Route prefix `/api/esign/**`** (provider-neutral): `/api/esign/connect/`, `/api/esign/callback/`, `/api/esign/webhook/`. (director, Nov 22)
3. **Whose account — development:** the free Acrobat Sign developer account under a non-attorney email Taylor creates; test signers only. **Production:** the firm's own API-tier account; the sender is whoever owns it. **Which account and owner remain an OPEN BLOCKER for Taylor and Rebecca** (Blocker 1); the contract does not pick. (director, Nov 22)
4. **Blocker wording:** as D3; the developer account is Lectual's (Taylor's, non-attorney email), not Rebecca's Pro account. (director, Nov 22)
5. **Isolation acceptance:** the cases are written into the 0113 proposal file and not run in 5a/5b, because 0113 is applied nowhere. **0113 cannot be applied until these cases are copied into lectual's `tests/tenant-isolation.test.ts` in the same PR and pass on lectual-dev; `ADOBE_SIGN_CLIENT_SIGNING` stays off until then.** (design note's choice, accepted by the strict evaluator with this addition, Nov 22)
6. **Disconnect or `reauth` with an open request.** Disconnect first re-reads and cancels open agreements at Adobe with the same token (cancellation emails off), marks them `cancelled` (a signed one is completed instead; a failed re-read is a failed cancel, never signed), then revokes. On `reauth`, requests stay open and the next sweep or return check re-reads them with the fresh token; meanwhile the client sees a paused sentence and Settings counts the waiting clients. Either way the client gets in-app on the next visit once nothing is open. Known limit: after revoke nothing watches the cancelled agreements. Tests 11 and 12. (director, Nov 22)
7. **Half-made agreement:** request `failed` and the agreement cancelled at Adobe; there is no `abandoned` status; a failed cancel is the `cancel_failed` flag. (design note's choice, accepted by the strict evaluator, Nov 22)
8. **Request columns staff may read, following 0106:** `SIGNATURE_READ_ROLES` read status, signer name, hashes, ids, flags and timestamps; IP, user agent, address/details, `entity_name`, `signer_title`, `template_version`, `signer_email`, `agreement_text`, `agreement_sha256`, `snapshot`, `selection` and any raw webhook payload are withheld from `authenticated` (the table has no IP, user-agent or payload column at all); viewer, social_media and `anon` read nothing. Isolation cases 5, 6 and 14. (director, Nov 22)
9. **`signed_pdf_sha256` / `audit_sha256`** are columns on the request (note §5.2). (design note's choice, accepted by the strict evaluator, Nov 22)
10. **Signer name = the name the client TYPES on our page** before going to Adobe (0106's `p_signer_name`), frozen on the request as `signer_name` and copied into the signature row by the completion function. The entity name is separate; the signer name is never derived from `client_name`. (director, Nov 22)
11. **Signed date.** Both date fields in the stored agreement text are the firm-zone date on which `startAdobeSigning` built it (`letterDateText(now, firm zone)`, exactly as `letterValues` does). The text is final when the request is created: no placeholder and no replacement. Adobe's own date field in the signature block records the actual signing date; `signed_at` = Adobe's completion time. (strict evaluator, Nov 22; replaces the design note's placeholder rule, which it rejected)
12. **Blank proposals:** files stay in the firm's Adobe account and `adobe_signed_files` is `blocked` until a lead or matter is linked (note option b; option a needs a new parent kind and a storage policy). `uploaded_by` is left to its default (null under the service role; the column is not insertable and the row type is nullable). (design note's choice, accepted by the strict evaluator, Nov 22)
13. **PKCE:** not sent; the signed `state` cookie is the protection; Adobe's refresh token does not rotate. Dropped from the spike list. (design note's choice, accepted by the strict evaluator, Nov 22)
14. **Sweep host:** a step at the end of `/api/cron/lawmatics-matters/`, after the hired-matter sync, with a 60 s slice inside the route's existing budget. (design note's choice, accepted by the strict evaluator, Nov 22)
15. **"Never sends":** if the spike shows Adobe still sends its own copy email to the client, the firm stays on in-app signing until Taylor explicitly says that email is acceptable. Gate: env `ADOBE_SIGN_CLIENT_SIGNING`, default OFF (only `on` creates new Adobe agreements), no schema. (director, Nov 22)
16. **Completion function arguments:** no `p_org_id`; the org comes from the locked request row. It returns `(signature_id, completed_now)`. (design note's choice, accepted by the strict evaluator with the changes in Data, Nov 22)
17. **Stale AGENTS.md 0106 lines:** corrected in a separate docs-only commit, not inside 5a or 5b. (director, Nov 22)
18. **Generator's choice A, finishing an open request with the switch off:** allowed (resume), but changed choices with the switch off cancel the request and fall back to in-app. (accepted by the strict evaluator, Nov 22)
19. **Generator's choice B, no "I agree" tick on the Adobe path:** Adobe's signature act replaces it; the tick appears only on the in-app fallback. (accepted by the strict evaluator, Nov 22)
20. **Signing page is top-level, never an iframe:** no `frameParent`, no CSP change; "embedded" in the design note means Adobe's page reached from ours. (strict evaluator, Nov 22)
21. **Race and lock order:** `client_proposal_esign_open` replaces a plain insert; both it and the amended `sign_and_accept` lock the proposal; request-then-proposal everywhere both are locked. (strict evaluator, Nov 22)

Also restated: the sandbox spike is done by a person (Taylor) once she has the developer account; no Adobe call in tests or CI. (director, Nov 22)
