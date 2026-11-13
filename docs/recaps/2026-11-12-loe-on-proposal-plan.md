# Session recap, 2026-11-12: engagement letter on the proposal, proposal maker plan

## What was asked

Plan the build that puts the engagement letter (LOE) on the client proposal the way Rebecca
described it, give the edit-proposal page a UX pass, and make proposals creatable three ways
(the assistant, Copilot, from scratch). Sevetri Wilson's LOE was the example. Later in the
session: once the plan is written, start a workflow and the PGE pipeline to build it.

## What was found

- **Rebecca's workflow (Granola, Nov 9 to 11).** Accept, sign the LOE, then pay, in one sitting.
  One standard letter that points to the proposal for fees. Payment stays in Lawmatics. She sees
  what goes to a client. The signed letter must be in the Lawmatics file. She never named an
  e-sign tool or said where the client signs.
- **Why Sevetri's letter said "Trademark Package: TBD".** The app does not write the letter. It
  makes a fee chart for a person to paste into a Lawmatics template, and it refuses that chart
  for more than one brand name or for marks on different packages.
- **The edit page.** Seven Save buttons on a two-brand draft; package choice, discount, greeting
  and first name hidden under "More options"; the step-3 package can disagree with the price box.
- **Three ways to create.** Three separate builders. Only the manual form can offer a package
  choice or a brand discount, and only on the first brand.

## Decisions (Taylor)

1. The client signs on the proposal page by typing their full name.
2. The signed letter ends with an exhibit filled in automatically from what the client selected.
3. Rebecca approves the letter wording once; no approval step per client.
4. Editor work and letter work are built at the same time.
5. Start the build with a workflow and PGE.
6. After seeing the mockup: the client proposal keeps its look (the total on the right on every
   step, and what the package includes), and the engagement letter is shown in full. Both are
   now pass/fail requirements of Sprint 4, and the full letter is in
   `docs/rpb/engagement-letter-trademark.md` for Rebecca to confirm.

## What was produced

- Design: `docs/specs/2026-11-12-proposal-loe-and-builder-design.md`
- Mockup (private until shared): https://claude.ai/artifact/S6dcsicKW5iBFFYE1mgeoM
- Master to-do: `docs/MASTER-TODO.md`
- Six-sprint build spec for the pipeline (in `pge-workspace/`, not committed).
- The build is running: two tracks in parallel in separate worktrees, each sprint contracted,
  built and evaluated by separate agents, merged and pushed to
  `claude/optimistic-brahmagupta-18q0xn` after each pair.

| Sprint | Track | What |
|---|---|---|
| 1 | Editor | One screen, one Save, checklist, preview |
| 2 | Letter | Migration 0106 (not applied), firm letter template and approval |
| 3 | Editor | One builder, start screen with three doors |
| 4 | Letter | Client page: details, letter with exhibit, sign, receipt |
| 5 | Editor | The assistant and Copilot build through the one builder |
| 6 | Letter | Signed letter on the staff side, Lawmatics filing, flat-fee letter |

## Limits to know

- No database or live app in the build environment. Sprints are checked with lint, build, the
  test suite and static renders, not in a real browser against real data.
- Migration 0106 is written by the pipeline but applied by nobody yet. Dev first, prod only with
  Taylor's OK.
- The letter stays off for RPB until Rebecca has approved the template, the typed signature and
  the changed client-page wording.
- The Obsidian vault could not be reached from this cloud session (no computer folder is
  shared with it), so this note is in the repo only.

## Action items

See `docs/MASTER-TODO.md`, section 2026-11-12.

## Later the same day: the build ran

- Six sprints, two tracks in parallel, each contracted, built and evaluated by separate agents; all six passed on the first attempt.
  30 agents in the pipeline, then a security review, a database audit, two fix passes and an independent check of the fixes.
- Tests: 9,975 before, 10,705 after, all passing; lint and build clean. `pricing.ts` unchanged. One library added (pdfkit, for the letter PDF).
- Migration 0106 (letter templates, signature records, sign-and-accept) was hardened after the audit, applied to lectual-dev and checked
  there with about 35 scenarios in rolled-back transactions. It is NOT on lectual-prod.
- The plugin's `draft-engagement-letter` and `process-consult` skills now describe sign-then-pay on the proposal page.
- After Taylor saw the mockup: the client page keeps its look (total on the right on every step, what the package includes), the letter
  is shown in full, the total panel sticks while scrolling, and the letter downloads as a PDF before and after signing.

### What the reviews caught and fixed

- Assistant and Copilot drafts did not carry the letter; now every way of creating does, and a letter that could not be attached blocks
  the link until it is attached or turned off on purpose.
- No signed-letter download until the page was reloaded.
- A double space in the typed name, or signing the day after opening the page, wrongly refused the signature.
- A legal-sounding footer line written by the builders was removed; the firm's own footer shows until Rebecca supplies hers.
- Signature records: staff roles only can read them; nobody, the server role included, can edit or delete one on its own.
- A signed PDF is only ever built from text that matches the recorded fingerprint.

### Not verified

No real browser, no production database, no live Lawmatics, no deployed build. The build environment turned out to hold live database
credentials; an agent's test run reached lectual-dev twice by accident and wrote nothing.

### Where the pipeline's own files are

`pge-workspace/` in the build container (contracts, handoffs, evaluations) was not committed and goes when the container does. The
decisions that matter are in the AGENTS.md sections each sprint wrote.

## Evening: letter details, layout and editor fixes (lectual.app#29)

- 0106 applied to lectual-prod on Taylor's instruction; RPB's trademark letter saved there as a DRAFT (Sevetri's letter with her details turned into fields).
- Signing now needs the full legal name and mailing address (street, city, state, ZIP, country). The address is written to the Lawmatics matter and contact
  after signing (unverified against live Lawmatics) and shown on the lead and matter pages for staff.
- RPB logo on the letter (page and PDF); footer "RPB Law Firm, PLLC"; the letter keeps the Word layout (centred address line with rule, bold underlined
  Via Email, centred Re line, indented signature) through template-only styles that never change the signed text.
- Editor: the per-package "what's included" tables now save; the link box stays in the side column; the side column fits the screen so the preview end is
  reachable; Expand shows the preview full width.
- Lawmatics pay form: a generic shared form link cannot be pre-filled from Lectual. Open decision in the master to-do.
- Checks: 649 test files, 10,823 tests, lint and build clean. Not checked in a real browser or against live Lawmatics.

## Night: merged, letter version 2, address at the details step

- Merged lectual.app#29, #30 and #31. #31 saves the address to the firm's Lawmatics (matter and contact) when the client presses Continue on
  "Your details", deduplicated (same address = no request, changed address = update), shown to the client only when Lawmatics is connected.
- Found on prod: Rebecca approved letter version 1 at 12:34 PM ET; one proposal with the letter is live and one client has signed. Version 2 (Word
  layout, "RPB Law, PLLC" kept under the logo) was added as a draft built from v1 with markers only; its md5 matches the repo template.
- Checks on the final branch: lint 0 errors, 652 test files / 10,849 tests, build passes. No real browser, no live Lawmatics.


## Nov 13 follow-up

- **#33 merged:** "What's included" took every row's note from the first package only. Each package's own note now shows under its cell. The
  save path (3 packages x 17 rows, then the client page per package) is pinned by an end-to-end test. The table looked unchanged because the
  edits were made before the Nov 12 deploy, and because the preview shows only the chosen package.
- **#34 merged:** on the client page, the typed name and the "I have read and agree" tick are required (asterisks, a line saying what's
  missing). "Your details" is a real address form (street, apartment, city, a state list for the US, numeric ZIP, country). Brand names show in
  quotation marks on the client page only; the letter, Exhibit A and the stored text are unchanged, so fingerprints don't move.
- **Test setup:** a duplicate draft for the test matter (Lawmatics 19989543) on lectual-prod, id 813f42e6-3564-4952-948a-987e214b636f, linked to test
  lead 4065b888-0885-477a-9daf-377987727f15. Nothing was sent.
- Verification for #34: lint 0 errors, 10,881 tests passed, build passed; `pricing.ts`, `exhibit.ts`, `signing.ts` untouched.
