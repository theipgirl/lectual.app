# Session recap, 2026-11-12: Lectual as a Claude connector

## What happened
- The Lawmatics server can't be added as a Claude custom connector (fixed Bearer token, no sign-in flow). Decision: make **Lectual** the connector, with
  Supabase's OAuth server, at `https://app.lectual.app/api/mcp/`. Drafts from the start; `lawmatics-mcp` stays for the plugin.
- Plan written and revised after checking code and Supabase docs: `docs/plans/2026-11-12-lectual-mcp-connector.md`.
- Decisions: Lectual staff may use it inside a firm; the firm owner (Rebecca for RPB) agrees first that client information appears in Claude chats.
- Phase 0 built (Opus build agent, reviewed by hand): discovery, consent page, decision endpoint, `/api/mcp/` + `whoami`, `claude-connector` switch. 10,763 tests pass.
- Set up for the test: `connector-test.lectual.app` tied to the branch; branch-only Vercel settings pointing at lectual-dev; `claude-connector` on for dev `hartwell-ip`.
- Verified live: dev Supabase OAuth server answers discovery with a client-registration address. `/api/mcp/` answers 401.

## Found
- Vercel Authentication covers every preview, including a branch domain, so Claude can't reach the test address yet.
- The workspace's Preview/Development settings point at lectual-prod, not lectual-dev.
- `taylormcghee93@gmail.com` is not a member of any dev firm.

## Not verified
Claude adding the connector, real sign-in and consent, tokens carrying `active_org_id` / `client_id`, trailing-slash URL acceptance, a real browser.

## Action items
See `docs/MASTER-TODO.md`, section "2026-11-12 (evening)". Copy this recap into the Obsidian second brain (this cloud session can't reach the vault).
