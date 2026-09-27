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
| `src/lib/env.ts` | same path | trimmed to vars this app reads; adds mailbox OAuth, token key, cron secret |
| `src/lib/site-origin.ts`, `src/lib/legal/disclaimer.ts` | same paths | none |
| `src/proxy.ts`, `src/app/auth/callback/route.ts`, `src/app/sign-in/actions.ts` | same paths | none |
| `src/app/sign-in/{page,LoginForm}.tsx` | same paths | restyled to the Lectual design; logic unchanged |
| `tests/roles.test.ts`, `tests/queue/{queue-load,create-draft}.test.ts` | same paths | roles test checks `QUEUE_APPROVE_ROLES` instead of Firm Brain's `CLAIM_REVIEW_ROLES`; the `queueUnavailableCopy` block now lives in `tests/queue/queue-unavailable.test.ts` (step 6) |
| `src/lib/intake/{email-match,email-threads,initials}.ts`, `src/lib/matters/tracker-import.ts` | same paths | none (pure modules) |
| `tests/intake/email-match.test.ts`, `tests/fixtures/intake/{mail-threads.json,README.md}` | same paths | none |
| `src/lib/mailbox/apply.ts` (write half) | `scripts/sync-intake-email.ts` `applyEvidence()` | same rules (dedupe on message_id, advance-only timestamps, placeholder-only address recovery, one bell per reply); adds matter rows, source `mailbox-sync`, returns counts instead of logging |
| `src/app/dashboard/queue/**`, `src/components/queue/*` | `src/app/(firm)/dashboard/queue/**` | logic and role gates unchanged; re-skinned; approve adds a draft in the approver's own mailbox when the queue has no send channel; Document Center post-approve hook ported with the generators |
| `src/lib/{pipeline,matters,automation,members,mentions,notifications,time}/**` | same paths | none — copied as the import closure of `@/lib/pipeline` and `@/lib/matters` |
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
| `src/lib/quotes/index.ts` | same path | none |
| `src/lib/quotes/pricing.ts` | same path | a `tier_group` is a PACKAGE chosen whole (exactly one package, all of its lines; new `tier_group_partial`), not "one line per group, every group answered"; exports `chargeBucket`. Totals unchanged (still the sum of selected lines) |
| `src/lib/quotes/engagement-terms.ts` | same path | states each offered package's two figures and the add-ons; withheld lines left out. A quote without packages or add-ons gets the same text as before |
| `src/lib/quotes/status.ts` | same path | firm-zone helpers come from `./firm-time` (this app's `calendar-rows.ts` has no `FIRM_TIME_ZONE`/`firmCivilDate`) |
| `src/lib/quotes/types.ts` | same path | drops `crm_payment`, `crm_org_payment_account`, `crm_quote_line_request` and `public_slug` |
| `src/lib/quotes/store.ts` | same path | no `public_slug` (0070), no line-request promotion (0071/0073), no manual payments; adds `updateQuoteDetails` (status-pinned, zero rows = lost race), the package/add-on operations (offer switch, rename, duplicate, remove, placed adds) and a Send gate on offers that can't be signed |
| `src/lib/quotes/load.ts` | same path | no line-request loader; list ordered by `updated_at`; adds `loadLinesForQuotes` (one `.in()` read for list totals) |
| `src/lib/quotes/service-library.ts` | same path | none |
| `src/lib/quotes/public.ts` | same path | reads `/q/<token>` only (no slug column, no retry), firm name only (no `crm_org_theme` logo), no line requests, no `quote_accepted` `crm_activity` write (0062's enum value; `crm_quote_event` records it); snapshot version 1 (no `line_requests`); adds `declinePublicQuote` (same conditional-update shape as accept). For the package builder: publishes only the OFFER (withheld lines never leave the server), removes `applyPublicSelection`/`saveSelectionAction` (the pick travels with the signature, so no refusal writes anything and the accept path reads the lines once), email optional, writes the client's choice back to `selected` after the winning update, then runs the matter auto-open |
| `src/lib/auth/current-role.ts` | same path | none |
| `src/lib/quotes/drift.ts` | `describeLineDrift` in `quotes/[id]/_components/LinesEditor.tsx` | moved to a pure module; `selected` is not compared and withheld lines are not "added after signing" (the offer model) |
| `src/lib/quotes/{money,labels}.ts` | the per-slice `money.ts` / `line-fields.ts` / `field-meta.ts` / `quote-meta.ts` copies | one copy; `parseDollarsToCents` also accepts a leading `$` |
| `src/lib/quotes/firm-time.ts` | `FIRM_TIME_ZONE`/`firmCivilDate` from `src/lib/matters/calendar-rows.ts` | adds `endOfFirmDay` (expiry is 23:59:59 in the firm's zone; lectual stored 23:59:59 UTC) |
| `src/lib/quotes/clients.ts` | — | new: client names for the list/builder, the "New quote" picker (leads, matters, contacts), and the linked matter's number |
| `src/lib/quotes/packages.ts` | — | new: the offer model for design/Quote_Builder_Prototype.dc.html — packages (`tier_group`), add-ons (`optional`), every-package lines (`included`), `selected` as the firm's offer switch until signature, the client's pick, derived blurbs |
| `src/lib/quotes/accept-matter.ts` | `ensureMatterForLead` (src/lib/matters/matters.ts), as a service-role step | new: on a winning public acceptance, opens one matter for the quote's lead (type from the PA tag, `createMatter`'s numbering, first open docket stage), links it with a `matter_id is null` conditional update, records a `revised` quote event and a `matter_opened` activity; idempotent and never fails the acceptance |
| `src/app/dashboard/quotes/{page,actions,errors}.ts(x)` | `src/app/(firm)/dashboard/quotes/{page,actions}.tsx` | same attorney+ gate on page and action; adds client and total columns; errors through `friendlyQuoteError` (lectual put raw PostgREST text on screen); the refusal copy names attorneys too |
| `src/app/dashboard/quotes/[id]/{page,actions}.ts(x)` | `src/app/(firm)/dashboard/quotes/[id]/*` | same gates, terms race guard and snapshot-first rendering; no payments or line-request panels; client link is `/q/<token>/`; adds `updateDetailsAction`. The builder is the uploaded design's (`QuoteBuilder.tsx`, `quotes.css`), with package/add-on actions; the per-line full edit form and reorder are gone |
| `src/components/quotes/*` | `quotes/[id]/_components/*`, `quotes/_components/*`, `settings/service-library/_components/*` | re-skinned to `lx-*`; `QuoteBuilder.tsx` is new (the design's builder) |
| `src/app/dashboard/settings/services/*` | `src/app/(firm)/dashboard/settings/service-library/*` | Settings tab; attorneys can read it; a discount item is stored negative (lectual's action stored the magnitude, which its own CHECK refused) |
| `src/app/q/[token]/*`, `src/components/proposal/*` | `src/app/q/[token]/*`, `src/app/proposal/_components/*` | one route, no `/proposal/<slug>/` twin, no PayPanel; adds Decline; UPL footer from `NOT_A_LAW_FIRM_DISCLAIMER`. Redesigned to the uploaded design (`q.css`): package cards, add-on checkboxes, typed-name signature, one locked page for unknown/draft/expired/withdrawn links, a frozen signed copy with a print stylesheet ("Download or print signed copy" opens the print dialog — no PDF library) |
| `tests/quotes/{pricing,status,engagement-terms}.test.ts` | same paths | none |
| `tests/quotes/store.test.ts` | same path | pure blocks only (the `promoteLineRequest` block is gone with the feature) |
| `tests/quotes/public.test.ts` | same path | without the line-request, slug, logo and timeline blocks; adds decline cases; the fake PostgREST moved to `tests/quotes/fake-db.ts`; selection-persistence cases replaced by offer/pick cases, "no refusal writes anything", write-back and matter auto-open cases. New: `tests/quotes/{packages,accept-matter}.test.ts` |
| `tests/quotes/builder-actions.test.ts` | `tests/quotes/quote-signed-copy.test.ts` (terms race) + `quotes-access.test.ts` (idea) | retargeted; adds the header-edit race and the per-action gate sweep |
| `tests/quotes/money-and-drift.test.ts` | `quote-signed-copy.test.ts` (drift block) | new cases for money and the firm's calendar |

**lectual should know:** its unmerged quote branch reads `tier_group` as "one line per group" and `selected` as the
client's live pick. Quotes built by this app's builder use packages chosen whole and `selected` as the firm's offer
until signature (see `src/lib/quotes/packages.ts`); after acceptance the rows carry the client's choice again.

Not ported: payments (LawPay, `PaymentForm`, `PayPanel`, `public-payment.ts`), client line requests (0071/0073),
readable proposal slugs and `/proposal/<slug>/<token>` (0070/0074), and the `quote_accepted`/`quote_payment` timeline
rows (0062/0072). None of their schema is in lectual.app's databases.
