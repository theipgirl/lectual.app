-- =====================================================================================================================
-- PROPOSAL ONLY. NOT A MIGRATION OF THIS REPO. NOT APPLIED ANYWHERE (not lectual-dev, not lectual-prod).
--
-- This file is a draft for the `lectual` repo (theipgirl/lectual), where migrations live (AGENTS.md: "No migrations in this
-- repo"). To use it: copy it to `lectual/supabase/migrations/0108_mailbox_connections_for_owner.sql` (first-merged-wins
-- numbering: renumber if 0108 is taken), review it there, apply to lectual-dev, run the tests below, and apply to
-- lectual-prod only with the owner's OK. Names of helpers (`current_org_id()`) and of the `crm_role` value are assumptions
-- taken from this app's code and AGENTS.md; verify them against lectual's 0031 / 0075 before copying.
--
-- Why (PGE Sprint 1, Taylor Nov 17, question T7): "owners can see what mailbox is connected". A colleague's PERSONAL mailbox
-- is invisible to everyone else by RLS (0075), so Settings -> Setup -> Team accounts can only say "Only <name> can see this".
-- This function lets the OWNER (only) see, per colleague: address, provider and status. Nothing else.
--
-- Why a function and not a policy: an owner SELECT policy on `mailbox_connection` would expose every column the table grants to
-- `authenticated` (and any column added later). The function names exactly six columns, so it can never leak a token, a scope
-- list, a sync cursor, an error text or anything from mail.
--
-- App side (this repo): src/lib/mailbox/colleague-connections.ts calls `rpc('mailbox_connections_for_owner')` with the caller's
-- scoped client, only for role `owner`. A missing function (42883 / PGRST202) reads as "not switched on yet"; any other failure
-- as "couldn't check", never "not connected". The app also keeps only these six fields (colleague-rows.ts).
-- =====================================================================================================================

create or replace function public.mailbox_connections_for_owner()
returns table (
  id        uuid,
  user_id   uuid,    -- the connection's owner (null for a firm-shared mailbox)
  scope     text,    -- 'personal' | 'firm'
  provider  text,    -- 'google' | 'microsoft'
  email     text,    -- the connected address
  status    text     -- 'active' | 'reauth' | 'error' | 'revoked'
)
language sql
stable
security definer
set search_path = pg_catalog, public   -- pinned: a caller's search_path must never decide which table or function runs
as $$
  select c.id, c.user_id, c.scope, c.provider, c.email, c.status
  from public.mailbox_connection c
  where c.org_id = public.current_org_id()           -- the caller's ACTIVE org (null when none: the comparison is then never true)
    and exists (                                      -- ONLY when the caller is an owner of that same org
      select 1
      from public.crm_org_member m
      where m.org_id  = public.current_org_id()
        and m.user_id = auth.uid()
        and m.role    = 'owner'
    );
$$;

-- No-one but signed-in users may call it, and a signed-in non-owner simply gets zero rows.
revoke all on function public.mailbox_connections_for_owner() from public;
revoke all on function public.mailbox_connections_for_owner() from anon;
grant execute on function public.mailbox_connections_for_owner() to authenticated;

comment on function public.mailbox_connections_for_owner() is
  'PGE Sprint 1 (T7). Owner-only: id, user_id, scope, provider, email, status of every mailbox_connection of the caller''s active org. Never returns tokens, scopes, sync_cursor, last_error, expires_at or mail. Zero rows for any other role, for an owner of another org, and with no active org.';

-- =====================================================================================================================
-- RLS / grants notes
--   * `mailbox_connection` keeps its 0075 policies and column grants UNCHANGED. No new policy, no new grant on the table.
--   * The function is SECURITY DEFINER, so it reads the table as its owner; the ONLY gate is the role check inside it. That is
--     why the body names the org twice (rows and membership) and why search_path is pinned.
--   * EXECUTE: `authenticated` only (public and anon revoked). The service role needs no grant to call it and the app never does.
--   * If `current_org_id()` is not the helper's name in lectual, use whatever 0031's `org_member_directory()` uses for "the
--     caller's active org" (the same scoping that keeps one firm from resolving another firm's users).
--
-- Tenant-isolation cases to add to lectual `tests/tenant-isolation.test.ts` (the gate lives there):
--   1. Owner of firm A calls it: gets exactly firm A's rows, none of firm B's (seed one connection in each firm).
--   2. admin, senior_admin, attorney, intake, paralegal, law_clerk, clerk, social_media and viewer of firm A: zero rows each.
--   3. An owner of firm B with active org = firm A (a stale claim, or a platform-admin switch they are not a member of): zero rows.
--   4. A user with no active org: zero rows (not an error).
--   5. The result has EXACTLY the six columns, in order: id, user_id, scope, provider, email, status (assert the column list, so a
--      future edit cannot add one without failing the test).
--   6. A signed-out (anon) call is refused (permission denied), and `public` has no EXECUTE.
--   7. After the call, `select access_token_enc from mailbox_connection` is still permission denied for an owner (no side effect on grants).
--
-- Not part of 0108 (separate, optional, needs its own decision):
--   * "Signed in at least once" for the Team accounts list: `org_member_directory()` has no sign-in field. Adding `last_sign_in_at`
--     there (a column of auth.users the function already joins) would let the checklist show it without the service role.
--   * "Can receive drafts" for a COLLEAGUE: the six columns do not say whether the connection granted Mail.ReadWrite. A seventh,
--     derived boolean (`can_write_drafts`, computed inside the function from `scopes`, never the scope list itself) would answer it.
--     Until then the app says "Only <name> can see this" for that one item, and each person sees their own on Getting started.
-- =====================================================================================================================
