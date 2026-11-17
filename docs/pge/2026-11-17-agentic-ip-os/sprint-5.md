# Sprint 5: Signed and paid opens everything

**Size:** large. **Starts:** after Sprint 4 and the design rollout. **Schema:** lectual 0112, plus 0106 on production (owner's OK). **Evaluator: STRICT.**

Design input: `docs/pge/2026-11-17-agentic-ip-os/adobe-sign-design.md` (B3, written separately). Where that note and this contract disagree, stop and ask; do not pick.

## Goal
After a consult, Rebecca approves ONE card and the rest happens without anyone chasing it: the client gets (from Rayn's Outlook, sent by Rayn) the proposal with its engagement letter; the client accepts, signs (Adobe Sign when the firm connected it, else the in-app signature), then pays; and when the proposal is **signed and paid** (decision 11: that is "hired") Lectual opens the matter, drafts the welcome email and queues the questionnaire, each for approval.

## Scope
**In**
1. **One card.** The post-consult approval card (kind `post_consult_email`, attorney-only) shows the proposal (client, brand names, packages, fees from `quoteProposal`), the attached engagement letter (title, version, "current" / "changed since"), and the client email. One Yes:
   - saves and turns on the proposal link through the existing one path (`runCreateLink` → approve → `sendProposal`, with `letterLiveCheck`),
   - approves the email, which then follows Sprint 4 (draft passed to Rayn).
   - If the link step is refused (letter changed, pending letter check, validation), the email is NOT approved, and the card says why. Never one without the other.
2. **The email** states the last day (Sprint 7 adds this to the template if it lands first; either sprint may) and links to the proposal. It does not repeat the fee total (decision 10).
3. **Adobe Sign (when connected).** Per firm, OAuth, sealed tokens (0112), like LawPay and Zoom: each firm signs in to ITS OWN Adobe Sign; no deployment-wide key. On acceptance on `/p/<token>`, instead of the in-app signing step, Lectual creates an Adobe Sign agreement for the CLIENT ONLY (the only signer), from the letter text Lectual built and fingerprinted (`agreementFingerprint`), and shows the client the signing step. Adobe's webhook (verified, idempotent) or a poll updates `adobe_sign_agreement`. When signed: the signed PDF is fetched, its hash recorded, filed as a `crm_file` on the matter or lead, and the proposal's accepted snapshot records the Adobe agreement id and signed time.
4. **Fallback.** Not connected, revoked, or Adobe unreachable at the moment of creation → the existing in-app signature (0106) exactly as today. A firm is never left with no way to sign.
5. **Pay.** After signing, the existing pay step (the firm's LawPay, amount only from the signed snapshot via `signingChargeForQuote`; or the pay link; or "Mark paid" after payment in Lawmatics, decision 4).
6. **Signed and paid → hired chain** (`src/lib/hired/chain.ts`, deps injected, once per proposal version and round):
   - open the matter (TM, from the accepted snapshot; reuse the hired-matter sync's matter builder and its dedupe: an existing matter for the lead/mark is linked, never duplicated), log `matter_opened` with `source: "signed-and-paid"`;
   - draft the welcome email (`src/lib/welcome/generate.ts`) to the queue as `welcome_email`;
   - queue the questionnaire request (`crm_intake_request` on the firm's main intake) as a draft for approval;
   - each step is a timeline step event with an outcome (the Sprint 19 vocabulary), retried on the next run, never repeated after success.
   - Triggered by whichever of "signed" / "paid" comes second; both are re-read from their sources before anything is done.
7. **0106 to production** with the owner's OK, verified there as it was on dev.

**Out**
- Any send (Rayn sends). A second signer (only the client signs). Creating a Lawmatics invoice (see `questions.md`: what "the invoice goes out with the proposal" means). Moving the lead to a `won` stage (only the hired-matter sync may today; see `questions.md`). Changing prices or `pricing.ts`.

## Files likely touched
- Card: `src/lib/queue/review-core.ts`, `src/lib/proposal-editor/create-link.ts`, `src/lib/consult-proposal/manual-email.ts`, `run.ts`, `src/app/dashboard/queue/**`, `src/components/deck/`.
- Adobe Sign: new `src/lib/adobe-sign/{oauth,connection,agreements,webhook,pdf}.ts`, `src/app/api/adobe-sign/{connect,callback,webhook}/route.ts`, Settings → Integrations card (`IntegrationRow`), `src/lib/setup/checklist.ts` item.
- Client page: `src/app/p/**`, `src/components/client-proposal/` (the sign step chooses Adobe or in-app), `src/lib/proposals/public.ts` (`signAndAccept` stays for the fallback).
- Chain: new `src/lib/hired/chain.ts`, `src/lib/lawmatics/hired-sync*.ts` (share the matter builder), `src/lib/welcome/`, `src/lib/matters/` intake request code, `src/lib/proposals/paid.ts` (read only), `src/lib/payments/payment-state.ts` (read only).
- `next.config.ts` (webhook route), `src/lib/ui/words.ts`, `src/lib/loe/client-words.ts`, `src/lib/db/types.ts`.
- Tests: `tests/adobe-sign/` (fake fetch only), `tests/hired/chain.test.ts`, `tests/queue/one-card.test.ts`, the send grep.

## Acceptance tests
1. One Yes on the card makes the link live AND approves the email; if the link is refused, the email stays pending and the card names the reason.
2. The card is attorney-only; Rayn's Yes is refused.
3. Adobe connected: the agreement has exactly ONE signer, the client's email from the proposal; the document's text hashes to Lectual's fingerprint; no firm-side signer, no auto-countersign.
4. Adobe webhook: a bad signature, a replay, another firm's agreement id, or an unknown id writes nothing. The org is taken from the stored agreement row, never from the payload.
5. Adobe not connected / revoked / failing at creation: the client gets the in-app signing step; nothing half-created is left (an orphan Adobe agreement is cancelled or recorded as abandoned).
6. Pay cannot start before signing (both paths). The charged amount comes only from the signed snapshot.
7. Signed but unpaid: no matter. Paid but unsigned: no matter. Signed and paid: exactly one matter, one welcome draft, one questionnaire draft, even if both events arrive twice or together.
8. A payment read that fails or is "confirming" never counts as paid; a signature read that fails never counts as signed.
9. An existing matter for the lead and mark is linked, not duplicated.
10. No step writes a deadline; no step sends; the welcome and questionnaire are queue drafts only.
11. Tests never call Adobe Sign, LawPay or Lawmatics; unset `ADOBE_SIGN_OAUTH_*` means "not set up" and the in-app signature works.
12. Tests, lint, build; isolation cases on lectual-dev; 0106 verified on production after the owner's OK.

## New schema: lectual 0112
- `adobe_sign_connection`: `org_id` (unique), `status` (`active` / `reauth` / `revoked`), `api_access_point`, `account_label`, sealed `access_token_enc`, `refresh_token_enc`, `expires_at`, `connected_by`, timestamps. Sealed columns: no SELECT grant to `authenticated`. Admin tier may insert/delete through actions; reads name columns.
- `adobe_sign_agreement`: `org_id`, `proposal_id`, `proposal_version`, `agreement_id` (unique), `status` (`created` / `out_for_signature` / `signed` / `cancelled` / `abandoned` / `failed`), `signer_email`, `text_sha256`, `signed_at`, `signed_pdf_sha256`, `file_id`, `last_event_at`. Written by the service role only (webhook / client-page path); staff read their firm's.
- Isolation: cross-firm read/write cases for both; a staff member cannot read a sealed column or insert an agreement.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Adobe connection (Settings, client page) | connected | not connected: in-app signature | client page: in-app signature; Settings: "couldn't check" |
| Agreement status (staff card) | status | (n/a) | "Couldn't load the signature status", never "not signed" |
| Payment state | the five states | manual only | "unavailable", never "unpaid" |
| Chain readiness (signed + paid) | proceed | (n/a) | do nothing; retried next run |

## MUST NEVER HAPPEN
- A send to a client. Legal advice in any added text. A deadline written. A cross-firm read (webhook org from our own row). The service role in dashboard code. A raw error shown (Adobe or LawPay text included). A module gate failing open. **A matter opened, or the welcome drafted, on signed-only or paid-only.** **A charge for any amount not from the signed snapshot.** **Any signer other than the client.** **A signature recorded whose text doesn't match the fingerprint.**

## Dependencies and blockers
- **Adobe Sign access** (developer app, OAuth credentials, webhook URL registered) and B3's design note.
- **Owner's OK for 0106 on production.**
- Sprint 4 (approved email → Rayn's draft).
- Answers in `questions.md`: what "invoice" means; whether hired moves the lead to won; which questionnaire.

## Models and evaluator
- Generator: **Opus** for the card's one Yes, Adobe Sign (OAuth, webhook, fingerprint), the chain, payments touchpoints, the migrations and every client-facing word; **Sonnet** for Settings UI and the staff status card.
- Evaluator: **strict**.
