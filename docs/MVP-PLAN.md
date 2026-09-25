# Lectual final MVP: new `lectual.app` frontend, mailbox OAuth, in-app AI agents

## Context
Taylor wants a fresh, final MVP build of the Lectual attorney dashboard in the empty `theipgirl/lectual.app` repo. It will run against **lectual-dev**, reuse what `theipgirl/lectual` already has, and add two things that don't exist yet:
1. **Gmail and Outlook OAuth mailbox connection.** Both a user's personal mailbox and firm shared mailboxes. The app reads them to pull client info onto leads and matters.
2. **In-app AI agents.** Three of them:
   - Email → client intel
   - Intake triage
   - Post-consult drafter

   All three run on a schedule and draft into the approval queue. Nothing sends automatically.

Visual design: Taylor will upload it. Step 0 below waits on it, and nothing visual is built before it arrives.

**Binding constraints carried over** (`brain/decisions.md`, `AGENTS.md`):
- **One DB, many frontends (2026-07-14-03).** `lectual.app` is a new *frontend* on the same Supabase projects. It is not a new backend.
- **Migrations stay single-chain in `lectual/supabase/migrations`.** The next free number is 0057.
- **The isolation gate `tests/tenant-isolation.test.ts` stays in `lectual`.** It gets a case for every new table.
- Everything else carries over unchanged:
  - Supabase Auth, no Clerk.
  - The UPL firewall.
  - Modules fail closed and use `notFound()`.
  - The queue has three read states: ok, unconfigured, unavailable.
  - Production ships only from `main`.
  - No content in migrations.
  - Every migration is applied to both dev and prod.

## What already exists and gets reused (ported, not rebuilt)
| Need | Existing code in `lectual` | Plan |
|---|---|---|
| Auth (magic link, JWT `active_org_id`, 10 roles, platform admin) | `src/app/sign-in/*`, `src/app/auth/callback/route.ts`, `src/proxy.ts`, `src/lib/auth/*`, migrations 0003/0029/0050 | Port as-is |
| Scoped DB client and types | `src/lib/db/*` | Port; regenerate types from lectual-dev |
| Module gates | `src/lib/org/modules.ts` (`orgHasModule`) | Port, and add modules `mailbox` and `agents` |
| Approval queue (external lawmatics-mcp) | `src/lib/queue/{api,load,org}.ts`, `dashboard/queue/*` | Port: agents write through `createDraft` |
| Email → lead matcher | `src/lib/intake/email-match.ts` (`matchMessageToLeads`, `resolveMatch`, `classifyEmail`, `activityPayloadForMessage`), `ThreadMessage` in `email-threads.ts` | Port unchanged. New providers emit `ThreadMessage[]` into it. |
| Sync write logic (dedupe on message_id, `crm_activity`, `last_*_at`, notifications) | `scripts/sync-intake-email.ts` (write section) | Extract into `src/lib/mailbox/apply.ts` so the script and the cron share it |
| LLM plumbing | `src/lib/ai/model.ts`, `src/lib/enrichment/client.ts` (`askClaude`, degrades to skipped) | Port |
| Post-consult | `src/lib/agents/{consult-notes,post-consult-workflow,post-consult-branch,post-consult-email}.ts`, notetaker webhook | Port. Fix: route drafts to the queue (they currently land only in `crm_post_consult_action` and are marked `sent` without sending). Also use `after()` instead of an un-awaited promise. |
| Enrichment (triage input) | `src/lib/enrichment/layer1.ts`, `layer2.ts` | Port. Triage builds on these. |
| Matters copilot, Document Center, intake board, matters, leads, calendar | `src/lib/agents/matters-chat.ts`, `src/lib/documents/*`, `(intake)`, `dashboard/*` | Port the pages in step 4. They get re-skinned to the uploaded design. |
| UI primitives | `src/components/ui/*` | Port, then re-theme to the design |

Porting rule: copy the files and record the source commit SHA in `lectual.app/PORTED_FROM.md`. Don't set up a shared package yet.

## Build steps

### Step 0 · Design intake (blocked on Taylor's upload)
- Turn the design into tokens in `src/app/globals.css` plus a component list.
- This becomes the **single** visual system, which resolves the three-system drift the decisions log flagged (2026-08-03-01). Record it as a new `brain/decisions.md` entry in `lectual`.

### Step 1 · Scaffold `lectual.app`
- Stack: Next.js 16.2.7, React 19.2, TypeScript, Tailwind 4, pnpm 11, Vitest.
  - Use the same versions and configs as `lectual`: `pnpm-workspace.yaml` allowBuilds, eslint, and `AGENTS.md`/`CLAUDE.md` copied with a pointer back to `lectual` for DB rules.
- Point `.env.local` / `.env.test` at lectual-dev (`vncamzabuhvlliscprmm`).
- Port auth, the db client, `org/modules`, the queue, and the UI primitives.
- Done when: `pnpm build` passes, and magic-link sign-in into a dev firm renders an empty shell.

### Step 2 · Mailbox schema (migrations in `lectual`, same branch name)
**`0057_mailbox_connection.sql`**
- **Table `mailbox_connection`**
  - Columns: `id`, `org_id` (FK `crm_org`), `user_id` (nullable), `scope` (`'personal'|'firm'`), `provider` (`'google'|'microsoft'`), `email`, `status`, `scopes text[]`, `access_token_enc`, `refresh_token_enc`, `expires_at`, `sync_cursor` (Gmail historyId / Graph deltaLink), `last_synced_at`, `last_error`, `created_by`, `created_at`.
  - Check constraint: `scope='personal' ⇔ user_id not null`.
  - Unique on `(org_id, provider, email)`.
- **RLS**
  - Row filter: `org_id = current_org_id()` AND (`scope='personal' AND user_id = auth.uid()`, OR `scope='firm'` AND the caller has a senior_admin+ role).
  - Deletes use the same filter.
  - Token columns: revoke column-level `SELECT` on `*_token_enc` from `authenticated`. Only the service-role sync job reads them.
- **Encryption:** tokens are AES-256-GCM encrypted app-side with `MAILBOX_TOKEN_KEY` (`src/lib/mailbox/crypto.ts`). The DB never sees plaintext.
- **Other additions**
  - Extend `crm_activity_type` with `email_intel` if it's needed for the agent's proposals.
  - Add the modules `mailbox` and `agents` to the `crm_org.modules` allowed list.
- **`0058_agent_run.sql`**
  - Table `agent_run`: `org_id`, `agent`, `trigger` (`cron|manual|webhook`), `status`, `started_at`, `finished_at`, `items_in`, `drafts_out`, `error`, `cost_usd`.
  - RLS is org-scoped and read-only for authenticated users. Rows are written by the service role.
- **Isolation gate:** add cross-tenant read and write cases for both tables to `tests/tenant-isolation.test.ts`. Also add a *cross-user* case: user A in org X cannot read user B's personal mailbox row.
- Apply to lectual-dev, then lectual-prod (additive), and check both with `list_migrations`.

### Step 3 · OAuth connect flow (`lectual.app`)
- **Routes**
  - `src/app/api/mailbox/connect/[provider]/route.ts` builds the auth URL:
    - Carries a signed `state`: user_id, org_id, scope and nonce, set in an httpOnly cookie.
    - Uses PKCE.
  - `.../callback/[provider]/route.ts` verifies state and org, exchanges the code, then encrypts and upserts the tokens. It fails closed on any mismatch.
- **Google**
  - OAuth client in Google Cloud.
  - Scopes: `openid email gmail.readonly gmail.compose`, with `access_type=offline` and `prompt=consent`.
  - ⚠ `gmail.readonly` is a *restricted* scope. Production needs Google verification plus a CASA security assessment. Until then it's capped at 100 test users. That's fine for the pilot firms; start verification in parallel.
- **Microsoft**
  - Multi-tenant Entra app.
  - Scopes: `offline_access User.Read Mail.Read Mail.ReadWrite` (delegated).
  - For shared mailboxes: `Mail.Read.Shared`, `Mail.ReadWrite.Shared`, reading `/users/{shared}/...`.
  - Firm tenants may need admin consent. The settings page shows the consent link.
- **UI**
  - A Settings → Mailboxes page.
    - "Connect Gmail" and "Connect Outlook" for personal mailboxes.
    - A Firm mailboxes section for senior_admin+.
    - Status, last sync, and Disconnect (revoke at the provider, then delete the row).
- **Env:** `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MS_OAUTH_CLIENT_ID/SECRET`, `MAILBOX_TOKEN_KEY`, `SITE_URL`.
- **Gates:** both the page and the actions are gated with `orgHasModule("mailbox")`.

### Step 4 · Mailbox sync (reads client info)
- **Provider adapters** in `src/lib/mailbox/{google,microsoft}.ts`:
  - Both map to the existing `ThreadMessage` type: metadata plus a ≤300-char preview, no bodies stored.
  - Incremental sync: Gmail `history.list` from `historyId`; Graph `messages/delta`.
  - Both handle token refresh, and set `status='reauth'` on `invalid_grant`.
- **`src/lib/mailbox/sync.ts`**
  - For each connection: fetch → `matchMessageToLeads`/`resolveMatch` → `apply.ts`.
  - `apply.ts` writes `crm_activity` `email_sent`/`email_received`, `last_*_at` and reply notifications. This is the logic extracted from `sync-intake-email.ts`.
  - **Privacy rule:** messages that match no lead or contact are dropped. Nothing from unmatched personal mail is persisted.
- **Contact and matter matching:** extend the matcher to also check `crm_contact.email` and link through `crm_matter_contact`. That's new code, with tests added next to `tests/intake/email-match.test.ts`.
- **Cron route** `src/app/api/cron/mailbox-sync/route.ts`:
  - Runs every 15 minutes via `vercel.json`.
  - Protected by `CRON_SECRET`.
  - Uses a service-role client, but every write carries the connection's own `org_id` (read from the row, never from input).
  - Records an `agent_run` row.
- This supersedes the "no Vercel Cron" note in `docs/2026-08-09-agent-activation-plan.md`. Log a decision entry for it.

### Step 5 · AI agents (in-app, scheduled, draft-only)
**Shared runner** `src/lib/agents/runner.ts`:
- Runs agents per org, only where `orgHasModule("agents")` is on.
- Writes an `agent_run` row per run.
- Calls the LLM via `resolveModel`/`askClaude`, with the default model `claude-sonnet-5` and Haiku for triage.
- Outputs **only** through `createDraft` (queue) or proposal rows. The UPL system-prompt rules are copied from `matters-chat.ts`.

**1. Email → client intel** (`agents/email-intel.ts`)
- Input: messages that matched in step 4.
- The LLM extracts client name, company, mark or brand, goods/services, jurisdiction, deadlines mentioned, and matter hints.
- Output:
  - A queue item of type `LEAD_UPDATE` with a field-level diff, or a new-lead proposal for unmatched inbound mail to firm mailboxes only.
  - Approving applies the diff through the existing `pipeline/leads.ts` update functions.
- Verify first that the lawmatics-mcp queue `type` enum accepts the new type.

**2. Intake triage** (`agents/intake-triage.ts`)
- Trigger: `lead_created` (it hooks the existing `runRules` call site in `pipeline/leads.ts`, wrapped in `after()`), plus a nightly backfill.
- Reuses the enrichment layer1/layer2 output. It scores readiness, value, urgency and practice-area fit.
- Writes `crm_lead.ai_summary` and tags (internal, so no queue needed), and posts a `BRIEFING` queue item for anything that's high-priority.

**3. Post-consult drafter**
- Reuses `post-consult-workflow.ts`.
- Drafts the follow-up email and summary into the queue as `CLIENT_EMAIL` and `BRIEFING` instead of `crm_post_consult_action`.
- Removes the fake `status:"sent"`.
- Triggered by the notetaker webhook (run in `after()`), plus a nightly catch-up cron.

**Approve → send path**
- Approving a `CLIENT_EMAIL` creates a **draft** in the approving user's connected mailbox: Gmail `drafts.create` or Graph `createMessage`.
- A human presses Send in their own mail client.
- If no mailbox is connected, it falls back to the existing lawmatics-mcp Outlook-draft path.

**Agents page**
- Replaces the static `crew-roster` with:
  - Real `agent_run` history.
  - On/off per agent per firm.
  - A "Run now" button, gated to senior_admin+.

### Step 6 · Port the remaining dashboard surfaces onto the new design
- In this order: Today, Queue, Intake board, Leads/lead detail, Matters, Settings, Document Center, Calendar.
- Each is a port of the `lectual` page and lib with the new skin applied. No rewrite of the logic.

## Critical files
- `lectual`:
  - `supabase/migrations/0057_mailbox_connection.sql`
  - `supabase/migrations/0058_agent_run.sql`
  - `tests/tenant-isolation.test.ts`
  - `src/lib/org/modules.ts`
  - `brain/decisions.md`
- `lectual.app`:
  - New: `src/lib/mailbox/{crypto,google,microsoft,sync,apply}.ts`, `src/lib/agents/{runner,email-intel,intake-triage}.ts`
  - New: `src/app/api/mailbox/**`, `src/app/api/cron/**`, `vercel.json`, `PORTED_FROM.md`
  - Ported from `lectual`: `src/lib/queue/*`, `src/lib/intake/email-match.ts`, `src/lib/agents/post-consult-*.ts`

## Verification
- **Build and tests**
  - `pnpm build && pnpm lint` in both repos.
  - In `lectual`: `set -a && . ./.env.test && set +a && pnpm test`, which must include the isolation gate with the new mailbox and agent_run cases, including the cross-user case.
  - In `lectual.app`, Vitest unit tests:
    - crypto round-trip and tamper rejection.
    - OAuth state tampering and org mismatch → rejected.
    - Gmail/Graph → `ThreadMessage` mapping, using recorded fixtures.
    - Unmatched mail → nothing written.
    - Agent outputs go only through `createDraft`, with mocked LLM and queue. No real external calls in tests.
- **Manual on lectual-dev**
  1. Connect a test Gmail and a test Outlook.
  2. Send an email from a seeded `@example.com` lead address.
  3. Hit `/api/cron/mailbox-sync` with `CRON_SECRET`.
  4. Check that `crm_activity` has the row, that a queue item shows up in `/dashboard/queue`, and that approving it creates a draft in the connected mailbox with nothing sent.
  5. A second firm's user sees none of it.
- **Supabase advisors:** run `get_advisors` on lectual-dev after the migrations.

## Open items (not blocking steps 1–4)
- The design upload (step 0).
- Google verification and CASA.
- The Entra app registration.
- Whether lawmatics-mcp's queue `type` enum takes `LEAD_UPDATE`. If not, add it there, or use `BRIEFING` with a structured body.
- Vercel project for `lectual.app`: preview only until merged to `main`, and never "Promote to Production".
