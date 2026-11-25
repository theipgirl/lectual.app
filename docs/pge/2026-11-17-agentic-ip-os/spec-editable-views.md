# Spec: views the firm can shape itself (Caitlyn's asks)

Status: DRAFT for Taylor's read. Nothing is built. No schema is applied.
Sources: the Nov 17 working session with Caitlyn, the Nov 23 team meeting (Caitlyn couldn't edit columns or add items), and the Nov 24 call
(add rows, edit column names, move things around; no change after the role change). The Nov 24 4:00 PM call is not in Granola.

## Taylor's decisions (Nov 25)

| Question | Answer |
|---|---|
| Whose changes are they? | **Firm-wide.** A layout change is the firm's view for everyone. |
| What is "add a row"? | **A real lead or matter.** Never a free-form line. |
| Who may change a view's structure? | **Owners and Caitlyn.** |
| Order | **Weekly review (List and Board) first, then Matters and Contracts, then Leads.** |
| Caitlyn's role | **Senior admin**, plus the new right below (Taylor, in chat Nov 25: "yes sr admin"). Her membership is OWNER on prod today (director, Nov 25); changing it is a prod write that needs Taylor's OK and is not part of this build. |
| Settings -> Columns | **Removed.** Editing happens on the view itself. |

Still open (default chosen; Taylor can overrule before the build):
- **Renaming a board column that is a STAGE.** Default: rename and reorder a stage from the board header are allowed for the same people; ADDING or
  DELETING a stage is NOT in this spec (stage names drive the new-enquiry rule, the Stage Keeper mapping, the won handoff and the hired sync, so a new
  or removed stage needs its own review). A plain column (not a stage) can be added, renamed, hidden and moved freely.
- **Each person hiding or reordering columns just for themselves.** Default: not in the first build (firm-wide only, as decided). The existing
  per-person chooser on the Weekly review List stays as it is until the shared layout replaces it, then is removed.

## What Caitlyn asked for (synthesis)

1. Work like her spreadsheet: the same columns, a notes column she clicks into and updates in place.
2. Change the structure herself on any List or Board: add rows, add columns, rename columns, move things around.
3. Every view looks and works the same, and they agree with each other (the lead page must say what the Weekly review says). Two names only:
   **List** and **Board**.
4. Boards follow the firm's stages: Intake, then pre-filing, then post-filing. **Matters shows only clients past the signed engagement letter and
   deposit** (today it shows intake stages). Contracts stays separate.
5. The Weekly review mirrors the intake layout: a timeline column (the last thing that went out), the next step with a real date (never
   "6 days ago"), and each person's load (what is on each paralegal's plate).
6. Open a card on the Board and add notes right there, not in a sidebar.
7. Her first view leaves out Forms and Proposals.
8. Then: her email connection (the firm's Microsoft admin consent, outside this spec), and loading the contracts and general counsel SOPs with data validation
   (separate spec).

## Why it doesn't work today (found Nov 25, main b87d1b6)

- The firm's own columns live in **Settings -> Columns** (`src/app/dashboard/settings/columns/page.tsx`, `src/lib/custom-columns/`), admin tier
  only, and only add columns to the Weekly review List. No rename of built-in columns, no add row, no move, nothing on Boards, Leads or Matters.
- Their tables are **lectual 0115, applied to lectual-dev and lectual-prod on 2026-11-23** (with 0116; the 0115 file is on lectual's
  claude/gracious-darwin-rceoyv branch, 0086dc0, not lectual main). RPB has no firm column yet (0 `crm_custom_field` rows).
- The Weekly review List is editable in place (`SheetEditTable`) **only in the owner view** (`viewFor(...) === "owner"`, `review/page.tsx`).
  Director's read-only check (prod, Nov 25): Caitlyn's membership is OWNER, `role-views` is on for RPB and her view preference is unset, so she
  lands in the owner view and should get that editable List today. What she asked for is still missing there: the List edits CELLS (status,
  next step, owner, source, notes, the firm's own columns) but cannot rename a column, add a row, or move columns for the firm; adding a column
  means leaving for Settings; and the Boards, Matters, Contracts and Leads have none of it. Once she is senior admin she would lose even the cell
  editing, because it is tied to the owner view.

## The design

### 1. One "can shape views" right, not a role

- A new per-member flag, `can_shape_views`, true for every owner by rule and for members Taylor names (Caitlyn). It decides ONLY whether the
  structure controls are drawn and accepted: column menu, add column, rename, move, stage rename/reorder. It never widens what a person may read or
  which records they may edit; record edits keep today's gates (`CAN_WRITE_LEAD`, `MATTER_WRITE_ROLES`, `CAN_MOVE_STAGE`).
- Stored server-side and enforced by the database (it changes what the whole firm sees), not in `user_metadata`. Every structure action re-reads it.
- Owners grant it on Settings -> Team (a checkbox "Can change views" on a member's row). Not grantable to viewer or social media.
- Independent of the owner VIEW: a senior admin with the right gets the editable List and Board in the technician shell too.

### 2. One editable List and one Board, used everywhere

- Extract one List component from the Weekly review's `SheetEditTable` / `SheetViewTable` and one Board from the review Board and
  `MatterBoard`, with the same names, header, toolbar, row height and card look. The Weekly review, Matters, Contracts and Leads render them with
  their own data sources and column sets. This is what makes the views look the same and agree.
- **Column header menu** (for people with the right): Rename, Hide, Move left / Move right (and drag), Add a column to the left / right.
  Without the right the header has no menu, only sort.
- **Add a column:** kinds Text, Choice, Date, Person, Checkbox, Money (Money stays owner-only to see and type, as decided Nov 23).
  The value is typed in the cell, like today's Notes cell.
- **Rename a built-in column** changes the firm's LABEL only. The data, filters and every rule keep working on the column's fixed key.
- **Add row:** a button at the bottom of the List opens a short inline form that creates a REAL lead (Leads, Weekly review "Leads") or matter
  (Matters, Contracts, Weekly review "Matters") through the existing `createLead` / open-a-matter paths, with today's gates. No free-form rows.
- **Board:** drag a card between stage columns (today's `moveLeadStage` / `updateMatterStage`, today's gates; never into a `won` stage from a
  lead board, as now). Stage columns can be renamed and reordered by people with the right (default above).
- **Open a card on the Board:** a card opens in place (the Weekly review's `?open=` panel pattern) with a notes box at the top, so a note is
  added without leaving the board.
- Every read stays three-state; a layout that can't be read draws the default layout with one note, never an empty table.

### 3. Storage (one lectual migration, proposal first)

- 0115 is applied, so this is a NEW migration on top of it (next free number in lectual), additive only:
  - `crm_view_layout`: one row per firm and view (`review_list`, `review_board`, `matters_list`, `matters_board`, `contracts_list`,
    `contracts_board`, `leads_list`, `leads_board`), a jsonb of columns in order: key, label, hidden, width.
  - The firm's own columns and their values: 0115's field and value tables, kept as they are, now used by every List, not only the Weekly
    review (if a field needs to say which views it belongs to, that is an added column, never a rewrite of 0115).
  - `crm_org_member.can_shape_views boolean default false` (owners pass by rule), writable only by an owner, through 0116's
    owner/self-write guard pattern.
- RLS on `org_id = current_org_id()`; layout writes need `can_shape_views` or owner. Isolation cases for every new table, in lectual's
  `tests/tenant-isolation.test.ts`.
- Proposal file in `docs/pge/...`; applied to lectual-dev, tested, then lectual-prod ONLY with Taylor's OK. Apply to both.

### 4. Board logic fixes (no schema)

- Matters (List and Board) shows only matters past "Signed LOE / Deposit Received"; intake stages never appear there.
- Pre-filing and post-filing are two groups on the Trademarks board; Contracts is its own List and Board.
- Weekly review List gains: Timeline (the newest outbound item, with its date) and Next step (title and real date). Load per person stays the
  Board's lanes.
- Caitlyn's view leaves out Forms and Proposals in the rail (the rail is a courtesy; the pages keep their gates).

### 5. Removed

- Settings -> Columns (`settings/columns/`, `ColumnsSettings*`, `FirmColumnsEdit`) and its rail and tab entries. Anything it did moves to the
  column header menu.
- The per-person column chooser on the Weekly review List, once the firm layout replaces it.

## Build order

| Step | What | Who (model) | Needs |
|---|---|---|---|
| 0 | Check what Caitlyn's account shows today (role, view, whether the List is editable) | director (read-only prod check) | nothing |
| 1 | Migration proposal: layouts, columns, `can_shape_views`; isolation cases | Opus | — |
| 2 | Shared List and Board components; Weekly review on them | Sonnet, Opus review | step 1 on dev |
| 3 | Column menu, add column, rename, move, add row (real records) | Sonnet, Opus review | step 2 |
| 4 | Team checkbox "Can change views"; enforcement in every structure action | Opus | step 1 |
| 5 | Matters and Contracts on the shared components; the Matters stage fix | Sonnet, Opus review | step 2 |
| 6 | Leads on the shared components | Sonnet, Opus review | step 2 |
| 7 | Remove Settings -> Columns and the per-person chooser | Haiku/Sonnet | steps 3-6 |
| 8 | Preview walk-through with Caitlyn and Taylor | Taylor, Caitlyn | dev-backed preview |

Merge to main only with Taylor's yes. The migration goes to prod only with Taylor's OK.

## Done means

- Caitlyn, as senior admin with "Can change views", can on the Weekly review List and Board, then Matters, Contracts and Leads: add a column,
  rename any column, hide and move columns, add a real lead or matter from the List, drag a card between stages, rename and reorder a stage,
  and open a card to add a note on the Board.
- The change is the firm's view for everyone, immediately.
- A member without the right sees the same layout with no structure controls, and the server refuses a forged structure request.
- Every List and Board looks the same, and the lead page agrees with the Weekly review.
- Matters shows nothing before the signed engagement letter and deposit.
- Settings -> Columns no longer exists.
- Full suite, lint and build pass; isolation cases pass on dev.
