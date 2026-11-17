# Adobe Acrobat Sign for the engagement letter: design note

Status: design only, no code. Written 2026-11-17 against `main` at e065f85.
Owner's decision (Nov 17): Adobe Sign signs the engagement letter when the firm has connected it. The in-app
signature (lectual 0106: `client_proposal_signature`, `client_proposal_sign_and_accept`, signing on `/p/<token>`)
stays as the fallback. Only the client signs. Order: the letter and invoice go out with the proposal, the client
accepts, signs, then pays. Signed and paid = hired.

Everything about Adobe below comes from Adobe's documentation, read on 2026-11-17 (sources at the end). Nothing
was run against a live Adobe account. Items marked **(unverified)** must be checked in a sandbox first.

---

## 0. The short version

- Each firm connects **its own** Adobe Acrobat Sign account (OAuth, admin tier, Settings -> Integrations). This
  follows the LawPay and Zoom pattern: sealed tokens, no deployment-wide key. Unset env means "not set up", and the
  in-app signature carries on.
- When the client presses **Sign** on step 3 of `/p/<token>`, the server builds the agreement exactly as 0106
  does: the stored letter, the cleaned details, the recomputed exhibit and the same canonical fingerprint. It then
  renders it with the same `pdf.ts` builder, uploads it to the firm's Adobe account and creates a one-signer
  agreement for the client's email.
- The client signs in Adobe's signing page, reached **from our page** (embedded, the recommendation). Adobe's own
  emails are switched off on the agreement. Whether that is enough to keep Adobe from emailing the client is the
  main open question (section 3).
- "Signed" comes from Adobe. A webhook says something happened, and we then **re-read the agreement ourselves**,
  because a webhook is only a hint. A check when the client comes back to our page and a daily sweep are the
  fallbacks. One database function makes signed + accepted a single, idempotent step, with the frozen selection.
- On completion we store Adobe's signed PDF and audit report as files, write a `client_proposal_signature` row
  that carries the Adobe agreement id, and keep `signed_loe_upload` (Lawmatics) working, filing Adobe's signed PDF.

---

## 1. The per-firm connection

### 1.1 Adobe's side (what the docs say)

| Item | Adobe docs (read 2026-11-17) |
|---|---|
| App type | Create a **PARTNER** application. It reaches other firms' accounts only after Adobe **certifies** it. Adobe reviews the enabled scopes at certification. |
| Authorize | `GET https://secure.adobesign.com/public/oauth/v2` with `response_type=code`, `client_id`, `redirect_uri` (https, registered), `scope` (space-separated), `state`. Partner apps use a host **without a shard**. The code is valid for 5 minutes. |
| Token | `POST <api host>/oauth/v2/token`, form body: `grant_type=authorization_code`, `code`, `client_id`, `client_secret`, `redirect_uri`. The response has `access_token`, `refresh_token`, `expires_in` (3600), `api_access_point`, `web_access_point`. |
| Shard | Every later call (API, refresh, revoke) goes to **that firm's** `api_access_point`, for example `https://api.na1.adobesign.com/`. |
| Refresh | `POST <api_access_point>/oauth/v2/refresh`. The response has a new access token and **no new refresh token**, so the refresh token does not rotate. It **expires after 60 days without use**. |
| Revoke | `POST <api_access_point>/oauth/v2/revoke` with `token`. Revoking the refresh token revokes its access tokens. |
| PKCE | Not mentioned anywhere. Rely on a signed `state` cookie (the LawPay/mailbox pattern). Sending PKCE is harmless but unverified. |
| Scope modifiers | `:self` (default), `:group`, `:account`. `:group` and `:account` need an admin on a Business or Enterprise edition. |

The scopes requested are all `:self`, the minimum:
- `user_read`: the account email shown as "Connected as".
- `agreement_read`: status, the signed PDF and the audit report.
- `agreement_write`: transient upload, creating and cancelling agreements, and `signingUrls`, which needs `agreement_write`.
- `webhook_write`: a per-agreement webhook.

`webhook_retention` (delete) is not requested. A completed agreement's webhook simply stops firing.

### 1.2 Table `adobe_sign_connection` (lectual migration 0108)

The table is modelled on `lawpay_connection` (0080) and `meeting_source_connection` (0081). It has one row per firm.

| Column | Notes |
|---|---|
| `id uuid pk`, `org_id uuid unique -> crm_org` | One connection per firm. |
| `status text` | CHECK `active` / `reauth` / `revoked`. |
| `api_access_point text not null` | **Readable.** CHECK: `https://` + a host ending in `.adobesign.com` or `.echosign.com`, no path beyond `/`. The app checks the same rule before every call, because a token must never be sent to a host an attacker wrote into the row. |
| `web_access_point text` | Readable. Same host rule. |
| `account_email text` | The "Connected as" hint, from `GET /users/me` (unverified shape). |
| `scopes text[]` | As granted. |
| `access_token_enc`, `refresh_token_enc` | Sealed with `MAILBOX_TOKEN_KEY` under their own HKDF context `lectual-adobe-sign`. **No column grant to `authenticated`**, the same as 0080. |
| `access_expires_at timestamptz`, `last_refreshed_at`, `last_verified_at`, `last_error text` | `last_refreshed_at` drives the 60-day keep-alive. |
| `connected_by uuid`, `created_at`, `updated_at` | |

- RLS: every firm member reads the readable columns. Owner, admin and senior_admin insert, update and delete.
- A trigger clears both sealed columns when `status` becomes `revoked`.

The same migration adds `client_proposal_esign_request` (section 2.3) and the new signature columns (section 5.1).

### 1.3 In lectual.app

- `src/lib/esign/adobe-config.ts`: env `ADOBE_SIGN_OAUTH_CLIENT_ID`, `ADOBE_SIGN_OAUTH_CLIENT_SECRET`, and optional
  `ADOBE_SIGN_OAUTH_REDIRECT_URI` and `ADOBE_SIGN_AUTHORIZE_URL`. Any of the first two unset = "not set up": the
  Settings card shows a disabled Connect button with `SWITCH_ON_WORDS`, and every proposal signs in-app. There is
  never a deployment-wide Adobe token.
- `src/lib/esign/adobe-connection.ts`, after `payments/lawpay-connection.ts`:
  - The readable row comes through the scoped client.
  - Sealed secrets are read by the service role only, fenced on the `(id, org_id)` a scoped read returned (signed-in
    path), or on the proposal row's own `org_id` (public and webhook path).
  - Refresh happens when `access_expires_at` is under 5 minutes away.
- **Connect / disconnect**: Settings -> Integrations -> "Adobe Acrobat Sign" (`IntegrationRow`), admin tier on the
  page AND in `/api/adobe-sign/connect/` and `/api/adobe-sign/callback/`. The callback uses the state cookie bound to
  the user and firm (10 minutes), exchanges the code, checks `api_access_point` against the host rule, reads
  `/users/me` and writes the row through the scoped client.
- **Disconnect** runs in this order:
  1. A scoped update sets `revoked`, which clears the secrets and is the permission check.
  2. Revoke the refresh token at Adobe.
  3. Delete the row.

  If agreements are still out for signature, the confirm says so: those links stop being checked, and the client is
  offered the in-app signature instead (section 5.3).
- **Reauth**: a 401 from Adobe, or a refused refresh (`invalid_grant`, an expired refresh token), sets `reauth`
  (service role, fenced on the row's org). While a connection is `reauth`, proposals fall back to in-app signing and
  Settings says "Reconnect". A 4xx about one agreement never pauses the firm, which is the LawPay rule.
- **Keep-alive**: the refresh token dies after 60 idle days. The daily sweep (section 4.3) refreshes any active
  connection whose `last_refreshed_at` is more than 30 days old.
- **Setup checklist**: not one of the ten items. It is optional, like Zoom.

### 1.4 Tenant-isolation cases (lectual `tests/tenant-isolation.test.ts`)

1. Firm B's member selects firm A's `adobe_sign_connection`: 0 rows.
2. Firm A's own member selects `access_token_enc` / `refresh_token_enc`: permission denied (no column grant).
3. Firm A's paralegal inserts, updates or deletes the row: refused. Firm A's admin can update `status`, not set another org's id.
4. Firm B's admin updates firm A's row: 0 rows.
5. `client_proposal_esign_request`:
   - firm B reads 0 rows of firm A's;
   - `authenticated` cannot insert, update or delete any row (service role only);
   - firm A's staff read only the non-text columns (no grant on `agreement_text`).
6. `client_proposal_adobe_complete` is not executable by `authenticated` or `anon`.
7. The new signature columns: no insert or update for `authenticated` (the 0106 rule holds).

---

## 2. Creating the agreement from the stored letter

### 2.1 When

The agreement is created **when the client presses Sign on step 3** (the accept moment), and not when the link goes
live:
- The letter merges the client's details.
- The exhibit depends on the client's choices.

Neither exists before step 3. The invoice/pay link is unchanged: it is on the proposal now, and is payable after
signing, as today. Signed and paid = hired, through the existing paid flow.

### 2.2 What is sent: the same text and fingerprint as 0106

`startAdobeSigning(token, selection, clientClasses, details, fingerprint)` is a new public server action. It shares
its first half with `signAndAccept` in `src/lib/proposals/public.ts`. Factor that half out, don't copy it:
1. The token read, live (`sent`) and unexpired, carrying `loe`.
2. `checkSigning`-style cleaning of the details. There is **no typed name and no tick**: Adobe's signature
   replaces both. `signer_name` is the cleaned `client_name`.
3. `quoteForAcceptance` (repair on), `buildExhibit`, then `assembleAgreement`. The letter date is this server's date in the firm's zone.
4. `canonicalFingerprint(agreement.canonical)` must equal the browser's fingerprint, or the action is refused as `stale`.
5. Readiness checks:
   - the firm's connection is `active`;
   - no other open request for this version (section 2.3);
   - the letter guard (`letterLiveCheck`) still says `current`;
   - the client email is a real address.

**The document Adobe receives** is rendered by `src/lib/loe/pdf.ts` in a new third mode, `for-signature`: the same
letterhead, logo, blocks and exhibit as the signed copy, with no "Review copy" banner and no signature record. After
the letter comes one appended **signature block** carrying Adobe text tags for one signer: a signature field, and a
date field filled by Adobe.
- The block is drawn by the builder, outside `agreementText`, so it is not part of the words, the canonical form or
  the sha256. The words the client reads on our page are exactly the words in the PDF.
- How `{{signed_date}}` is filled is an open question (Q9). The proposed rule: in the stored agreement text, it takes
  the completion date in the firm's zone, written at completion. In the PDF, Adobe's own date field shows the
  signing date. The canonical fingerprint fixes both date fields, so it is the same at sending and at completion.
- Text-tag syntax and Adobe's handling of a PDF with no field at all are **(unverified)**.

What we store **before** calling Adobe (section 2.3):
- the final text with the signed date left as the fixed placeholder;
- the canonical fingerprint;
- the sha256 of the exact PDF bytes uploaded.

So the fingerprint means the same thing it means for 0106: these words, these details, this exhibit. Adobe's
returned PDF necessarily has different bytes, since it adds the signature and audit stamp. We therefore keep both
hashes: our sent PDF and Adobe's signed PDF.

### 2.3 Table `client_proposal_esign_request` (0108)

| Column | Notes |
|---|---|
| `id`, `org_id`, `proposal_id`, `family_id`, `version`, `connection_id` | `org_id` always comes from the proposal row. |
| `provider text` | CHECK `adobe_sign`. It leaves room for others. |
| `adobe_agreement_id text unique` | Null until Adobe answers. The webhook finds the request by this id. |
| `canonical_fingerprint text`, `agreement_text text`, `sent_pdf_sha256 text` | Frozen at sending. No `authenticated` grant on `agreement_text`. |
| `selection jsonb`, `snapshot jsonb`, `details jsonb`, `signer_email text` | What completion will accept, frozen. The browser is never asked again. |
| `status text` | `creating` / `out_for_signature` / `completed` / `cancelled` / `expired` / `declined` / `failed`. |
| `signature_id`, `signed_pdf_file_id`, `audit_file_id` | Filled at completion and after the downloads. |
| `last_checked_at`, `last_error`, `created_at`, `completed_at` | `last_error` holds a fixed code, never Adobe text. |

The rules:
- **One open request per version**: a partial unique index on `(proposal_id)` where status is `creating` or `out_for_signature`.
- The row is inserted as `creating` **before** Adobe is called, the same idea as LawPay's pending `crm_payment`.
- If the client changes a choice and presses Sign again, the old agreement is cancelled at Adobe
  (`PUT /agreements/{id}/state` to `CANCELLED`, with cancellation emails off) and a new request is made.

### 2.4 The Adobe calls (the firm's token, the firm's `api_access_point`, service role fenced on the proposal's org)

1. `POST /api/rest/v6/transientDocuments`: multipart with the file name, mime type `application/pdf` and the bytes. One file per call; the document lasts 7 days.
2. `POST /api/rest/v6/agreements`, with this body:
   - `fileInfos: [{transientDocumentId}]`;
   - `name`: `"<letter title> - <client name>"`, at most 255 characters;
   - `participantSetsInfo: [{ order: 1, role: "SIGNER", memberInfos: [{ email, name }],
     disabledNotificationTypes: ["INITIAL","INTERMEDIATE","FINAL","CANCELLATION","REMINDER"] }]`;
   - `signatureType: "ESIGN"`, `state: "IN_PROCESS"`;
   - `emailOption: { sendOptions: { initEmails: "NONE", inFlightEmails: "NONE", completionEmails: "NONE" } }`;
   - `expirationTime`: the proposal's expiry;
   - `postSignOption: { redirectUrl: "<clientLinkOrigin>/p/<token>/?signed=adobe", redirectDelay: 0 }`;
   - no `reminderFrequency`;
   - `externalId: { id: <esign_request id> }`. Adobe warns that `externalId` is visible to participants, so it
     carries the request uuid, never the proposal token.
3. `POST /api/rest/v6/webhooks`, at RESOURCE scope for this agreement:
   - `resourceType: "AGREEMENT"`, the agreement's `resourceId`;
   - events `AGREEMENT_WORKFLOW_COMPLETED`, `AGREEMENT_RECALLED`, `AGREEMENT_REJECTED`, `AGREEMENT_EXPIRED`;
   - **no** `includeSignedDocuments`.

   A failure here is **not** fatal: the return check and the sweep still find completion. It is recorded as `webhook_not_registered`.
4. Embedded only: `GET /agreements/{id}/signingUrls?expiry=900&frameParent=<firm's client-link origin>`. A 404
   `AGREEMENT_NOT_EXPOSED` / `DOCUMENTS_NOT_YET_PROCESSED` just after creation is retried a few times within the
   action's deadline (15 s per call, the `http/timeout.ts` pattern). The `esignUrl` goes to the browser and is
   **never stored or logged**.

---

## 3. Embedded vs email signing, and "Lectual never sends" (OPEN, needs the owner)

| | Embedded (recommended) | Adobe email |
|---|---|---|
| How the client reaches Adobe | Our step 3 button calls `signingUrls` and opens Adobe's page (redirect, or an iframe allowed by `frameParent`). Adobe sends the client back to `/p/<token>` afterwards. | Adobe emails "please sign" to the client's address from the firm's Adobe account. |
| Who emails the client | No one, **if** Adobe honours `emailOption` NONE and `disabledNotificationTypes`. | Adobe does, on the firm's account. Lectual has still sent no mail, but it pressed the button that made Adobe send it. |
| Fit with "nothing in Lectual sends email to a client by itself" | Fits, provided the suppression holds. The client pressed Sign, and nothing is sent. | Arguably a send *caused* by Lectual. The client pressed Sign, so it is not "by itself", but it is mail to a client that no person at the firm approved. |
| Identity | Adobe does not check that the person opening an `esignUrl` is the named signer. This is the same as today's `/p/<token>` link, where whoever holds the link can sign. | Adobe's email proves control of the inbox. |
| Risks | The suppression may be overridden by account settings. A community report says a bug sent emails despite NONE until an Apr 2024 fix **(unverified now)**. `signingUrls` needs `agreement_write`, and Adobe may still email a signed copy. | Reminders, completion copies and bounce mail all come from Adobe. |

What the code would do (recommendation): embedded, with every Adobe notification switched off on the agreement and
the participant set. It never calls `/reminders`. It never sets an email option to `ALL`. A hygiene test greps for that.

**The tension, plainly.** Even embedded, Adobe may email the client a signed copy, or an account setting may override
the agreement's options. The firm owns that Adobe account and its settings, and Lectual cannot see or change them.
The questions for the owner:
- (a) Is an Adobe email, sent because the client pressed Sign on our page, acceptable as "the client's own action"?
- (b) If a sandbox test shows Adobe emails the client anyway, do we accept that, or keep the in-app signature for that firm?
- (c) Should the firm be told on the Settings card that "Adobe may email your client a copy when they sign"?

---

## 4. Detecting "signed"

### 4.1 Webhook endpoint `GET|POST /api/adobe-sign/webhook/` (public, no session)

- **Verification of intent (GET)**: Adobe sends `X-AdobeSign-ClientId`. If it equals our
  `ADOBE_SIGN_OAUTH_CLIENT_ID` (constant-time compare), answer 200 with the same header **and** the JSON body
  `{"xAdobeSignClientId": "<id>"}`. Otherwise answer 403 and register nothing. Adobe allows 5 seconds.
- **Notification (POST)**: the same header check (a wrong id gets a non-2xx). The body is capped at 64 KB, because we
  never ask for documents in it. We read **only** `webhookNotificationId`, `event` and `agreement.id`, then answer
  2xx with the echo at once. The work runs in `after()`, because 5 seconds is too short for downloads.
- **Adobe does not sign notifications** (no HMAC). The docs offer only the client-id echo and optional mutual TLS, an
  account setting on "Solutions" plans. So the payload is **a hint, never a fact**:
  1. Find the request by `adobe_agreement_id` (service role, unique index). Unknown id: do nothing, still answer 2xx
     with the echo (a non-2xx makes Adobe retry and then disable the webhook).
  2. Read that request's firm connection and call `GET /agreements/{id}` **ourselves**, with the firm's token, at the
     firm's `api_access_point`.
  3. Act only on the status Adobe returns there.

  A forged or replayed POST can therefore only cause one extra read.
- Replays and duplicates (Adobe documents `webhookNotificationId` for spotting them) are harmless, because the
  transition is idempotent (section 4.4). No notification id is stored.
- Retries: Adobe retries with doubling intervals, from 1 minute up to 12 hours, 15 tries over 72 hours, then
  **disables** the webhook. The endpoint therefore never fails because of our own downstream work.
- Rate limit: in memory per instance, a courtesy limit as elsewhere. Logs carry the event name and the request uuid
  only, never the agreement id together with any client data, and never tokens.

### 4.2 The return check

Adobe's `postSignOption.redirectUrl` brings the client back to `/p/<token>/?signed=adobe`. The page calls
`checkAdobeSigning(token)` (token only):
- It reads the open request and calls `GET /agreements/{id}` (with `If-None-Match`).
- It completes if the status is `SIGNED`.
- Otherwise it shows "Waiting for Adobe to confirm your signature."

It polls at most every 20 seconds, for up to 3 minutes, because Adobe allows only 3 identical GETs per minute and
answers 429 with `Retry-After`. The `?signed=adobe` parameter is a hint only: it never marks anything signed.

### 4.3 Polling fallback (daily sweep)

There is no new cron entry, and `vercel.json` is unchanged. This is a step in an existing daily route with its own
budget slice, like the calendar step in the mailbox sync, for example `/api/cron/lawmatics-matters/` after the
hired-matter sync. It runs as the service role, per firm with an active connection:
- read every request still `out_for_signature`, oldest first, at most 50 per firm and 60 s overall;
- `GET /agreements/{id}`, then complete, expire, cancel or leave it;
- do the 30-day refresh keep-alive (section 1.3).

A 429 stops that firm for the run. Counts only go into the cron JSON.

### 4.4 The idempotent transition: `client_proposal_adobe_complete` (0108, security definer, service role only)

Inputs:
- `p_request_id`, `p_agreement_id`;
- `p_signed_at`, Adobe's completion time (from the agreement's events or `GET /agreements/{id}`; the field is **(unverified)**);
- `p_agreement_text`, the final text with the signed date written in;
- `p_agreement_sha256`.

In one transaction, with the request row locked:
1. If the request is already `completed`, return its `signature_id`. That is the replay case.
2. Require all of:
   - request `out_for_signature`;
   - `adobe_agreement_id = p_agreement_id`;
   - the proposal row still the same `org_id`, `family_id` and `version`, status `sent`, not expired.
3. Require `sha256(p_agreement_text) = p_agreement_sha256`, and `p_agreement_text` equal to the stored text with only
   the signed-date placeholder replaced (checked in SQL).
4. Insert the `client_proposal_signature` row, with `provider = 'adobe_sign'` and `adobe_agreement_id`.
5. Set the proposal to `accepted` with the request's **frozen** `selection` and `snapshot`, plus the final agreement block.
6. Set the request to `completed`.

Any refusal leaves everything as it was. The reasons are codes: `request_closed`, `proposal_changed`, `text_mismatch`.

If the proposal changed while the client was signing (withdrawn, a new version, deleted), the signed agreement
is **not** accepted. The request becomes `failed` (`proposal_changed`). The staff page then shows "The client signed in
Adobe after this proposal changed. Check it with them." Nothing is auto-cancelled after the fact.

After the function succeeds, the same caller runs the acceptance follow-ups (`runAcceptanceFollowups`: firm notice,
Lawmatics note, address, `signed_loe_upload`), plus a new step `adobe_signed_files` (section 5.2).

---

## 5. Replacing, and falling back to, 0106

### 5.1 What is written on completion

- **`client_proposal_signature`** (0108 adds nullable columns): `provider text default 'lectual'` (CHECK `lectual` /
  `adobe_sign`), `adobe_agreement_id text`, `esign_request_id uuid`. 0106's rows read as `lectual`.
  - `agreement_text` and `agreement_sha256` mean exactly what they mean today.
  - `ip` and `user_agent` are null for Adobe: Adobe's audit report holds them.
  - `signer_name` is the cleaned `client_name`.
  - The 0106 insert policy is unchanged: only the two security-definer functions write the table.
- **Accepted snapshot**: still `schema: 2`, so every reader works unchanged. The `agreement` block gains optional
  `provider: "adobe_sign"` and `adobe_agreement_id`, absent = in-app. `signing` is the same `{ details, date_text, client_email }`.
  - `isSignedSnapshot` is true for both providers.
  - `verifySignedCopy`, "Read it again" and `buildVerifiedSignedPdf` work unchanged, because `agreement_text` and its
    sha256 are stored the same way.
- **UI wording**: the staff card and receipt say "Signed by <name> on <date/time> with Adobe Acrobat Sign", with the
  same zone rules.

### 5.2 Files: the signed PDF and the audit trail (`adobe_signed_files` step, success word `stored`, in `RETRYABLE_STEPS`)

- Download `GET /agreements/{id}/combinedDocument?attachAuditReport=false` (the signed PDF) and
  `GET /agreements/{id}/auditTrail` (a PDF stream). Each is checked for a `%PDF-` header and capped at 25 MB (`MAX_FILE_BYTES`).
- Store them in the private `client-files` bucket under the Sprint 26 path rule
  `{org_id}/{lead|matter}/{parent_id}/{file_id}.pdf`, with `crm_file` rows `uploaded_by = null`. This is written by
  the service role, which stamps the request row's own `org_id`, the one allowed use.
- Record `signed_pdf_sha256` and `audit_sha256` on the request, so a later copy can be checked against them.
- **Gap**: a proposal with neither a lead nor a matter (Start blank) has no file parent today. Two options:
  - (a) store under the request only, which needs a `proposal` parent kind in `files/rules.ts` and a storage policy in lectual;
  - (b) keep the files at Adobe until a lead or matter is linked.

  This is open question Q8.
- A failure never changes the acceptance or the paid state. The step is retried by the sweep or by Try again.

### 5.3 `signed_loe_upload` (Lawmatics)

The step, core and once-per-round rule are unchanged. Only `deps.buildPdf` changes, by provider:
- `lectual`: `buildVerifiedSignedPdf`, as today.
- `adobe_sign`: read the stored signed PDF from the bucket. Its sha256 must equal `signed_pdf_sha256`, or the step is
  `blocked` with `STEP_TEXT.signedMismatch`. If the files aren't stored yet, the step is `failed`, and the next run
  retries after `adobe_signed_files`.

The audit report is not sent to Lawmatics unless the firm asks (Q6).

### 5.4 Choosing the path, and falling back

| Firm state at Sign | Path |
|---|---|
| Env unset, no connection, `revoked` | In-app (0106), unchanged. |
| `reauth`, or the connection read failed | In-app, with no mention of Adobe to the client. Settings says Reconnect. |
| `active` | Adobe. |
| `active` but the create call fails (5xx, timeout, 429) | The fixed sentence "Adobe Acrobat Sign didn't answer. Try again in a minute." The request becomes `failed` and any half-made agreement is cancelled. **Whether the page then offers the in-app signature is Q2.** |

Rules:
- **No double signature.** While a request for this version is `creating` or `out_for_signature`, in-app signing is
  refused. 0108 amends `client_proposal_sign_and_accept` to check for an open request, so the rule holds in the
  database, not only the page.
- Reset acceptance: a reset of an Adobe-signed version is allowed by the 0101 rules. The old request stays
  `completed`, and a new signing starts a new request. The confirm sentence adds: "The Adobe agreement stays signed in
  your Adobe account."
- The owner's delete removes the signature row (cascade) but **not** Adobe's agreement or the stored files, which are
  `crm_file` rows the admin tier can delete. Say so in the confirm.

---

## 6. Failure states (three-state reads, fixed sentences)

Every read below is ok / not-set-up / unavailable. **A failed read is never "unsigned" or "not sent".**

| Where | Failure | Sentence (fixed, never Adobe's text) |
|---|---|---|
| Settings card | env unset | "Adobe Acrobat Sign isn't switched on for your firm yet. Lectual will turn it on." |
| Settings card | `reauth` | "Adobe Acrobat Sign needs you to sign in again." with Reconnect |
| Settings card | row unreadable | "Can't show the Adobe Acrobat Sign connection right now. Refresh to try again." |
| `/p` step 3 | create failed | "Adobe Acrobat Sign didn't answer. Try again in a minute." |
| `/p` step 3 | stale | (the existing `stale` sentence) |
| `/p` return | status not yet SIGNED | "Waiting for Adobe to confirm your signature. This page will update." |
| `/p` return | read failed | "We couldn't check your signature with Adobe just now. Refresh in a minute; nothing is lost." |
| `/p` | agreement expired / cancelled / declined | "This signing link has closed. Press Sign to start again." |
| Staff proposal page | request read failed | "Signing status couldn't be loaded." (never "Not signed") |
| Staff proposal page | out for signature | "Out for signature with Adobe Acrobat Sign since <date>." |
| Staff proposal page | signed after a change | "The client signed in Adobe after this proposal changed. Check it with them." |
| Staff card | files not stored | "The signed PDF from Adobe isn't stored yet. Try again." |
| Timeline step | `adobe_signed_files` failed | `HTTP <status>` or a fixed sentence |

Adobe's error `code` is mapped to our codes in one file (`src/lib/esign/adobe-errors.ts`). The raw message is never
shown or logged (`tests/ui/no-raw-error-text.test.ts` already covers pages).

---

## 7. MUST NEVER HAPPEN

1. **Lectual sends email.** No mail call anywhere in `src/lib/esign/`. The agreement is created with every Adobe
   notification set to NONE / disabled, there is no `/reminders` call, and no email option is ever `ALL`. A hygiene
   test greps for all of this.
2. **The firm signs for the client.**
   - There is exactly one participant set: role `SIGNER`, the client's email.
   - No staff action creates, opens or fetches a `signingUrl`; only the token-holding public page does.
   - No `HOST` or `IN_PERSON_SIGNER` role, no `x-api-user` impersonation, no `:account` / `:group` scopes.
   - The staff UI has no "sign" button.
3. **A fee or the letter text changes after signing.**
   - Completion accepts only the request's frozen selection, snapshot and text.
   - The function checks the text and the sha256, and refuses if the proposal's version or status moved.
   - Accepted snapshots are never re-priced (an existing rule).
   - `pricing.ts` has no diff.
4. **A cross-firm read.**
   - The `org_id` always comes from the proposal or request row, never from the browser or the webhook body.
   - A token is read fenced on that row's org and sent only to that connection's checked `api_access_point`.
   - A webhook agreement id unknown to us does nothing.
5. **Tokens logged.** No access token, refresh token, `esignUrl`, client secret, agreement text, address or Adobe
   response body is ever logged, put in a step payload, or stored in `last_error`. `esignUrl` is never stored.

Also never:
- `includeSignedDocuments` in a webhook (untrusted base64 in a request body);
- the proposal token in `externalId` or the agreement name;
- falling back to the unsigned update for `loe` content (the existing rule).

---

## 8. Open questions for the owner and the firm

1. **Plan tier.** API access needs Acrobat Sign Enterprise / "Solutions" (or a free Developer Edition for testing);
   Acrobat Pro and the individual or small-business plans do not include it (community and Adobe staff answers). What
   is RPB's plan? Does it allow API apps and webhooks? Is mutual TLS for webhooks wanted? (It needs "Solutions".)
2. **Embedded vs email**, and the "never sends" tension (section 3 a-c). If Adobe fails at Sign, do we offer the in-app
   signature on the spot, or only "try again"?
3. **Sender account.** Agreements are sent "from" whoever connected Adobe. Should that be Rebecca, or a shared firm
   account? Their name appears in Adobe's audit report.
4. **Branding.** Adobe's signing page shows the firm's Adobe account branding, not Lectual's. Is that acceptable? Does
   the firm want its logo set in Adobe?
5. **Identity.** Embedded signing does not verify the signer, the same as today's link. Is that acceptable, or should
   the signer use Adobe email OTP (`EMAIL_OTP`, which is itself an Adobe email to the client)?
6. **Retention.**
   - Keep Adobe's audit report forever in `client-files`?
   - File it to Lawmatics with the signed PDF?
   - Does the firm's Adobe account have a document-retention rule that deletes agreements? (Adobe:
     `AGREEMENT_DESTROYED`.)
7. **Sandbox.** A Developer Edition account for Lectual and a test PARTNER app, then **Adobe certification** of the
   partner app before any other firm can connect. Who applies, and how long does it take?
8. **Blank proposals.** Where do the signed files live when the proposal has no lead or matter (section 5.2)?
9. **The `{{signed_date}}` field** (section 2.2). Is Adobe's own signature date on the PDF enough, with our stored
   text carrying the completion date in the firm's zone? Could the two dates differ across midnight, and is that acceptable?
10. **Signed but changed.** If a client signs in Adobe after the firm withdrew or replaced the proposal, is it right
    that Lectual does not accept it and staff resolve it by hand?

---

## 9. Test plan and size

**No test calls Adobe.** All HTTP goes through injected fetches, as LawPay and Meetings do. A missing
`ADOBE_SIGN_OAUTH_*` means "not set up" in every test.

| Area | Tests |
|---|---|
| Pure cores | The agreement payload builder (one SIGNER, every notification NONE/disabled, no reminders, `externalId` = request uuid, no token); the `api_access_point` host rule (accepts `api.na1.adobesign.com`, refuses `evil.com`, `adobesign.com.evil.com`, `http://`, paths); the error mapper; the status-to-transition table. |
| PDF | `for-signature` mode: the words equal `agreementText`, the canonical sha256 equals the in-app one for the same inputs, the signature block lies outside the words; a pinned fixture. |
| Public action | stale, missing details, not connected -> in-app, reauth -> in-app, create failure -> no acceptance and a cancel attempted, open request -> in-app refused, `esignUrl` never in logs (spy on `console.*`). |
| Webhook route | GET echo (header and body) for our client id, 403 for others; POST with a wrong id is non-2xx; an unknown agreement gets 2xx and no write; a forged "completed" POST with Adobe answering OUT_FOR_SIGNATURE writes nothing; a replay of a real completion calls the function and returns the same signature id; the body cap. |
| Completion | The fake function: refusals for `proposal_changed`, `request_closed`, `text_mismatch`. Follow-ups run once. `adobe_signed_files` stores both files with the request's org; mismatched bytes -> `blocked`. |
| `signed_loe_upload` | The provider switch: an Adobe signed PDF is filed; a hash mismatch is blocked; not stored yet is failed. |
| Sweep | Budget respected; 429 stops that firm; the keep-alive refresh at 30 days; counts only. |
| Hygiene greps | No mail import in `src/lib/esign`; no `ALL` email option; no `/reminders`; no `x-api-user`; no service role outside the listed files; the token columns are never named in a select of the scoped client. |
| lectual | Migration 0108 DB cases: the tenant-isolation cases in section 1.4; the completion function's idempotency and refusals; `sign_and_accept` refused with an open request. |

**Rough size**: about 2 sprints.
- **Sprint A**: 0108 in lectual, the connection, connect/disconnect, the Settings card, the config, the host rule,
  the `for-signature` PDF mode, the create path behind the connection, and the tests.
- **Sprint B**: the webhook, the return check, the sweep, the completion function wiring, the files step, the
  `signed_loe_upload` switch, the staff and receipt wording, and the tests.

Before Sprint A: Adobe Developer Edition access, a PARTNER app, and a one-day sandbox spike to verify the
**(unverified)** items:
- email suppression;
- text tags;
- the signing-URL timing;
- the completion date field;
- the `/users/me` shape.

Certification and the firm's plan are outside our control and may be the long pole.

---

## Sources (all read 2026-11-17)

Read directly:
- OAuth (authorize, token, refresh with no rotation, 60-day expiry, revoke, scopes, modifiers):
  https://secure.na1.adobesign.com/public/static/oauthDoc.jsp
- OAuth token management (refresh and revoke, 1-hour access token):
  https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/oauth
- Getting started (PARTNER apps, certification, shardless host for partner apps, `api_access_point` on the redirect,
  https redirect URI): https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/gstarted
- API usage (transient documents valid 7 days, the create-agreement body, `signingUrls`, `combinedDocument`, 429 and
  `Retry-After`, 3 identical GETs a minute): https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/apiusage
- REST API v6 reference (the machine-readable spec behind the v6 docs page; `emailOption.sendOptions` NONE/ALL,
  `disabledNotificationTypes`, `externalId` warning, `postSignOption`, `signingUrls` `expiry` / `frameParent` and its
  404/409 codes, `combinedDocument?attachAuditReport`, `GET /agreements/{id}/auditTrail`, the agreement `status` enum,
  webhook scopes): https://secure.na1.adobesign.com/public/docs/restapi/v6 and
  https://secure.na1.adobesign.com/restapijson/v6/restapi.json
- Webhook APIs (`POST /webhooks` body, ACCOUNT/GROUP/USER/RESOURCE scope, conditional params, verification of intent):
  https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/webhookapis
- Webhooks in Acrobat Sign (retry policy 1 minute doubling to 12 hours, 15 tries over 72 hours, then disabled; 5-second
  response; mutual TLS; no payload signing described): https://developer.adobe.com/acrobat-sign/docs/overview/acrobat_sign_events/
- Webhook payload (`webhookNotificationId` for duplicates, the 10 MB cap, signed documents trimmed first):
  https://developer.adobe.com/acrobat-sign/docs/overview/acrobat_sign_events/webhookpayloadoverview
- Email suppression bug fixed Apr 2024 (community, not official):
  https://community.adobe.com/questions-24/unable-to-suppress-agreement-email-notifications-1025667

Seen only through search results (the page could not be fetched; treat as unconfirmed):
- Plan tiers for API access (community threads):
  https://community.adobe.com/questions-35/what-adobe-plan-is-needed-to-use-adobe-acrobat-sign-api-21164 ,
  https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/
- Signer identity in API signing (Adobe does not verify who opens a signing URL):
  https://helpx.adobe.com/sign/developer/signer-identity-in-workflows.html
- Webhook mTLS (Solutions accounts): https://helpx.adobe.com/sign/web/developers/webhooks/two-way-ssl.html

Could not be fetched:
- `opensource.adobe.com/acrobat-sign/...` (the older guide; 404 on oauth, webhookapis, webhooks-oauth-2.0, events index).
- `helpx.adobe.com` webhook overview and API FAQ (403 to automated fetch).

The developer.adobe.com copies above were used instead.
