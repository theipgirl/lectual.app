# Ported from `theipgirl/lectual`

Source commit: `610c206` (main, 2026-09-25). Copy, don't import: when a ported file changes in
`lectual`, re-port it here and bump the commit above.

| lectual.app | From lectual | Changes |
|---|---|---|
| `src/lib/db/{admin,scoped-client}.ts` | same paths | none |
| `src/lib/db/types.ts` | same path | copied after lectual's 0070/0071 commit; the three new tables were hand-added there until dev is unpaused and types can be regenerated |
| `src/lib/auth/{roles,actions}.ts` | same paths | none |
| `src/lib/org/modules.ts` | same path | adds modules `mailbox`, `agents` |
| `src/lib/queue/{api,load,org,roles}.ts` | same paths | none |
| `src/lib/firm/session.ts` | same path | per-firm theme read removed (one design system) |
| `src/lib/env.ts` | same path | trimmed to vars this app reads; adds mailbox OAuth, token key, cron secret, optional `INTAKE_EVENT_SALT` |
| `src/lib/site-origin.ts`, `src/lib/legal/disclaimer.ts` | same paths | none |
| `src/app/auth/callback/route.ts`, `src/app/sign-in/actions.ts` | same paths | none |
| `src/proxy.ts` | same path | session refresh unchanged; adds the intake `frame-ancestors` header for `/i/` and `/r/` |
| `src/app/sign-in/{page,LoginForm}.tsx` | same paths | restyled to the Lectual design; logic unchanged |
| `tests/roles.test.ts`, `tests/queue/{queue-load,create-draft}.test.ts` | same paths | roles test checks `QUEUE_APPROVE_ROLES` instead of Firm Brain's `CLAIM_REVIEW_ROLES`; the `queueUnavailableCopy` block now lives in `tests/queue/queue-unavailable.test.ts` (step 6) |
| `src/lib/intake/{email-match,email-threads,initials}.ts`, `src/lib/matters/tracker-import.ts` | same paths | none (pure modules) |
| `tests/intake/email-match.test.ts`, `tests/fixtures/intake/{mail-threads.json,README.md}` | same paths | none |
| `src/lib/mailbox/apply.ts` (write half) | `scripts/sync-intake-email.ts` `applyEvidence()` | same rules (dedupe on message_id, advance-only timestamps, placeholder-only address recovery, one bell per reply); adds matter rows, source `mailbox-sync`, returns counts instead of logging |
| `src/app/dashboard/queue/**`, `src/components/queue/*` | `src/app/(firm)/dashboard/queue/**` | logic and role gates unchanged; re-skinned; approve adds a draft in the approver's own mailbox when the queue has no send channel; Document Center post-approve hook ported with the generators |
| `src/lib/{pipeline,matters,automation,members,mentions,notifications,time}/**` | same paths | none — copied as the import closure of `@/lib/pipeline` and `@/lib/matters` (except `automation/drips.ts`; see Campaigns) |
| `src/app/dashboard/leads/{actions,errors}.ts` | `src/app/(firm)/dashboard/pipeline/{actions,errors}.ts` | paths only |
| `src/app/dashboard/leads/[id]/actions.ts` | `src/app/(firm)/dashboard/leads/[id]/actions.ts` | role gate, assign, move stage, edit, note, tags, prep-consult and voice notes unchanged; founder link not ported; adds `reviewProposalAction` |
| `tests/pipeline/*`, `tests/matters/*`, `tests/mentions/*`, `tests/time/*` | same paths | `lead-actions.test.ts` retargeted at the new action paths |
| `src/lib/matters/board.ts` | same path | none (pure; kept for a board view) |
| `src/app/dashboard/matters/{list-utils,labels}.ts` | `src/app/(firm)/dashboard/matters/_components/{list-utils,labels}.ts` | list-utils none; labels drops `MATTER_TYPE_TONE` |
| `src/app/dashboard/matters/[id]/actions.ts` | `src/app/(firm)/dashboard/matters/[id]/actions.ts` + `team-status/actions.ts` (`assignMatterOwnerAction`) | validation and role gates unchanged; errors go through `friendlyMatterError` so no raw database message reaches the screen (**lectual should take this fix**); litigation, voice notes, welcome email and filing follow-up not yet ported |
| `tests/matters/{list-utils,actions}.test.ts` | `tests/matters/matters-page.test.ts` (pure list-utils and mocked role-gating blocks) | retargeted; adds owner, stage-error and LIT-gate cases |
| `src/app/dashboard/calendar/page.tsx` | `src/app/(firm)/dashboard/calendar/page.tsx` | same sources, merge and grouping; re-skinned; marks unconfirmed docket dates |
| `src/app/dashboard/page.tsx` (Today) | `src/app/(firm)/dashboard/page.tsx` (ops home) | same independent reads and "a failed read is never a zero" rule; priority weighting kept (`src/lib/today/priorities.ts`), with stalled matters and unclaimed hot leads in place of stalled leads; reports and the matters copilot not ported |
| `src/app/dashboard/documents/**` | reads `crm_document_draft` (0045) | new list over Document Center's table; the per-firm generators (`document-center/[matterId]/*`, `src/lib/documents/*`) are not ported |
| `src/lib/lawmatics/{client,jsonapi,normalize,import-plan,stage-map,matters-normalize,matters-import-plan}.ts`, `src/lib/intake/referral-source.ts` | same paths | none |
| `src/lib/lawmatics/{import,matters-import}.ts` | same paths | the client comes from the calling firm's own token (`connection.ts`, lectual 0072) instead of `LAWMATICS_TOKEN`; the env readers and `connectionStatus` are gone |
| `src/app/dashboard/settings/integrations/lawmatics/actions.ts` | `src/app/(firm)/dashboard/import/actions.ts` | preview/confirm/fingerprint unchanged; no `lawmatics-import` module gate (the token is per firm); adds connect/disconnect; a 401 marks the connection invalid; coded DB errors don't reach the screen |
| `tests/lawmatics/*`, `tests/__fixtures__/lawmatics.fixture.ts` | same paths | `apply-budget` and `import-actions` mock the firm connection instead of env/module; `pull-source` fixture gains `includeDropped` (was a type error in lectual too) |
| `src/lib/settings/{admin,members,enums,index}.ts`, `src/lib/members/email.ts` | same paths | none |
| `src/app/dashboard/settings/team/actions.ts` | `src/app/(firm)/dashboard/settings/actions.ts` (member actions) | errors go through `friendlySettingsError`; stages, tags and theme not ported |
| `src/lib/voice/*`, `src/lib/welcome/*`, `src/lib/matters/{filing-followup,filing-followup-action,filing-followup-queue,court-time}.ts`, `src/lib/documents/errors.ts` | same paths | none |
| `src/components/voice/VoiceNoteRecorder.tsx` | `src/components/firm/VoiceNoteRecorder.tsx` | recording logic unchanged; restyled |
| matter actions: litigation, voice note, welcome email, filing follow-up | `src/app/(firm)/dashboard/matters/[id]/actions.ts` | unchanged gates (module in the action); errors through `friendlyMatterError` |
| `tests/matters/{matter-board,filing-followup*,court-time}.test.ts`, `tests/welcome/*`, `tests/voice.test.ts` | same paths | none |
| `src/lib/prep-consult/*`, `tests/prep-consult/*` | same paths | drafts call `askClaude` from `src/lib/ai/claude.ts` (same advisory contract) instead of `@/lib/enrichment/client` |
| lead actions: tags, prep-consult, voice note | `src/app/(firm)/dashboard/leads/[id]/actions.ts` | unchanged; prep-consult keeps its agent-toolkit gate in the action |
| `src/lib/documents/{approve-hook,docx,extract,generate,loe,opinion-letter,store,trademark-clearance,types}.ts`, `tests/documents/*` | same paths | AI drafts call `askClaude` from `src/lib/ai/claude.ts`; `trademark-clearance.test.ts` typing fixed (a tsc error in lectual too) |
| `src/app/dashboard/documents/new/**` | `src/app/(firm)/dashboard/document-center/**` | same module gate at the segment layout and in every action; forms restyled; pages rewritten in the new design |
| queue approve → `generateApprovedDocument` | `src/app/(firm)/dashboard/queue/actions.ts` | same best-effort post-approve hook |
| `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `pnpm-workspace.yaml` | same paths | lint ignores `design/` |

New in this repo: Settings → Firm profile (`src/lib/org/profile*.ts`, lectual 0073) and Modules, `src/lib/lawmatics/connection.ts` and the Lawmatics import UI (`src/components/lawmatics/*`), `src/lib/matters/worklist.ts` (the design's whose-move-is-it bands), `src/lib/mailbox/*` (except the apply port above), `src/lib/nav.ts`, `src/lib/fonts`, `src/components/shell/*`, `src/app/dashboard/*`,
`src/app/globals.css` (design tokens).

## Intake (table, board by stage, board by owner)
From `theipgirl/lectual` main @ 610c206 (`src/app/(intake)/intake`):
- `_components/*` → `src/app/dashboard/intake/_components/`; `actions.ts`, `time-actions.ts` → `src/app/dashboard/intake/`.
- `src/lib/intake/{index,leads,reply,rows,scope,temperature,views}.ts`, `src/lib/time/entries.ts`, `src/components/intake/{TimeChip,TimeEntryDialog}.tsx`.
- `intake.css` adapted: same tokens and components, but the route group's own rail, top bar and 100dvh frame are dropped because the app shell provides them. Mono labels use the app's Courier Prime.
- `IntakeTopBar` is now just the page's status line. The notification bell and the `/intake/import` page were not ported; Import points to Settings → Integrations → Lawmatics.
- Tests: `tests/intake/{reply,rows,scope,temperature,views}.test.ts`. The DB-backed `list-intake` and `time/entries` suites stay in lectual.

## Quotes & proposals
From `theipgirl/lectual` branch `claude/lectual-firm-dashboard-prd-f3loev` @ `0f13772` (unmerged). Uses only
0068's tables (`crm_quote`, `crm_quote_line`, `crm_quote_event`, `crm_service_item`); no migration here.

| lectual.app | From lectual | Changes |
|---|---|---|
| `src/lib/quotes/{pricing,engagement-terms,index}.ts` | same paths | none |
| `src/lib/quotes/status.ts` | same path | firm-zone helpers come from `./firm-time` (this app's `calendar-rows.ts` has no `FIRM_TIME_ZONE`/`firmCivilDate`) |
| `src/lib/quotes/types.ts` | same path | drops `crm_payment`, `crm_org_payment_account`, `crm_quote_line_request` and `public_slug` |
| `src/lib/quotes/store.ts` | same path | no `public_slug` (0070), no line-request promotion (0071/0073), no manual payments; adds `updateQuoteDetails` (status-pinned, zero rows = lost race) |
| `src/lib/quotes/load.ts` | same path | no line-request loader; list ordered by `updated_at`; adds `loadLinesForQuotes` (one `.in()` read for list totals) |
| `src/lib/quotes/service-library.ts` | same path | none |
| `src/lib/quotes/public.ts` | same path | reads `/q/<token>` only (no slug column, no retry), firm name only (no `crm_org_theme` logo), no line requests, no `quote_accepted` `crm_activity` write (0062's enum value; `crm_quote_event` records it); snapshot version 1 (no `line_requests`); adds `declinePublicQuote` (same conditional-update shape as accept) |
| `src/lib/auth/current-role.ts` | same path | none |
| `src/lib/quotes/drift.ts` | `describeLineDrift` in `quotes/[id]/_components/LinesEditor.tsx` | moved to a pure module |
| `src/lib/quotes/{money,labels}.ts` | the per-slice `money.ts` / `line-fields.ts` / `field-meta.ts` / `quote-meta.ts` copies | one copy; `parseDollarsToCents` also accepts a leading `$` |
| `src/lib/quotes/firm-time.ts` | `FIRM_TIME_ZONE`/`firmCivilDate` from `src/lib/matters/calendar-rows.ts` | adds `endOfFirmDay` (expiry is 23:59:59 in the firm's zone; lectual stored 23:59:59 UTC) |
| `src/lib/quotes/clients.ts` | — | new: client names for the list/builder, and the "New quote" picker (leads, matters, contacts) |
| `src/app/dashboard/quotes/{page,actions,errors}.ts(x)` | `src/app/(firm)/dashboard/quotes/{page,actions}.tsx` | same attorney+ gate on page and action; adds client and total columns; errors through `friendlyQuoteError` (lectual put raw PostgREST text on screen); the refusal copy names attorneys too |
| `src/app/dashboard/quotes/[id]/{page,actions}.ts(x)` | `src/app/(firm)/dashboard/quotes/[id]/*` | same gates, terms race guard and snapshot-first rendering; no payments or line-request panels; client link is `/q/<token>/`; adds `updateDetailsAction` |
| `src/components/quotes/*` | `quotes/[id]/_components/*`, `quotes/_components/*`, `settings/service-library/_components/*` | re-skinned to `lx-*`; logic unchanged |
| `src/app/dashboard/settings/services/*` | `src/app/(firm)/dashboard/settings/service-library/*` | Settings tab; attorneys can read it; a discount item is stored negative (lectual's action stored the magnitude, which its own CHECK refused) |
| `src/app/q/[token]/*`, `src/components/proposal/*` | `src/app/q/[token]/*`, `src/app/proposal/_components/*` | one route, no `/proposal/<slug>/` twin, no PayPanel; adds Decline; UPL footer from `NOT_A_LAW_FIRM_DISCLAIMER` |
| `tests/quotes/{pricing,status,engagement-terms}.test.ts` | same paths | none |
| `tests/quotes/store.test.ts` | same path | pure blocks only (the `promoteLineRequest` block is gone with the feature) |
| `tests/quotes/public.test.ts` | same path | without the line-request, slug, logo and timeline blocks; adds decline cases |
| `tests/quotes/builder-actions.test.ts` | `tests/quotes/quote-signed-copy.test.ts` (terms race) + `quotes-access.test.ts` (idea) | retargeted; adds the header-edit race and the per-action gate sweep |
| `tests/quotes/money-and-drift.test.ts` | `quote-signed-copy.test.ts` (drift block) | new cases for money and the firm's calendar |

Not ported: payments (LawPay, `PaymentForm`, `PayPanel`, `public-payment.ts`), client line requests (0071/0073),
readable proposal slugs and `/proposal/<slug>/<token>` (0070/0074), and the `quote_accepted`/`quote_payment` timeline
rows (0062/0072). None of their schema is in lectual.app's databases.

## Firm brain
From `theipgirl/lectual` main @ `610c206`. Backed by 0024/0026 (`crm_firm_brain_entry`, `crm_claim_library`,
`crm_claim_review_log`), on both dev and prod; no migration here.

| lectual.app | From lectual | Changes |
|---|---|---|
| `src/lib/brain/{entries,claims,index}.ts` | same paths | doc-comment migration references only; role gates (`BRAIN_ADMIN_ROLES`, `CLAIM_{PROPOSE,REVIEW,DELETE}_ROLES`) and the fail-closed review log unchanged |
| `src/app/dashboard/brain/{page,actions,enums}.ts(x)`, `_components/*` | `src/app/(firm)/dashboard/brain/**` | rebuilt on `lx-*` instead of the `rpb-*` components; same data flow and gates; grouped by category/status (no `BrainSearchShell` filter); a failed read says so instead of an empty list |
| `tests/brain/brain.test.ts`, `tests/brain-ui/brain-page.test.ts` | same paths | pure and mocked blocks only; the DB-backed RLS block stays in lectual's isolation suite |

Not ported: `src/lib/brain/rpb-seed.ts` (one firm's content).

## AI copilot
From `theipgirl/lectual` main @ `610c206`.

| lectual.app | From lectual | Changes |
|---|---|---|
| `src/lib/agents/matters-chat.ts` | same path | the `ai` SDK tool loop is rebuilt on `callClaudeWithTools` (new in `src/lib/ai/claude.ts`); same read-only tools over `@/lib/matters`/`@/lib/pipeline` (scoped client), same UPL guardrails and mechanically collected citations; adds `list_stalled_matters`, real totals with a `truncated` flag, and `readFailed` so a failed read is never an empty answer (**lectual should take the honest-read fix**) |
| `src/app/api/matters-chat/route.ts` | same path | gated by `resolveFirmSession` (403 with no firm) |
| `src/components/copilot/CopilotChat.tsx`, `src/app/dashboard/copilot/page.tsx` | `src/components/firm/MattersCopilotBox.tsx` | a page of its own instead of the home-page box; says when no AI provider is configured |
| `tests/agents/{matters-chat,matters-chat-route,copilot-page}.test.ts` | `tests/agents/matters-chat*.test.ts` | retargeted at the new primitive and route gate |

## Campaigns
New in this repo over the already-ported `src/lib/automation/drips.ts` (0022's `crm_drip_*` and
`crm_email_template`, on both dev and prod). The "New campaign" form follows lectual's
`src/app/(firm)/dashboard/automation/_components/NewSequenceForm.tsx` and `createSequenceAction`, re-skinned;
the step builder, enrollments, templates page and "Run next step" have no lectual counterpart.

| lectual.app | From lectual | Changes |
|---|---|---|
| `src/lib/automation/drips.ts` | same path | adds `getSequence`, `updateSequenceDetails`, `toggleSequenceActive`, `deleteStep` (lectual's automation page never edits or pauses a sequence) |
| `src/lib/campaigns/{steps,advance}.ts`, `src/app/dashboard/campaigns/**` | — | new. There is no cron: a step runs only when staff click "Run next step". An email step only ever calls `createDraft` (the approval queue); a step is claimed with a compare-and-set before any side effect; a paused campaign runs nothing; condition steps have no branch target in this schema and are a no-op |

## Report views, Intake forms
New in this repo, nothing ported. Reports (`src/lib/reports/*`, `src/app/dashboard/reports/**`) compose the
existing ported readers. Intake forms (`src/lib/intake-forms/*`, `src/app/dashboard/forms/**`, `src/app/i/**`,
`src/app/r/**`, `public/embed.js`, the frame-ancestors policy in `src/proxy.ts`) read lectual's 0075 tables, which
are on dev only until 0075 merges in lectual and is applied to prod.
