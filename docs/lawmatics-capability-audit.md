# Lawmatics Capability Audit

**Written for:** Rebecca, Caitlyn, Dawn
**Question it answers:** Caitlyn's, from the Aug 28 call — *"do you think that that solution is within Lawmatics or that you need to take it to Lectual?"*
**Date:** Aug 2026

Rebecca has paid at least two people to build this inside Lawmatics and it didn't work. She is entitled to see the reasoning written down rather than told to her a third time. That's what this document is.

---

## 1. What we are actually trying to do

One sentence: **let a client pick their package, marks, and classes on a page, and have that selection flow automatically into the correct engagement letter and the correct invoice amount.**

Break that into the capabilities it requires:

| # | Capability | Why it's needed |
|---|---|---|
| C1 | Conditional-logic form | Package choice changes which follow-up questions appear; class count varies per mark |
| C2 | Computed pricing | Total = package base + (additional classes × rate) + gov fees − discount |
| C3 | Dynamic document assembly | The LOE must contain **only** the chosen package's chart rows |
| C4 | Repeating sections | Irene's matter: two marks → two charts in one letter |
| C5 | Invoice with a pre-set amount | So the client never types their own total |
| C6 | Document filed to the client's matter | The signed LOE has to live in the client file |
| C7 | E-signature + delivery | LOEs go out for signature from the firm's system of record |

## 2. What Lawmatics does and does not support

| Capability | Lawmatics | Evidence |
|---|---|---|
| C1 Conditional-logic form | **No** | Dawn raised this with Lawmatics support directly and confirmed on the Aug 28 call: *"It doesn't have that functionality… I reached out to them countless times. It's not just something that they have available right now."* Three contractors failed to produce it. |
| C2 Computed pricing | **No** | The workaround attempted — putting the package chart on page 2 of the invoice and asking clients to enter their own figure — failed in production. Rebecca: *"we tried to do it like this, but it wasn't easy. People putting the wrong thing."* |
| C3 Dynamic document assembly | **No** | This is why Dawn's process exists at all: she opens the template and manually **deletes the two packages the client didn't choose**. |
| C4 Repeating sections | **No** | Dawn pastes a second chart by hand for multi-mark matters. |
| C5 Invoice with pre-set amount | **Unverified — see §4** | Invoices are created manually today. |
| C6 Document filed to matter | **Yes** | Dawn does this today; it's a core Lawmatics function. |
| C7 E-signature + delivery | **Yes** | Dawn sends the LOE from Lawmatics today. |

**C1–C4 are the entire problem, and Lawmatics supports none of them.** This is not a matter of finding the right contractor. Lawmatics forms are static intake forms; they cannot branch on an answer, do arithmetic, or drive document assembly. That's a product boundary, not a skill gap.

C6 and C7 — the parts Rebecca most cares about keeping — Lawmatics does well, and **nothing in this project moves them.**

## 3. The recommended boundary

The instinct that this should all live in one system is right in general. It doesn't hold here, because the two halves need genuinely different tools. The split follows the capability table exactly:

**Stays in Lawmatics (system of record — unchanged):**
- Contacts, prospects, matters
- All payment and LawPay processing — Lectual never touches money
- Email templates and history; the hundreds of existing forms and QR intake
- LOE delivery, e-signature, and document storage of record

**Moves to Lectual (the C1–C4 work Lawmatics can't do):**
- Transcript → post-consult email draft. *Rebecca, Aug 28: "Lawmatics can never take a Fathom transcript and make the post-consult email. It can't do that."*
- The conditional proposal page the client fills in
- The pricing engine
- LOE assembly — **already built**, see §5

**Crosses the boundary:**
- Lectual → Lawmatics: file the assembled LOE to the matter; create the invoice with the computed amount
- Lawmatics → Lectual: payment received, LOE signed

That last arrow is not a nice-to-have. It is the fix for the incident Rebecca raised: a client paid in Lawmatics at night and got a Lectual follow-up email the next morning. Lectual must read payment state from Lawmatics before it sends anything.

## 4. The open technical question — stated plainly

**We do not yet know whether the Lawmatics API can create an invoice with a fixed amount (C5) or accept a document upload (C6) programmatically.**

This is not a guess. The `lawmatics-mcp` repo contains a diagnostic route (`app/api/lawmatics-probe/route.ts`) whose own comment records the problem:

> *"The tool layer assumed paths like `/matters` and `/contacts`, but the live API answers 404 ('This resource path does not exist') for at least `/matters`, so the assumed surface was never verified."*

The endpoints currently exercised are `/contacts`, `/prospects`, `/pipelines`, `/stages`, `/custom_fields`, `/notes`, `/tasks`, `/users`, `/events`. **No document or invoice endpoint is implemented, and none is in the probe's candidate list.**

**Action required before Phase B is committed to:** run the probe with a live `LAWMATICS_TOKEN`, extending its candidate list with `/documents`, `/files`, `/invoices`, `/billing`, `/payments`, `/transactions`, `/e_signatures`, `/document_templates`. It is a read-only GET, one page, one record. This should take minutes and it settles the question.

**If those endpoints don't exist, the project does not stall.** The fallback:

> Lectual generates the LOE and shows Dawn the exact invoice amount to enter. Dawn creates the invoice and sends the LOE from Lawmatics as she does today.

That fallback still removes the Word editing, the manual chart-building, the package deletion, and — most importantly — **the client typing their own amount.** It preserves nearly all of the value. The automation of the last click is a bonus, not the point.

## 5. What is already built (important context)

This is not a fourth attempt from scratch. Working code already exists in the `lectual` repo:

- **`src/lib/documents/loe.ts`** — trademark LOE generation, with an explicit current-vs-legacy template choice (never guessed), gov filing fees at $350/class, and a 14-day signature deadline. Built after Dawn's June 22 walkthrough.
- **`src/app/(firm)/dashboard/document-center/[matterId]/loe/`** — the Document Center LOE screen.
- **The approval queue** — `queue_draft` in `lawmatics-mcp` has an `ENGAGEMENT_LETTER` type and is documented as *"the ONLY way an agent should produce a client-facing artifact — it NEVER sends."* Rebecca reviews everything before it goes out.
- **Post-consult email agents** — `src/lib/agents/post-consult-email.ts`.
- **The database schema** — `crm_package` (name, price, included classes, additional-class rate), `crm_consult_note`, `crm_post_consult_action`, `crm_document_draft`. All present. All at **zero rows**.

The LOE generator's own source comment names the remaining gap precisely:

> *"…is a staff judgment call the MVP asks for directly rather than trying to re-derive from a proposal PDF Lectual has no integration to read."*

That is exactly Rebecca's Aug 28 complaint, and the fix follows directly: **make the proposal a structured record in Lectual instead of a PDF.** Then there is nothing to re-derive.

So the genuine gap is narrow:

1. No client-facing selection page — staff type the package, the chart rows, the class count, and the amount by hand today. `amountPaid` is a hand-typed string.
2. No package catalogue — `crm_package` is empty, so there is nothing to price against.
3. No proposal record linking what the client was shown to what they chose.
4. The unverified Lawmatics write path in §4.

## 6. Recommendation

Proceed with the split in §3. Build items 1–3 of §5 in Lectual. Run the §4 probe before committing to the automated invoice path, and ship the Dawn-clicks-send fallback if the API won't support it.

**What this does not do:** it does not migrate intake off Lawmatics, does not touch payments, and does not ask the team to learn a second system for anything they do today. Lawmatics remains the system of record. Lectual does the four things Lawmatics cannot do, and hands the result back.
