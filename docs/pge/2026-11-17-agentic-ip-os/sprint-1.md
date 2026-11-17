# Sprint 1: Sync check and first-user readiness

**Size:** small. **Starts:** after the design rollout merges. **Schema:** none.

## Goal
Before the firm relies on Lectual as the true stage (decision 1), each Weekly review row says who last changed it and when, so a person can tell at a glance whether Lectual and Lawmatics agree. And the three first users (Caitlyn, Rebecca, Rayn) are known to be set up: signed in, the right role, Outlook connected where needed.

## Scope
**In**
- A quiet line on each Weekly review row (Board card, Sheet row, the detail panel): "Changed by Caitlyn · Nov 16" / "Changed by the Stage Keeper · Nov 16" / "Changed by Lawmatics sync · Nov 15" / "Not changed since import".
  - Source: the newest `crm_activity` row of the record of a CHANGE type (`stage_changed`, `matter_updated`, `matter_opened`, `lead_created`, task and note types), with its actor (person name from the member directory, or the agent / system actor in `payload.actor`, e.g. `agent:stage-keeper`, `lawmatics-sync`). Type, actor and date only; never a payload value.
- An accounts checklist, owner/admin/senior_admin only, as a section "Team accounts" of Settings → Setup (`/dashboard/settings/setup/`). One row per member (so Caitlyn, Rebecca and Rayn appear without any name in code): role (`roleLabel`), signed in at least once, Outlook connected (a Microsoft connection `active`), and "Can receive drafts" (that connection has a draft-writing scope). The last item is what Sprint 4 needs for Rayn.
  - Nothing is stored; the section only reads. No names, emails or roles are hard-coded.
  - A colleague's PERSONAL mailbox is invisible to everyone else by RLS (0075). So for another member the Outlook items read "Only <first name> can see this", never "not connected"; the admin's own row shows its real state. A small "Your setup" line on Getting started shows each person their own Outlook state (scoped read of their own connection). Whether to add a firm-readable "connected" flag is a question for Taylor (`questions.md`), not built here.
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
7. Another member's personal mailbox is never shown as "not connected": it reads "Only <first name> can see this". Each person sees their own Outlook state on Getting started.
8. Full tests, lint and build pass; no-build-words and no-raw-error-text pass.

## New schema
None. (Sprint 1 must not need one; if it does, stop and re-plan.)

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Last change per record | the line | (n/a) | no line, named in the details note |
| Member directory | names | (n/a) | actor shown as "a teammate"; checklist items "couldn't check" |
| Own mailbox connection | connected / not | Mailboxes feature off: "to do" with a link to Features | "couldn't check" |
| Sign-in status per member | signed in / not yet | (n/a) | "couldn't check" |

## MUST NEVER HAPPEN
- A send to a client. Legal advice in any text. A deadline written. A cross-firm read (scoped client only; another firm's record never named). The service role in dashboard code. A raw error shown. A module gate failing open (the checklist page and the Mailboxes item gate themselves).

## Dependencies and blockers
- Design rollout merged. Nothing else.

## Models and evaluator
- Generator: **Sonnet** for all parts. Evaluator: quality pass.
