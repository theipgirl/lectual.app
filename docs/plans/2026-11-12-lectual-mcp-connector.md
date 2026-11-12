# Lectual as a Claude connector (MCP) — plan

Date: 2026-11-12. Status: plan, not built. Owner decision log: Taylor, 2026-11-12 (drafts from the start;
keep `lawmatics-mcp` for the plugin).

## Goal
A firm member adds **Lectual** in Claude (Settings → Connectors → Add custom connector) with one URL,
`https://app.lectual.app/api/mcp`, signs in with their own Lectual account, approves access, and can then ask
Claude about their own firm's leads, matters, deadlines, approvals and proposals, and create DRAFTS. Nothing
reaches a client from this connector: the approval queue stays the only path out.

## Decisions
1. **Where it lives: this repo, at `app.lectual.app/api/mcp`.** The firm workspace already holds the
   signed-in session, the Supabase Auth redirect setup, the scoped DB client and every reader and draft helper
   the tools need (`listLeads`, `listMatters`, `loadActiveQueue`, `createProposal`, the review loaders...).
   Building in `lectual` would mean re-porting them; a third project would mean a third deployment.
2. **Sign-in: Supabase Auth's OAuth 2.1 server (beta, free during beta)** on lectual-prod (and lectual-dev for
   testing). It provides discovery, dynamic client registration (Claude registers itself), PKCE, token and
   refresh endpoints. We build only the consent page. Docs:
   supabase.com/docs/guides/auth/oauth-server/getting-started and .../mcp-authentication.
3. **Firm isolation is the existing RLS, unchanged.** Custom access-token hooks apply to OAuth tokens, so the
   0003/0029 `custom_access_token_hook` stamps `active_org_id` / `org_role` exactly as for a browser session.
   Every tool reads and writes through a client built from that token. No service role in any tool.
4. **Drafts from day one** (Taylor). Write tools create drafts only; none approve, send, move money or open a
   client link.
5. **`lawmatics-mcp` stays** for the lectual-plugin and its crons. It is unchanged by this work.

## Pieces

### A. Supabase (dashboard, Taylor or with her OK) — dev first, then prod
- Authentication → OAuth Server: enable; authorization path `/oauth/consent`; site URL `https://app.lectual.app`.
- Enable dynamic client registration (Claude needs it; the dialog has no place for a client id otherwise).
  Mitigation for "any client can register": the consent page names the client and the firm, and we list
  registered clients monthly.
- Check the JWT signing keys: OAuth recommends asymmetric (RS256/ES256). If the project is still on the
  legacy HS256 secret, migrating is a separate, careful step (every session re-signs); verification can use
  `supabase.auth.getClaims()` / `getUser()` either way, so this does not block v1.
- Confirm the access-token hook is enabled on both projects (it is on prod; AGENTS.md).

### B. Discovery and the 401 (this repo)
- `GET /.well-known/oauth-protected-resource` (and `/.well-known/oauth-protected-resource/api/mcp`):
  `{ resource: "https://app.lectual.app/api/mcp", authorization_servers: ["https://<ref>.supabase.co/auth/v1"],
  bearer_methods_supported: ["header"] }`. The ref comes from `NEXT_PUBLIC_SUPABASE_URL`, never hard-coded.
- `/api/mcp` with no or a bad token: `401` + `WWW-Authenticate: Bearer resource_metadata="<that URL>"`.
- `proxy.ts`: `/api/mcp` and `/.well-known/*` must pass through without the dashboard session redirect.

### C. Consent page `/oauth/consent` (this repo)
- Signed out: the normal sign-in (magic link / code), returning here (`safeNext`).
- Signed in: "Allow **Claude** to use Lectual for **RPB Law** as **you**?" with what it can do in plain words
  (read your firm's records; create drafts that wait for approval; never send anything) and Allow / Deny.
  Calls the Supabase OAuth authorization approve/deny API for the `authorization_id` it was given.
- A member of several firms (or a platform admin) sees which firm is active and can switch it first, using
  the existing active-org switch. The token carries exactly one firm, like a browser session.
- Wording through `src/lib/ui/words.ts`; no build vocabulary on screen.

### D. The MCP route `/api/mcp` (this repo)
- `@modelcontextprotocol/sdk` (new dependency), `WebStandardStreamableHTTPServerTransport`, stateless, same
  shape as `lawmatics-mcp/app/api/mcp/route.ts`.
- **Token → client:** verify the Bearer with Supabase (`auth.getUser(token)`), require `active_org_id` in the
  claims, then build a supabase-js client with `global.headers.Authorization = Bearer <token>`.
- **Making existing helpers work without cookies:** `getScopedClient()` reads cookies. Add a request-scoped
  override (an `AsyncLocalStorage` holding the bearer client) checked first by `getScopedClient()`, and a
  matching session resolver for the role/user readers. The route wraps each tool call in it. Lint-fence the
  setter to `src/app/api/mcp/**`. This keeps "one sanctioned client"; nothing else changes.
- Role and module gates are re-checked inside every tool (the page gates do not run here). Modules fail
  closed; a refused tool answers one fixed sentence.
- Logging: tool name, org id, outcome, duration. Never arguments, record fields or results.

### E. Tools (v1)
Read (every role that can see the page in the app):
| Tool | Uses |
|---|---|
| `search_leads` | `listLeads` + `pickRecords` (name, business, email) |
| `get_lead` | `getLead` + timeline (last 20), pending approvals for it |
| `search_matters` / `get_matter` | `listMatters` / `getMatter`, deadlines |
| `upcoming_deadlines` | the Copilot stats reader (14 days + overdue) |
| `weekly_review` | `src/lib/review` loaders (buckets, Proposals out, Waiting on) |
| `list_approvals` | `loadActiveQueue` — three states, never an empty list on failure |
| `list_proposals` / `get_proposal` | proposals list loader (status, accepted, paid, opens) |
| `list_meetings` | Meetings reader (title, date, linked record; transcripts NOT returned in v1) |

Draft (staff write roles only; `CAN_WRITE_LEAD` / `MATTER_WRITE_ROLES` / proposal-writing roles):
| Tool | Uses | Guard |
|---|---|---|
| `draft_proposal` | Copilot's `copilot-draft-proposal.ts` executor | proposals module; exact-one lead match; package on the firm's current list; returns the summary + a confirm ref, creates only on a second call with `confirmed: true` and that ref |
| `add_note` | `addLeadNote` / `addMatterNote` | internal note only |
| `create_next_step` | `createTask` (as the weekly review) | assignee must be a member |
| `queue_client_email` | the approval queue's draft path | lands as PENDING; never approved or sent |

Claude's own tool-approval prompt is the person's confirmation for writes; the `draft_proposal` confirm ref
is kept so a single model call can never create one. Tool descriptions say "draft" and "needs approval".

### F. Tests (this repo)
- Discovery JSON and the 401 header shape.
- Bearer for firm A cannot read or write firm B's lead, matter, proposal or queue item (scoped client + RLS;
  the isolation gate in `lectual` is unchanged because no table is added).
- Every tool refuses viewer/social_media where the app does; module-off answers the refusal sentence.
- No tool imports `src/lib/db/admin.ts` (grep test). No tool calls a send path (grep test, like
  `new-agents-hygiene`).
- Queue reads stay three-state through the tool.

### G. Rollout
1. Enable on lectual-dev, deploy a preview (merge `main` into the branch first), add the connector in Claude
   against the preview URL, walk sign-in → consent → each tool.
2. Taylor reviews the consent wording (client-facing-ish: firm staff read it).
3. Merge to `main` (production ships from `main` only), enable on lectual-prod, add the connector, then
   Rebecca adds it with her own login.

## Not in v1
Transcripts and consult notes through the connector; Lawmatics writes; approving or sending anything;
per-tool OAuth scopes (Supabase supports only the standard scopes today, so access = the person's own role).

## Known risks
- Supabase OAuth server is beta: endpoints or the authorization API may change.
- The token is a full user token: anything the person can do through the API, Claude's holder of the token
  could do. Mitigated by short expiry + refresh rotation, and by the tools being the only surface we expose.
- Dynamic registration lets any client ask; the consent page and the person's approval are the gate.
