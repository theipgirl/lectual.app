# Lectual as a Claude connector (MCP) — plan

Date: 2026-11-12 (revised the same day after a check against the code and Supabase's docs).
Status: plan, not built. Decisions so far (Taylor, 2026-11-12): draft tools from the start; keep
`lawmatics-mcp` for the plugin.

## Goal
A firm member adds **Lectual** in Claude (Settings → Connectors → Add custom connector) with one URL,
signs in with their own Lectual account, approves access, and can then ask Claude about their own firm's
leads, matters, deadlines, approvals and proposals, and create DRAFTS. Nothing reaches a client from this
connector: the approval queue stays the only path out.

## Decisions
1. **Where it lives: this repo, at `https://app.lectual.app/api/mcp/`** (trailing slash, see B). The
   workspace already holds the session, the scoped DB client and every reader and draft helper the tools
   need. Only `src/lib/db/scoped-client.ts` and `src/lib/site-origin.ts` read `next/headers` in `src/lib`,
   so one seam (D) makes the existing helpers work for a token-carrying request.
2. **Sign-in: Supabase Auth's OAuth 2.1 server** (beta, free during beta) on lectual-dev, then
   lectual-prod. It provides discovery, dynamic client registration (Claude registers itself), PKCE, token
   and refresh endpoints. We build the consent page and its decision endpoint. The lockfile's
   `@supabase/auth-js` 2.117 should carry `auth.oauth.getAuthorizationDetails / approveAuthorization /
   denyAuthorization`; confirm in Phase 0 (node_modules was not installed when this was written).
3. **Firm isolation is the existing RLS, unchanged.** Supabase documents that custom access-token hooks
   apply to OAuth tokens, so `custom_access_token_hook` (0003/0029) stamps `active_org_id` / `org_role` as
   for a browser session. Every tool goes through a client built from that token. No service role in any
   tool. No new table, so no migration and no new isolation case in `lectual`.
4. **A per-firm switch, fail closed: module `claude-connector`** in `crm_org.modules` (a text array, no
   CHECK; adding the name is code only: `OrgModule` + `modules-copy.ts`, kept out of Settings → Features like
   `role-views`). The consent page and EVERY tool call check it. Lectual turns it on per firm and can turn
   it off again, which stops the connector for that firm within one request.
5. **Only Claude may be approved.** The consent page refuses any client whose redirect URI is not on an
   allow-list (env `MCP_ALLOWED_REDIRECTS`, default `https://claude.ai/api/mcp/auth_callback` and
   `https://claude.com/api/mcp/auth_callback`). Dynamic registration lets anyone register a client; this is
   what stops a look-alike client from getting a member's token through our own consent page.
6. **Drafts from day one** (Taylor). Write tools create drafts only; none approve, send, move a stage, move
   money or turn on a client link.
7. **`lawmatics-mcp` stays** for the lectual-plugin and its crons, unchanged.

## Decided 2026-11-12 (Taylor)
- **Lectual staff inside a firm they are not a member of** (platform admin, 0050) MAY use the connector
  there. Taylor had no preference, so the plan's default stands: entering the firm was already written to
  `platform_admin_audit` when they chose it in the app, and every tool result names the firm. To reverse
  it, the consent page refuses `actingAsStaff`.
- **Client information in Claude chats needs the firm owner's agreement first.** Tool results (names,
  marks, deadlines, proposal figures) are stored in the person's Claude conversation history, outside
  Lectual. `claude-connector` is NOT added to a firm until its owner has agreed; for RPB Law that is
  Rebecca, before step 4 of the rollout. v1 returns no transcripts, consult notes or email bodies.

## Phase 0 — prove the unverified parts on lectual-dev (before any tool is written)
A half-day spike on a preview deployment. Stop and re-plan if one fails.
1. Enable the OAuth server on lectual-dev with dynamic registration. Read the project's **Site URL**
   (Authentication → URL Configuration): Supabase sends people to `Site URL + authorization path`.
   - If it is the workspace's origin, the path `/oauth/consent` lands here.
   - If it is `https://lectual.app` (the `lectual` project, likely on prod since "/" there is the marketing
     homepage), do NOT change it: magic-link fallbacks and email templates depend on it. Add one redirect in
     `lectual`'s `proxy.ts`, `/oauth/consent` → `${FIRM_WORKSPACE_ORIGIN}/oauth/consent/` with the query
     kept, beside the existing dashboard redirect. On dev, pointing Site URL at the preview is acceptable.
2. A throwaway `/api/mcp/` with one tool (`whoami`) and the discovery document. Add it in Claude and check:
   the trailing-slash URL connects; Claude registers, reaches consent, returns; the access token carries
   `active_org_id` and `org_role`; a PostgREST read with it returns only that firm's rows; refresh works.
3. Confirm how the signing keys are set (legacy HS256 or asymmetric). v1 verifies tokens by asking
   Supabase (`auth.getUser(token)`), which works with both; no key migration in this project.

## Pieces

### A. Supabase (dashboard; Taylor, or with her OK) — dev first, then prod
- Authentication → OAuth Server: enable; authorization path `/oauth/consent`; dynamic registration on.
- The access-token hook must be enabled (it is on prod; see `lectual` AGENTS.md).
- Monthly: look at the registered clients list; delete any that are not Claude.

### B. Discovery and the 401
- This app has `trailingSlash: true`, so `/api/mcp` answers a 308 to `/api/mcp/`. The connector URL, the
  `resource` value and the metadata URL in the 401 all use the trailing-slash form so no client has to
  follow a redirect on a POST. Phase 0 confirms Claude accepts it; if not, the fallback is a rewrite for
  this one path, not `skipTrailingSlashRedirect` for the whole app.
- `GET /.well-known/oauth-protected-resource/api/mcp/` (and the bare `/.well-known/oauth-protected-resource/`):
  `{ resource, authorization_servers: ["https://<ref>.supabase.co/auth/v1"], bearer_methods_supported: ["header"] }`.
  The ref comes from `NEXT_PUBLIC_SUPABASE_URL`; the origin from `getSiteOrigin()`.
- `/api/mcp/` with no or a bad token: `401` + `WWW-Authenticate: Bearer resource_metadata="<that URL>"`.
- `proxy.ts` only refreshes cookies and never gates, so these paths need no exception.

### C. Consent: page `/oauth/consent/` + `POST /api/oauth/decision/`
- Signed out: the normal sign-in, returning here with `authorization_id` kept (`safeNext` must allow it).
- Signed in: `getAuthorizationDetails`. Refuse (fixed sentence, nothing approved) when: the redirect URI
  is not on the allow-list (5); the session is not `ok` (no firm); the firm lacks `claude-connector`.
- Otherwise: "Allow **Claude** to use Lectual for **<firm>** as **<you>**?" with, in plain words: it can read
  your firm's records that you can see; it can create drafts that wait for approval; it never sends anything;
  what it reads appears in your Claude chats. Allow / Deny. The firm shown is the active one; a person in
  several firms switches firm in the app first.
- The decision endpoint re-checks all of the above before `approveAuthorization` (the page is not the gate).
- Wording through `src/lib/ui/words.ts`; `noindex`; no build vocabulary on screen.

### D. The route `/api/mcp/`
- `@modelcontextprotocol/sdk` (new dependency; `zod` if not already present),
  `WebStandardStreamableHTTPServerTransport`, stateless, node runtime, same shape as `lawmatics-mcp`.
- **Token → client.** Verify with `auth.getUser(token)`; require an `active_org_id` claim; build a
  supabase-js client with `Authorization: Bearer <token>`.
- **The seam.** `getScopedClient()` first checks an `AsyncLocalStorage` holding that client; the route runs
  each tool call inside it. 33 files call `supabase.auth.getUser()` with no argument (it reads the cookie
  session, which a header-only client does not have), `resolveFirmSession` among them, so the stored client's
  `auth.getUser` is wrapped to pass the token. The setter is lint-fenced to `src/app/api/mcp/**`.
  Tested: outside the route the store is empty and behaviour is byte-for-byte today's.
- **Every call, in order:** token valid → `resolveFirmSession` is `ok` → firm has `claude-connector` → the
  tool's own role and module gate. A refusal is one fixed sentence; never which firms have a feature.
- Every result starts with the firm's name, so a person in several firms (the token follows their active
  firm at each refresh, as the hook is written) always sees which firm answered.
- Limits: at most 25 rows per list result with "showing N of M"; text fields clipped; a per-person
  in-memory rate limit (a courtesy on serverless, like feedback's). `maxDuration` 60.
- Logging: tool name, org id, outcome, duration. Never arguments, record fields or results.
- Tools call `src/lib` functions only, never `"use server"` action files (those revalidate and redirect).

### E. Tools (v1)
Read (roles as the matching page allows):
| Tool | Uses |
|---|---|
| `whoami` | session: firm, role, what is switched on |
| `search_leads` / `get_lead` | `src/lib/pipeline/leads.ts` + `pickRecords`; timeline titles (last 20), pending approvals |
| `search_matters` / `get_matter` | `src/lib/matters/matters.ts`, deadlines |
| `upcoming_deadlines` | the Copilot stats reader (14 days + overdue) |
| `weekly_review` | `src/lib/review` loaders (buckets, Proposals out, Waiting on) |
| `list_approvals` | `loadActiveQueue` — three states, a failed read is never an empty list |
| `list_proposals` / `get_proposal` | the proposals list loader (status, accepted, paid, opens) |
| `list_meetings` | title, date, linked record. No transcript, summary or attendee list |

Draft (staff write roles only):
| Tool | Uses | Guard |
|---|---|---|
| `draft_proposal` | `runDraftProposal` (`src/lib/agents/copilot-draft-proposal.ts`) | proposals module + proposal-writing role; exactly one lead match; package on the firm's current list. First call returns the summary and a ref (sha256 of org + inputs, so it needs no stored thread); only a second call with that ref creates the draft |
| `add_note` | `addLeadNote` / `addMatterNote` | internal note; `CAN_WRITE_LEAD` / `MATTER_WRITE_ROLES` |
| `create_next_step` | `createTask` (`src/lib/matters/tasks.ts`) | assignee must be a member of the firm |
| `queue_client_email` | `createDraft` (`src/lib/queue/api.ts`) with the firm's `queue_org_key` | lands PENDING through the queue's own hygiene; a firm with no queue gets "not switched on"; who may approve is unchanged (`routing.ts`) |

Text inside records (notes, subjects, client-typed words) is returned as data. Tool descriptions say so,
and say "draft" and "needs approval". Because no tool sends or approves, the worst a planted instruction
can produce is a draft a person then reviews.

### F. Tests
- Discovery JSON, the 401 header, the trailing-slash forms.
- Consent refuses: redirect URI off the list, no firm, module off, signed out. The decision endpoint
  refuses the same without the page.
- A token for firm A cannot read or write firm B's lead, matter, proposal or queue item through any tool.
- Each tool refuses viewer / social_media where the app does; module off gives the refusal sentence.
- Grep tests: no file under `src/app/api/mcp` or `src/lib/mcp` imports `src/lib/db/admin.ts` or a send path;
  the ALS setter is imported only by the route.
- Queue and list reads stay three-state through the tool.

### G. Rollout
1. Phase 0 on dev + a preview (merge `main` into the branch first).
2. Build B–E on the branch; review pass (security review of C and D by the most capable model).
3. Taylor reads the consent wording.
4. Rebecca agrees to client information appearing in Claude chats (see Decided). Merge to `main` (production ships from `main` only). Enable the OAuth server on lectual-prod, add
   `claude-connector` to the first firm, add the connector in Claude, then Rebecca adds it with her own login.

## Disconnecting
A person removes the connector in Claude. Lectual removes `claude-connector` from the firm (stops every
tool at once) or deletes the client in the Supabase dashboard. A "Connected apps" list in Settings with a
revoke button is not in v1.

## Not in v1
Transcripts, consult notes and email bodies; Lawmatics writes; approving, sending, stage moves; per-tool
OAuth scopes (Supabase offers only the standard scopes today, so access is the person's own role).

## Known risks
- The OAuth server is beta: endpoints or the authorization API may change.
- The access token is a full user token: with it, a caller could use the database API directly with that
  person's rights, not only our tools. Limited by: only Claude's redirect URIs can be approved (5), short
  expiry with refresh rotation, the per-firm switch on the consent step, and RLS itself.
- Not verified until Phase 0: Claude's handling of the trailing-slash URL, the Site URL each project has,
  that OAuth tokens carry the hook's claims in practice, and the `auth.oauth` methods in the installed client.
