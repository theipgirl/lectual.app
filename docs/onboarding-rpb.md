# Onboarding RPB Law (Rebecca) onto lectual.app

RPB is a real firm with real client data, so this runs on **production only**: the
lectual.app production deployment on lectual-prod. Never connect RPB's mailbox,
Lawmatics or Fathom to a preview or to lectual-dev: that would copy privileged client
mail and records into the dev database.

State checked 2026-09-29 (lectual-prod, read-only):
- RPB Law org exists: 8 members, 151 leads, 110 matters. Modules: lawmatics-import,
  agent-toolkit, practice-ops, inbox, document-center. An approval queue is wired
  (`queue_org_key` set).
- RPB mail is Microsoft 365 (MX `rpblawfirm-com.mail.protection.outlook.com`), so the
  mailbox connection is **Outlook**, not Gmail.
- Existing RPB matter numbers are `TM-<n>`; new ones are `TM-2026-0001`… (no collision).
- None of RPB's leads carry a `lawmatics_id` yet; the importer matches by Lawmatics id,
  then by email, and never duplicates (`src/lib/lawmatics/import-plan.ts`). Review the
  plan screen before importing.

## Part 1 — Lectual, before the session (blocking)

1. **Migrations.** Reconcile migration numbering across open branches (lectual
   `docs/2026-09-21-migration-reconciliation.md`; `claude/lectual-firm-dashboard-prd-f3loev`
   also claims 0075–0078), merge theipgirl/lectual#26 to `main`, then apply 0075–0078 and
   0079–0082 to **lectual-prod** (additive) and confirm with `list_migrations`.
2. **Ship lectual.app from `main`.** Merge theipgirl/lectual.app#1. In Vercel → lectual-app →
   Settings → Git, set the **Production Branch to `main`** (it currently deploys
   `claude/mycase-dashboard-tracy-bwdfp4`). Never promote a preview.
3. **Production env (Vercel, Production only):** `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all lectual-prod),
   `SITE_URL` (the production URL), `MAILBOX_TOKEN_KEY`, `CRON_SECRET`, `INTAKE_EVENT_SALT`
   (new random values, never the preview's), `ANTHROPIC_API_KEY`, `QUEUE_API_URL` +
   `DASHBOARD_API_TOKEN` (RPB's queue), `MS_OAUTH_CLIENT_ID` / `MS_OAUTH_CLIENT_SECRET`.
4. **Supabase lectual-prod → Authentication:** add `<production URL>/**` to Redirect URLs;
   confirm the `custom_access_token_hook` is enabled.
5. **Microsoft app** (docs/mailbox-oauth-setup.md §3): one multi-tenant Entra app in
   Oath's tenant, redirect `<production URL>/api/mailbox/callback/microsoft/`, delegated
   Graph permissions as listed there. RPB's tenant may block user consent: have RPB's
   Microsoft 365 admin open
   `https://login.microsoftonline.com/<rpb-tenant>/adminconsent?client_id=<MS_OAUTH_CLIENT_ID>`
   before the session.
6. **Modules for RPB on prod:** add `mailbox` and `agents` (keep the existing ones). Add
   `fathom-deployment-key` only if RPB still relies on the old Fathom webhook's fallback
   to the deployment-wide key; once Rebecca connects her own Fathom key below, it isn't
   needed.

## Part 2 — the session with Rebecca (~30 min)

1. Sign in at `<production URL>/sign-in` with her own email (magic link). Confirm the
   header says RPB Law.
2. **Settings → Firm profile:** display name, time zone, the sign-off drafts use.
3. **Settings → Team & roles:** check the 8 members and their roles.
4. **Settings → Integrations → Outlook → Connect** (personal: rebecca@). Then any firm
   mailboxes (e.g. intake@) under Firm mailboxes. Mail matched to a lead or matter lands on
   its timeline; unmatched mail is never stored.
5. **Settings → Integrations → Lawmatics:** Rebecca creates an API token in Lawmatics
   (Settings → API) and pastes it. Open the import plan, review the matches, then import.
6. **Settings → Integrations → Meetings → Fathom:** in Fathom, Settings → API Access →
   generate a key; paste it; press **Import recent meetings** (first run looks back 30 days).
7. **Zoom:** only after Lectual's Zoom app passes Zoom's review (production credentials);
   until then the button says it isn't set up.
8. **LawPay:** only after 8am issues the partner app; until then record payments by hand.
9. **Agents:** switch on intake triage, email intel and post-consult; set minutes per task
   (hours-saved estimate). Autopilot can be paused from Today at any time.
10. **Intake → Forms** and **Settings → Services**: set up the public intake form and the
    firm's flat-fee services for quotes.

## After
- Next morning: Today's "Overnight run" shows what the agents did; "Needs you" lists what
  is waiting on Rebecca.
- Record the date and outcome in the changelog doc.
