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
