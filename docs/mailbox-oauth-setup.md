# Mailbox OAuth setup (Gmail and Outlook)

The "Connect Gmail / Outlook" buttons on **Settings → Mailboxes** stay greyed out until the
env vars below are set on the deployment. Code: `src/lib/mailbox/`, `src/app/api/mailbox/`.

## 1. Encryption key (required for both)

Tokens are AES-256-GCM encrypted before they reach the database.

```bash
openssl rand -base64 32   # → MAILBOX_TOKEN_KEY
```

Set a **different** key per environment (dev, preview, production), and store it only in
Vercel env vars. Rotating it makes every stored token unreadable, so every mailbox would have
to be reconnected.

## 2. Google (Gmail)

1. Google Cloud Console → create a project (e.g. "Lectual").
2. **APIs & Services → Library:** enable the **Gmail API**.
3. **OAuth consent screen:**
   - User type **External**, app name "Lectual".
   - Support email, and the authorized domain `lectual.app`.
   - Scopes: `openid`, `email`, `.../auth/gmail.readonly`, `.../auth/gmail.compose`.
4. **Credentials → Create OAuth client ID:**
   - Type **Web application**.
   - Authorized redirect URIs (exact, with the trailing slash):
     - `http://localhost:3000/api/mailbox/callback/google/`
     - `https://lectual.app/api/mailbox/callback/google/` (and any preview domain you test on)
5. Copy the client ID and secret into `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

`gmail.readonly` is a **restricted** scope:
- While the app is in "Testing", only the test users you list (up to 100) can connect.
- Opening it to everyone needs Google's verification plus a CASA security assessment, which
  takes weeks. Start it early.

## 3. Microsoft (Outlook / Microsoft 365)

1. Entra admin center → **App registrations → New registration**:
   - Name "Lectual".
   - Supported account types: **Accounts in any organizational directory and personal
     Microsoft accounts** (the code uses the `common` endpoint).
   - Redirect URI: **Web**, `https://lectual.app/api/mailbox/callback/microsoft/`. Add
     `http://localhost:3000/api/mailbox/callback/microsoft/` under Authentication.
2. **API permissions → Microsoft Graph → Delegated:**
   - `openid`, `email`, `offline_access`, `User.Read`, `Mail.Read`, `Mail.ReadWrite`.
   - Do **not** add `Mail.Send`: Lectual only ever creates drafts.
3. **Certificates & secrets → New client secret.** Copy the *value* (not the ID) into
   `MS_OAUTH_CLIENT_SECRET`, and the Application (client) ID into `MS_OAUTH_CLIENT_ID`.
4. A firm whose Microsoft 365 tenant blocks user consent needs its admin to grant consent
   once, using this link:
   `https://login.microsoftonline.com/<their-tenant>/adminconsent?client_id=<MS_OAUTH_CLIENT_ID>`.

## 4. Turn it on for a firm

The surface is behind the `mailbox` module (fail-closed). Add it to the firm's
`crm_org.modules`. That's an operator act with the service role, never from a migration.

## How a connection works

- **Personal mailbox:** any staff member signs in with their own account.
- **Firm mailbox** (intake@, trademark@): an owner, admin or senior admin clicks "Add …" and
  signs in **as that shared account**.
- **The round trip** is protected by:
  - PKCE;
  - a signed, httpOnly, 10-minute state cookie;
  - a check that the person finishing is the same user, in the same firm, who started.
- **Disconnecting** deletes the row, and for Google also revokes the refresh token.

## 5. The sync (step 4)

`/api/cron/mailbox-sync/` runs every 15 minutes (`vercel.json`).
- **Auth:** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. With no `CRON_SECRET`
  set, the route refuses every call.
- **Plan:** a 15-minute schedule needs Vercel **Pro**. Hobby only allows daily crons, and
  the deploy fails if a cron is more frequent than the plan allows.

What each run does:
- **Scope:** for every firm with the `mailbox` module, it syncs every `active` or `error`
  connection. `reauth` connections wait until a person reconnects them.
- **First sync:** reads the last 30 days (Gmail search, or Graph delta on Inbox and Sent Items).
- **Later syncs:** read only what's new (Gmail History API, or the stored Graph delta link).
- **Matching:** each message is matched to a lead (by address, name and mark) or to a
  matter (through its contacts' addresses). Only matched messages produce anything: a
  timeline row with no body or preview, updated "last heard from" dates, and a bell
  notification on a new reply.
- **Run log:** one `agent_run` row per firm (`mailbox-sync`), with counts only.

Run it by hand against dev: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/mailbox-sync/`
