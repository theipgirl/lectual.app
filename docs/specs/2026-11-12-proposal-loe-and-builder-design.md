# Proposals: engagement letter on the client page, one builder, simpler editor

Date: 2026-11-12. Status: design, awaiting Taylor's review. Nothing here is built.

Repos: `lectual.app` (the app code), `lectual` (one migration, the isolation gate),
`lectual-plugin` (two skills whose rules change).

## 1. What this is for

Rebecca wants a client to accept a proposal, sign the engagement letter (LOE) and pay in one
sitting. Today the LOE is drafted by hand after payment and sent from Lawmatics, which adds
about a day and, for proposals like Sevetri Wilson's, produces a letter whose fee chart is
empty and reads "Trademark Package: TBD".

Taylor wants a proposal to be made one of three ways (the assistant drafts it from a consult,
Copilot drafts it on request, or a person starts from scratch), and wants the edit page to be
more straightforward.

Done means:

- A client can go from the proposal link to a signed LOE to the firm's pay link without anyone
  at the firm sending anything in between.
- The signed LOE ends with a fee exhibit filled in from what that client selected. It is never
  typed by hand and never says TBD.
- All three ways of creating a proposal can produce the same proposals and open the same editor.
- A two-brand proposal with a package choice can be finished from the editor with one Save and
  without opening a hidden section.

## 2. Where this comes from

### 2.1 What Rebecca said (Granola)

| Date | What | Standing |
|---|---|---|
| Nov 11 | Order is client details, then agree to the agreement, then pay. Pay-first was only ever a seriousness filter; the consult fee does that now. | Decided |
| Nov 11 | Stop typing the package into the LOE. The LOE says the fees are as outlined in the proposal. | Decided |
| Nov 10 | Client clicks accept and signs, the LOE fills in with name and address, signing leads to the pay link. Signed and paid means Hired. | Decided (mechanism proposed by Taylor, agreed) |
| Nov 9 | LOE and invoice go out as one step. Sevetri asked to see the LOE before signing. | Decided |
| Oct 27, Jun 11 | Rebecca sees what goes to a client before it goes. | Standing rule |
| Aug 28, Nov 11 | Payment stays in Lawmatics. The LOE must end up in the Lawmatics client file. | Standing rule |
| May 7 | Never list the packages the client did not choose in the LOE. | Standing rule |
| Aug 28 | Discounts are handled in the proposal, not in the LOE wording. | Agreed |

Not found in any meeting: which e-sign tool to use, where the client signs, and whether each
LOE needs its own review. Taylor decided those on Nov 12 (section 3).

### 2.2 What the code does today

- The app does not produce the letter. `buildTrademarkLoeDraft` writes a fee chart and a
  checklist for a person to paste into a Lawmatics template. The letter text and the e-sign tag
  live only in Lawmatics.
- That chart is refused for more than one brand name (`multiple_brands`), for marks on
  different packages (`mixed_mark_packages`), for a package no longer on the firm's list, and
  for flat-fee proposals. Sevetri's proposal hits the first two, so nothing was filled in.
- The client proposal page records no signature. The older quote engine (`src/lib/quotes/public.ts`)
  already has a typed-name signature with name, IP, browser, a frozen snapshot and a
  fingerprint check. That is the pattern to reuse.
- Three builders exist. Only the New proposal form can offer a package choice or a brand
  discount, and only on the first brand. The consult assistant and Copilot cannot.
- The editor has six kinds of form and seven Save buttons for a two-brand draft. Package
  choice, brand discount, greeting and first name are under "More options", and the link
  cannot be created without the last two.

## 3. Decisions (Taylor, Nov 12)

- D1. The client signs on the proposal page by typing their full name.
- D2. The signed letter ends with an exhibit filled in automatically from the client's selection.
- D3. Rebecca approves the LOE wording once. There is no approval step per client beyond
  today's rule that only a named approver turns a client link on.
- D4. The editor work and the LOE work are built at the same time.

## 4. Part A: the engagement letter on the proposal

### 4.1 The firm's letter (Settings, Proposals, "Engagement letter")

- One template per kind: `trademark` and `general`. The trademark text starts from the clean
  current RPB letter (the Sevetri example is that letter, with the AI-use paragraph).
- Stored in a new table, `client_proposal_loe_template` (migration 0106). The proposals
  settings jsonb is capped at 64 KB and already holds the packages, so the letter does not go there.
- A template has versions. A version is `draft`, `approved` or `retired`. The admin tier edits
  a draft. Only a person named in "Who may create client links" approves it, signed in, never
  the service role. An approved version is frozen; a change is a new draft version. At most one
  approved version per firm and kind. The database enforces all of this, the same way 0089
  enforces proposal approval.
- The body is plain text: paragraphs, optional bold lead-ins, and merge fields in double
  braces. Allowed fields: `date`, `client_name`, `entity_name`, `address_block`, `client_email`,
  `signer_name`, `signed_date`. A draft with any other field cannot be approved.
- No model writes or edits letter text, ever. The assistant and Copilot cannot change it.

### 4.2 On a proposal

- `content.loe = { kind, template_id, template_version, title, body }`, a copy of the approved
  version. Every save of a draft refreshes it from the firm's current approved version, the way
  the package snapshot is refreshed. Once the link is live the content is frozen, so the client
  signs exactly the letter that version carried.
- Creating the link re-checks that the copy equals a currently approved version. If the firm's
  letter changed in between, the action refuses and asks for a save.
- Per proposal there is one switch, "Client signs the engagement letter on this page". It is on
  by default when the firm has an approved letter. Off, or no approved letter, means the client
  page behaves exactly as it does today.
- `validateContent` gains the `loe` rules (kind matches the proposal kind, body 1 to 60,000
  characters). `publicContent` gains `loe.title`, `loe.body` and `loe.kind` and nothing else.

### 4.3 What the client does

Four steps on the same page, same link, same domain:

1. **Choose.** As today. A link, "Read the engagement letter first", shows the letter at any
   time before signing (Sevetri's request).
2. **Your details.** Full legal name, business name (optional), title (optional), mailing
   address. Prefilled from what the firm entered. These go on the letter.
3. **Engagement letter.** The letter with their details and today's date merged in, followed by
   "Exhibit A: Fee Structure and Estimated Costs", built from the live selection through the
   one price engine: each brand name, its marks and the package each is on, its classes, the
   legal fee lines and any discount, the legal fee due now, and the USPTO fees due at filing.
   Only what they selected. Then: type your full legal name, tick "I have read and agree to
   this engagement letter", press "Sign and continue to payment".
4. **Pay.** A receipt ("Signed Nov 12 at 2:14 PM by ..."), a link to view or print their signed
   copy (`/p/<token>/?agreement=1`, a print view on the same route so the firm-domain rewrite
   already covers it), and the pay button, which opens the firm's Lawmatics pay link as today.

A flat-fee (general) proposal follows the same steps with the general letter; its exhibit is
the matter, the work and the flat fee.

### 4.4 What the server does at signing

Accepting and signing are one act. There is no new status: an LOE proposal that is `accepted`
is signed.

- `acceptProposalAction(token, selection, clientClasses, signing)`. `signing` is the typed
  name, the details from step 2, the agreement tick and a fingerprint of what was on screen.
  Nothing money-shaped comes from the browser, as now.
- The server re-reads the proposal by token, recomputes the quote, cleans the typed details
  (same rule as client-typed class text: control characters and angle brackets removed, length
  capped, refused when empty), and builds the final agreement text itself from the stored
  letter, the cleaned details and the recomputed exhibit.
- It compares its own fingerprint with the browser's. A mismatch means the page was stale;
  nothing is written and the client is asked to reload.
- It reads the client's IP and browser from the request headers (the quote engine's `parseInet`
  and 400-character user-agent rule).
- One database function, callable only by the service role, inserts the signature record and
  moves the proposal to `accepted` in a single transaction. If either part fails, neither happens.
- `accepted_snapshot` becomes `schema: 2` and adds
  `agreement: { signature_id, signer_name, signed_at, sha256, template_version }`. Readers of
  the snapshot (the docx, the LOE adapter, the staff views) accept both schemas.

### 4.5 The signature record (lectual migration 0106)

`client_proposal_signature`, one row per signing:

- `org_id`, `proposal_id` (composite key to `client_proposal (id, org_id)`), `family_id`, `version`.
- `signer_name`, `signer_title`, `entity_name`, `address` (jsonb), `signer_email` (the
  proposal's own client email, not typed), `signed_at` (server clock).
- `ip`, `user_agent`, `agreement_text` (the letter and exhibit exactly as signed, at most
  200 KB), `agreement_sha256`, `template_id`, `template_version`.
- Members of the firm read it. Nobody signed in inserts, updates or deletes it. A trigger
  refuses any update, the service role included (the 0103 pattern).
- A reset of an acceptance (0101) leaves earlier signature rows in place; a new signing adds a row.
- It goes when its proposal is deleted. Only the owner can delete a proposal (0102), and the
  confirm text will say the signed letter's record goes too. By then the signed letter is also
  filed in Lawmatics (4.6). **Open for Taylor:** keep this, or refuse to delete a signed proposal.
- The same migration adds `client_proposal_loe_template` (4.1).
- Privileged content: never logged. Isolation cases for both tables go in
  `lectual/tests/tenant-isolation.test.ts`. Applied to dev first, then prod with Taylor's OK.

### 4.6 After signing (internal only; nothing is sent to a client)

- The firm notice and the Lawmatics note say the letter was signed, by whom and when.
- New follow-up step `signed_loe_upload`: render the signed letter (letterhead, body, signature
  block "Signed electronically by ... on ...", Exhibit A, and a last page with the signature
  record) as a docx with the `docx` library already installed, and upload it to the matter's
  Engagement folder in the firm's own Lawmatics. Recorded as a step event with a retry, like
  the existing uploads. Nothing is stored in a bucket; the signature row is the source.
- Staff proposal page: an "Engagement letter" card with signer, date and time, the fingerprint,
  Download, and the Lawmatics filing state (done, failed with Try again, couldn't be read).
- Status wording: an LOE proposal that is accepted reads "Signed by client". The list's
  Accepted column reads "Signed Nov 12".
- Mark paid stays as it is. For a signed version the old "draft the LOE" step is recorded as
  skipped ("Signed on the proposal page") and no approval-queue item is made. The refusals that
  broke Sevetri's letter no longer apply, because the exhibit comes from the accepted quote.
- Hired: unchanged. The hired-matter sync still follows Lawmatics.

### 4.7 Wording that must change (client-facing; Rebecca approves each line)

- "Once your payment is received, we'll send your engagement agreement for review and
  signature." Removed on LOE proposals.
- RPB's footer line that the page does not create an attorney-client relationship. On an LOE
  proposal it sits next to a letter that does, once signed and paid. Rebecca supplies the line.
- Button labels: "Continue", then "Sign and continue to payment", then "Pay my legal fee".
- Lectual's own "software, not a law firm" line stays on every state.

### 4.8 Rules that hold

- The letter is the firm's own document. The software shows it and records the signature; it
  gives no advice and writes no terms.
- Fail closed: an unreadable template, a missing approved version or an unmerged field means
  the link cannot be created with a letter. A client never sees a half-filled letter.
- An expired, withdrawn or replaced proposal cannot be signed.
- The client's typed details and the letter never reach a model prompt or a log.
- `pricing.ts` is not changed. The exhibit only formats the engine's quote.

## 5. Part B: one builder, three ways to start

### 5.1 One description of a proposal

A new pure type, `ProposalDraftSpec` (`src/lib/proposals/draft-spec.ts`): who it is for; kind;
brand names, each with marks, classes, how its package is offered (one package, the client
chooses among named packages with a starting one, or a package per mark) and a brand discount;
credits on the whole proposal; pay link; greeting; expiry; the flat-fee fields; and a list of
things to check, each with where it came from.

`buildDraftContent(spec, firmSettings)` turns that into proposal content by calling the helpers
that already exist (`buildNewContent`, `buildBrandNames`, the package-choice and snapshot
helpers, `buildGeneralContent`), then `validateContent`. It also attaches the firm's approved
letter (4.2). Package names must be on the firm's current list; prices never come from the caller.

### 5.2 The three doors

| Door | Today | After |
|---|---|---|
| The assistant, from a consult | Builds its own content. One package for the whole proposal. Trademark only. | Maps what it heard to the spec. Offers the firm's default choice of packages, starting on the one recommended on the call. Its quote-evidence rules are unchanged. |
| Copilot, on request | One lead, one package, one discount. Trademark only. | `draft_proposal` accepts the spec: package choice per brand or mark, brand discount, a credit, or a flat-fee matter. Same confirmation rule (a summary, a draft reference, a plain yes). |
| From scratch | A form, then a second screen where the real options appear. | "Who is this for?", then the draft is created and the editor opens. One screen does the building. |

"New proposal" opens a start screen with the three doors: From a consult (the recent consults
with "Draft the proposal"), Ask Copilot (opens Copilot with the request typed in, never sent by
itself; hidden when Copilot isn't switched on), Start from scratch.

### 5.3 Telling them apart

The content carries `made_by` (`assistant`, `copilot` or `person`), never shown to the client,
so this needs no database change. The editor header says "Made by the assistant from the
Nov 10 consult", "Made with Copilot" or nothing. Things to check appear in the
editor's checklist with a link to the field they are about.

A new firm setting, in the proposals settings: "New proposals offer" one package, or a choice
of these packages, per brand or per mark. All three doors use it as the starting point.

## 6. Part C: the edit page

### 6.1 Principles

One screen. One Save. A choice sits next to the thing it changes. What blocks the link is
visible before you start. You can always see what the client will see.

### 6.2 Layout

Header: client name, status, who made it, link to the lead. The "Proposal at a glance" card is
removed (it repeats the form). For an assistant draft, a short "Check these N things" panel
replaces it.

Main column, five sections, no Save button inside any of them:

1. **Who.** Full name, first name for the greeting, email, company.
2. **What we're protecting.** One card per brand name: name; word mark and logo; classes; then
   "Package for this brand" (one package / the client chooses, with the starting one / a
   different package for each mark) and "Discount on this brand". A link applies the same
   package options to every brand. Rarely used fields sit in a closed "Advanced for this brand".
3. **Fees and payment.** Credit or discount on the whole proposal, pay link, open-until date. A
   closed "Advanced pricing" holds the package numbers and the included-items table. The
   proposal-level package picker shows only when no brand has its own.
4. **Message.** Greeting and recommendation, in view, because the link needs a greeting.
5. **Engagement letter.** The switch, which approved version is attached, and "Preview the letter".

Side column (sticky on desktop; a bottom bar on phones):

- **What the client pays**, from the saved prices, with a note when there are unsaved changes.
- **Ready to send?** A checklist of what blocks the link, each item a link to its field. It is
  there from the first moment, not after the first failed save.
- **Preview as the client**, **Save**, **Save and create link**.

### 6.3 Saving

- One server action saves the whole draft. It runs the existing section parsers on one form
  post and makes one `updateProposal` call with the same `updated_at` fence, role and feature
  checks as now. The server stays the authority; no browser state is trusted.
- "Save and create link" saves first when there are unsaved changes, then turns the link on. A
  refused save stops there and shows why.
- One "Unsaved changes" marker for the page. Adding or removing a row marks it too.
- Other statuses keep their behaviour (read-only when the link is live, the pay-link card,
  Withdraw, Reset, Delete) in the new layout.

### 6.4 Words

- "Starts ticked" becomes "Selected to start". "Client describes this class" becomes "Let the
  client describe this". "More" beside the create button becomes a menu named for what it
  holds (Withdraw, Delete). "More options" is replaced by the two Advanced sections.
- All names go through `src/lib/ui/words.ts` and `src/lib/proposal-editor/vocabulary.ts`.

### 6.5 Not in this build

A price box that updates as you type (it updates on Save). Editing a package's own
included-items rows per proposal. A control for the custom package discount.

## 7. How it gets built

Two tracks at once (D4). Each sprint: a short contract, implementation by a coding agent,
review by a separate agent, then `pnpm lint`, `pnpm build`, `pnpm test` in `lectual.app`, and
the isolation gate in `lectual` when the database changed. Taylor checks each sprint on a
preview at desktop and phone width. Nothing goes to production, and no migration is applied to
lectual-prod, without her OK. The LOE stays switched off for a firm until its letter is approved.

**Track 1: editor and builder (needs nothing from Rebecca)**

- E1. One save action; the five-section layout; the checklist; preview; the phone bar. Leaves
  an empty slot for the Engagement letter section.
- E2. `ProposalDraftSpec` and `buildDraftContent`; New proposal creates a draft and opens the
  editor; the start screen with three doors; the "New proposals offer" setting.
- E3. The assistant and Copilot build through the spec, with the wider Copilot input.

**Track 2: the engagement letter**

- L0. From Rebecca: the clean letter text for trademark and general; her OK that a typed name
  is an acceptable signature for her engagement letters; the lines in 4.7; which details the
  letter needs from the client. Not code. L1 and L2 can be built before these arrive; nothing
  is switched on for RPB until they do.
- L1. Migration 0106 (both tables, the accept-and-sign function, `copilot` source), isolation
  cases, applied to dev. Settings page for the letter, with approval.
- L2. Client page: details, letter with exhibit, sign, receipt, print view. The server side of 4.4.
- L3. Staff side: the letter card, the signed docx, the Lawmatics upload, paid-flow changes,
  status wording, the editor's Engagement letter section (joins Track 1 here).
- L4. Flat-fee proposals with the general letter.

**Who does what**

| Work | Agent |
|---|---|
| Migration 0106, RLS, the accept-and-sign function, the server side of signing, review of every sprint | Most capable model |
| Client-facing wording drafts for Rebecca | Most capable model, then Rebecca |
| Editor layout, start screen, client-page UI, docx, tests | Fast coding model |
| File searches, copy sweeps, the plugin skill edits | Lightest model |

Also in scope: `lectual-plugin`'s `draft-engagement-letter` skill has a hard rule "Payment
first", and `process-consult` puts a Lawmatics LOE link in the email. Both must be rewritten
for sign-then-pay, or the Cowork skills will contradict the app.

## 8. Checks before RPB uses the letter

1. Rebecca has approved the template in Settings, the typed signature, and the wording in 4.7.
2. On a preview behind the firm's proposals domain, the recorded IP is the visitor's, not the
   proxy's.
3. A test signing files the docx in the right Lawmatics matter (the `/files` call has never
   been checked against a live account).
4. A two-brand, per-mark-package test proposal produces a complete Exhibit A.
5. Sign, reset, sign again leaves two signature rows and one live acceptance.

## 9. Open items

- Delete of a signed proposal: allow for the owner (current rule) or refuse. Recommended: allow,
  with the warning, because the signed letter is already in Lawmatics.
- The client's copy is a print view. A PDF by email would go through Approvals and is not in
  this build.
- LawPay taking the payment on the proposal would replace the pay link and Mark paid. Separate
  work; Rebecca wants payment in Lawmatics for now.
- Moving the matter to Hired in Lawmatics when signed and paid is still done in Lawmatics.

## 10. Not verified

Nothing in this document has been built or run. The editor screenshots used for the audit were
static renders. The Lawmatics template text was not readable from any repo. Rebecca's lines in
the Nov 10 meeting were attributed by content, because that transcript has no speaker split.
