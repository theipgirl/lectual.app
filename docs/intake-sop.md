# RPB Law — Trademark Intake SOP

**Status: DRAFT FOR WORKSHOP.** Sections marked **[DECISION]** need Rebecca's answer before any code is written. That ordering is deliberate — building the pricing engine before the pricing rules are agreed is how the last three attempts went.

**Scope:** trademarks only. Copyright, contracts, and general matters are out of scope per Rebecca (*"we've done, like, five copyrights… it's not a high priority. I think we should start with the trademarks"*). Post-filing prosecution — office actions, statements of use, maintenance — is explicitly deferred.

This is the document Rebecca said doesn't exist: *"that's a part of building out an SOP to map out all of the possibilities to then build it into the workflow. So that's definitely something that we need to put that into. But we just — we haven't gotten there yet."*

---

## 1. The stages

These are the 21 `crm_stage` rows already seeded for RPB Law in Lectual. Stages 1–8 are intake and are the whole scope of this document. **9–21 exist but are deferred.**

| # | Stage | Category | In scope |
|---|---|---|---|
| 1 | Follow-Up | open | ✅ |
| 2 | Potential New Client | open | ✅ |
| 3 | Preliminary Search | open | ✅ |
| 4 | Consultation Scheduled | open | ✅ |
| 5 | Post Consultation Email Sent | open | ✅ |
| 6 | Undecided / Questions | open | ✅ |
| 7 | LOE & Invoice Sent | open | ✅ |
| 8 | Signed LOE / Deposit Received | **won** | ✅ |
| 9–21 | Questionnaire Complete → Trademark Registered | — | ❌ deferred |

## 2. The flow, step by step

### 2.1 Inquiry → consultation (stages 1–4)

Unchanged. Runs in Lawmatics as it does today — forms, QR codes, nurture emails. Two entry paths:

- **Discovery call** with Taylor — complimentary
- **Legal strategy session** with Rebecca — paid ($100–$200, rate varies by referral source)

A PNC may skip discovery and book the strategy session directly. Either call can be a no-show; a no-show returns to Follow-Up.

The paid consult is deliberate and is working. Rebecca: *"there's a barrier to entry and you're paying 200 to speak with me… it's been more of like a barrier to entry."* It replaced sending LOEs to people who said they were ready and weren't.

### 2.2 Consultation → post-consult email (stage 5) — **the automation gap**

**Today:** Taylor or Rain listens back to the call and hand-writes an email containing a package chart. Manual, every time.

**Proposed:** Lectual pulls the consult transcript and drafts the post-consult email, extracting into a `crm_consult_note`:

- Mark(s) — text, and word mark vs design mark for each
- Class(es) per mark, with the goods/services description
- **Filing basis per mark: 1A (in use) or 1B (intent to use)**
- Recommended package
- Any discount discussed

> **On 1A/1B.** Rebecca's specific objection to the pipeline demo was that the board assumed one path when the basis determines everything downstream: *"under examination, it's going to not be an office action response if it's a 1B."* The basis does not change the LOE, but it is decided at intake and must be **captured here** so the deferred prosecution work has it. Recording it costs nothing now and is expensive to backfill later.

**Transcript source:** the `lawmatics-mcp` consult tools currently read **Zoom** (`get_consult_notes`). Rebecca referred to **Fathom**. `crm_consult_note.transcript_source` is free text and holds either. **[DECISION] Which is authoritative going forward?**

**The email does not send itself.** A human reviews and approves it. `crm_firm_settings.post_consult_autosend_email` stays `false`.

### 2.3 The proposal — **the piece that has never existed**

The client receives a link. They see the same chart Dawn builds by hand today, but interactive:

1. Choose a package — Essential / Enhanced / Concierge
2. Add marks (usually one; sometimes more)
3. Set classes per mark
4. See a live total
5. Confirm

**Dawn's constraint governs this screen.** It must be understandable on its own: *"whatever we are designing should be easy enough for anyone who is selecting any class to be able to understand what they are picking."* The last attempt — package details on page 2 of an invoice — failed because *"people [were] putting the wrong thing."*

The proposal is a stored record, not a PDF. It freezes what the client was shown, so a later price change cannot retroactively alter a live engagement, and the LOE and the invoice are generated from **the same** stored selection and therefore can never disagree.

### 2.4 Confirmation → LOE + invoice (stage 7)

On confirm:

1. The selection is frozen on the proposal, and the total is computed once
2. Staff open the Document Center LOE form, now **pre-filled** — package, chart rows, class list, class count and amount all carried over, nothing typed
3. Staff choose the **current or legacy** template — a hard rule that is never guessed, and not a choice a client can make — and generate
4. The draft lands in the approval queue; Rebecca reviews before anything reaches the client
5. On approval: file the LOE to the Lawmatics matter, create the invoice with the amount **already computed**
6. Client pays through Lawmatics / LawPay — Lectual never touches money
7. Lead moves to **LOE & Invoice Sent**

> **Why acceptance doesn't just generate the letter.** The current-vs-legacy template choice is a staff judgment the SOP forbids guessing, and an LOE is a legal document. So confirming produces a *pre-filled form*, not a letter. The typing disappears; the judgment stays with the firm.

Steps 3 and 4 depend on an unverified Lawmatics API capability. See `lawmatics-capability-audit.md` §4 and its fallback.

If the client has questions instead of confirming, they go to **Undecided / Questions** (stage 6), not lost.

### 2.5 Payment / signature (stage 8)

Lawmatics tells Lectual the invoice is paid or the LOE is signed. The lead moves to **Signed LOE / Deposit Received** and **any queued Lectual email to that client is cancelled.**

That cancellation is a named requirement, not a detail. A client paid at night and received an automated Lectual follow-up the next morning. Rebecca: *"if I was that client, that would have left a bad taste in my mouth."* Lectual must check Lawmatics payment state before sending.

## 3. The offering

### 3.1 Packages — **confirmed from the firm's own proposal**

Transcribed from the Woody Remy / "Ravi" trademark proposal (July 2026), the chart Dawn pastes into every LOE by hand today. These are now seeded, not placeholders.

| | ESSENTIAL™ | ENHANCED™ | CONCIERGE™ |
|---|---|---|---|
| Legal fee | **$1,950** | **$3,250** | **$4,950** |
| Classes included | 1 | 2 | 3 |
| Additional class | $825 | $825 | $825 |
| Corresponding word/logo discount | 10% | 15% | 20% |
| Total estimated value | ≈ $7,800+ | ≈ $12,000+ | ≈ $17,750+ |

Sixteen benefit rows sit beneath, verbatim, in the firm's own wording — from "Preliminary Consultation Strategy Call ($450)" through "Trademark Assignment Agreement ($1,500)". Values are free text (`✔`, `Unlimited`, `2 if high risk`, `—`) and are never parsed; they round-trip into the LOE fee chart unchanged.

Three printed rows are **structured fields** rather than chart text, because the product does arithmetic with them: classes included, the corresponding-mark discount, and the estimated value. The proposal page re-renders them in their printed positions, so the client sees the chart exactly as designed.

> **The corresponding word/logo discount was not in the original brief and is a real pricing rule.** When a client protects the same trademark as both a word mark and a design mark, the cheaper package is discounted by its own tier's percentage. It is implemented and tested. It applies only to a genuine word+design pair of the same mark — two unrelated marks earn nothing, and two word marks are a duplicate filing, not a pair.

### 3.2 Government filing fees

$350 per class, added on top of the package fee, shown as its own line with the math visible (`$700 (350 × 2 classes)`). Already implemented and tested.

### 3.3 Marks and classes

- A matter may cover **more than one mark**. Irene's had two, with two charts in one LOE.
- Each mark is a **word mark** or a **design mark**, and they do **not** always share classes — checked with Rebecca on the call.
- Classes are per mark, each with a goods/services description.

Multi-mark is atypical (*"most of the time it's just one mark and it's like two classes"*) but it must not break the flow.

### 3.4 Discounts — **[DECISION]**

Dawn asked directly: *"will this also cover situations where Rebecca offers family and friend discounts?"*

**Recommendation: named percentage codes only.** A short list — e.g. `FRIENDS_FAMILY` 10%, `REFERRAL` 15% — applied to the package subtotal, never to government fees, shown as visible math (`$2,775 − $250 = $2,525`, the format the LOE already supports).

Ad-hoc dollar amounts cannot be automated, and they are the exact hole that broke the previous attempts. Rebecca has already acknowledged the trade: *"maybe I have to just stop doing that."*

**[DECISION] Rebecca to confirm the code list and percentages.**

### 3.5 Thrown-in extras — resolved

Ad-hoc freebies ("we'll add the comprehensive IP audit for free") stay **in the email body, out of the LOE.** Agreed on the call — Rebecca: *"we could just account for that in the email… I'm not super worried about that part."*

This keeps the LOE deterministic. It is the single most useful simplification in this document.

## 4. Where a human decides

Every one of these is a deliberate stop. Nothing on this list should ever become automatic without Rebecca saying so.

| # | Decision | Who | Why it can't be automatic |
|---|---|---|---|
| 1 | Recommended package and classes | Attorney | Legal judgment |
| 2 | Filing basis 1A vs 1B | Attorney | Legal determination |
| 3 | Post-consult email content | Attorney/staff | AI-drafted, human-approved |
| 4 | Send the proposal | Attorney | Client sees nothing unreviewed |
| 5 | Current vs legacy LOE template | Staff | Hard rule — never guessed |
| 6 | Approve the LOE | Rebecca | It's a legal document |
| 7 | Any discount | Rebecca | Pricing authority |

Existing rule that stays in force: **every dollar figure in an LOE traces to a stored selection or to fixed arithmetic — never to a model's judgment.**

## 5. Failure modes

| Situation | Behaviour |
|---|---|
| Client opens the proposal, doesn't confirm | Stays open until `expires_at`; lead sits at stage 5 |
| Client pays before opening the proposal | Payment wins. Cancel queued email, advance to stage 8, alert staff |
| Client wants something not on the menu | Proposal is voided; staff handle manually. Do not force it into the form |
| Client picks a package the attorney didn't recommend | Allowed and recorded. Rebecca's stated principle: *"I want people to be able to pick what they want"* |
| Prices change after a proposal is sent | The sent proposal keeps its frozen prices |
| Multi-mark with different classes per mark | Supported — one chart per mark |
| Lawmatics write fails | Fall back to the manual path; never leave the client mid-flow |

## 6. Open decisions — the workshop agenda

1. **[3.1]** Package names, prices, included classes, additional-class rate, benefit rows
2. **[3.4]** Discount codes and percentages — and confirmation that ad-hoc dollar discounts stop
3. **[2.2]** Zoom or Fathom as the authoritative transcript source
4. **[§2.4]** If the Lawmatics API can't create invoices or file documents, is the Dawn-clicks-send fallback acceptable for v1?
5. ~~Proposal expiry window~~ — **answered by the chart itself: 7 days from receipt.** Implemented. (Distinct from the LOE's 14-day signature deadline, which is unchanged.)
6. Who besides Rebecca may approve an LOE, if anyone

---

### Appendix — what this replaces

Dawn's current process, from her Aug 28 walkthrough:

1. Receive the proposal email with the hand-built chart
2. Open the LOE template, convert PDF → Word
3. **Delete the two packages the client didn't choose**
4. Edit the remaining chart to match
5. Paste a second chart for a second mark, if any
6. Copy the whole thing back into Lawmatics
7. Save, then send
8. Separately create an invoice — **into which the client types their own amount**

Steps 1–6 disappear. Step 7 becomes a review-and-approve. Step 8 arrives pre-filled.
