# System Design — Proposal → LOE → Payment

Companion to `intake-sop.md` (what the firm does) and `lawmatics-capability-audit.md` (why the work splits across two systems). This document covers how it's built.

---

## 1. What already exists

Worth stating up front, because it reframes the size of this project. From reading `theipgirl/lectual` and `theipgirl/lawmatics-mcp`:

| Piece | Where | State |
|---|---|---|
| Trademark LOE generation | `lectual` — `src/lib/documents/loe.ts` | **Built.** Current/legacy variants, $350/class gov fees, 14-day signature deadline, discount math shown verbatim. Tested. |
| LOE screen | `lectual` — `src/app/(firm)/dashboard/document-center/[matterId]/loe/` | **Built.** Staff type every field by hand. |
| Approval queue | `lawmatics-mcp` — `src/tools/approval.ts`; `lectual` — `/dashboard/queue/[id]` | **Built.** `ENGAGEMENT_LETTER` is an existing type. Documented as *"the ONLY way an agent should produce a client-facing artifact — it NEVER sends."* |
| Post-consult email drafting | `lectual` — `src/lib/agents/post-consult-email.ts` | **Built.** |
| Consult transcript pull | `lawmatics-mcp` — `src/tools/consult.ts` | **Built** (Zoom). |
| Package / consult-note / document-draft schema | Supabase `lectual-prod` | **Tables exist, zero rows.** |
| Lawmatics REST client | `lawmatics-mcp` — `src/lawmatics.ts` | Generic GET/POST/PATCH/DELETE against `api.lawmatics.com/v1`. |

**The gap is four things:**

1. **No package catalogue.** `crm_package` is empty, so there is nothing to price against.
2. **No proposal object.** The LOE generator's own comment names this: *"…rather than trying to re-derive from a proposal PDF Lectual has no integration to read."*
3. **No client-facing selection page.** `packageName`, `benefitRowsText`, `classCount` and `amountPaid` are typed by staff — `amountPaid` is a hand-typed **string**.
4. **No verified Lawmatics write path** for invoices or documents. See the audit, §4.

Fixing (1)–(3) turns the existing LOE generator's inputs from *typed* into *derived*. That is the whole build.

## 2. Flow

```
Consult (Zoom / Fathom)
  │
  └─> crm_consult_note        marks · classes · 1A or 1B · recommended package
        │
        └─> [ATTORNEY REVIEWS]                        ← nothing auto-sends
              │
              └─> crm_proposal  + tokenized public URL
                    │
                    └─> post-consult email carries the link
                          │
                          └─> CLIENT: package · marks · classes · live total
                                │                    ↑ the part Lawmatics cannot do
                                └─> confirm:
                                      1. freeze accepted_selection
                                      2. price it            → lib/pricing
                                      3. generateTrademarkLoe(...)
                                      4. → approval queue    ← Rebecca reviews
                                      5. lead → "LOE & Invoice Sent"
                                            │
                                            └─> on approval:
                                                  file LOE to Lawmatics matter
                                                  create invoice, amount pre-filled
                                                  client pays via LawPay
                                                      │
                                                      └─> webhook: paid / signed
                                                            lead → "Signed LOE / Deposit Received"
                                                            CANCEL queued email   ← the double-fire fix
```

The client confirming does **not** send them a letter. It produces a draft for Rebecca. Given that three prior attempts failed and her stated worry is things firing wrongly, the gate stays.

## 3. Schema

Apply to **`lectual-dev` (`vncamzabuhvlliscprmm`) first**, never straight to prod. `lectual-prod` carries 110 live RPB matters.

### New: `crm_proposal`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid | RLS predicate, matches every other table |
| `lead_id` | uuid null | |
| `matter_id` | uuid null | composite FK `(id, org_id)`, per `crm_matter_contact` convention |
| `consult_note_id` | uuid null | |
| `token` | text unique | unguessable; the public URL |
| `status` | text | `draft` / `sent` / `accepted` / `expired` / `void` |
| `offered` | jsonb | **frozen** snapshot of packages+prices as shown |
| `accepted_selection` | jsonb | what the client chose |
| `subtotal_cents`, `discount_code`, `discount_cents`, `gov_fee_cents`, `total_cents` | | computed at accept |
| `expires_at`, `sent_at`, `accepted_at` | timestamptz | |
| `created_by` | uuid | |

Two columns carry the design:

- **`offered`** freezes what the client saw. A price change tomorrow cannot alter a live engagement.
- **`accepted_selection`** is the single source of truth for both the LOE merge and the invoice amount, so the letter and the bill can never disagree — the failure the current copy-paste process invites.

### New: `crm_discount_code`

`org_id · code · label · percent_off · active`. Percentage only — see SOP §3.4.

### Reused unchanged

`crm_package`, `crm_consult_note`, `crm_post_consult_action`, `crm_document_draft`, `crm_lead.lawmatics_id`, `crm_firm_settings`, and the seeded `crm_stage` rows.

## 4. The pricing engine

A pure function, no I/O, exhaustively unit-tested:

```
price(offered, selection, discount) -> {
  lines: [{ label, detail, cents }],
  subtotal_cents, discount_cents, gov_fee_cents, total_cents
}
```

Rules:
- Package base fee, once
- Additional classes beyond those included × the package's additional-class rate
- Government fees: **$350 × total class count across all marks**, its own line, never discounted
- Discount: percentage off the **package subtotal only**
- Every line carries visible math (`$700 (350 × 2 classes)`) — the existing LOE convention

This is where the client-types-their-own-amount bug dies. The number shown on the proposal, the number in the LOE, and the number on the invoice are one computation.

It respects the existing hard rule — *every dollar figure comes from a stored selection or fixed arithmetic, never a model's judgment.* The engine is arithmetic. No AI touches a price.

**Test cases:** the common one (1 mark, 2 classes, Essential); Irene's (2 marks, many classes, two charts); discount applied; zero additional classes; a class count of 0 rejected, as the LOE generator already does.

## 5. Lawmatics boundary

One module wraps every call, so the fallback is a single switch rather than a rewrite:

```
fileDocumentToMatter(matterId, docx)  ->  ok | UNSUPPORTED
createInvoice(matterId, cents, memo)  ->  ok | UNSUPPORTED
getPaymentStatus(matterId)            ->  ok | UNSUPPORTED
```

On `UNSUPPORTED`, the UI shows Dawn the exact amount and the generated document and asks her to complete it in Lawmatics — the manual path, minus all the manual work. **Verify with the probe before building against these** (audit §4).

## 6. Failure modes

| Case | Handling |
|---|---|
| Client abandons mid-proposal | Nothing happens. `expires_at` closes it. |
| Client pays before opening the proposal | Payment wins: void the proposal, cancel queued email, advance to stage 8, alert staff |
| Double submit | `accepted_at` non-null makes accept idempotent |
| Prices changed after send | `offered` is frozen; the live proposal is unaffected |
| Token guessed | 32+ bytes of entropy, expiring, and it can only *create a draft for Rebecca* — never send |
| Lawmatics write fails | Fall back to manual; never leave the client mid-flow |
| Two systems both act | Lawmatics is authoritative for payment. Lectual reads before it sends. |

## 7. Open architecture question

The prototype was scoped to this repo (`lectual.app`), decided before we knew `generateTrademarkLoe` already exists in `lectual`. That creates a tension: a separate app cannot call that function directly and would have to duplicate it or reach it over HTTP — and duplicated LOE logic is exactly the kind of drift that produces a wrong letter.

Options, with the trade-off stated honestly:

- **A — build inside `lectual`.** The proposal page and pricing engine sit next to the LOE generator, the packages, and the queue. No duplication, no second deployment, no cross-app auth. Costs: it is a larger, live codebase.
- **B — build here, call `lectual` over HTTP.** Faster to iterate in isolation; adds an API surface and a second deployment against the same database.
- **C — build here as a throwaway prototype**, then port. Fastest to something demo-able; the port is real work.

**Recommendation: A.** The single most valuable property of this design is that the proposal, the letter, and the invoice come from one computation. Splitting them across two repos undermines that on day one.

## 8. Verification

1. `pnpm test` — pricing engine green, including the multi-mark case
2. Seed `crm_package` + `crm_discount_code` in **dev**; confirm via SQL
3. Create a proposal against a dev lead; open the public URL in a browser; select Enhanced + 2 marks + 3 classes; check the live total against a hand calculation
4. Confirm; assert `accepted_selection` is frozen, a queue item exists, and the `.docx` chart matches the selection — and that the **two unchosen packages are absent**
5. Lawmatics **sandbox only** — never live client records
6. Mock webhook → stage advances and a queued email is cancelled (the double-fire regression test)
7. Screenshot the proposal page for the Tuesday call
