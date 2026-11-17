# Sprint 5: Signed and paid opens everything

**Size:** large (the Adobe part alone is about two of the design note's sprints, so it runs as 5a and 5b). **Starts:** after Sprint 4 and the design rollout. **Schema:** lectual 0113, plus 0106 on production, which is **NOT approved yet** (Taylor, Nov 17: T1 is to be asked directly; 0103 is already on prod). **Evaluator: STRICT.**

Design input: `docs/pge/2026-11-17-agentic-ip-os/adobe-sign-design.md` (B3). This contract follows that note for everything Adobe (connection, agreement creation, embedded signing, webhook re-read, completion function, files). Where the note and this contract disagree, stop and ask; do not pick. The note calls its migration "0108"; in this plan's sprint order it is **0113**.

## Goal
After a consult, Rebecca approves ONE card and the rest happens without anyone chasing it: the client gets (from Rayn's Outlook, sent by Rayn) the proposal with its engagement letter and the firm's pay link; the client accepts, signs (Adobe Sign when the firm connected it, else the in-app signature), then pays; and when the proposal is **signed and paid** (decision 11: that is "hired") Lectual opens the matter, moves the lead to won, drafts the welcome email and queues the questionnaire, each draft for approval.

## Scope
**In**
1. **One card.** The post-consult approval card (kind `post_consult_email`, attorney-only) shows the proposal (client, brand names, packages, fees from `quoteProposal`), the attached engagement letter (title, version, "current" / "changed since"), the pay link and the client email. One Yes:
   - saves and turns on the proposal link through the existing one path (`runCreateLink` → approve → `sendProposal`, with `letterLiveCheck`);
   - approves the email, which then follows Sprint 4 (the draft passes to Rayn).
   - If the link step is refused (letter changed, pending letter check, no pay link, validation), the email is NOT approved and the card says why. Never one without the other.
2. **The invoice is the pay link (Taylor, Nov 17, T4).** "The invoice goes out with the proposal" means the firm's custom Lawmatics pay link on the proposal (`pay_url`, entered by a person; it starts empty). **Lectual creates no invoice**, in Lawmatics or anywhere. The card refuses Yes without a pay link ("Add the pay link before approving.", as today).
3. **The email** states the last day (Sprint 7, if it lands first; either sprint may add the slot) and carries the proposal link. It does not repeat the fee total (decision 10).
4. **Adobe Sign (5a and 5b), Rebecca's own account (Taylor, Nov 17, T3).** Per firm, OAuth, sealed tokens, like LawPay and Zoom; no deployment-wide key. Per the design note:
   - when the client presses Sign on `/p/<token>`, the server builds the agreement exactly as 0106 does (stored letter, cleaned details, recomputed exhibit, the same canonical fingerprint), renders it with `src/lib/loe/pdf.ts`, and creates a ONE-signer agreement for the client only, with Adobe's emails switched off;
   - the client signs in Adobe's signing page reached from our page (embedded);
   - "signed" comes from Adobe: a webhook is only a hint, so the agreement is re-read; a return check and a daily sweep are the fallbacks; one database function (`client_proposal_adobe_complete`) makes signed + accepted a single idempotent step;
   - Adobe's signed PDF and audit report are stored as files; `client_proposal_signature` carries the Adobe agreement id; `signed_loe_upload` files Adobe's signed PDF in Lawmatics.
5. **Fallback.** Not connected, `reauth`, `revoked`, or a failure at creation → the existing in-app signature (0106), unchanged. A firm is never left with no way to sign. An open Adobe request refuses the in-app path for that version (the note's rule), so one version is never signed twice.
6. **Pay.** After signing: the firm's pay link (Lawmatics), or LawPay where the firm uses it (amount only from the signed snapshot, `signingChargeForQuote`). "Paid" is the existing paid state: LawPay received, or "Mark paid" after the payment is confirmed in Lawmatics (decision 4).
7. **Signed and paid → hired chain** (`src/lib/hired/chain.ts`, dependencies injected, once per proposal version and round), triggered by whichever of "signed" / "paid" comes second; both are re-read from their sources first:
   - open the matter (TM, from the accepted snapshot; reuse the hired-matter sync's matter builder and its dedupe: an existing matter for the lead and mark is linked, never duplicated); log `matter_opened` with `source: "signed-and-paid"`;
   - **move the lead to won** (exception below);
   - draft the welcome email to the queue as `welcome_email`, using **the welcome email in the trademarks@ mailbox, as it stands** (Taylor, Nov 17, R8). Caitlyn or Taylor pastes its text into the firm's template setting; **it is never invented or rewritten**. Until it is pasted, the chain records the welcome step as `blocked` ("The welcome email text isn't saved yet.") and drafts nothing;
   - queue the questionnaire request (`crm_intake_request` on the firm's main intake) as a draft for approval. Whether the questionnaire stays as it is remains open (R8); until answered, the current one is used unchanged;
   - each step is a timeline step event with an outcome (the Sprint 19 vocabulary), retried on the next run, never repeated after success.
8. **The second won exception (Taylor, Nov 17, T5).** AGENTS.md allows exactly one path into a `won` stage (the hired-matter sync). This sprint adds a SECOND, deliberate, equally narrow one, and nothing else may copy it:
   - **Evidence:** a signature recorded for the version (a `client_proposal_signature` row, in-app or Adobe) AND paid marked for the current round (`paidStateFromEvents` = paid, or a LawPay payment `received`). A read that fails or is "confirming" is not evidence.
   - **The lead:** the proposal's own lead (followed to its keeper if merged), and only while it is in an `open` stage now (never out of `won` / `lost` / `nurture`, never backwards).
   - **Target:** the same rule as the hired sync (`wonTargetStage`: the `won` stage named like "signed loe" / "deposit received", else the lowest-ordered `won` stage); no `won` stage = no move.
   - **The write:** `crm_lead` updated conditional on `current_stage_id = <from>` (a person's move in between wins), `stage_entered_at` and `last_activity_at` set to now, and ONE `stage_changed` row (`actor_type system`, payload `from_stage`, `from_stage_id`, `to_stage`, `to_stage_id`, `actor: "signed-and-paid"`, `reason`). A row that can't be written puts the lead back.
   - **No automation rule run, and no matter handoff** beyond what the chain itself already did (the matter is opened by step 7, before the move). Counted (`leadsMoved` / `leadMovesFailed`); never fails the chain or undoes the matter.
   - AGENTS.md gets a paragraph naming this exception beside the hired-sync one.
9. **0106 to production** only after Taylor's direct OK (T1), verified there as it was on dev. Until then this sprint runs on lectual-dev only.

**Out**
- Any send (Rayn sends). A second signer (only the client signs). Creating, editing or marking any invoice. Writing the welcome email's text. Changing prices or `pricing.ts`. Any other path into a `won` stage.

## Files likely touched
- Card: `src/lib/queue/review-core.ts`, `src/lib/proposal-editor/create-link.ts`, `src/lib/consult-proposal/manual-email.ts`, `run.ts`, `src/app/dashboard/queue/**`, `src/components/deck/`.
- Adobe (per the design note): `src/lib/esign/**` (connection, OAuth, host rule, payload builder, webhook, sweep), `src/app/api/esign/**` routes, Settings → Integrations card (`IntegrationRow`), `src/lib/loe/pdf.ts` (`for-signature` mode), `src/lib/proposals/public.ts` (the sign step chooses Adobe or in-app), `src/lib/proposals/loe-signed-upload.ts` (provider switch).
- Chain: new `src/lib/hired/chain.ts` and `src/lib/hired/won-move.ts` (pure decision + conditional write), `src/lib/lawmatics/hired-sync*.ts` (share the matter builder and `wonTargetStage`), `src/lib/welcome/`, the matter intake request code, `src/lib/proposals/paid.ts` and `src/lib/payments/payment-state.ts` (read only).
- `AGENTS.md`, `next.config.ts` (webhook route), `src/lib/ui/words.ts`, `src/lib/loe/client-words.ts`, `src/lib/db/types.ts`.
- Tests: `tests/esign/` (fake fetch only, per the note's table), `tests/hired/chain.test.ts`, `tests/hired/won-move.test.ts`, `tests/queue/one-card.test.ts`, the send grep.

## Acceptance tests
1. One Yes on the card makes the link live AND approves the email; if the link is refused (including no pay link), the email stays pending and the card names the reason.
2. The card is attorney-only; Rayn's Yes is refused.
3. No code path creates an invoice (grep: no Lawmatics invoice write; no LawPay invoice call).
4. Adobe connected: the agreement has exactly ONE signer, the client's email; Adobe's notifications are off; the document's words hash to Lectual's canonical fingerprint; no firm-side signer, no auto-countersign.
5. Webhook: a wrong client id, an unknown agreement, a forged "completed" while Adobe answers OUT_FOR_SIGNATURE, or another firm's agreement writes nothing; a replay of a real completion returns the same signature id. The org comes from our own stored request row.
6. Adobe not connected / `reauth` / failing at creation: the client gets the in-app signing step; a half-created agreement is cancelled or recorded as abandoned.
7. Pay cannot start before signing (both paths). A LawPay charge amount comes only from the signed snapshot.
8. Signed but unpaid: no matter, no won move. Paid but unsigned: none either. Signed and paid: exactly one matter, one won move, one welcome step, one questionnaire draft, even if both events arrive twice or together.
9. **Won move:** a lead in `lost` / `nurture` / `won` is not moved; a lead a person moved between read and write is not moved (conditional update matched no row, counted); exactly one `stage_changed` row with `actor: "signed-and-paid"`; no `runRules` call and no matter-handoff call (spied); a firm with no `won` stage gets no move.
10. A payment read that fails or is "confirming" never counts as paid; a signature read that fails never counts as signed.
11. With no welcome text saved, the welcome step is `blocked` with its sentence and nothing is drafted; with it saved, the draft body equals the saved text with only the existing merge fields filled.
12. No step writes a deadline; no step sends; the welcome and questionnaire are queue drafts only.
13. Tests never call Adobe Sign, LawPay or Lawmatics; unset Adobe env means "not set up" and the in-app signature works.
14. Tests, lint, build; 0113's isolation cases on lectual-dev; 0106 verified on production only after T1.

## New schema: lectual 0113 (the design note's "0108")
As designed in `adobe-sign-design.md`:
- `adobe_sign_connection` (per firm; sealed token columns with no SELECT grant; admin-tier connect/disconnect through actions).
- `client_proposal_esign_request` (one open request per version; service-role written).
- New nullable columns on `client_proposal_signature`: `provider` (`lectual` / `adobe_sign`, default `lectual`), `adobe_agreement_id`, `esign_request_id`; still written only by security-definer functions.
- `client_proposal_adobe_complete` (security definer, service role only, idempotent); `client_proposal_sign_and_accept` amended to refuse while an Adobe request is open.
- Tenant-isolation: the note's section 1.4 cases, plus the completion function's refusals.
- The won move needs no schema.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Adobe connection (Settings, client page) | connected | not connected: in-app signature | client page: in-app signature; Settings: "couldn't check" |
| Signature / request status (staff card) | status | (n/a) | "Couldn't load the signature status", never "not signed" |
| Payment state | the five states | manual only | "unavailable", never "unpaid" |
| Welcome text setting | text | not saved: welcome step `blocked` | step `failed`, retried |
| Chain readiness (signed + paid) | proceed | (n/a) | do nothing; retried next run |
| Lead's stage and stage list (won move) | move or not | no `won` stage: no move | no move; counted |

## MUST NEVER HAPPEN
- A send to a client. Legal advice in any added text. A deadline written. A cross-firm read (webhook org from our own row). The service role in dashboard code. A raw error shown (Adobe or LawPay text included). A module gate failing open. **A matter opened, a won move, or a welcome drafted on signed-only or paid-only.** **A charge for any amount not from the signed snapshot.** **Any signer other than the client.** **A signature recorded whose text doesn't match the fingerprint.** **An invoice created by Lectual.** **A welcome email text written by Lectual or a model.** **A won move by any path other than the hired sync and this chain.**

## Dependencies and blockers
- **0106 on production: NOT approved yet** (T1, to be asked directly).
- **Adobe Sign access** on Rebecca's account (T3): Developer Edition, a PARTNER app, and the design note's one-day sandbox spike for its unverified items.
- Sprint 4 (approved email → Rayn's draft).
- The welcome email text pasted from the trademarks@ mailbox (R8); the questionnaire question (R8, open).

## Models and evaluator
- Generator: **Opus** for the card's one Yes, Adobe Sign (OAuth, webhook, fingerprint, completion), the chain, the won move, payments touchpoints, the migration and every client-facing word; **Sonnet** for Settings UI and the staff status card.
- Evaluator: **strict**.
