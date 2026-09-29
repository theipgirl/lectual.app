# LawPay: each firm connects its own account

Each firm signs in to its **own** LawPay account (OAuth). Nobody pastes an API key, and there is no
deployment-wide LawPay secret. Once a firm is connected, its admin picks the **operating** account,
which is required, and can also pick a **trust (IOLTA)** account. After that, a client who has
signed a proposal can pay the amount due at signing by card on the receipt, `/q/<token>`.

Until the environment variables below are set, everything stays inert. **Settings → Integrations →
LawPay** shows a disabled "Connect LawPay" button with an honest explanation. Clients are told the
firm will send them a way to pay. Staff record payments by hand on the quote.

## What has to happen first (outside this repo)

1. **8am (AffiniPay/LawPay) issues Lectual a partner OAuth app.** This is not self-service. Email
   devsupport@8am.com. DEV and production are separate apps with separate client ids.
2. Register the redirect URI **exactly**: `https://<app host>/api/lawpay/callback/`. The trailing
   slash matters, because `trailingSlash` is on. You can also set `LAWPAY_OAUTH_REDIRECT_URI` to the
   registered value.
3. **Go-live needs 8am to approve a demo video.** It must show connect/disconnect, account mapping,
   a successful charge and a declined one, and Hosted Fields.

## Environment (all optional; unset means "not configured")

| Var | Purpose |
|---|---|
| `LAWPAY_OAUTH_CLIENT_ID`, `LAWPAY_OAUTH_CLIENT_SECRET` | The partner app. Server-only. |
| `MAILBOX_TOKEN_KEY` | Existing root key. LawPay secrets are sealed under their own HKDF context (`lectual-lawpay`), so they can't be opened as mailbox tokens, or the reverse. |
| `LAWPAY_MODE` | `test` (the default) or `live`. Only the exact string `live` charges real cards. A connection stays in the mode it was made in. A connection whose mode differs from the deployment's gets no card form. |
| `LAWPAY_OAUTH_AUTHORIZE_URL` | Override for `https://secure.lawpay.com/oauth/authorize`. |
| `LAWPAY_OAUTH_REDIRECT_URI` | Override for the origin-derived callback. |
| `LAWPAY_API_BASE` | Override for `https://api.8am.com` (token, gateway-credentials, `/v1/charges`). |

## How it works

- **Connect** (`/api/lawpay/connect/`, then `/api/lawpay/callback/`). This follows the mailbox
  pattern: PKCE S256 plus a signed, httpOnly, 10-minute state cookie bound to the user and the firm.
  - Only owner, admin and senior_admin can connect, both on the page and in the routes.
  - The code is exchanged for a grant. The grant fetches `GET /gateway-credentials`, which returns
    the per-account secret keys and trust flags.
  - The secrets are sealed. The row is written through the caller's scoped client.
- **Map accounts.** Only accounts that LawPay itself lists are offered: in the connection's mode,
  and with a trust flag that matches the role. Nothing is preselected, and saving requires an
  explicit confirmation tick, which stamps `verified_at`. lectual 0080's trigger enforces the same
  rules again.
- **Refresh accounts.** Re-reads the credentials with the stored grant. The grant is refreshed first
  if LawPay ever returns an expiry and a refresh token. LawPay documents neither today. A 401 marks
  the connection `reauth`. If a mapping no longer matches, it is removed rather than repointed.
- **Disconnect.** Runs in this order:
  1. A scoped update clears every secret. This is also the permission check.
  2. Revoke at LawPay (a `client_credentials`/`tenant` token, then `DELETE
     …/deauthorize_application`).
  3. Delete the mappings and the row.
- **Pay** (the receipt on `/q/<token>`).
  - The amount is the **signed snapshot's** due-at-signing and goes to the **operating** account.
    USPTO fees are never included.
  - A `pending` `crm_payment` row is written **before** LawPay is called. 0080's partial unique
    index allows only one open charge per quote.
  - The result is then reconciled. An indeterminate answer stays `pending`. An admin resolves it on
    the quote's Payments panel.
  - The charge is refused (nothing is sent) unless the snapshot's lines recompute to exactly the
    frozen `totals.due_at_signing` the client signed.
  - If LawPay rejects the firm's own credentials (HTTP 401/403), the connection is flagged `reauth`.
    The firm's card form then disappears everywhere until an admin reconnects.
  - Any other refusal (another 4xx, a 2xx `VOIDED`) is about that one request, whose payment token
    the anonymous visitor chose. It fails the row, writes a timeline row for the firm, and leaves card
    payments on. It never pauses the firm, or one junk request could turn off every client's form.
  - After 5 failed card attempts on one quote, the form is withdrawn and the client is told the firm
    will send a way to pay. The link has no login and no rate limiter, and this stops it being used
    to test stolen cards against the firm's merchant account.
  - Only a mapping with `verified_at` set (the admin's confirmation tick) is charged.
  - The account's trust flag and mode are checked against the SEALED copy LawPay returned, not only
    the readable `accounts` column, which a firm admin can write through the API.
- **Manual payments** (quote builder → Payments → Record a payment). Staff must choose the amount,
  the purpose and the account kind explicitly. An earned legal fee can't be recorded into trust.

## Nothing charges in tests

Every test mocks HTTP. No test or check ever calls LawPay. The first real charge must be a
**test-mode** charge against a firm's test credentials, once the partner app exists.

## Still unknown (see the research notes)

- Whether LawPay echoes `state` on the authorize redirect. If it doesn't, every callback fails
  closed as "expired", and the design needs a different CSRF key.
- Whether PKCE is honored. It is sent, and ignoring it is harmless.
- Token lifetime and refresh.
- Whether revoking from inside LawPay sends any notice. We only find out on the next 401.
- The exact `formData` that `getPaymentToken` requires.

## Changes in lectual (the backend repo) this depends on

`theipgirl/lectual`, branch `claude/lectual-mvp-email-oauth-bklroa`, commit `c2a9e26`. It is
applied to **lectual-dev only**. Prod still needs it before this ships.

- `supabase/migrations/0080_lawpay_connection.sql`:
  - The `lawpay_connection` table:
    - one row per firm;
    - the sealed `access_token_enc`, `refresh_token_enc` and `gateway_credentials_enc` have no
      column grant for `authenticated`;
    - `accounts` is non-secret and guarded by the `lawpay_accounts_valid()` CHECK;
    - status is `active`/`reauth`/`revoked` and mode is `test`/`live`;
    - RLS: the whole firm can read it; owner, admin and senior_admin can write it.
  - The `crm_activity_type` value `quote_payment`.
  - The partial unique index `crm_payment_one_open_signing_charge`: at most one pending or
    succeeded LawPay legal-fee charge per quote. It replaces the unapplied `0072_quote_payment_guard`
    on the dashboard branch.
  - The CHECK `crm_payment_lawpay_legal_fee_operating`: a LawPay legal fee is never trust.
  - The partial unique index `crm_org_payment_account_lawpay_account_once`: one LawPay account can
    hold only one role.
  - The trigger `crm_org_payment_account_lawpay_guard`. A mapping requires:
    - an active connection;
    - an account that is listed and in mode;
    - a matching trust flag.
  - The trigger `crm_payment_lawpay_guard`. A LawPay payment must:
    - use the mapped account;
    - be on an active connection;
    - be listed and in mode, with a matching trust flag;
    - for a signing charge, be against a signed quote.
- `tests/tenant-isolation.test.ts`: 11 new cases, 183/183 on dev.
- `src/lib/db/types.ts`: `lawpay_connection`, `lawpay_accounts_valid` and `quote_payment`.
- `AGENTS.md`: a section headed "LawPay connections and the signing-charge guards (0080)".

Then commit `ffc6728` on the same branch (documentation only, no schema change):

- `AGENTS.md`: a bullet in that section saying `accounts` is not proof of LawPay's trust flag.
  Owner/admin can UPDATE it through the API and the guards compare against it, so lectual.app
  also seals LawPay's own trust flag and mode with the secret keys and checks that sealed copy
  before every charge. Any charge path added in lectual must do the same.
