# Contract: Owner "View as" a teammate (read-only preview)

**Status:** DRAFT for Taylor's approval, revised after the strict security review (Nov 23). Nothing is built.

**Size:** large. Every write path gets one wrapper, and every render path switches from "my role" to "the viewer's role".

**Schema:** one proposed lectual migration, **0117** (a proposal file only). **0117 is applied only after 0116** (see "Data").

**Evaluator:** STRICT on the write block, the owner-only rule, the private-data rule and the 0117 policies. Quality pass on the rest.

## The ask
Taylor (the firm owner) wants to pick any team member and see the app the way they see it:
- their view, rail and Today;
- their "Mine" approvals (what is routed to them, what is handed to them);
- their Weekly review lanes and "Waiting on <name>".

## What this is, and what it is not
**It is a read-only preview, not an impersonation.**
- **The session stays Taylor's.** No new auth token, no signing in as the teammate, and no service role added to dashboard code.
- **RLS still runs as Taylor.** The preview works out the teammate's VIEW over data Taylor can already read: which role, which items are "theirs", which lane is theirs.
- **Nothing can be changed while previewing.** The server refuses writes, whatever the screen shows.
- **What RLS keeps private to the teammate stays private.** In those places the preview shows a fixed sentence, never Taylor's own private items in their place.

**Threat model.** The block guards against accident and confusion. Two examples: Taylor clicking "Approve" while looking at a paralegal's screen, or a write that reads as if the teammate did it.

It does not guard against a hostile owner. Any write that slipped through would still be Taylor's own, under her own RLS, and she can press Exit at any time. So the layers below are chosen so that nobody can forget a step, not so that nobody can get round them.

## Goal
1. From Settings → Team, a real owner presses "View as" on a teammate's row.
2. Every dashboard page then draws as that teammate would see it, under a banner: "Viewing as Dana Lee (read-only)", with Exit.
3. Writes are refused on the server with one sentence.
4. Entering, leaving, time-outs and sign-outs are logged: who, whom, when, in or out.
5. Exit returns to Settings → Team.

## Who may use it
**Only a real owner.** The signed-in user must have a `crm_org_member` row in the active firm with `role = 'owner'`.
- This is read from the table, never from the JWT `org_role` claim.
- It is the same rule as proposed 0116 (rule d) and the Team-settings fix.

**Only once 0116 is on the database.** Until then the owner rule can be bypassed through RLS (see 0116's "THE GAP"):
- An admin or senior admin can promote their own `crm_org_member` row to owner.
- A Lectual platform admin (claim `owner`, no row) can insert an owner row for themselves. After that they hold a real row, so `actingAsStaff` turns false and the app sees an ordinary owner.

So 0117 is applied only after 0116. `owner_view_as_start` also refuses (`view_as_needs_member_guard`) when 0116's guard trigger is not on `crm_org_member` (Q15).

**Never Lectual staff acting inside a firm** (`session.actingAsStaff`).
- Their `owner` claim does not count, and they have no row.
- They keep their existing draw-only preview (`user_metadata.lectual_view_preview`), unchanged.
- One platform admin in prod is ALSO a real owner. Whether they may use View as is Q11. Default: allowed, because they hold a real owner row.

**Never any other role.** That includes admins and senior admins: admins get the owner shell, but not this.

**Who can be previewed:**
- Not yourself.
- Not anyone outside the firm.
- Not a removed member. The target must have a row in the same firm when the preview starts AND on every request while it lasts. If they leave the firm, the next request shows Taylor's own view again.
- Any member otherwise, other owners and admins included (Q8).

## Scope

### In
**1. Entry.**
- Settings → Team: a "View as" button on each member row except your own, drawn only for a real owner.
- Account menu: one line, "View as a teammate", linking to Team (real owner only).

**2. Three route handlers at fixed paths.**

| Path | What it is |
|---|---|
| `POST /dashboard/view-as/enter/` | Body: the target's user id |
| `POST /dashboard/view-as/exit/` | |
| `POST /auth/sign-out/` | Replaces `signOutAction` (`src/lib/auth/actions.ts`), which every sign-out button posts to today |

These are route handlers, not server actions. A server action reaches the proxy only as an opaque action id, so the proxy cannot allow one by name.

Each handler re-reads the session, checks the origin (same-site POST) and returns a redirect.

**Enter:**
1. Refuses unless the caller is a real owner and not staff.
2. Checks the target is a current member who is not the caller.
3. Calls `owner_view_as_start`, which re-checks all of it in the database and writes the rows.
4. Sets the hint cookie.
5. Redirects to `/dashboard/`.

Entering while a preview is open switches teammate. The function closes the old preview with reason `switch`.

**Exit:**
1. Calls `owner_view_as_end('exit')`.
2. Clears the hint cookie.
3. Redirects to Settings → Team.

If the call fails, Exit still clears the cookie, which ends the preview in this browser (see "Where the preview state lives"). It then shows `VIEW_AS_EXIT_UNRECORDED`. The next call closes the open row (item 5).

**Sign-out:**
1. Calls `owner_view_as_end('sign_out')` first. This is best effort: a failure never blocks signing out.
2. Calls `auth.signOut({ scope: "global" })`, as today.
3. Clears the cookie.

**3. Banner.**
- Drawn by the dashboard layout above the top bar on every page while previewing.
- Text: "Viewing as <name> (read-only)", plus an Exit button (a plain form posting to the Exit path).
- It can't be dismissed.
- On phones it is one sticky line: "Viewing as Dana · read-only · Exit".

**4. Time limit.** 2 hours from Enter, on the server clock, checked in the database. After that Taylor sees her own view again with no banner.

**5. Every preview's end is logged.**

| How it ended | Row written |
|---|---|
| Exit | `exit/exit` |
| Sign-out | `exit/sign_out` |
| Switching teammate | `exit/switch` |
| Time-out | `exit/timeout`, with `created_at` = start + 2 hours |

A time-out is closed on the next request:
1. While the hint cookie is present, the proxy asks `owner_view_as_current`.
2. If that says the preview is over, the proxy calls `owner_view_as_close_expired()`, which writes `exit/timeout`.
3. The proxy deletes the cookie.

`owner_view_as_start` and `owner_view_as_end` also close any open entry the same way first.

If the browser never comes back, one row stays open. Every reader of the log counts it as ended at start + 2 hours.

**6. The teammate's view, computed through one seam** (below). It covers the rail, phone bar, Today, Approvals (list, deck, item page), Weekly review, Settings tabs, and every page's drawn role checks.

**7. The write block** (below), in four parts:
- the `previewSafe()` wrapper on every action and mutating handler, enforced by an AST test;
- the database net inside `getScopedClient()`;
- the proxy's quick refusal;
- the provider skip.

**8. Private places** show fixed sentences (below).

**9. Logging** in 0117 (below).

### Out
- Acting as the teammate: approving, moving, sending, noting or uploading "as" them. Any write at all.
- Seeing the teammate's personal mail, personal Outlook, Copilot chats or bell (open questions).
- A screen for viewing the log (Q6).
- Telling the teammate they were viewed (Q5).
- Any change to RLS on existing tables.
- Any change to the staff draw-only preview.
- Changes to `pricing.ts`, `canApproveItem` or the routing rules. They are called with the teammate's id and role, not changed.
- A process-wide `globalThis.fetch` wrapper, or a wrapper on `getAdminClient()`. Both were rejected; see "Rejected designs".

## Firm rules this must keep
- **Software, not a law firm.** Nothing here sends anything or implies advice.
- **Tenant isolation.** Every read is Taylor's scoped client, so RLS on `active_org_id` still decides. The teammate is checked to be in the same firm. 0117's SELECT policy is fenced on the active firm (see "Data").
- **The service role stays where it is.** No new service-role code.
- **Three states.** A failed read is still "couldn't be read", never empty or zero. The queue's ok / unconfigured / unavailable is untouched.
- **Modules fail closed.** Page and action gates are unchanged. In a preview, what is drawn is decided with the teammate's role, which can only narrow it, never widen it.
- **Fixed sentences only.** No raw error text, and no record data in logs.

## The seam: "whose view" vs "whose session"
Today most pages use `session.user.id` and session role reads for two different things:
- **Whose session:** who RLS is, who writes, who is logged. In a preview this stays Taylor.
- **Whose view:** whose items are "Mine", which lane is "yours", which rail rows and controls are drawn, which page gates pass. In a preview this becomes the teammate.

**One new server-only resolver:** `resolveViewer()` in `src/lib/views/view-as.ts`.
- Memoized per request with React `cache`.
- Used by layouts, pages and server components only.

```
{ session,                                  // resolveFirmSession(), unchanged: Taylor
  viewAs: null | { targetUserId, targetRole, targetName, startedAt },
  viewer: { userId, role, displayName },    // the teammate while previewing, else the session user
  previewState: "off" | "on" | "unknown" }
```

- `targetRole` and `targetName` come from the member directory, re-read on every request. If the target has no current row, there is no preview.
- **No server action and no route handler may read `resolveViewer()`.** Actions keep deciding with the session. In a preview they are refused before deciding anything. The read-only allowlist (Layer a) can only narrow.
- A grep test fails when any `"use server"` file or `route.ts` imports `@/lib/views/view-as`.
- The write block reads the preview FLAG through a separate, smaller module, `src/lib/views/view-as-flag.ts`, which carries no viewer.

### Every role read is switched for drawing
Role reads in the code today:
- `resolveFirmSession().role`;
- `currentRole()` and `callerHasRole()` (`src/lib/auth/current-role.ts`, about 24 files);
- `resolveCurrentRole()` (`src/lib/pipeline/leads.ts`) and `resolveQueueRole()` (`src/lib/queue/roles.ts`);
- the `require*Role` helpers: `requireMatterWriteRole`, `requireQuoteWriteRole`, `requireAutomationAdminRole`, `requireAutomationStaffRole`, `requireQuoteLibraryAdminRole`;
- **28** direct `rpc("current_org_role")` calls in 21 files, for example `src/lib/proposals/store.ts:174` (`requireRole`) and `:958` (the delete path);
- `isCurrentUserApprover()` (`src/lib/proposals/store.ts:1210`).

**The rule:**
- **These helpers stay session reads.** Actions use them to authorize, and actions are refused in a preview.
- **Every call that decides what is DRAWN switches to a viewer-aware twin.** Drawn means: a page gate, a button shown or hidden, "Approve" offered, a tab listed. The twins are:
  - `viewerRole()`;
  - `viewerHasRole(r)`;
  - `isViewerApprover()`, which checks the viewer's id in `client_proposal_setting.approver_user_ids` (members can read it).
  All three read `resolveViewer()`. Outside a preview they return exactly what the session helpers return.
- **A test pins each call site** (`tests/views/view-as-role-reads.test.ts`). It enumerates every call of the session helpers and of the `current_org_role` RPC:
  - under `src/app` and `src/components` (render code);
  - under `src/lib`, where reached from a page.
  Each one is classified as `draw → twin` or `authorize (action or route) → session`. A new call fails the test until it is classified.

### Which parts this covers, and how
| Part | Today reads | In a preview | Faithful? |
|---|---|---|---|
| Role → view | `viewFor({ role, preview, firmHasRoleViews, actingAsStaff })` | `viewFor({ role: viewer.role, preview: NO_PREVIEW, firmHasRoleViews, actingAsStaff: false })` | Yes |
| Rail, phone bar, More sheet, tour slugs | `drawnNav(visibleNav(modules, role), view)` | `drawnNav(visibleNav(modules, viewer.role), view)`, `shellFor(view)` | Yes |
| Rail Approvals badge | `mineQueue(allQueue, { userId, role })` | Same, with `viewer` | Yes |
| Owner-shell deal-ready dot | `loadDealNudge(..., parseDealTimes(user.user_metadata), parseDeckSeen(...))` | Viewer id; firm default deal times (`DEFAULT_DEAL_TIMES`); no deck-seen stamp, because the teammate's own account metadata is not readable | Partly (Q10) |
| Today (technician) | `loadDeadlineAlerts(userId)`, `mineQueue`, `greetingName`, setup and Getting started cards | Viewer id and role; greeting from the directory name; Getting started card hidden, because its progress lives on the teammate's own account | Mostly |
| Today (owner view, for an owner or admin target) | `OwnerToday({ userId, role, metadata })`, `loadDeckSummary` | Viewer id and role; no metadata, so firm default deal times | Mostly |
| Today Consults | Outlook stored events, plus source notes from the CALLER's visible Microsoft connections (Taylor's personal one included); live Zoom | Events as stored: they are org-wide, so the teammate sees the same rows. Source notes from **firm (shared) connections only**, never Taylor's personal connection state. The teammate's own Outlook shows `VIEW_AS_PRIVATE_OUTLOOK`. Zoom is not read (token refresh, see Layer d) and shows `VIEW_AS_ZOOM` | Partly |
| Approvals list, item page, deck | `loadQueueViewContext()` → `viewer` | That function's viewer comes from `resolveViewer().viewer`. Only pages call it; the deck and queue actions keep their own session reads | Yes |
| Routing | `canApproveItem` / `ownerOf` / `isOwnedBy` | Unchanged code, teammate's id and role | Yes |
| Card-event fold ("Handed to you") | `handedToViewer`, `currentHolder`, `buildDeck(..., trust)` | Teammate as viewer; trust from `viewEventTrust(view)` | Yes |
| "Ready to draft" (Sprint 4) | `viewerId`, `view.drafter === viewer.userId` | Teammate | Yes |
| Weekly review | `userId = session.user.id`; `isApprover`; `?who=mine`; Cards `chosenPerson(people, params.person, userId)`; "Waiting on you" | Viewer id and role everywhere. An approver target reads "Waiting on you", as they would | Yes |
| Lanes, Board, Sheet | Firm-wide rows | Unchanged | Yes |
| Running timer chip | `crm_time_entry`, readable firm-wide (0056) | The viewer's running timer | Yes |
| My Mail | The caller's visible connections: own personal plus firm | **Firm (shared) mailboxes only**, from stored rows. The live Inbox tab and reading pane are not fetched. Personal mailboxes show a sentence | Partly (Q1) |
| Bell | `crm_notification` (RLS `user_id = auth.uid()`) | Muted bell with the sentence; neither person's items | No (Q4) |
| Copilot | Page, drawer, `POST /api/matters-chat`, history (author-only RLS) | Page shows the sentence; launcher hidden; the route refuses | No (Q2) |
| Own-Outlook pieces (drafter's Outlook, "Send from Outlook now") | `myOwnOutlookRow()` via `auth.getUser()` | The sentence; never Taylor's Outlook in their place | No (Q1) |
| Settings | Per-tab gates | Drawn by `viewerRole()`; every save refused | Yes |

### Wider than they'd see (handled in code, not left to RLS)
RLS runs as Taylor. So anything RLS would hide from the teammate, but the app does not hide itself, would show MORE in the preview. Checked against `lectual/supabase/migrations`:
- **Role-gated SELECTs:** only `client_proposal_signature` (0106, staff roles). The app gates that read by role (`src/lib/loe/signature-roles.ts`), and the page asks with `viewerRole()`.
- **Per-person SELECTs** (`user_id = auth.uid()`):
  - `crm_notification` (0056);
  - personal `mailbox_connection` (0075, and the proposed 0108 `mailbox_connections_for_owner`);
  - `copilot_conversation` / `copilot_message` (0099).

  In a preview each of these would return Taylor's own rows. So none is queried for display; each shows its sentence.
- **The teammate's own account settings** (`auth.users.user_metadata`) are not readable. The preview uses defaults or hides them, as in the table above.
- **Rule for later work:** any new SELECT policy keyed on a role or on `auth.uid()` needs a line here and a preview treatment.

### `auth.getUser()` used for identity
About 40 files under `src/lib` call `auth.getUser()`.
- Most use it to stamp a write, which is refused in a preview anyway.
- The ones that use it to decide whose items to SHOW must use the viewer or return the private sentence. Known ones:
  - `src/lib/mailbox/my-mailbox.ts` (`myOwnOutlookRow`);
  - `src/lib/deal/my-times.ts`;
  - the Getting started and tour readers.

A test pins the classified list.

## Private places: the fixed sentences (`src/lib/ui/words.ts`)
| Constant | Text |
|---|---|
| `VIEW_AS_BANNER(name)` | "Viewing as {name} (read-only)" |
| `VIEW_AS_EXIT` | "Exit" |
| `VIEW_AS_READ_ONLY` | "This is a read-only preview. Nothing was changed." |
| `VIEW_AS_EXIT_UNRECORDED` | "You've left the preview, but leaving couldn't be recorded. Sign out to end the preview fully." |
| `VIEW_AS_PRIVATE_MAIL(name)` | "{name}'s own mailbox is private to them and isn't shown in a preview." |
| `VIEW_AS_LIVE_MAIL` | "Live mail isn't read in a preview. Stored messages are shown." |
| `VIEW_AS_PRIVATE_OUTLOOK(name)` | "{name}'s own Outlook isn't checked in a preview." |
| `VIEW_AS_PRIVATE_COPILOT(name)` | "{name}'s Copilot chats are private to them and aren't shown in a preview." |
| `VIEW_AS_PRIVATE_BELL(name)` | "{name}'s notifications are private to them and aren't shown in a preview." |
| `VIEW_AS_ZOOM` | "Zoom consults aren't read in a preview." |
| `VIEW_AS_NOT_ALLOWED` | "Only an owner of this firm can view the app as a teammate." |
| `VIEW_AS_TARGET_GONE` | "That person isn't on your team any more." |
| `VIEW_AS_UNCHECKED` | "Couldn't check whether you're viewing as a teammate. Nothing can be changed until you refresh." |
| `VIEW_AS_LINK` | "View as" |
| `VIEW_AS_MENU` | "View as a teammate" |
| Before 0117 (or 0116) is applied | `notReadyYet("Viewing as a teammate")` |

The no-build-words gate applies to all of these: no "impersonate", "session", "RLS" or "migration".

## Where the preview state lives
**The state lives in the database (0117), keyed on the auth session id. It is switched on in a browser only while the hint cookie is present.**

| Hint cookie | Database read | Result |
|---|---|---|
| Absent | None made | OFF |
| Present | `owner_view_as_current()` returns an open entry | ON |
| Present | No open entry | OFF (the proxy closes the row and deletes the cookie, Scope item 5) |
| Present | The read fails | `previewState: "unknown"`: banner shows `VIEW_AS_UNCHECKED` with Exit; writes refused |

- **The hint cookie** is `lx_view_as`: httpOnly, Secure, SameSite=Lax, path `/`, lasting 2 hours.
- **An open entry** is one for this user, this session and this firm that is:
  - less than 2 hours old;
  - held by a caller who is still a real owner;
  - for a target who is still a member.
- **No cookie means no read.** A non-owner, or an owner who isn't previewing, pays nothing, and a 0117 outage never blocks anyone who isn't previewing.
- **The session id** comes from the JWT's `session_id` claim, read in the database (`auth.jwt()`). The browser never sends it.

**Why the database, not a signed httpOnly cookie alone.** A cookie holding `{owner, target, session, expiry}`, signed with a server secret, would also work and would save a read per request. The database was chosen because:
- the in/out log is required anyway, and the log IS the state, so the two can't disagree;
- the 2-hour limit uses the database clock, not the app server's;
- owner-only and target membership are re-checked in the database on every read, so a demoted owner or a removed teammate ends the preview at once (a signed cookie would stay valid until it expired);
- there is no new deployment secret to manage and rotate.

The cookie is kept only as the on-switch in a browser. Deleting it ends the preview there. Forging it without an open row changes nothing.

**Why not reuse `user_metadata.lectual_view_preview`:**
- **The user can edit it** (`auth.updateUser` with the anon key). That is fine for the staff flag, which only decides what is drawn. Here the flag also gates writes and is logged.
- **It follows the account, not the session.** A preview on the laptop would also lock the phone.
- **Leaving would itself be a write** (`updateUser`).
- **It has no server clock and no log.**

**Before 0117 is applied, or when 0116's guard is missing:** the feature is not offered and nobody is previewing. A missing table or function is recognised by its error code (42P01, PGRST205, 42883 or PGRST202).

## The write block

### How many write paths there are
**Server actions:** 69 files with `"use server"`, about **244** exported actions, under `src/app` and `src/lib`.

**Route handlers:** 17 `route.ts` files. The mutating ones a signed-in person reaches:
- `POST /api/matters-chat`;
- the OAuth `connect` / `callback` GETs (mailbox, Zoom, LawPay);
- `auth/callback`, which starts a new session and so ends any preview;
- the three new view-as / sign-out handlers.

`POST /api/worksheet`, the cron routes and the webhook routes have no signed-in caller.

**Writes that are not the database:**
- the approval queue (`src/lib/queue/api.ts`, lawmatics-mcp over HTTP);
- Lawmatics writes;
- Graph and Gmail drafts, and the one send (`outlook-send.ts`);
- Resend (`src/lib/mail/internal-mail.ts`);
- LawPay;
- OAuth token refreshes;
- OpenAI (voice);
- the model API.

All of these are reached only from actions and route handlers, or from the render-time refreshes listed under Layer d.

### Layer a (the main layer): `previewSafe()` on every action and mutating handler
- **Every exported server action is wrapped:** `export const approveAction = previewSafe(async (...) => { ... })`.
- **Every mutating route handler is wrapped the same way,** with `previewSafeRoute`.
- **In a preview, the wrapper returns before the body runs,** with `VIEW_AS_READ_ONLY` in the action's own result shape:
  - `{ ok: false, error }`;
  - the `ActionForm` state;
  - a redirect back with `?notice=preview`, for redirect-style actions;
  - for a route handler, 409 with the sentence.
- **Outside a preview it calls the body unchanged.**
- **The wrapper reads only `view-as-flag.ts`** (the memoized flag), never the viewer.

**Enforced in CI by an AST test** (`tests/views/view-as-actions-guarded.test.ts`). It parses every `"use server"` file and every `route.ts`. It fails when an exported action or a mutating handler is not wrapped, or is defined in a way the test can't see through (re-exports, factories).

**A named read-only allowlist.** These actions are wrapped in `previewReadOnly(action)` instead, which lets the body run in a preview.
- **What may be on it:** only actions that write nothing at all. That means pickers, search, compare, previews and downloads, for example:
  - the proposal and document pickers' searches;
  - the CSV export;
  - signed download links.
- **What "write nothing" means:** no database write, no queue or provider call, and **no token refresh**.
- **How each entry is checked:** listed with its reason, and covered by a test that runs it under a preview with a fetch spy and expects only GET reads.
- **`previewReconcileAction` stays refused,** because it refreshes mailbox tokens (the reconcile mail search).
- **Whether read-only actions should work at all in a preview is Q12.** Default: they work, because a picker that only answers "read-only" makes the preview hard to look round.
- **The only other exceptions** are the three view-as / sign-out handlers, listed by path.

### Layer b: the database net inside `getScopedClient()`
**What it refuses.** `getScopedClient()` builds each client with its own `global.fetch` (per instance, not process-wide). When the memoized preview flag for THIS request is on (or "unknown"), that fetch refuses, before sending:
- every call to `/rest/v1/*` or `/storage/v1/*` whose method is not GET or HEAD;
- `PUT /auth/v1/user` (`updateUser`).

**What still passes:**
- `POST /storage/v1/object/sign/...`, because minting a download link is a read;
- `POST /rest/v1/rpc/owner_view_as_end` and `owner_view_as_close_expired`, which write only the log;
- auth's token refresh and logout.

**There is no other RPC allowlist.** Read-only RPCs are called as GET, `rpc(fn, args, { get: true })`, which supabase-js supports for STABLE and IMMUTABLE functions. The build switches every read RPC call to that form:
- `current_org_id` and `current_org_role` (28 calls);
- `is_platform_admin` and `platform_admin_orgs`;
- `org_member_directory` (`src/lib/members/directory.ts:46`, via `callMemberRpc` in `src/lib/members/rpc.ts:35`). `loadApprovalRouting` (`src/lib/queue/routing-load.ts:26`) and the preview itself depend on it;
- the proposed 0108 `mailbox_connections_for_owner`;
- `owner_view_as_current`.

Each must be STABLE in the database for GET to be accepted; the build checks this. A read RPC left as POST simply fails in a preview with "couldn't be read", so the net fails closed.

**What it covers.** This is the net for an action that slipped past Layer a: its database and storage writes are refused. It does not cover the queue API, Lawmatics, Graph, Resend or LawPay. Layer a covers those.

### Layer c: the proxy (a quick refusal only)
**What it refuses.** While `lx_view_as` is present, `src/proxy.ts` answers 409 with `VIEW_AS_READ_ONLY` to:
- any non-GET request on a signed-in path: `/dashboard/**`, and `/api/**` except cron, webhooks, `/api/worksheet` and the public token pages;
- the OAuth connect / callback GETs.

**What it lets through:** three exact paths, `/dashboard/view-as/enter/`, `/dashboard/view-as/exit/` and `/auth/sign-out/`. Paths, because a server action arrives only as an opaque action id.

**It also does the time-out housekeeping** (Scope item 5).

**It is not the authority.** Layers a and b are the guarantee, because:
- the matcher skips `.png` / `.svg` / font paths and `_next/static`;
- server functions can fall outside a matcher (the proxy's own comment says so);
- the proxy may run outside the main runtime.

### Layer d: the provider skip for render-time token refreshes
Some renders call providers whose access token may be refreshed. A refresh rotates the token at the provider, and the new token is then saved in our database:
- Today's Zoom consults (`ownZoomAccess()`);
- My Mail's live Inbox tab and reading pane (`freshAccessToken`, `searchableMailboxAccess`).

If the provider rotated the token but Layer b refused the save, the connection would die. So in a preview these renders check the flag first and show their sentence, with no provider call at all.

### Layer e: courtesy in the browser
- While previewing, a `ReadOnlyPreview` client provider in the layout catches `submit` events in the capture phase, cancels them and shows `VIEW_AS_READ_ONLY` in a quiet toast.
- Controls are drawn as the teammate sees them, not disabled one by one.
- Nothing relies on this layer.

### Stale tabs
- A tab drawn before the preview started has no banner. If it posts, the server refuses with the sentence. That is the safe direction.
- Every tab in this browser shares the cookie and the session.
- Another device or another sign-in is not affected.

### Rejected designs, and why
**A process-wide `globalThis.fetch` wrapper, or a wrapper on `getAdminClient()`:**
- A per-request flag inside a global function would need AsyncLocalStorage.
- Detached work (`after()`, timers, an agent run) would see no flag, so it would fail open.
- It interferes with Next's own fetch patching and with prerendering.
- The proxy may run outside the main runtime anyway.
- The service-role client is used by cron and agents, which never preview.

**`set transaction read only`:**
- PostgREST opens its own transaction per request, and supabase-js cannot set the mode per request.
- It would not cover storage, auth, the queue API or any provider.

**A `db_pre_request` hook:**
- The database would need a per-request signal it can trust. A request header can be set by any client. A JWT claim would mean minting a new token, which this spec forbids.
- The hook is shared PostgREST configuration for both apps: a `lectual` change with replay risk.
- It covers only the database.

## The rollout switch (`role-views`)
- **Off:**
  - The teammate's view is the technician view (today's shell), filtered by `visibleNav(modules, teammate role)`.
  - Their Mine counts, handed cards and review lanes still apply.
  - The deck page answers `notFound()`, as it would for them.
- **On:** an owner or admin target gets the owner shell. Every other role gets the technician shell, because only the owner view is live.
- **Either way,** View as works and never shows a view the firm hasn't switched on.

## Phone, tour, runner, Copilot, notifications, account menu
**Phone:**
- The banner is one sticky line above the top bar under 640px, with a 44px Exit.
- The bottom bar and More sheet are the teammate's.
- No sideways scroll.

**Tour, Welcome deal, Getting started runner, and the name, deal-times and feedback dialogs:**
- None of them opens in a preview.
- Their menu items are left out: "Show tips again", "Getting started", "Send feedback", "Your name".

**Copilot:**
- The launcher is hidden. It would answer with Taylor's access and save into Taylor's own history.
- `/dashboard/copilot` shows the sentence.
- The chat route is wrapped and refuses.

**Notifications:**
- The bell shows neither person's items. It is drawn muted, labelled `VIEW_AS_PRIVATE_BELL`.
- `/dashboard/notifications` shows the same sentence.

**Account menu:**
- The avatar shows the teammate's initials with a "preview" ring.
- The menu holds only the header "Viewing as <name>", Exit and Sign out. Exit and Sign out post to their fixed paths.

## Data: proposed lectual 0117 (a proposal file only)
**Where it goes.** At build time this is written as `docs/pge/2026-11-17-agentic-ip-os/0117-proposed.sql.txt`, for the `lectual` repo. This repo has no migrations.

**Number.** 0117 is the next after the 0108–0116 proposals in this folder. The sibling `spec-lawmatics-daily-sync.md` needs no migration. Re-check `lectual/supabase/migrations` and this folder before copying, because numbering is first-merged-wins.

**Order.**
1. 0116 is applied and verified on a project.
2. Then 0117 on the same project.
3. Dev first, then prod with Taylor's OK.

**Why a migration** (the brief preferred none). No existing place fits:
- `crm_activity` needs a lead or matter parent (0019 `crm_activity_target`).
- `platform_admin_audit` belongs to Lectual staff.
- `crm_notification` is per recipient.
- `agent_run` belongs to the service role.
- `user_metadata` can be edited by the user and follows the account.

The state needs a server clock, owner re-checks and a log. One small append-only table does all three.

### The table: `owner_view_as_event`
**Columns:**
- `id`: uuid, primary key.
- `org_id`: uuid NOT NULL, FK to `crm_org`, ON DELETE CASCADE.
- `actor_id`: uuid NOT NULL.
- `target_user_id`: uuid NOT NULL.
- `kind`: text NOT NULL, CHECK in (`enter`, `exit`).
- `exit_reason`: text, CHECK in (`exit`, `sign_out`, `switch`, `timeout`). Required on `exit`, null on `enter`.
- `auth_session_id`: uuid NOT NULL.
- `created_at`: timestamptz NOT NULL.

**No FK** from `actor_id` or `target_user_id` to members or `auth.users`. That way the record survives someone leaving; 0116 drops `platform_admin_audit`'s user FK for the same reason. The functions check membership at write time instead.

**What is stored:** only who, whom, when, in/out (with how it ended) and the session id. No page, no record, no IP.

**Index:** `(org_id, actor_id, auth_session_id, created_at desc)`.

**Grants:**
- `authenticated`: **SELECT only** (the owner policy below needs it). No INSERT, UPDATE or DELETE.
- `anon`: nothing.
- TRUNCATE, REFERENCES and TRIGGER revoked from both.
- All writes go through the SECURITY DEFINER functions below.

**SELECT policy.** It names the table on both sides of the subquery, so the subquery can't compare a column with itself and leak across firms:
```
using (
  owner_view_as_event.org_id = public.current_org_id()
  and exists (
    select 1 from public.crm_org_member m
    where m.org_id = owner_view_as_event.org_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  )
)
```
- It is a table lookup, never `current_org_role()`, so a staff `owner` claim does not count.
- Whether owners see each other's rows is Q13. This policy says yes.

**Append-only:**
- A BEFORE UPDATE trigger refuses every update, the service role included (`view_as_append_only`).
- A BEFORE DELETE trigger refuses a direct delete (`view_as_no_delete`). Rows go only by the firm's cascade, following 0106's pattern.

### The functions
All are SECURITY DEFINER with `search_path = ''`, and executable by `authenticated` only.

**Shared checks:**
1. `auth.uid()` and the JWT `session_id` claim are not null. Else `view_as_no_session` (42501).
2. 0116's guard trigger exists on `public.crm_org_member` (looked up in `pg_trigger` by its 0116 name). Else `view_as_needs_member_guard` (42501).
3. A real owner row exists in `current_org_id()`. Else `view_as_not_owner` (42501).

**`owner_view_as_start(p_target uuid) returns timestamptz`:**
1. Runs checks 1–3.
2. Refuses the caller as their own target (`view_as_self`, 23514).
3. Refuses a target with no row in the same firm (`view_as_target_not_member`, 23514).
4. Closes any open entry in this session: an expired one as `timeout` (at start + 2 hours), a live one as `switch`.
5. Writes `enter` and returns its time.

**`owner_view_as_end(p_reason text) returns void`:**
1. Runs checks 1–3. Check 3 is skipped when the caller has an open entry, so a just-demoted owner can still close their own row.
2. Accepts `p_reason` in (`exit`, `sign_out`) only.
3. Writes the exit when this session has an open entry, otherwise nothing.

**`owner_view_as_close_expired() returns void`:**
1. Runs check 1.
2. Writes `exit/timeout` (at start + 2 hours) for this session's open entry when the entry is over 2 hours old, or when its target is no longer a member or its actor no longer an owner. Otherwise nothing.

**`owner_view_as_current() returns table (target_user_id uuid, started_at timestamptz)`:**
- STABLE, called with GET. Runs checks 1–2.
- Returns the newest event for (`auth.uid()`, session, `current_org_id()`) when all of these hold:
  - it is an `enter`;
  - it is younger than 2 hours;
  - the caller is still a real owner;
  - the target is still a member.
- Otherwise it returns no row.

**Error prefixes:** `view_as_no_session`, `view_as_needs_member_guard`, `view_as_not_owner`, `view_as_self`, `view_as_target_not_member`, `view_as_append_only`, `view_as_no_delete`.

### Isolation cases (lectual `tests/tenant-isolation.test.ts`)
- **An owner of firm B reads 0 rows of firm A's events**, directly and through `owner_view_as_current`.
- Firm B's owner cannot start a preview of firm A's member.
- Admin, senior_admin, attorney and viewer are refused.
- A platform admin inside the firm with only the claim is refused.
- Self is refused, and so is a member of another firm as the target.
- Direct INSERT, UPDATE and DELETE are refused for `authenticated`; UPDATE and DELETE are refused for the service role.
- The start function refuses when 0116's trigger is absent.
- `owner_view_as_current` returns nothing after 2 hours, and nothing under a new session id.
- `owner_view_as_close_expired` writes exactly one `timeout`.
- The firm delete cascades.

## States
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Preview state (`owner_view_as_current`) | On (banner) / off | Before 0117, or without 0116: not offered, nobody previewing | Cookie present: "unknown", banner with `VIEW_AS_UNCHECKED`, writes refused. No cookie: not read, off |
| Target in the member directory | Name, role | (n/a) | No preview drawn; Taylor's own view; "Couldn't load your team. Refresh to try again." |
| Approval routing (for Mine) | Teammate's Mine | (n/a) | Today's fallback: every pending item counted, never 0 |
| Card events (Handed to you) | Teammate's handed cards | Before 0103: nothing drawn | Nothing drawn, never "none handed" |
| Queue | As today | Unconfigured | Unavailable (three states untouched) |
| Exit's log write | Logged, redirect | (n/a) | Cookie cleared, preview over in this browser, `VIEW_AS_EXIT_UNRECORDED`; the next call closes the row |
| Every other read | As today | As today | As today |
| Private places | The sentence | The sentence | The sentence |

## Acceptance tests (names to write)

### lectual.app
1. **`tests/views/view-as-rules.test.ts`**
   - Who may start: all 10 roles × member / staff / self / other firm / removed member. Only a real owner row passes, never the claim.
   - `resolveViewer` swaps only "whose view".
   - role-views on and off give the teammate's `viewFor` / `drawnNav(visibleNav(...))`.
2. **`tests/views/view-as-actions-guarded.test.ts`** (AST)
   - Every exported action in all 69 `"use server"` files, and every mutating handler in the 17 `route.ts` files, is one of:
     - wrapped in `previewSafe` / `previewSafeRoute`;
     - on the read-only allowlist, with its reason;
     - one of the three fixed paths.
   - Fails on a new unwrapped action, and on re-export or factory forms it can't see through.
3. **`tests/views/view-as-no-viewer-in-actions.test.ts`**: no `"use server"` file and no `route.ts` imports `@/lib/views/view-as`.
4. **`tests/views/view-as-db-net.test.ts`**
   - With the flag on, none of these reaches the fetch spy from a scoped client: insert, update, upsert, delete, volatile RPC, storage upload, `updateUser`.
   - GET reads, GET RPCs (`{ get: true }`), signed-URL minting and the two log functions pass.
   - With the flag off, everything passes.
5. **`tests/views/view-as-read-rpcs.test.ts`**: every read RPC call uses `{ get: true }`: `current_org_id`, `current_org_role`, `is_platform_admin`, `platform_admin_orgs`, `org_member_directory`, `mailbox_connections_for_owner`, `owner_view_as_current`. A grep of `.rpc(` against a classified list.
6. **`tests/views/view-as-read-only-allowlist.test.ts`**
   - Each allowlisted action, run in a preview with a fetch spy, makes only GET requests and no token refresh.
   - `previewReconcileAction` is refused.
7. **`tests/views/view-as-role-reads.test.ts`**
   - Every role read is classified as draw → twin or authorize → session:
     - `resolveFirmSession().role`, `currentRole`, `callerHasRole`;
     - `resolveCurrentRole`, `resolveQueueRole`, the `require*Role` helpers;
     - the 28 `current_org_role` RPC calls, including `proposals/store.ts:174` and `:958`;
     - `isCurrentUserApprover` (`store.ts:1210`).
   - A render-path call to a session helper fails the test.
8. **`tests/views/view-as-getuser.test.ts`**: every `auth.getUser()` call is classified as stamp a write, via the viewer, or private.
9. **`tests/views/view-as-private.test.tsx`**
   - Seed Taylor's own notification, personal mailbox row, personal Outlook calendar connection and Copilot chat.
   - In a preview, none of their text or state renders in the bell, the notifications page, My Mail, the Today Consults source notes or the Copilot page.
   - Each of those places shows its sentence.
   - Shared-mailbox mail and firm connections still show.
10. **`tests/views/view-as-queue.test.ts`**: with the teammate as viewer, `mineQueue`, `buildDeck`, `handedToViewer`, `currentHolder` and "Ready to draft" equal what the teammate's own session computes, on fixtures.
11. **`tests/views/view-as-review.test.ts`**
    - `?who=mine`, the Cards deck's default person, "Waiting on you" and `isApprover` use the teammate.
    - Lanes are unchanged.
12. **`tests/views/view-as-layout.test.tsx`**
    - Banner text, and the Exit form's fixed path.
    - Rail, phone bar and More sheet equal the teammate's.
    - Tour, welcome deal, runner and dialogs closed; Copilot launcher absent.
    - The account menu holds only the header, Exit and Sign out.
    - With role-views off, the technician shell.
13. **`tests/views/view-as-provider-reads.test.ts`**: in a preview, Today's Zoom source, My Mail's Inbox tab and the reading pane make no provider call and no token refresh, and show their sentences.
14. **`tests/views/view-as-routes.test.ts`**
    - Enter refuses each of these with its fixed sentence: staff, non-owners, self, a non-member, a missing 0117, a missing 0116 guard.
    - Enter switches teammate, writing one `switch` exit.
    - Exit writes `exit/exit` and clears the cookie.
    - Exit with the database down still clears the cookie and shows `VIEW_AS_EXIT_UNRECORDED`.
    - Sign-out calls `owner_view_as_end('sign_out')` first, and signs out even when that fails.
15. **`tests/views/view-as-proxy.test.ts`**
    - With the cookie, non-GET on signed-in paths gets 409 plus the sentence.
    - The three fixed paths pass; so do cron, webhooks, worksheet and the public token pages.
    - An expired preview triggers `owner_view_as_close_expired` once, and the cookie is deleted.
16. **`tests/ui/words.test.ts` and the no-build-words gate** cover the new strings.
17. **Existing suites stay green:** the queue three-state tests, `tests/queue/fold-trust.test.ts`, the views tests (the staff preview is unchanged), and the Weekly review tests.

### lectual
18. **Migration-text test for 0117:**
    - its prefixes are listed in AGENTS.md;
    - no FK on the user columns;
    - `authenticated` has SELECT and **no INSERT, UPDATE or DELETE grant**;
    - the SELECT policy qualifies `owner_view_as_event.org_id` on both sides and checks `current_org_id()`;
    - every read function is STABLE;
    - the 0116-trigger check is present.

    Plus the isolation cases above.

## Done when
- A real owner can view the app as any teammate from Team settings, sees the banner on every page, and can leave by Exit, by sign-out or at the 2-hour limit. Every way out is in the log.
- Rail, Today, Approvals (Mine, deck, Handed to you) and the Weekly review match what that teammate's own session computes (tests 10–12).
- Every action and mutating handler is wrapped (test 2), no action reads the viewer (test 3), and the database net refuses writes that slip past (test 4).
- None of Taylor's or the teammate's private items render in a preview (test 9).
- Staff, admins and every other role cannot start one, in the app or in the database.
- Nothing is offered until 0116 and 0117 are both on the database.
- Tests, lint and build pass. The report says so if the phone layout wasn't checked in a real browser at 375px.

## MUST NEVER HAPPEN
- A write, send, approval, stage move, note, upload, metadata change or model call while previewing.
- The teammate's session, token or identity used for anything.
- The service role added to dashboard code.
- Taylor's own private items shown inside the teammate's view, or the teammate's private items shown at all.
- A preview started:
  - by Lectual staff through their claim;
  - by a non-owner;
  - of yourself, or of someone outside the firm;
  - on a database without 0116's member guard.
- One firm reading another firm's view-as log.
- A provider token refreshed (and so rotated) during a preview.
- A failed read shown as empty or zero.

## Open risks
- **R1. GET-only RPCs.** `rpc(fn, args, { get: true })` needs every switched function to be STABLE or IMMUTABLE. The build lists each one and checks it on lectual-dev. One that isn't stays POST and fails closed in a preview.
- **R2. Memoization outside pages.** React `cache` memoization in route handlers and server actions must be checked. If it doesn't memoize there, the flag is read once per handler and passed down.
- **R3. External reads that use POST** (for example a provider search). In a preview they are refused and show "couldn't be read". That fails closed, but a preview page can end up emptier than the real one. List them during the build.
- **R4. The AST test must see through every way an action is exported** in this codebase. If a pattern can't be checked, it is rewritten to one that can, rather than allowlisted.

## OPEN QUESTIONS (for Taylor)
1. **Their personal mail and Outlook.** This can't be done safely. A personal mailbox is visible only to its owner by design (0075), and opening it to the firm owner would expose privileged client mail and the person's own mail. Shared mailboxes (intake@, trademark@) do show. Is that enough?
2. **Their Copilot chats.** These are private to the author (0099), and there is no owner policy, on purpose. Recommend leaving them private. Agree?
3. **"Act as" them** (approve, move or send as the teammate). Not offered. Every record would say the teammate did something they didn't, which breaks:
   - the audit trail;
   - lane and approval attribution (0085, the approval receipts);
   - the attorney-only approval rule.

   Taylor does any fix as herself, after Exit. Agree?
4. **Their bell.** `crm_notification` is readable only by its recipient (0056). Showing it would need a new policy letting an owner read teammates' notification headlines. Recommend no. Want it anyway?
5. **Should the teammate be told** they were viewed (a bell line, or a line on their Team row)? Default: no notice; the log is for owners.
6. **Where to show the log.** Default: stored only, no screen. Option: a "Recent previews" list on Team settings for owners.
7. **Time limit.** Default 2 hours. Shorter or longer?
8. **Previewing another owner or an admin.** Default: allowed (read-only, and only firm data Taylor already sees). Restrict to non-owners?
9. **Admins** get the owner shell but NOT View as, per "owner only". Confirm.
10. **Their own settings** (deal times, tips and Getting started progress) live on their account and can't be read. The preview uses the firm's default deal times and hides Getting started. OK?
11. **"Never Lectual staff."** Does that mean only staff acting in a firm they don't belong to (`actingAsStaff`), or any `platform_admin`? One platform admin is also a real owner in prod. Default: only `actingAsStaff` is refused, so that person may use it as an owner.
12. **Read-only actions in a preview** (pickers, search, compare, previews, downloads). Should they work, or show the read-only sentence? Default: they work.
13. **Owners and the log.** Should owners see each other's View as rows? (The default policy says yes.) And may one owner preview another owner without that owner seeing it?
14. **Live reads skipped.** Zoom consults on Today, and the live Inbox and reading pane in My Mail, are not read in a preview: reading them refreshes a token, which is a write. OK?
15. **View as waits for 0116.** It can't ship until the member guard (0116) is on both databases, because until then an admin can make themselves an owner. OK to hold it?
16. **Exit when the database is unreachable.** Proposed:
    - Exit still ends the preview in this browser (the cookie is cleared);
    - it says leaving couldn't be recorded, and to sign out to end it fully;
    - the open row is closed by the next call, or counted as ended at 2 hours.

    Acceptable, or should Exit refuse until it can be recorded?
17. **Two tabs.** A preview covers every tab in that browser sign-in; other devices are not affected. OK?
18. **AGENTS.md** says firm members have no view switch (Nov 10). This is a different thing, a read-only look at a teammate, but that line should be updated when this is built. Agree?
