# Spec: views the firm can shape itself (Caitlyn's asks)

Status: DRAFT for Taylor's read. Nothing is built. No schema is applied.
Sources: the Nov 17 working session with Caitlyn, the Nov 23 team meeting (Caitlyn couldn't edit columns or add items), and the Nov 24 call
(add rows, edit column names, move things around; no change after the role change). The Nov 24 4:00 PM call is not in Granola.

## Taylor's decisions (Nov 25)

| Question | Answer |
|---|---|
| Whose changes are they? | **Firm-wide.** A layout change is the firm's view for everyone. |
| What is "add a row"? | **A real lead or matter.** Never a free-form line. |
| Who may change a view's structure? | **Owners** (Taylor via the director, Nov 25). No separate right. |
| Order | **Weekly review (List and Board) first, then Matters and Contracts, then Leads.** |
| Caitlyn's role | **Stays owner** (Taylor via the director, Nov 25; this replaces "senior admin" said in chat earlier the same day). |
| Stages | **Full control from a Board**: rename, reorder, add and delete stages (Taylor via the director, Nov 25). Safeguards in "Stages" below. |
| Stage roles (fixed tags rules read) | **Yes** (Taylor, in chat Nov 25: "yes do the stage tags"). Section "Stages", rule 4. |
| Settings -> Columns | **Removed.** Editing happens on the view itself. |

Still open (default chosen; Taylor can overrule before the build):
- **Each person hiding or reordering columns just for themselves.** Default: not in the first build (firm-wide only, as decided). The existing
  per-person chooser on the Weekly review List stays until the shared layout replaces it, then is removed. **Done (step 7, Nov 25).**

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
  means leaving for Settings; and the Boards, Matters, Contracts and Leads have none of it.

## The design

### 1. Who may change a view: owners

- Structure controls (column menu, add column, rename, hide, move, stage rename / reorder / add / delete) are drawn and accepted for a member
  whose membership ROW is `owner` (the 0116 pattern: a membership row, never the role claim, so Lectual staff acting inside a firm are not owners
  here). Everyone else sees the same firm layout with no structure controls, and every structure action re-checks on the server.
- It never widens what a person may read or which records they may edit; record edits keep today's gates (`CAN_WRITE_LEAD`,
  `MATTER_WRITE_ROLES`, `CAN_MOVE_STAGE`).
- Tied to the owner ROLE, not the owner VIEW: an owner previewing another view still has the controls only where the page draws them.

### 2. One editable List and one Board, used everywhere

- Extract one List component from the Weekly review's `SheetEditTable` / `SheetViewTable` and one Board from the review Board and
  `MatterBoard`, with the same names, header, toolbar, row height and card look. The Weekly review, Matters, Contracts and Leads render them with
  their own data sources and column sets. This is what makes the views look the same and agree.
- **Column header menu** (owners): Rename, Hide, Move left / Move right (and drag), Add a column to the left / right.
  For everyone else the header has no menu, only sort.
- **Add a column:** kinds Text, Choice, Date, Person, Checkbox, Money (Money stays owner-only to see and type, as decided Nov 23).
  The value is typed in the cell, like today's Notes cell.
- **Rename a built-in column** changes the firm's LABEL only. The data, filters and every rule keep working on the column's fixed key.
- **Add row:** a button at the bottom of the List opens a short inline form that creates a REAL lead (Leads, Weekly review "Leads") or matter
  (Matters, Contracts, Weekly review "Matters") through the existing `createLead` / open-a-matter paths, with today's gates. No free-form rows.
- **Board:** drag a card between stage columns (today's `moveLeadStage` / `updateMatterStage`, today's gates; never into a `won` stage from a
  lead board, as now). Stage columns are managed from the board header by owners (section "Stages").
- **Open a card on the Board:** a card opens in place (the Weekly review's `?open=` panel pattern) with a notes box at the top, so a note is
  added without leaving the board.
- Every read stays three-state; a layout that can't be read draws the default layout with one note, never an empty table.

### 3. Storage (one lectual migration, proposal first)

- 0115 is applied, so this is a NEW migration on top of it (next free number in lectual), additive only:
  - `crm_view_layout`: one row per firm and view (`review_list`, `review_board`, `matters_list`, `matters_board`, `contracts_list`,
    `contracts_board`, `leads_list`, `leads_board`), a jsonb of columns in order: key, label, hidden, width.
  - The firm's own columns and their values: 0115's field and value tables, kept as they are, now used by every List, not only the Weekly
    review (if a field needs to say which views it belongs to, that is an added column, never a rewrite of 0115).
  - Stage roles on `crm_stage` and `crm_matter_stage` (section "Stages", rule 4).
  - One SECURITY DEFINER function per stage operation (section "Stages"), owner membership row required.
- RLS on `org_id = current_org_id()`; layout writes need an owner membership row. Isolation cases for every new table, in lectual's
  `tests/tenant-isolation.test.ts`.
- Proposal file in `docs/pge/...`; applied to lectual-dev, tested, then lectual-prod ONLY with Taylor's OK. Apply to both.

### 3b. Stages (full control from a Board)

Two stage lists exist and both are managed the same way from their Board's header: lead stages (`crm_stage`: name, order, category
`open` / `won` / `lost` / `nurture`) and matter stages (`crm_matter_stage`: code, label, order, `is_open`, `waiting_on`). Today the admin
tier may already insert, update and delete them by RLS; this spec narrows the UI to owners and routes every change through one function per
operation, so the rules below hold whoever calls.

1. **Rename.** Changes the label. A matter stage's `code` never changes (code reads it). A lead stage has no code today, so rule 4 matters.
2. **Reorder.** One function moves a stage and renumbers the rest in one transaction (`unique (org_id, order_index)` on both tables would refuse a
   naive two-row swap). Lead stages keep their category; order never changes a category.
3. **Add.** Owner picks the name, the position and, for a lead stage, the category (default `open`); for a matter stage, open or closed and
   who it waits on. Adding a `won` stage shows a warning that leads moved there by a person run the matter handoff (today's behaviour).
4. **Stage roles (decided: yes, Taylor Nov 25).** Several rules find a stage by its NAME today: the new-enquiry rule (`src/lib/pipeline/new-enquiry.ts`, alias
   list), the Stage Keeper's defaults (`src/lib/agents/stage-keeper/mapping.ts`), Reconcile's milestone names (`src/lib/reconcile/milestones.ts`),
   the hired-matter sync's TM stage and won target ("Signed LOE / Deposit Received", `src/lib/lawmatics/hired-sync-plan.ts`), the USPTO wait
   (`src/lib/review/waiting.ts`), and the Matters board's "past signed engagement letter" line. A rename would silently break them. Add a
   nullable `role` to both stage tables (e.g. `new_enquiry`, `consult_scheduled`, `consult_held`, `signed_loe`, `filed`, `uspto_wait`), back-fill
   it from today's names once, and have every rule read the role first and the name only as the fallback it is today. Then a rename or reorder
   changes nothing a rule does. The role is set by the migration's back-fill and by Lectual, never typed in the board UI.
5. **Delete.**
   - A stage that holds NO records: deleted after a confirm.
   - A stage that holds leads or matters: never orphaned. The dialog says how many and asks where they go ("Move 12 leads to: [stage]"); the
     function moves them and deletes the stage in ONE transaction, and refuses if any record changed stage since the dialog opened. Each moved
     record gets its `stage_changed` timeline row (actor the owner, reason "stage deleted"). The database already refuses a delete that would
     orphan (`crm_lead.current_stage_id` NO ACTION, `crm_matter.stage_id` RESTRICT); that stays the backstop.
   - The destination may never be a `won` lead stage (a move there runs the matter handoff), may not be the stage being deleted, and for leads may
     be `open`, `lost` or `nurture` only. Matter stages: any other matter stage.
   - Refused: deleting the firm's last `open` lead stage; deleting the stage holding a role (rule 4) until another stage is given that role in the
     same dialog; deleting the last `won` stage (the hired-matter sync would then move no lead, which is allowed today but must be said, so it is
     refused unless the owner ticks "No won stage: hired clients stay where they are").
   - History is kept: earlier `stage_changed` rows name the stage by id and name in their payload, so the timeline still reads.
6. **Category changes.** A lead stage's category can change only while the stage is empty (a lead silently becoming "won" would skip the
   handoff). Matter `is_open` likewise.
7. **Unchanged rules, restated so the build cannot weaken them:** no agent or import ever targets a `won` stage; the hired-matter sync is the one
   exception (the hired lead move), and it finds its target by role, else by today's name match, else the lowest-ordered `won` stage, else no move;
   the new-enquiry stage is never `won`, `lost` or `nurture`; a person's bulk move and the Reconcile apply still refuse a `won` target. Every
   test that pins these keeps passing.

### 4. Board logic fixes (no schema)

- Matters (List and Board) shows only matters past "Signed LOE / Deposit Received"; intake stages never appear there.
- Pre-filing and post-filing are two groups on the Trademarks board; Contracts is its own List and Board.
- On stage boards (Matters, Contracts), the saved layout only hides columns; order and names are the stages' own (the stage menu is the one source).
- Weekly review List gains: Timeline (the newest outbound item, with its date) and Next step (title and real date). Load per person stays the
  Board's lanes.
- Caitlyn's view leaves out Forms and Proposals in the rail (the rail is a courtesy; the pages keep their gates).

### 5. Removed

- Settings -> Columns (`settings/columns/`, `ColumnsSettings*`, `FirmColumnsEdit`) and its rail and tab entries. Anything it did moves to the
  column header menu.
- The per-person column chooser on the Weekly review List, once the firm layout replaces it. **Done (step 7, Nov 25):** removed with its words, CSS and tests; an old stored choice is deleted once and never read; dragged column widths are kept.

## Build order

| Step | What | Who (model) | Needs |
|---|---|---|---|
| 0 | Done Nov 25 (director): Caitlyn is owner, role-views on, 0115 applied | — | — |
| 1 | Migration proposal: layouts, stage roles + back-fill, stage functions (reorder, add, delete-with-move); isolation cases | Opus | — |
| 2 | Shared List and Board components; Weekly review on them | Sonnet, Opus review | step 1 on dev |
| 3 | Column menu, add column, rename, move, add row (real records) | Sonnet, Opus review | step 2 |
| 4 | Stage management on the Board header; every name-based rule reads the role first | Opus (rules), Sonnet (UI) | step 1 on dev |
| 5 | Matters and Contracts on the shared components; the Matters stage fix | Sonnet, Opus review | step 2 |
| 6 | Leads on the shared components | Sonnet, Opus review | step 2 |
| 7 | Remove Settings -> Columns and the per-person chooser (**done Nov 25**) | Haiku/Sonnet | steps 3-6 |
| 8 | Preview walk-through with Caitlyn and Taylor | Taylor, Caitlyn | dev-backed preview |

Merge to main only with Taylor's yes. The migration goes to prod only with Taylor's OK.

## Done means

- Caitlyn, as owner, can on the Weekly review List and Board, then Matters, Contracts and Leads: add a column,
  rename any column, hide and move columns, add a real lead or matter from the List, drag a card between stages, rename, reorder, add and delete a stage (records moved first, never orphaned),
  and open a card to add a note on the Board.
- The change is the firm's view for everyone, immediately.
- A stage rename or reorder changes nothing any rule, agent or sync does (stage roles).
- A non-owner sees the same layout with no structure controls, and the server refuses a forged structure request.
- Every List and Board looks the same, and the lead page agrees with the Weekly review.
- Matters shows nothing before the signed engagement letter and deposit.
- Settings -> Columns no longer exists.
- Full suite, lint and build pass; isolation cases pass on dev.
