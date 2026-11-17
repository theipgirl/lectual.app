# Sprint 1: Sync check and first-user readiness

**Size:** small. **Starts:** after the design rollout merges. **Schema:** lectual 0108 (owner-only mailbox visibility; added Taylor, Nov 17).

## Goal
Before the firm relies on Lectual as the true stage (decision 1), each Weekly review row says who last changed it and when, so a person can tell at a glance whether Lectual and Lawmatics agree. And the three first users (Caitlyn, Rebecca, Rayn) are known to be set up: signed in, the right role, Outlook connected where needed.

## Scope
**In**
- A quiet line on each Weekly review row (Board card, Sheet row, the detail panel): "Changed by Caitlyn · Nov 16" / "Changed by the Stage Keeper · Nov 16" / "Changed by Lawmatics sync · Nov 15" / "Not changed since import".
  - Source: the newest `crm_activity` row of the record of a CHANGE type (`stage_changed`, `matter_updated`, `matter_opened`, `lead_created`, task and note types), with its actor (person name from the member directory, or the agent / system actor in `payload.actor`, e.g. `agent:stage-keeper`, `lawmatics-sync`). Type, actor and date only; never a payload value.
- An accounts checklist, owner/admin/senior_admin only, as a section "Team accounts" of Settings → Setup (`/dashboard/settings/setup/`). One row per member (so Caitlyn, Rebecca and Rayn appear without any name in code): role (`roleLabel`), signed in at least once, Outlook connected (a Microsoft connection `active`), and "Can receive drafts" (that connection has a draft-writing scope). The last item is what Sprint 4 needs for Rayn.
  - Nothing is stored; the section only reads. No names, emails or roles are hard-coded.
  - **Owners see which mailbox each colleague has connected: address and status only, never mail or tokens (Taylor, Nov 17, T7).** A colleague's personal mailbox is invisible to everyone else by RLS (0075), so this goes through 0108's function (below), called with the scoped client, ONLY for role `owner`. Admin and senior_admin still see "Only <first name> can see this" for a colleague's personal mailbox; their own row shows its real state.
  - A small "Your setup" line on Getting started shows each person their own Outlook state (scoped read of their own connection).
**Out**
- Any change to how a stage is chosen. Any Lawmatics write. Any new page in the rail.

## Files likely touched
- `src/lib/review/load.ts` (one more optional read: last change per record, chunked like the other reads), `src/lib/review/build.ts`, `src/lib/review/format.ts` (new `lastChangedText`, pure), new `src/lib/review/last-changed.ts` (pure: pick the newest change, name the actor).
- `src/components/review/ReviewViews.tsx`, `SheetView.tsx`, `ReviewPanel.tsx`, `shared.tsx`.
- `src/lib/setup/checklist.ts`, `src/lib/setup/build.ts`, `src/lib/setup/readers.ts`, new `src/lib/setup/first-users.ts` (pure), `src/app/dashboard/settings/setup/page.tsx`, `src/app/dashboard/getting-started/page.tsx`.
- "Signed in at least once" must come from a read the scoped client may make (the member directory, `src/lib/members/directory.ts`); if no such field exists, the item is left out rather than read with the service role.
- `src/lib/ui/words.ts` (every new phrase).
- Tests under `tests/review/` and `tests/setup/`.

## Acceptance tests
1. A row whose newest change is a person's stage move reads "Changed by <first name> · <firm-zone date>".
2. A Stage Keeper move reads "Changed by the Stage Keeper"; a hired-matter sync move reads "Changed by Lawmatics sync"; an import with no later change reads "Not changed since import".
3. A failed last-change read draws no line on any row and the existing "Some details couldn't load (…)" note names it; no row says "Not changed".
4. The line is drawn for every role that can see the Weekly review; it carries no email address, payload value or note text.
5. The checklist is `notFound()` for any role outside the admin tier (signed out included).
6. Each checklist item is done / to do / couldn't check; a failed read is "couldn't check", never done and never to do.
7. For an owner, each colleague's row shows the connected address, provider and status from 0108's function; nothing else about the connection reaches the page (no token, scope list, sync cursor, error text or mail). For admin and senior_admin, another member's personal mailbox reads "Only <first name> can see this", never "not connected". Each person sees their own Outlook state on Getting started. (Taylor, Nov 17)
7a. The function returns zero rows to a non-owner, to an owner of another firm, and when called with no active org; the page treats a refused or failed call as "couldn't check", never as "not connected".
7b. Before 0108 is applied (42883 / PGRST202 by code), owners see the "Only <first name> can see this" wording and nothing fails.
8. Full tests, lint and build pass; no-build-words and no-raw-error-text pass.

## New schema: lectual 0108 (Taylor, Nov 17, T7)
Owners may see which mailbox a colleague has connected; address and status only.
- Preferred shape: a `SECURITY DEFINER` function, `search_path` pinned, e.g. `mailbox_connections_for_owner()`, that returns `id`, `user_id` (the connection's owner), `scope`, `provider`, `email` (the address) and `status` for every `mailbox_connection` row of `current_org_id()`, and ONLY when the caller's membership role in that org is `owner`; otherwise it returns no rows. It never returns `access_token_enc`, `refresh_token_enc`, `scopes`, `sync_cursor`, `last_error`, `expires_at` or anything from mail. `EXECUTE` granted to `authenticated` only.
- Why a function, not a policy: a new owner SELECT policy on the table would let an owner select every column the table grants (and future columns), while the function names exactly six. A view would need the same care plus its own grants; the function is the narrowest.
- Tenant-isolation cases: an owner of firm A gets none of firm B's rows; an admin, senior_admin, attorney and viewer of firm A get no rows; the result has exactly the six columns.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Last change per record | the line | (n/a) | no line, named in the details note |
| Member directory | names | (n/a) | actor shown as "a teammate"; checklist items "couldn't check" |
| Colleagues' connections (owner, 0108) | address, provider, status | before 0108: "Only <first name> can see this" | "couldn't check" |
| Own mailbox connection | connected / not | Mailboxes feature off: "to do" with a link to Features | "couldn't check" |
| Sign-in status per member | signed in / not yet | (n/a) | "couldn't check" |

## MUST NEVER HAPPEN
- A send to a client. Legal advice in any text. A deadline written. A cross-firm read (scoped client only; another firm's record never named). The service role in dashboard code. A raw error shown. A module gate failing open (the checklist page and the Mailboxes item gate themselves).

## Dependencies and blockers
- Design rollout merged. 0108 on lectual-dev for the owner view (the rest of the sprint works without it).

## Models and evaluator
- Generator: **Opus** for 0108 and the owner gate; **Sonnet** for everything else. Evaluator: quality pass, strict on 0108's tests.
