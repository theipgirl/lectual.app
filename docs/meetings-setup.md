# Meetings: Fathom and Zoom imports

The Meetings area (`/dashboard/meetings/`, in the rail under **Communication**) holds a firm's
consult and meeting recordings, imported from **the firm's own** Fathom or Zoom account: title,
time, attendees (names and emails only), the summary, the speaker-labelled transcript, a link back
to the recording, and the lead or matter it was about. Staff can link or unlink a meeting, and
"Draft follow-up" writes the client email into the **approval queue** with the post-consult
drafter. Nothing is ever sent from here.

Schema: lectual migration `0077_meetings.sql` (`meeting_source_connection`, `crm_meeting`); see
lectual `AGENTS.md` → "Meetings". Code: `src/lib/meetings/`, `src/app/dashboard/meetings/`,
`src/app/dashboard/settings/integrations/meetings/`, `src/app/api/meetings/zoom/`,
`src/app/api/cron/meetings-import/`.

## Why there is no module gate

Every credential is the firm's own (a Fathom API key it pasted, or a Zoom grant it signed in to),
sealed per firm, and every imported row is stamped with the org_id of the connection row it was
imported with. A firm can only ever see meetings from the account it connected. That is the
lawmatics_connection / LawPay pattern, not the `LAWMATICS_TOKEN` one, so per AGENTS.md no module is
needed. There is **no deployment-wide `FATHOM_API_KEY` in lectual.app**.

The older notetaker webhook in `lectual` (`/api/webhooks/notetaker/[provider]`) does use a
deployment-wide `FATHOM_API_KEY` to fill in a missing transcript. That path is now allowed only for
a firm holding the `fathom-deployment-key` module (lectual `src/lib/org/modules.ts`). The webhook
also writes `crm_meeting` (content only, never links), so meetings it receives show up here too.

## What a firm does

**Fathom** (works today, needs only `MAILBOX_TOKEN_KEY` on the deployment)
1. In Fathom: **Settings → API Access → generate an API key**, from the account that records the
   firm's consults. A key sees the meetings its owner recorded or that were shared with them or
   their team.
2. In Lectual: **Settings → Integrations → Meetings → Fathom**, paste the key. We make one
   read-only call (`GET /meetings`) to check it, then store it sealed. Nobody can read it back.
3. Press **Import recent meetings** (the last 30 days on the first run). After that, a daily cron
   imports what's new.

**Zoom** (once Lectual has registered its Zoom app, below)
1. **Settings → Integrations → Meetings → Connect Zoom**, sign in as the Zoom user who hosts the
   consults, approve.
2. In Zoom, cloud recording and **audio transcripts** must be on (Settings → Recording). Only
   cloud recordings with a transcript bring one; Zoom's recording list names no participants, so
   Zoom meetings list their speakers by name and are linked to a client by hand.

Owner / admin / senior_admin connect, import and disconnect. Everyone in the firm sees the
Meetings list; staff (not social_media or viewer) can link meetings. Disconnect deletes the stored
credential (and revokes the Zoom grant at Zoom); meetings already imported stay.

## What Lectual must do (once per deployment)

- `MAILBOX_TOKEN_KEY` (already required for mailboxes): seals Fathom keys and Zoom tokens under
  their own HKDF context, `lectual-meetings`.
- `CRON_SECRET` (already required): protects `/api/cron/meetings-import/`, scheduled daily in
  `vercel.json` (11:48 UTC).
- Zoom (optional until wanted): create a **General app, user-managed** in the Zoom App Marketplace
  (marketplace.zoom.us → Develop → Build App).
  - Redirect URL and allow-list: `https://<host>/api/meetings/zoom/callback/` (trailing slash; or
    set `ZOOM_OAUTH_REDIRECT_URI` to exactly what is registered).
  - Scopes (granular): `cloud_recording:read:list_user_recordings` (list the user's recordings),
    `cloud_recording:read:list_recording_files` (recording files incl. the transcript download),
    and `user:read:user` (the account email shown as "connected as"). Check the names against the
    app's scope picker: Zoom's docs and forum show both names for the list endpoint.
  - Set `ZOOM_OAUTH_CLIENT_ID` and `ZOOM_OAUTH_CLIENT_SECRET`. Separate apps for dev and prod.
  - Until both are set, Connect Zoom shows "not set up on this deployment" and does nothing.
  - To publish beyond the developer's own account, Zoom's app review applies.

## The import

- One run per connection: `since` = 30 days back on the first run, else the stored cursor minus a
  2-day overlap (so a transcript or summary that finished processing after the last run fills in).
  Rows are keyed on `(org_id, provider, external_id)`: re-reading a meeting refreshes its content,
  never duplicates it, never clears a transcript or summary, and never touches its links.
- Fathom: `GET https://api.fathom.ai/external/v1/meetings?created_after=…&include_transcript=true&include_summary=true&cursor=…`,
  header `X-Api-Key`. At most 25 pages a run (transcript/summary requests are Fathom's "heavy"
  class, 30 per minute).
- Zoom: `GET https://api.zoom.us/v2/users/me/recordings?from&to&page_size=30&next_page_token`
  in windows of at most 30 days; the `TRANSCRIPT` file (WebVTT) is downloaded with the access token
  as a Bearer header, and only from a `zoom.us` host. Access tokens last an hour; the refresh token
  rotates on every refresh and is re-sealed each time.
- A 401/403 (Fathom) or a dead refresh token / 401 (Zoom) marks the connection `reauth`; the
  Meetings page and Settings say "Reconnect". Anything else is recorded as `last_error` and retried
  on the next run. One connection failing never stops the others.

## The auto-link rule (`src/lib/meetings/match.ts`)

By attendee **email** only, against the leads, contacts and matters of that firm. Names never match.
- The firm's side of the call (the Fathom recorder, the Zoom host) is ignored.
- A lead is linked automatically only when **exactly one** lead in the firm has an attendee's
  address; with two or more, the first is stored as a suggestion for staff to confirm.
- A matter likewise, from its contacts' addresses plus matters opened from the matched lead(s).
- Links are applied only when the meeting is first imported. A re-import never overrides staff.

## Transcripts are stored

`crm_meeting.transcript` holds the speaker-labelled transcript. It is privileged client content,
with the same boundary as consult notes and voice-note transcripts: RLS on org_id, every member of
the firm, nobody else. Audio and video are never copied; `share_url` links to the recording.

## Sources (checked 2026-09-28)

- Fathom list meetings: https://developers.fathom.ai/api-reference/meetings/list-meetings
- Fathom quickstart (key location, what a key can see, `X-Api-Key`): https://developers.fathom.ai/quickstart.md
- Fathom rate limits (60/min; heavy 30/min): https://developers.fathom.ai/api-overview
- Fathom get transcript: https://developers.fathom.ai/api-reference/recordings/get-transcript.md
- Fathom webhooks (signing): https://developers.fathom.ai/webhooks.md
- Zoom OAuth (authorize, token, PKCE, refresh rotation, revoke): https://developers.zoom.us/docs/integrations/oauth/
- Zoom list recordings: https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording/GET/users/{userId}/recordings
- Zoom granular scopes: https://developers.zoom.us/docs/integrations/oauth-scopes-granular/

## Not yet verified against a live account

- Fathom: the exact page size and sort order of `/meetings` (the code assumes nothing about either
  beyond following `next_cursor`); whether `include_transcript` works for a plain API key on every
  Fathom plan (the docs say only that OAuth apps cannot use it).
- Zoom: the final granular scope names in the app's scope picker; that the recordings list's
  `download_url` accepts the Bearer header for every account type; Zoom AI Companion summaries are
  not imported (Zoom meetings arrive without a summary).
