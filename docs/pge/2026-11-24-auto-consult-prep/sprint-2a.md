# Sprint 2a: picklist labels, reuse of an existing full prep, full-brief-only emails (build spec)

Approved by Taylor (relayed by the director session, Nov 25): revision `revision-2026-11-25.md`, plus these answers:
- **Q1:** if no full brief exists at the 1-hour mark, send the facts brief, clearly marked as facts only.
- **Q2:** reuse looks ONLY in Approvals and the lead's files (do not look anywhere else).
- **Q3:** handled outside this repo.

Same limits as before:
- branch `claude/auto-consult-prep-s2` only, with no merge to main;
- no production change and no migration;
- nothing is emailed to anyone (the sender stays unset);
- nothing is client-facing;
- org-fenced;
- counts-only logs;
- tests never call Lawmatics, Resend or a model.

Read first:
- the `AGENTS.md` section "Automatic consult prep (S1, no schema)", including its review-fix bullets;
- `src/lib/consult-prep/` (engine.ts, sends.ts, brief.ts, lawmatics-intake.ts, card.ts, card-load.ts, keys.ts);
- `src/lib/lawmatics/lead-origin.ts` and `lead-origin-read.ts`;
- `src/lib/queue/resolve-batch.ts`;
- `src/lib/agents/types.ts` (`ctx.listPending`, `ctx.listApproved`).

## 1. Picklist labels (requirement 4)
- A brief must never print a raw Lawmatics option id. The case seen in production was a 6-digit number in "referral source".
- Read the account's `/custom_fields` ONCE per run (read-only client, the firm's own token). Keep, per field, its name, its type and its select options (option id to label).
  - Be tolerant of shape: options may sit under `attributes.options`, `picklist_options`, `values`, `choices` or `included`, with `id`/`value`/`key` and `name`/`label`/`value`.
  - The real shape is NOT verified; say so in AGENTS.md.
  - Reuse or extend the reader in `lead-origin-read.ts` rather than adding a second `/custom_fields` reader.
- One pure resolver, used by every Lawmatics value the brief prints:
  1. `formatted_value` when present and not itself a bare id;
  2. else the option label for a select/picklist/dropdown/radio/multi-select field (comma-join multi);
  3. else, when the value is a bare number of 3 or more digits and the field is a select type or has options, "not recorded";
  4. otherwise the value.
- A failed `/custom_fields` read never prints raw ids: select-type values (and any bare 3+ digit value) read "not recorded", and the brief names the read as failed.
- Lectual's own fields (`referral_source`, the stage name) are already labels: keep them.

## 2. Reuse an existing full prep (requirement 2)
- Before building a NEW prep for a key (not a re-run), look for an existing FULL prep for that lead in Approvals:
  - a BRIEFING item, pending or approved (read through `ctx.listPending` / `ctx.listApproved`; three-state);
  - from agent `prep-consult` or `consult-prep`;
  - linked to that lead by the queue's own `resolveBatch` rules (exactly one lead);
  - created since the consult's booking or within the firm's current calendar day. Booking = the calendar row's `created_at` when present, else the lead's `stage_entered_at`.
- "Full" is a pure detector: the text has the class, risk and package sections. Match headings case-insensitively: "likely classes", "risk read" (or "preliminary risk"), and "package recommendation".
  - A heads-up or facts-only item is NOT full.
  - Lectual's own S1 facts brief is never full.
- If one is found, ADOPT it:
  - queue NO new BRIEFING;
  - write the prep marker with `queueItemId` = that item's id and `adopted: true`;
  - every email of this prep sends THAT item's text (html = the escaped text in a pre-wrapped block);
  - the lead-page card says the prep in Approvals was used.
- A failed Approvals read means no adoption and no build for that key this run (counted, retried next run). It is never "none found".
- **The lead's files:** a reused prep must be READABLE as text, but crm_file holds PDFs and Word files whose contents this app never reads. So S2a does NOT search the files. Document that in AGENTS.md as a known limit. Do not add a file reader.

## 3. Emails carry only a full brief (requirement 1 and Q1)
- A prep's brief is `full` (adopted, or S2b's build later) or `facts` (S1's brief).
- With a `facts` brief, the `booked` and `24h` sends are NOT sent. They stay owed, and a later run that has a full brief (adoption appears, or S2b) sends them while they are still due. They are never sent late:
  - `booked` is not sent after the 24h time has passed;
  - `24h` is not sent less than 2 h before the start.
- The `1h` send goes out even with a `facts` brief, MARKED:
  - subject prefix "Facts only: ";
  - the first line of the body: "Facts only: the full prep couldn't be built in time.".
- Adoption after a facts-only 1h send changes nothing already sent.
- Keep every S1 rule (keys, idempotency, cancel-on-change, recipients guard, cutover is S2c).
- Pure tests for every branch, plus engine tests:
  - adoption found / not found / read failed;
  - a full item vs a heads-up;
  - an item from another lead or another agent ignored;
  - a facts brief withholding booked and 24h, then a later full brief sending them;
  - a marked 1h facts send;
  - picklist resolution in every case, including a failed `/custom_fields` read and a bare id that is never printed.

## Done
- lint clean (the same 15 warnings as before), tsc showing only the 11 baseline errors, and the full suite green except the known stale `tests/sprint29/hygiene.test.ts`;
- the AGENTS.md section updated with an "S2a" block, including any existing assertions changed on purpose;
- commits on the branch, pushed.
