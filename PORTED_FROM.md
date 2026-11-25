# Ported from `theipgirl/lectual`

Source commit: `610c206` (main, 2026-09-25). Copy, don't import: when a ported file changes in
`lectual`, re-port it here and bump the commit above.

| lectual.app | From lectual | Changes |
|---|---|---|
| `src/lib/db/{admin,scoped-client}.ts` | same paths | none |
| `src/lib/db/types.ts` | same path | copied after lectual's 0075/0076 commit; the three new tables were hand-added there until dev is unpaused and types can be regenerated |
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
| `src/lib/matters/matters.ts` (`ensureMatterForLead`) | same path | lectual.app only: also selects the lead's `mark_text` and carries the lead's REVIEWED consult details (mark, filing basis, classes, goods/services) onto the new matter via `@/lib/consult/store`. lectual has no Consult details card or `notes.consult_details`, so it needs no matching change |
| `src/app/dashboard/leads/{actions,errors}.ts` | `src/app/(firm)/dashboard/pipeline/{actions,errors}.ts` | paths only |
| `src/app/dashboard/leads/[id]/actions.ts` | `src/app/(firm)/dashboard/leads/[id]/actions.ts` | role gate, assign, move stage, edit, note, tags, prep-consult and voice notes unchanged; founder link not ported; adds `reviewProposalAction` |
| `tests/pipeline/*`, `tests/matters/*`, `tests/mentions/*`, `tests/time/*` | same paths | `lead-actions.test.ts` retargeted at the new action paths |
| `src/lib/matters/board.ts` | same path | none (pure; kept for a board view) |
| `src/app/dashboard/matters/{list-utils,labels}.ts` | `src/app/(firm)/dashboard/matters/_components/{list-utils,labels}.ts` | list-utils none; labels drops `MATTER_TYPE_TONE` |
| `src/app/dashboard/matters/[id]/actions.ts` | `src/app/(firm)/dashboard/matters/[id]/actions.ts` + `team-status/actions.ts` (`assignMatterOwnerAction`) | validation and role gates unchanged; errors go through `friendlyMatterError` so no raw database message reaches the screen (**lectual should take this fix**); litigation, voice notes, welcome email and filing follow-up not yet ported |
| `tests/matters/{list-utils,actions}.test.ts` | `tests/matters/matters-page.test.ts` (pure list-utils and mocked role-gating blocks) | retargeted; adds owner, stage-error and LIT-gate cases |
| `src/app/dashboard/calendar/page.tsx` | `src/app/(firm)/dashboard/calendar/page.tsx` | same sources, merge and grouping; re-skinned; marks unconfirmed docket dates |
| `src/app/dashboard/page.tsx` (Today) | `src/app/(firm)/dashboard/page.tsx` (ops home) | same independent reads and "a failed read is never a zero" rule; priority weighting kept (`src/lib/today/priorities.ts`), with stalled matters and unclaimed hot leads in place of stalled leads; the list is now "Needs you" (`src/lib/today/needs-you.ts`, a superset: quotes, payments, reconnects, agent failures, intake review); reports and the matters copilot not ported |
| `src/app/dashboard/documents/**` | reads `crm_document_draft` (0045) | new list over Document Center's table; the per-firm generators (`document-center/[matterId]/*`, `src/lib/documents/*`) are not ported |
| `src/lib/lawmatics/{client,jsonapi,normalize,import-plan,stage-map,matters-normalize,matters-import-plan}.ts`, `src/lib/intake/referral-source.ts` | same paths | none |
| `src/lib/lawmatics/{import,matters-import}.ts` | same paths | the client comes from the calling firm's own token (`connection.ts`, lectual 0077) instead of `LAWMATICS_TOKEN`; the env readers and `connectionStatus` are gone |
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
| `src/lib/documents/loe.ts`, `src/app/dashboard/documents/new/[matterId]/loe/**` | `src/lib/documents/loe.ts`, `.../document-center/[matterId]/loe/**` | **diverges after the port.** `loe.ts` gains optional `govFeesText` and `signedQuote` on both inputs (a letter names the signed quote it came from and prints where it departs from it; output is unchanged without them). The form, page and action open pre-filled from a signed quote's frozen snapshot. New here with no lectual counterpart: `src/lib/documents/loe-prefill.ts`, `loe-prefill-load.ts` (lectual has the quote engine only on its unmerged branch; take these across when it merges). The form also no longer says "default for new clients" beside the Current template, and submits through a transition so an error does not clear the fields: **lectual's LoeForm wants both** |
| queue approve → `generateApprovedDocument` | `src/app/(firm)/dashboard/queue/actions.ts` | same best-effort post-approve hook |
| `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `pnpm-workspace.yaml` | same paths | lint ignores `design/` |
| `src/lib/assessment-card/{questions,ip-questions,score,ip-score}.ts` | `src/lib/booth/` same names, lectual main @ `ff2def9` (2026-10-20) | none: the booth card's questions, points and hot/warm/cold rules, verbatim, so an intake assessment scores exactly like the booth |
| `src/lib/assessment-card/variants.ts` | `src/lib/booth/variants.ts` | drops the event codes and the Urban-Golf/Story2Profit date switch: here the event IS the intake, and its source tag is the Lawmatics tag |
| `src/lib/lawmatics/contact-payload.ts` | same path | none (pure request shapes; records which Lawmatics endpoints the live API accepted) |
| `src/lib/lawmatics/writes.ts` | `src/lib/lawmatics/contacts.ts` (create, tag, update) | the FIRM's token is an argument (lectual 0077) instead of LAWMATICS_TOKEN; custom-field sync not ported |
| `eslint-rules/no-glued-jsx-text.mjs`, `tests/lint/no-glued-jsx-text.test.ts`, its block in `eslint.config.mjs` | same paths, from lectual `claude/hopeful-rubin-bxyv3y` @ `d1ffdc9` (2026-10-19, not on lectual main yet) | the rule is unchanged; the test's comments drop lectual's `(funnel)` lint ignore, which this app doesn't have |
| `src/lib/intake/sheet-import.ts` | same path (lectual main @ `0c65dca`) | one change: `parseIntakeRow` also reads the owner from a `Client Name` column (the workbook's second intake layout); this needs the same one-line change in lectual. `parseIntakeSheet`, `parseIntakeRow`, `sheetKeyFor`, `splitOwnerName`, `touchDirectionOf`, `touchTimestampsFrom`, `assignedInitialsOf` and their types are copied with the logic unchanged; only a header comment is new. `splitNoteEntries`, `stageCodeOf` and `sourceHash` are the earlier port in `src/lib/matters/tracker-import.ts` and are imported, not copied again. Used by the stage reconciliation screen, which reads the sheet as CSV (no `xlsx` here) |
| `src/lib/intake/sheet-records.ts` | `src/lib/matters/tracker-import-plan.ts` (`recordsFromSheetRows` and its `headerKey` helper only) | none; the tracker import plan half of that file is not ported |

New in this repo: `src/lib/proposals/*` (client trademark proposals, lectual 0089 `client_proposal`; modelled on `src/lib/quotes/*` but not the quote engine), Settings → Firm profile (`src/lib/org/profile*.ts`, lectual 0078) and Modules, `src/lib/lawmatics/connection.ts` and the Lawmatics import UI (`src/components/lawmatics/*`), `src/lib/matters/worklist.ts` (the design's whose-move-is-it bands), `src/lib/mailbox/*` (except the apply port above), `src/lib/nav.ts`, `src/lib/fonts`, `src/components/shell/*`, `src/app/dashboard/*`,
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
`src/app/r/**`, `public/embed.js`, the frame-ancestors policy in `src/proxy.ts`) read lectual's 0079 tables, which
are on dev only until 0079 merges in lectual and is applied to prod.

## LawPay payments (per-firm OAuth)
From `theipgirl/lectual` branch `claude/lectual-firm-dashboard-prd-f3loev` @ `0f13772` (unmerged; the payments
files were last changed there in `e046999`), quote-engine payments per spec `docs/specs/2026-09-09-quote-engine.md`
§0, §5, §7, §7.4 and `docs/research/2026-09-09-lawpay-cosmolex.md`. Reuses 0068's `crm_payment` and
`crm_org_payment_account` (on dev and prod); the unapplied 0072_quote_payment_guard is replaced by 0080. Needs lectual 0080
(`lawpay_connection` + signing-charge guards; lectual commits `c2a9e26` and `ffc6728`). Setup and the lectual-side
change list: `docs/lawpay-setup.md`.

| lectual.app | From lectual | Changes |
|---|---|---|
| `src/lib/payments/types.ts` | same path | no `lawpay` module constant and no CosmoLex adapter; `credentialRejected` on a 401/403 |
| `src/lib/payments/lawpay.ts` | same path | built from ONE firm's account secret key (from its own connection), never `LAWPAY_SECRET_KEY`; `lawPayFromEnv`/module gate removed; request, statuses and failure split unchanged (5xx/429 stay `unknown`) |
| `src/lib/payments/registry.ts` | same path | takes the firm's charge client instead of a module list; a 23505 at the pending insert is `already_open`; a refusal before sending closes the row `failed` instead of leaving it pending forever; the echoed account id is flagged, not written over the mapped one (**lectual should take both fixes**) |
| `src/lib/payments/accounts.ts` | same path | LawPay mappings only; adds `mapLawPayAccount` / `unmapLawPayAccount` (explicit kind + confirmation) |
| `src/lib/payments/hosted-fields.ts` | same path | unchanged; the public key is the firm's own operating account's |
| `src/lib/quotes/public-payment.ts`, `src/components/proposal/PayPanel.tsx` | `src/lib/quotes/public-payment.ts`, `src/app/q/[token]/_components/PayPanel.tsx` | five states (received / confirming / payable / manual / unavailable) from a pure machine in `src/lib/payments/payment-state.ts`; only a 401/403 on the firm's key pauses the firm's card payments (any other refusal is about one visitor's token and must not); 5 failed attempts per quote, then no form (card testing); the recomputed amount must equal the snapshot's frozen `due_at_signing`; trust flag and mode checked against the sealed gateway credentials (**lectual should take all four**) |
| `src/components/proposal/Receipt.tsx`, `src/app/q/[token]/{page,actions}.ts(x)` | `src/app/q/[token]/_components/Receipt.tsx`, `src/app/q/[token]/{page,actions}.ts(x)` | receipt shows the payment state beside the signature (separate steps; a decline never costs the signature); `payQuoteAction` computes the amount server-side from `accepted_snapshot` only |
| `src/lib/payments/lawpay-{oauth,state,config,connection,accounts}.ts`, `src/app/api/lawpay/**`, `src/app/dashboard/settings/integrations/lawpay/**`, `src/lib/payments/{manual,quote-payments,payment-state,pay-messages}.ts`, `src/components/quotes/PaymentsPanel.tsx` | — | new |

Runbook (`docs/runbooks/publish-proposal-links.md`) Step 5 defects: #2 (manual rendered as card; partial manual
read as settled) fixed in `payment-state.ts`; #4 (pre-signature "nothing is charged" depending on an unpicked
package) fixed by answering from the firm's setup only (`firmTakesCardPayments`); #5 (5xx/429 as decline) kept
fixed in `lawpay.ts`; #1 and #3 concern client line requests (0071/0073), which this app does not have.

**lectual needs the same fix (Nov 23):** `src/lib/settings/members.ts` `removeMember` and `src/lib/settings/admin.ts` `setMemberRole` now require the caller's own OWNER `crm_org_member` row (`assertCallerIsOwnerMember`) before touching an owner row, checked before `revoke_member_sessions`; lectual's copies still trust the owner role claim alone.

## Ported from `lawmatics-mcp`

Source commit: `73355ec`. Copy, don't import: lawmatics-mcp is a separate deployment.

| lectual.app | From lawmatics-mcp | Changes |
|---|---|---|
| `src/lib/inbox/triage.ts` | `src/triage.ts` | bucket order, labels and rule order unchanged. Three deliberate changes: (a) the firm's own domains come from its connected mailbox addresses (`firmDomainsOf`), not the `FIRM_DOMAINS` environment variable; (b) `assignTo` is a role label (Attorney, Intake, Filings, Partnerships, Discovery calls), not a named RPB teammate, because the agent runs for every firm and one firm's staff names must not appear in another's digest; (c) the six sensitive phrases are the app's own `SENSITIVE_PHRASES` (`src/lib/intake/email-match.ts`), not a second copy, so the reason quotes the first matching phrase in this order. Reasons and labels also drop the source's em dashes. |
| `src/lib/consult-prep/lawmatics-intake.ts` | lawmatics-mcp `src/consult-brief/facts.ts` (commit e738c24's tree, 2026-11) | the tolerant intake-label patterns (`INTAKE_PATTERNS`, `mapIntake`, `sanitizeText`), the custom-field pair reader and the "all fields first, then a plain read" prospect fetch, over lectual.app's read-only per-firm `LawmaticsClient` (`get`/`listAll`) instead of lawmatics-mcp's `ReadOnlyLawmatics`; adds the patterns for competitors, goals and consult fee paid, a `/custom_fields` name lookup for id-keyed values, and three states instead of throws; nothing logged. The USPTO knockout, the model judgment and the packages PDF are NOT ported (S2). |
| `src/lib/pipeline/{leads,move-as}.ts` | `src/lib/pipeline/leads.ts` (lectual) | lectual.app only: after a stage move that landed, both call `scheduleConsultPrepOnEntry` (`src/lib/consult-prep/hook.ts`, inside try/catch) so a lead entering the consult stage is prepped. lectual has no consult prep assistant, so it needs no matching change. |
| `src/lib/consult-prep/uspto/{uspto,uspto-summary}.ts` | lawmatics-mcp `src/consult-brief/{uspto,uspto-summary}.ts` (commit 3bcbe3f, 2026-11) | behaviour unchanged: two tiers, 20 s per-request deadline, all-or-nothing `unavailable`, summary prose. The CSV and zip are NOT ported: `xlsx.ts` (new, not a port) rebuilds the USPTO site's own "Export, First 500 results" workbook `tmSearchResults<date>.xlsx` instead (owner's decision, Nov 25), with `exceljs` pinned exactly. One change: `UsptoInput.fetch` is REQUIRED (the source fell back to the global `fetch`), so a caller always injects the transport. No env reads, nothing logged. S2b P1; not yet wired into the engine.
| `tests/consult-prep/uspto/{uspto,uspto-summary}.test.ts`, `uspto-fixtures.ts` | the same-named `*.test.ts` and `uspto-fixtures.ts` (`xlsx.test.ts` is new) | imports retargeted to `@/lib/consult-prep/uspto/*`; no other change |

| `src/lib/consult-prep/judge/scrub.ts` | `src/consult-brief/scrub.ts` (commit 3bcbe3f) | currency scrubbers and the sentence backstop are verbatim. Package-name scrubbing takes the FIRM'S own names (`makeScrubber(nonFiling, names)`, `scrubPackageNames(text, names)`), not the three RPB tier words: a name matches in any case when a "package / tier / plan" word follows it, and as written or in ALL CAPS otherwise (the source also removed lower-case "enhanced" and "concierge" anywhere; that is dropped because a firm's names are not known to be non-English words). |
| `src/lib/consult-prep/judge/schemas.ts` | `src/consult-brief/ai/schemas.ts` (3bcbe3f) | zod 4 from the repo's `zod`; the package `tier` enum (ESSENTIAL / ENHANCED / CONCIERGE) becomes `choice`, a NAME from the firm's list or HELD or NONE, so the judgment schema is built per firm (`makeJudgmentSchema(names)`). No price field, as before. |
| `src/lib/consult-prep/judge/prompt.ts` | `src/consult-brief/ai/prompt.ts` (3bcbe3f) | the skill's rules unchanged except: no firm or attorney name (the firm's name is passed in; "Rebecca" is "the attorney"; "RPB is in Florida" is "the firm's home state"); the three RPB tiers and their benefit lists are replaced by the firm's own package list (names and included classes, never a price); `AGENT_POLICY` leads each system prompt; record data is made inert with `neutralise` (`‹ ›`) instead of replacing `<` `>` with spaces; the version string is new. |
| `src/lib/consult-prep/judge/judge.ts` | `src/consult-brief/ai/judge.ts` (3bcbe3f) | grounding, trimming and the cross-field checks are verbatim over `JudgeFacts` (plain strings) instead of `ConsultFacts`. The model is the injected `llm` (the shape of `ctx.llm`, agent "consult-prep"), not the Anthropic SDK; failures are typed (`timeout`, `error`, `invalid`, `refused`, `truncated`, `budget`), told apart by error NAME so the SDK is never imported; the 60 s / 90 s timeout race is kept; an already-aborted signal makes no call (`budget`); the answer is re-validated against the zod schema and the choice must be on the firm's list. |
| `src/lib/consult-prep/judge/pricing.ts` | `src/consult-brief/pricing.ts` (3bcbe3f) | the block's wording is unchanged; every amount is read from the firm's package list in cents (`normalisePackages`), the package is found by name, and the consult credit and its date are per-firm inputs (no credit line without one). `finalizeJudgment` is new: it scrubs every model-written string once (this was done inside `compose.ts` in the source). |
| `src/lib/consult-prep/judge/facts.ts` | `src/consult-brief/facts.ts` `ConsultFacts` (3bcbe3f), shape only | `JudgeFacts` is new and plain; `judgeFactsFromBrief` maps this app's brief facts onto it. The client's address is never in it. |
| `src/lib/consult-prep/pdf/{spec,render,canvas,fonts,palette}.ts` | `src/consult-brief/pdf/{spec,render,canvas,fonts,palette}.ts` | Sprint 2b P3, the packages PDF. Layout, sizes, palette, spec rules (class numbers refused, placeholders refused, one-company-absent eyebrow, filename, `content_overflow`) and the expiry rule (counted from the day after the consult, on the consult's local day) are unchanged. Per firm: the firm (name, time zone, `normalisePackages` list, expiry days, slug) is passed in; `FIRM_CONFIG`, `config.ts` prices and `facts.ts` imports are gone. The page shows the passed-in packages (1 to 4 columns, was a fixed 3) and every price, class count, additional-class fee and USPTO fee comes from that list in cents (`formatUsd` takes cents; no consult-credit field, it was never drawn). Colours stay the one palette in `palette.ts`. Errors gain `missing_firm`, `no_packages`, `too_many_packages`, `invalid_expiry`, `invalid_time_zone`, and `PACKAGES_SPEC_ERROR_REASONS` (moved from `attachments.ts`). PDF producer and font path renamed. |
| `src/lib/consult-prep/pdf/art.ts`, `rpb-package-template.json` | `pdf/package-template.json`, the `RPB` strings in `pdf/render.ts` and `spec.ts` | the firm's benefit rows, wordmark ("RPB LAW FIRM" / "EST 2024"), footer line, title name and author now live in ONE per-firm map (`packagesArtForSlug`, same signal as `letter-logo.ts`: slug `rpb-law`). A firm with no entry gets the plain version: its own name as wordmark and footer, and a table of classes, price and additional-class fee only. The art's cells for those three rows are compared with the list and a disagreement throws `template_config_mismatch`. |
| `src/lib/consult-prep/pdf/assets/fonts/*` | `src/consult-brief/pdf/assets/fonts/*` | the nine Playfair Display and Source Serif 4 TTFs, `OFL.txt` and the README, byte for byte (README paths only). Read with `fs`; `next.config.ts` traces them for `/api/cron/agents`, `/api/cron/lawmatics-matters` and `/dashboard/leads/*`. |
| `tests/consult-prep/pdf/*` | `src/consult-brief/pdf/{spec,render,fonts,fixture}.test.ts`, `pdf-inspect.ts`, `fixtures.ts` | build a PDF from fixtures and read it back; fixtures now carry an RPB package list (with art) and a second, plain firm; new per-firm cases (plain firm renders with none of RPB's words, 1 to 4 packages, long firm name, art/list mismatch, expiry in the firm's zone). |
