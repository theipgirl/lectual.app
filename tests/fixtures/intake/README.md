# Monday Intake Dashboard — importer and email-sync fixtures

These fixtures are **entirely synthetic**, same convention as
`tests/fixtures/cabanis/README.md`. The real export
(`RPB Law Team Tasks.xlsx`, `Trademarks` sheet) names real founders, real
marks and real serial numbers, and is deliberately NOT stored in this
repository — it reaches the importer through `--file` at runtime and lives only
in external storage. Every name, mark and serial number below is invented.

## `trademarks-sheet.json`

The `Trademarks` worksheet as a **raw grid** — an array of rows, the first of
which is the header — exactly the shape
`recordsFromSheetRows()` (`src/lib/matters/tracker-import-plan.ts`) turns into
parse-layer records, and exactly what `scripts/import-intake-sheet.ts` gets
from `XLSX.utils.sheet_to_json(sheet, { header: 1 })`. The header keeps the real
export's quirks verbatim, because the parse rules are written against them:

- Column 0 is headed `0` and holds the **owner name**; the column actually
  headed `Trademark Owner` is blank on every row.
- `Serial No. ` keeps its trailing space.
- Column 9 has an **empty header** (a spacer). Only the first blank-header
  column may arrive under `''`, which is why the owner read is ordered
  `0` → `Trademark Owner` → `''`.

### What each row exercises

| # | Row | Exercises |
|---|---|---|
| 1 | Amara Nwosu | stage code `1`; a log with both directions — `DO sent …` (outbound) and `PNC scheduled …` (inbound) |
| 2 | Kwame Boateng | stage code `0`; **no Source** (blank classifies to `Inbound`); `Assigned To` = `TAM`, a three-letter initial that must match the two-letter display name "Taylor McGhee" |
| 3 | Priya Raman | stage code `2`; recognized source (`Melanin Money`); `Assigned To` = `DO` |
| 4 | Marguerite (Margo) Delacroix | stage code `3`; **parenthetical → `business_name`**; non-ASCII mark (`Château Bellerive`) proves the cp1252 decode; **`Priority: High` → temperature `hot`** |
| 5 | Desmond Okafor | stage code `4`; `PNC responded …` inbound entry; **typo future date `2.3.36`** in Notes, which must be clamped and flagged `date_suspect` |
| 6 | Lena Fitzgerald | stage code `5`; **unknown Source token** (buckets to `Inbound`, reported for renaming); `Priority: Low` → `cold` |
| 7 | Hollis Vance | stage code `6`; `Assigned To` = `ZZ`, initials no member matches → reported, `assigned_to` stays null |
| 8 | *(blank)* | one of the ~940 trailing empty rows — skipped silently, never reported |
| 9 | Ines Marchetti | **stage code `10` → refused** `client, not intake — use import-tracker` |
| 10 | Ola Adeyemi | stage code `2` but a status text no tenant stage is named — **refused, never parked** in the first stage |
| 11 | Beatrix Lund | status with **no stage code** → refused |
| 12 | Okonjo | single-token (mononym) owner name; `Assigned To` holding a whole pasted sentence instead of initials — reported verbatim, never read for its leading letters |

Rows 1–7 and 12 are the eight importable intake rows; 9–11 are the three
refusals; 8 is the blank.

### Rules for changing this file

- **Never paste anything from the real export into it.** Not a name, not a
  mark, not a serial number, not a note.
- Keep the header row byte-identical to the real one. The parse rules key on
  those exact strings, quirks included.
- Add rows rather than editing existing ones — the tests assert against row
  positions and on the sheet keys those rows hash to.

---

## `mail-threads.json`

One **`GET /api/mail/threads` response body** (blueprint §12.1), exactly as
lawmatics-mcp's `src/mail-threads.ts` puts it on the wire:
`{ status, detail, mailbox, since, until, count, truncated, messages: [...] }`.
It is what `--from-json` reads, so it doubles as the worked example of a saved
pull — `pnpm tsx scripts/sync-intake-email.ts … --from-json <this file>` is the
same code path the deployed API drives.

25 messages across 9 invented intake leads, in one mailbox
(`trademark@rpblawfirm.com`). The **two-mailbox merge** is tested by remapping
this same body onto `intake@rpblawfirm.com` in the test rather than by a second
file — the point of that test is that the *same message id* appears twice.

### What each thread exercises

| Lead / thread | Messages | Exercises |
|---|---|---|
| Amara Nwosu | m21, m01, m02, m03, m25 | real address → basis `email` at 1.0; three outbound touches 6 and 7 days apart → **median gap 6.5**; last touch inbound → `replied`; **m25 carries `at: null`** and must be dropped from the cadence rather than sorted to the front |
| Kwame Boateng | m04, m05, m06 | placeholder `@intake.invalid` address; name **+ mark in subject** → 0.9 → the **placeholder-email recovery** (`kwame@sankofabrew.example`); senders are two people *and* the shared mailbox; gaps 4 and 8 → median 6 |
| Mireille (Mimi) Toussaint | m22, m07, m08 | **parenthetical nickname** — the lead is filed as "Mimi Toussaint"; name alone is 0.7, so the address is matched but **never recovered** |
| Dr. Patricia Morgan | m09, m10 | **honorific dropped**; m09 reaches a second address of hers and matches by name only, m10 matches by address |
| Renée Dubois | m11, m12, m13 | **diacritics** against a lead stored as "Renee Dubois"; gaps 4 and 10 → median 7; no reply |
| Jordan Ellis ×2 | m14, m24 | **the ambiguous name** — two intake leads share it, both clear 0.7, so neither is logged |
| Hollis Vance | m23, m15 | m23 is a name-only match; m15 is a **mark-in-subject-only** message from an assistant → 0.5, below the threshold, reported not logged |
| Desmond Okafor | m16, m17 | the **sensitive thread** ("opposing counsel") → type `other`, preview dropped; m17 on the same thread is not sensitive and keeps its preview |
| — | m18, m19, m20 | vendor mail nobody's lead: **unmatched**. m20 still classifies as `loe-invoice`, proving classification is independent of matching |

Staff senders are the role mailboxes §12.3 describes — `support@` (Dawn Otiti,
DO), `rayn@` (Rayn Lathome, RL), `info@` (Taylor McGhee, TM) — plus the shared
`trademark@` box, which belongs to no member and is attributed to the mailbox.

### Rules for changing this file

- **Synthetic only.** No real client, mark, subject line, address or preview
  text, from this firm or any other. Previews here are invented sentences.
- Message **ids are the dedupe key** (`payload.message_id`) and the tests
  address messages by id, so ids are append-only: add `m26`, never renumber.
- Timestamps are chosen to make the cadence arithmetic checkable by hand. If you
  change one, recompute the median-gap expectations in
  `tests/intake/email-match.test.ts`.
