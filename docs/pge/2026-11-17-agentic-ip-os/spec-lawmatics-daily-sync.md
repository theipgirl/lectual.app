# Contract: Lawmatics daily sync (new prospects and booked consults)

**Status:** DRAFT v3, with Taylor's answers of Nov 23 folded in (cutoff, stored event fields, people who come back, schedule). The defaults for everything else are listed in "Defaults chosen". Nothing is built.
**Size:** medium.
**Schema:** one small migration is proposed (lectual **0118**, a proposal only: one column for "last successful run"). Everything works without it, with a fallback.
**Evaluator:** strict on the tenant fence, on "never writes to Lawmatics" and on the calendar delete rule; quality pass on the rest.

## The problem
Someone who books a consult in Lawmatics does not exist in Lectual. This week's consults have no lead and no calendar row. Today only two things come over from Lawmatics on their own:
- **Hired clients**, through the hired-matter sync (`src/lib/lawmatics/hired-sync*.ts`, daily in the 4 AM New York hour).
- **Nothing else.** The only calendar SYNC is Outlook's (`src/lib/calendar/outlook-sync.ts`). Most consult readers filter on `source = 'outlook'` or sit behind the Mailboxes feature. Two do not filter on source:
  - `src/lib/calendar/events.ts`, the calendar page's base reader. It already returns any `source = 'lawmatics'` rows, with no label and no dedupe.
  - `src/lib/intake/working-load.ts`, the Leads "Working" set.

The manual importer (Settings → Integrations → Lawmatics) can bring people in, but only when a person presses it.

## Goal
Several times a day, without anyone pressing a button:
1. A new Lawmatics prospect becomes a lead in the firm's new-enquiry stage. Someone already in Lectual (including a Lost, Won or Nurture lead) is linked instead, and flagged on Today if they "came back".
2. A consult booked in Lawmatics becomes a calendar row, linked to the lead.

Both then show on the calendar, on the lead page ("Consult booked") and on Today's Consults card (both Today layouts). The Stage Keeper can use a booked consult as evidence.

## Scope
**In**
1. **New prospects.** Each Lawmatics prospect created on or after the run's cutoff (below) that is not hired:
   - becomes a lead in the new-enquiry stage; or
   - if an unlinked lead with the same email and a name that agrees exists, is linked to it (the lead gets `lawmatics_id`) instead of being duplicated; or
   - if the email belongs to a Lost, Won or Nurture lead, is linked to that lead and flagged "came back".
2. **Consults.** Lawmatics events in the read window that are consults are stored as `crm_calendar_event` rows (`source = 'lawmatics'`). Each row carries an `external_id` that marks it as this sync's own, a title, times, a join link when there is one, and the lead link. `is_consult` is true.
   - Rescheduled events are updated.
   - Cancelled or deleted events are removed, but only this sync's own rows and only after a complete read.
   - A consult whose prospect is not yet a lead gets its lead made (one targeted read of that prospect, same matching rules).
3. **Readers widened** so Lawmatics consults appear wherever Outlook consults do (full list under "Where it shows").
4. **One route, three steps,** in the existing `/api/cron/lawmatics-matters/` route:
   - 4 AM: hired sync, then new prospects, then consults (then Adobe if Sprint 5a ships);
   - daytime runs: new prospects and consults only.
5. **"Sync from Lawmatics now"** on Settings → Integrations → Lawmatics: admin tier only, for the session's own firm, counts only.
6. **Three runs a day** (see Frequency).
7. **Client changes needed by the sync:** a per-request deadline, an `AbortSignal`, and bounded retries after a 429 on the Lawmatics client (`src/lib/lawmatics/client.ts`).
8. **A refused key marks the connection `invalid`** (an existing 0077 status), so Integrations shows "Reconnect".

**Out**
- Any write to Lawmatics. Any email, text or queue draft. Any automation rule. Opening a matter (that stays the hired sync's job, 4 AM only).
- Moving any lead's stage. The Stage Keeper may suggest one, under its own rules; it never moves a Lost, Won or Nurture lead.
- Updating an existing lead's fields (name, phone, source). The manual importer still does fill-blank updates when a person runs it.
- Lawmatics contacts with no prospect (the importer's `contactCreates`). `/contacts` is read only to fill emails and names.
- Consult prep (the `consult-prep` agent) for Lawmatics consults (default: unchanged).
- Non-consult Lawmatics events (court dates, internal meetings).
- Storing a Lawmatics event's description, body, attendee list or location (Taylor, Nov 23).

## Firm rules (same as the hired sync, plus the review's)
- **The firm's own connection only.** Service role, per ACTIVE `lawmatics_connection` row, token from `firmToken(admin, orgId)` (lectual 0077). There is no deployment-wide Lawmatics token and none is added.
- **The org comes from the connection row.** Every read is filtered on that row's `org_id`, and every insert, upsert and update is stamped with it. It never comes from Lawmatics data or from a request.
- **Sweep with `listAll`.** Lawmatics ignores query parameters silently, so any filter we send is a hint only. Every rule (created date, event window, event type) is applied again on our side.
- **Fail closed per step, per firm.**
  - A truncated, failed or unrecognised read writes nothing for that step for that firm, and is counted.
  - One firm failing never stops another.
  - The consult step still runs when the prospect step failed: it links to the leads that exist.
- **Counts only.** No names, emails, titles, event text or links anywhere a log, a cron response, `agent_run`, the button's result line or an error message can reach.
  - **`LawmaticsApiError.message` is never logged, returned or stored** (it carries up to 500 characters of Lawmatics' response body).
  - Only the HTTP status class is kept: `auth` for 401/403, `rate` for 429, `server`, `timeout`, `shape`.
- **Nothing sent, nothing fired.** No mail, no queue item, no `runRules`, no matter handoff, no Lawmatics write. A grep test holds the new files to read calls (`listAll`, `get`).
- **A refused key (401/403).**
  - The runner sets `lawmatics_connection.status = 'invalid'`. This is a value 0077's CHECK already allows, and the manual importer sets it today through `recordLawmaticsOutcome`.
  - The write uses the service role, fenced on the connection `id`, its `org_id` and `status = 'active'`. `last_error` is set to a fixed sentence only.
  - Integrations already reads an `invalid` row as "Lawmatics stopped accepting your firm's token. Reconnect to keep importing." The Lawmatics settings page shows its "Reconnect" pill.
  - The cron reads only active connections, so the firm is skipped until someone reconnects. It is counted as `reauthNeeded` in the response and named on the button's line.
- **429 (rate limited).**
  - The client waits for `Retry-After` (capped at 10 s, else 2 s then 5 s) and retries at most 2 times per request.
  - It only retries when the wait still fits the step's budget.
  - If a request is still refused, the read has failed and is counted as `rate`.
- **Caps per firm per run:** 50 lead creates (targeted prospect reads for consults included), 50 lead links, 500 calendar rows written, 200 calendar rows removed. Past a cap, the rest wait for the next run and are counted as "over the per-run limit".
- **Merged leads (lectual 0107).**
  - A merged lead is never written.
  - A Lawmatics id or email that only a merged lead holds is skipped for a lead create (the importer's `LEAD_MERGED_IMPORT_SKIP`).
  - For a calendar link or a "came back" flag, it is followed through `merged_into_id` to the keeper.
- **Three-state reads everywhere.** Each read is ok, not set up, or couldn't be read. "No consults" and "nothing new" are only said about a read that worked.

## The Lawmatics reads (exact requests)
One set of reads per firm per run, shared by the steps that need it:
1. **`/prospects`:** `listAll("/prospects", { include: "stage,practice_area,contact", params: { fields: "all" } })`.
   - This is the importer's include plus the hired sync's `fields: "all"`, in ONE request.
   - It is used by the hired step (through `normalizeHiredProspect`) and by the prospect step (through the importer's `normalizeProspect` + `mergeContact`).
   - **Not verified:** that Lawmatics honours `fields=all` and `include` together. Blocker 1 checks it. If it does not, the run makes the two requests the steps make today, and each step fails closed on its own read.
2. **`/practice_areas`:** as the hired sync reads it today. Hired step only.
3. **`/contacts`:** `listAll("/contacts")`, as `pullSource` does (`import.ts`), to fill emails and names (`mergeContact`).
   - It is a second sweep with its own 3,000-record cap, so it is a second source of truncation.
   - **For the daily prospect step, a truncated or failed `/contacts` read writes NO leads for that firm.** This is stricter than the manual importer, where a person is watching.
   - The hired step and the consult step do not depend on it.
4. **Tag and custom-field names** (`readOriginLookups`): optional. A failed read only skips the source rules that need them.
5. **`/events`:** see (b).
6. **One prospect by id** (consults only): `get("/prospects/<id>", { include: "stage,practice_area,contact" })`, plus that prospect's contact when its email is not inline.
   - Used only for a consult whose prospect is not on any lead and not in the swept list (created before the cutoff).
   - The answer must name the id that was asked for. Anything else is discarded.

**`includeDropped`.** When Lawmatics returns the prospects but drops the sideloaded records (`ListResult.includeDropped`), stage names are unknown, so `isHiredStageName` cannot fire.
- **The prospect step writes nothing for that firm** and counts it as "Lawmatics didn't return stages".
- The hired step is unaffected: it reads `status` and `converted_date`, which are attributes.

## The cutoff and "last successful run" (Taylor, Nov 23)
**The rule.**
- **First run** (no stored value): cutoff = **2026-11-01**. There is no rolling window.
- **After that:** cutoff = max(2026-11-01, last successful run − 2 days). The 2-day overlap covers a run that died part-way and Lawmatics' clock.
- **Stored value can't be read** (the read failed, or the column isn't there yet): cutoff = 2026-11-01. That is safe: matching by `lawmatics_id` and email means a prospect seen before is never created twice. It only costs planning time and the per-run cap.

**What "successful" means.** The prospect step for that firm:
- read `/prospects` and `/contacts` completely;
- kept its includes;
- finished inside its budget;
- left nothing "over the per-run limit".

Only then is "last successful run" set, to the run's START time. A run that hit the cap leaves the value where it was, so the next run picks up the rest.

**Where it is stored: no existing column fits.** I looked at:
- `lawmatics_connection.last_import_at` (0077): written by the MANUAL importer (`recordLawmaticsOutcome`) and shown on Settings as "last import". Sharing it would mix two meanings. A manual run with the practice-area filter on would also move the cutoff past people it skipped.
- `lawmatics_connection.last_verified_at`: about the token. It is reset on reconnect, which would skip everyone created while the firm was disconnected.
- An `agent_run` row: its `agent` CHECK (0098) refuses a new name without a migration. `calendar-sync` is the Outlook step's name, and reusing it would mix the two calendar reads.
- `meeting_source_connection.import_cursor`: Meetings only.
- `crm_activity` and other tenant rows: not a place for a sync's bookkeeping.

**Proposed migration: lectual 0118** (the next free number after 0117 in this plan; the generator re-checks `lectual/supabase/migrations` and this folder first, since numbers are first-merged-wins):
```sql
alter table public.lawmatics_connection
  add column if not exists last_sync_at timestamptz null;
comment on column public.lawmatics_connection.last_sync_at is
  'Start time of the last complete daily-sync prospect step (lectual.app). Written only by the service role.';
grant select (last_sync_at) on public.lawmatics_connection to authenticated;  -- read, like the other non-secret columns
-- no insert/update grant for authenticated: only the service-role runner writes it
```
- It is additive and idempotent. The table already exists, so there is no new isolation case: the 0077 case covers the row.
- Apply it to BOTH projects. It is written to this folder as `0118-proposed.sql.txt` when the generator starts, not put in lectual's chain by this contract.
- Until it is applied, the read answers 42703 and the sync uses the 2026-11-01 fallback every run.

**Writing it.** The service role writes it, fenced on the connection `id` and `org_id`. A failed write is counted; the next run then reads the older value or falls back.

**The first full run from Nov 1, and the risks.**
- Every prospect created since 2026-11-01 is planned on the first run. If that is more than 50 new leads for a firm, they arrive 50 per run (three runs a day). "Last successful run" is not set until the backlog is cleared.
- The `/prospects` and `/contacts` sweeps read EVERY record each run whatever the cutoff, because Lawmatics ignores filters. So the cutoff saves planning, not reading. The 3,000-record cap is the real risk (Blocker 1).
- **Run the first sync by hand.** Use "Sync from Lawmatics now" at a quiet hour and read its counts before the cron does it, so a surprise is seen by a person.

**Known limit.** A lead a person DELETES in Lectual comes back on the next run while its prospect is still after the cutoff: up to 2 days with the stored value, and always until 0118 is applied. Moving it to Lost or merging it is the supported way to clear one.

## (a) New prospects

**Planner:** a new pure file, `src/lib/lawmatics/prospect-sync-plan.ts`.
1. It filters the records (cutoff, hired).
2. It sets aside the "came back" people (below).
3. It calls the importer's own `planImport` (`import-plan.ts`) on the rest with the practice-area filter off, so there is one set of matching rules, not two.

From `planImport`'s result it keeps only:
- **`creates`** → insert a lead (capped at 50);
- **`updates` with `linksRecord === true` and `matchedBy === "email"`** → write `lawmatics_id` only, fenced `.is("lawmatics_id", null)` and `.is("merged_into_id", null)`. **The field changes in that update are ignored:** no fill-blank, no source, no name.

Everything else writes nothing and is counted by reason: `unchanged`, updates matched by Lawmatics id, `unmapped`, every `skipped`, and `contactCreates`, which are dropped.

**Which prospects** (filtered before `planImport`):
1. Created on or after the run's cutoff. A prospect with no readable created date is left out and counted.
2. Not hired. The prospect is left to the hired sync when its `status` is hired (case-insensitive), it has a `converted_date`, or its sideloaded stage name is a hired name (`isHiredStageName`). These are counted as "left for the hired sync".

**`planImport`'s own skips, unchanged and counted:**
- no Lawmatics id;
- the same id twice in the response;
- no usable email;
- no name on the record;
- two Lawmatics records reaching one lead;
- only a merged lead matches;
- several leads share the email;
- the email is already linked to a different Lawmatics id;
- the email belongs to a differently named lead;
- another prospect in the same pull claims the email;
- the firm has no open stage.

**Dedupe, in order:**
1. **By `lawmatics_id`.** A lead that already has this id (from the importer, an earlier run or the hired sync) → nothing. A prospect the importer already brought in is left alone, never updated by this sync.
2. **Came back (Taylor, Nov 23).** The prospect is not on any lead by `lawmatics_id`, and its email (case-insensitive) belongs to exactly ONE live lead, followed to the keeper when merged. That lead must be in a stage whose category is `lost`, `won` or `nurture`, and its name must not contradict the prospect's (the importer's `nameKey` test).
   - **Link:** the lead gets `lawmatics_id` only when it has none (fenced `.is("lawmatics_id", null)`). A lead already linked to an older Lawmatics record keeps its id. A won client's new enquiry is usually a new Lawmatics matter, and the lead row holds one id.
   - **Never move its stage.**
   - **Flag it once:** one "came back" row (below) per lead and Lawmatics prospect id.
   - **Consults link to it:** the consult step's email rule finds this lead (rule 2 of the lead link), and its prospect-id rule does too once the id was written.
   - Several leads with the email, or a contradicting name → the importer's skip, no flag.
3. **By email, open stages (the importer's rule).** Exactly one unlinked lead in an `open` stage with that email and a name that agrees → link it.
4. **Within the pull,** two prospects sharing one email → the first wins and the second is skipped.

This matters for intake forms. A person who fills in a Lectual intake form is already a lead, and is pushed to the firm's Lawmatics. The next run sees that Lawmatics record and links it by email instead of making a second lead.

**The writes (the runner's own, not the importer's).** `applyImport` writes through the signed-in scoped client and cannot be reused by a cron. The runner (`src/lib/lawmatics/daily-sync.ts`) has its own service-role writes, all stamped with the connection row's `org_id`.

- **Lead insert.**
  - Columns: `org_id`, `first_name`, `last_name`, `email`, `phone`, `business_name`, `website`, `practice_area`, `referral_source`, `referral_detail`, `current_stage_id`, `lawmatics_id`.
  - Source comes from `leadOriginFromProspect` through `normalizeProspect`. Unknown is blank, never "Lawmatics".
  - The stage is `newEnquiryStage`, never `won`, `lost` or `nurture`.
  - Rows are inserted one at a time, so a 23505 (`crm_lead_org_lawmatics_id_uniq`) is counted and the rest go on.
  - No `assigned_to`, `lane` or temperature.
- **Stage age (the rule).**
  - `created_at` = the Lawmatics created date.
  - `stage_entered_at` = the run time.
  - **`lawmatics_synced_at` is left NULL on create.**

  `stageAgeDisplay` reads "In stage since import" only when `stage_entered_at` equals `created_at` or the import time. With a past created date and no `lawmatics_synced_at`, neither matches, so the card reads "0d in stage". The link writes set `lawmatics_id` only.
- **`last_activity_at`** = the Lawmatics created date. A future or unreadable date is not written.
- **Timeline row.** One `lead_created` `crm_activity` row per created lead.
  - `actor_type system`, payload `{ source: "lawmatics-daily-sync", lawmatics_id }`.
  - It does NOT carry `lawmatics_stage_unmapped` or `hired_in_lawmatics`, so the board's "Needs a stage decision" is not flooded.
  - A failed timeline row is counted and never undoes the lead.

### "Came back": how it is recorded and shown (no migration)
**Recorded.**
- One `crm_activity` row on the lead (or the keeper): type `ai_insight` (an existing type the Stage Keeper already uses for system cards), `actor_type system`.
- Payload: `{ source: "lawmatics-daily-sync", kind: "came_back", lawmatics_id, stage_category: "lost" | "won" | "nurture" }`.
- Ids and the category only. No name, email or text.
- **Before inserting,** the runner reads whether a `came_back` row for that lead and `lawmatics_id` already exists. If it does, nothing is written, so a prospect seen again on the next run is flagged once. If that read fails, nothing is written and the event is counted (a missing flag is retried next run; a duplicate would never go away).
- The `ai_insight` readers that exist (the Stage Keeper's suggestions and reviews) select on their own `source`, so they ignore this row. A test pins that for every `ai_insight` reader.
- The lead timeline renders it from `words.ts`.

**Shown on Today** (both layouts, inside the existing "Needs you" list, `src/lib/today/load-needs-you.ts`).
- A new read, `loadCameBack` (`src/lib/today/came-back.ts`, scoped client, RLS).
  - It reads `came_back` rows of the last 14 days.
  - A row is dropped once the lead has a `stage_changed` row after it (a person dealt with it) or the lead is merged.
  - Rows are newest first, capped at 10.
- **Three states:**
  - ok with rows: one row each;
  - ok with none: nothing drawn;
  - couldn't be read: one line, "Can't show returning clients right now. Refresh to try again." It is never silence and never "none".
- **Words (`src/lib/ui/words.ts`):**
  - `CAME_BACK_LABEL` = "Came back";
  - `cameBackLine(name, category)`:
    - won → "<name> is an existing client with a new enquiry in Lawmatics (possibly a new trademark).";
    - lost → "<name> came back with a new enquiry in Lawmatics. They were marked Lost.";
    - nurture → "<name> came back with a new enquiry in Lawmatics. They were in Nurture.";
  - `CAME_BACK_UNAVAILABLE`, the sentence above.
- The row links to the lead page. The timeline line is `cameBackTimeline(category)` ("Came back: new enquiry in Lawmatics").

## How the hired sync and this sync stay apart
- **Order at 4 AM:** hired, then new prospects, then consults (then Adobe). **Daytime runs:** new prospects, then consults.
- The prospect step skips every hired prospect, so it never makes a lead for someone the hired sync makes a matter for.
- **A prospect who becomes hired after this sync made their lead:** the next 4 AM hired run finds the lead by `lawmatics_id` (its first rule), sets the matter's `lead_id` and moves the lead to the signed stage, as it does today. There is still one lead and one matter.
- **A won client's new enquiry** is linked (came back), never re-created. If it later becomes hired in Lawmatics, the hired sync makes the new matter as it does today, under its own rules.
- **Consults run last,** and re-read the firm's leads after the prospect inserts, so a consult can link to a lead made a moment earlier.
- If the `/prospects` read fails, is cut short, or drops its includes, the prospect step writes nothing. The hired step follows its own rule on its own read.

## (b) Consults

**Lawmatics resource (NOT verified against a live Lawmatics).**
- The resource is expected to be `GET /v1/events` (appointments), from the public API reference and the director's notes on lawmatics-mcp (`normalizeEvent`).
- Expected fields:
  - a title (`name`);
  - start and end;
  - `all_day`;
  - a status or cancelled flag;
  - an event type (attribute or relationship);
  - a `description`;
  - a relationship to the prospect and to invitees.
- **There is no location field; a join link, when there is one, sits in the description.**
- Attribute and relationship names are unverified. Blocker 1 checks the real shape. The normaliser tries the likely names (as `hired-sync-normalize.ts` does) and treats an unrecognised record as unusable, never guessed.

**Normaliser:** new `src/lib/lawmatics/events-normalize.ts` (pure). It returns, per event:
- id;
- title (trimmed, capped at 300);
- start, end, all-day;
- event-type name;
- cancelled;
- the prospect id from its own relationship;
- `joinUrl`;
- `attendeeEmails`.

**Kept in memory only, never stored:**
- **`joinUrl`:** the first https URL in the description whose host is on an allowlist: `zoom.us` and its subdomains, `teams.microsoft.com`, `teams.live.com`, `meet.google.com`. It is found the way the Outlook sync handles `bodyPreview`. Only the URL is kept; the description itself is dropped in the normaliser and never leaves it.
- **`attendeeEmails`:** lowercased, at most 50. Used ONLY to find the lead (rule 2 below), then dropped. They are never stored.

**Times:**
- A start or end with no UTC offset is refused (the event is unusable and counted). The exception: Blocker 1 shows Lawmatics names the zone in another field; then that named zone is used. Nothing is ever assumed.
- An all-day event is stored as UTC midnight of its civil date with `all_day = true`, the form the readers already expect.
- An event whose end is before its start is dropped and counted.

**Planner:** new `src/lib/lawmatics/consult-sync-plan.ts` (pure).
- **Window:** events that start from now − 7 days to now + 60 days. Events outside it are ignored.
- **Consult or not (`is_consult`).** lawmatics-mcp's rule is `isConsult(title)` (`src/consult.ts`, lines 77–86, sent by the director, Nov 23): lower-case the text and match when it includes `strategy session`, `discovery call`, `consult` or `initial call`.
  - **That is the same set of words as Lectual's `isConsultTitle`** (`src/lib/calendar/outlook-parse.ts`, case-insensitive `strategy session|discovery call|consult|initial call`). So `isConsultTitle` is reused, with no second predicate. A test pins that the two agree on a table of titles.
  - It is applied to the event TYPE name (e.g. "Complimentary Consultation") OR the title (e.g. "30 Minute Consultation - <client>", "Topic: Discovery Call with <staff> - <client>").
- **Which events are stored:** consults only. A non-consult event is not stored. One of this sync's own rows that is no longer a consult is removed like a vanished one.
- **Lead link (in order),** against the leads re-read after the prospect step:
  1. the event's own prospect id equals a lead's `lawmatics_id`, followed through `merged_into_id` to the keeper;
  2. else exactly ONE lead whose email equals an attendee email, case-insensitive (`buildLeadIndex` + `linkLead`, the Outlook rule; none or two is null, never a guess), also followed to the keeper. A Lost, Won or Nurture lead found this way is linked like any other, and its stage is not touched.
  3. **else, the prospect itself (default chosen).** If the event names a prospect id that no lead holds, the runner reads that ONE prospect (read 6). It runs it through the same rules as (a): not hired, matching by id, came back, email, the importer's skips. The result is then:
     - a new lead in the new-enquiry stage, or
     - a link, or
     - a came-back flag, or
     - nothing.

     This ignores the cutoff (a booked consult is evidence enough). It counts toward the 50-create cap. A failed or mismatched read leaves the consult unlinked and is counted.
  4. else null. The row is still stored and shows on the calendar, unlinked.
- **Matter link:** `matter_id` = the matter whose `lawmatics_id` equals the event's prospect id, when exactly one exists in the firm; else null.
- **This sync's own rows are marked.**
  - `external_id` = `lmsync:` + the Lawmatics event id, at most 256 characters (a longer id is unusable and counted).
  - Every upsert, update and delete is fenced on `org_id`, `source = 'lawmatics'` AND `external_id like 'lmsync:%'`.
  - A `source = 'lawmatics'` row without that prefix (legacy, from the unmerged 0059 work, or written by anything else) is never updated or deleted.
- **Columns written (Taylor, Nov 23: title, times and the lead link; no location, description or attendee list):**
  - `org_id` (from the connection row);
  - `source = 'lawmatics'`, `external_id` (as above), `lawmatics_id` = the bare event id;
  - `title`, `starts_at`, `ends_at`, `all_day`, `event_type`;
  - `lead_id`, `matter_id`, `is_consult = true`;
  - `join_url`: the URL only, when one was found (default chosen). It helps the Today and calendar dedupe with Outlook and Zoom by join link;
  - `synced_at`.

  These stay NULL: `location`, `attendee_emails`, `organizer_email`, `mailbox_connection_id`, `contact_name`. No description or body column exists, and none is added.
- **Upsert key:** `onConflict: "org_id,source,external_id"` (0098's plain unique constraint, the one the Outlook sync uses).
  - If a row that is not this sync's already holds the same `(org_id, lawmatics_id)` (0059's unique), the write fails with 23505. It is counted as "held by an older Lawmatics row", and the other row is left untouched.
  - The pre-build checks decide whether that can happen at all.
- **Rescheduled:** the same event id with new times updates the row.
- **Cancelled or vanished.** Rows are removed only after a COMPLETE read: no page failed, the read was not truncated, the shape was recognised, and the read finished inside the budget.
  - Only this sync's own rows with that `org_id` and a `starts_at` inside the window are removed.
  - Ids are computed from a select first, then deleted in small `in` chunks (the Outlook sync's method).
  - An event Lawmatics marks cancelled counts as vanished.
  - A cut-short or failed read writes nothing for that firm (no upserts either).

**Privacy note.** What is stored about a Lawmatics consult is its title, times, type, the join URL and the lead and matter links.
- Titles can carry a client's name ("30 Minute Consultation - <client>"). They are firm data, read only through RLS by that firm's members, like Outlook titles today, and they are never logged or counted by name.
- The description is read in memory only, to find a join URL, and never stored.
- Attendee addresses are read in memory only, to find the lead, and never stored.

## Where it shows (readers to change)
| Place | File(s) | Change |
|---|---|---|
| Calendar page, base read | `src/lib/calendar/events.ts` | Already returns every source, Lawmatics included, with no label and no dedupe. It gains `source`, `external_id` and `join_url` in its select. On 42703 (a database without 0098) it falls back to today's columns. |
| Calendar page | `src/app/dashboard/calendar/page.tsx` (≈214–221) | Today the Outlook half reads only behind `orgHasModule("mailbox")`. Lawmatics rows come from the base read whatever the Mailboxes feature says, labelled "Lawmatics". A Lawmatics consult and an Outlook consult that are the same call (a shared `joinKey`, or the same lead with starts within 15 minutes) show once, and the Outlook row is kept. |
| Lead page "Consult booked" | `src/app/dashboard/leads/[id]/page.tsx` (≈189, `hasMailbox ? loadBookedConsult(...)`), `src/lib/calendar/outlook-read.ts` | Split into two reads. Outlook keeps its Mailboxes gate. A new `loadBookedLawmaticsConsult` (`src/lib/calendar/lawmatics-read.ts`) runs whenever Lawmatics is connected, NOT behind Mailboxes. The card shows the earliest of the two. |
| Lead step facts | `src/lib/lead-step/load.ts` `readConsult` (≈207–216) | Today it returns `notSetUp("mailbox-off")` before reading anything. It reads Lawmatics consults first; the Mailboxes gate applies to the Outlook half only. |
| Today's Consults card, logic | `src/lib/calendar/consult-sources.ts`, `consult-sources-live.ts` | A third source, `lawmatics`, with its own `SourceState` and `sourceNote` sentence. `TodayConsultsResult` gains `lawmatics`. Merge: one row per call (a shared `joinKey`, OR the same lead with starts within 15 minutes). Twins are kept in the order Outlook, Lawmatics, Zoom, and a lead link found on any twin is kept. |
| Today's Consults card, UI | `src/components/calendar/TodayConsults.tsx` (≈9, 20) | The hard-coded `SOURCE_LABEL` and the source list gain `lawmatics: "Lawmatics"`. |
| Owner Today | `src/components/today/OwnerToday.tsx`, `src/components/today/owner/OwnerConsults.tsx` (≈10, 24) | Same, plus the "Came back" rows. |
| Today "Needs you" | `src/lib/today/load-needs-you.ts`, new `came-back.ts` | The "Came back" rows (above). |
| Leads "Working" set | `src/lib/intake/working-load.ts` | Already reads every source (no change; a test pins that Lawmatics consults count, and that a legacy non-consult row does not). |
| Stage Keeper | `src/lib/agents/stage-keeper/run.ts` `readConsults` | Reads `source in ('outlook','lawmatics')`, with Lawmatics limited to this sync's own rows. See "Stage Keeper evidence". |
| Held-consult last touch | `src/lib/stage-keeper/held-consult.ts` | Reads both (this sync's own Lawmatics rows). Forward only, as now. |
| Morning brief consults | `src/lib/agents/morning-brief/sections.ts` | Reads both. The Lawmatics half is not behind the Mailboxes feature. |
| Consult prep | `src/lib/agents/consult-prep/run.ts` | Unchanged (Outlook only; default chosen). |

**Stage Keeper evidence (default chosen).** A Lawmatics consult may have been booked by the client themselves through a Lawmatics scheduler, which is weaker evidence than a call the firm organised.
- It becomes a Stage Keeper SUGGESTION card (the existing `ai_insight` path a person accepts), never a move, whatever the agent's autonomy.
- It gives nothing at all for a lead that is not in an `open` stage, so a came-back Lost, Won or Nurture lead is never moved or suggested out of its stage.
- Every other Stage Keeper rule holds, with `signal_key` = `<lead>:calendar:<row id>`.
- When the same call is in Outlook and Lawmatics, the Outlook signal acts and the Lawmatics key is recorded among `also_signal_keys`.

## Frequency (Taylor, Nov 23: the full run at 4 AM plus daytime runs)
**What the repo shows.**
- `vercel.json` has **8** cron entries today: four jobs, each as an EST/EDT pair one UTC hour apart.
- `shouldRunNow` (`src/lib/cron/ny-hour.ts`) lets through only the tick in the job's New York hour.
- AGENTS.md treats the project as **Hobby** ("on Hobby a cron fires anywhere in its scheduled hour").

**Hobby limits** (to re-check on Vercel's limits page before merging): each entry runs at most once a day, at an imprecise time within its hour. The entry count per project is limited; it was 100 on every plan when last documented, so 12 is well within it. If the page now says otherwise, the generator stops and asks.

**Final schedule (current plan, Hobby): 12 entries, 4 of them new.**
| New York time | What runs | Entries (UTC, EST / EDT) |
|---|---|---|
| ~4:08 AM (existing) | hired, new prospects, consults, Adobe | `8 9` / `8 8` (unchanged) |
| ~12:08 PM (new) | new prospects, consults | `8 17` / `8 16` |
| ~4:08 PM (new) | new prospects, consults | `8 21` / `8 20` |

The other six entries (meetings-import, mailbox-sync, agents) are unchanged.

Checked by hand: in winter (UTC−5) the ticks that land in an allowed hour are 9→4, 17→12 and 21→16. In summer (UTC−4) they are 8→4, 16→12 and 20→16. Every other tick lands in an hour that is not allowed. `tests/cron/ny-hour.test.ts` proves it for every day of 2026 and 2027.

On Pro this would be one hourly entry from 7 AM to 7 PM New York. That is not built unless the plan changes.

**Ordering on Hobby is not guaranteed inside one hour.**
- `lawmatics-matters` and `mailbox-sync` both fall in the 4 AM hour, and either can fire first. The Stage Keeper also runs in the 5 AM agents cron (a second run is a no-op through `signal_key`), so a consult stored at 4 AM is seen at the latest at 5 AM.
- Consults stored by a daytime run reach the Stage Keeper the next morning. They show on the calendar, the lead page and Today right away.

**The guard.**
- `INTENDED_NY_HOUR` becomes `Record<CronJob, readonly number[]>`. Every existing job keeps a one-element list; `lawmatics-matters` gets `[4, 12, 16]`.
- The job id and the route path are NOT renamed.
- `shouldRunNow` returns the matched hour, so the route knows whether it is the 4 AM tick (full) or a daytime tick.
- Allowed hours for one job must be at least 2 apart. Adjacent hours would let both entries of a pair through. A unit test checks the table.

**Daily only (default chosen):** the hired sync (including its lead-to-won move) and the Adobe sweep run on the 4 AM tick only. Daytime ticks skip them.

**Budget (the route has `maxDuration = 300`).**
- **Lawmatics client:** every request gets a 20 s deadline (`src/lib/http/timeout.ts`) and accepts an `AbortSignal`. The 429 retries (above) count against the step's slice.
- **Wall budget:** 270 s, leaving 30 s of headroom. Firms run one after another.
- **Per firm:** at most 150 s. Inside that:
  - hired step: up to 60 s (4 AM only);
  - prospect step: up to 45 s;
  - consult step: up to 45 s (targeted prospect reads included).
- **Adobe:** up to 60 s at 4 AM, after all firms, inside what is left.
- **Starting:** a step whose slice cannot fit is skipped and counted, never started. A firm is not started with under 60 s left.
- **Mid-step:** a step that runs out of time aborts and writes nothing. It does not set "last successful run".

## "Sync from Lawmatics now"
- One button on Settings → Integrations → Lawmatics, replacing "Sync hired matters now" (default chosen). It runs every step a 4 AM run does, except Adobe.
- `syncLawmaticsAction`:
  - re-resolves the role inside the action (`requireImportAdmin`: owner, admin, senior admin);
  - takes the org from `resolveFirmSession()`, never the form;
  - passes the runner `{ orgId }`.
- **Its own budget:** the settings page segment exports `maxDuration = 300`, and the action passes the runner a 240 s budget.
- **Result line,** counts only, e.g. "Added 3 leads, linked 1, 1 came back, 2 need a look. 4 consults updated, 1 removed. Added 0 matters, linked 0."
  - A failed step names the step, never raw text.
  - A refused key: "Lawmatics no longer accepts your firm's key. Reconnect it above."
  - Out of time: "Lawmatics took too long. Try again shortly."
  - No connection: "Lawmatics isn't connected for your firm."
- `revalidatePath` for the Leads list, the calendar, Today and the settings page.

## Data (migrations)
**Proposed: lectual 0118**, one column, `lawmatics_connection.last_sync_at` (see "The cutoff"). Everything else needs no migration. Checked against the migration text in `lectual`:
- `crm_lead.lawmatics_id` has the partial unique index `crm_lead_org_lawmatics_id_uniq (org_id, lawmatics_id) where lawmatics_id is not null` (0034).
- `lawmatics_connection.status` allows `'active' | 'invalid' | 'revoked'` (0077). `invalid` keeps the token (only `revoked` must have none), so the refused-key write is allowed.
- `crm_activity` type `ai_insight` exists, so the came-back row needs no schema.
- `crm_calendar_event` (0059 base + 0098):
  - `source in ('lawmatics','outlook')`;
  - `lawmatics_id` nullable but required for `source = 'lawmatics'`;
  - `external_id` optional for Lawmatics rows, at most 256 characters;
  - unique `(org_id, lawmatics_id)` and unique `(org_id, source, external_id)`;
  - `join_url` must be https (0098 CHECK);
  - composite FKs keep `lead_id` and `matter_id` in the same firm.

  The planned row satisfies all of these.
- **Tenant isolation:** no new table, so no new isolation case.

**Read-only checks before building** (on lectual-dev AND lectual-prod; the generator writes up the answers in this folder and stops on a surprise):
1. **Legacy Lawmatics rows:** `select org_id, count(*), min(synced_at), max(synced_at), count(external_id) from crm_calendar_event where source = 'lawmatics' group by org_id`. Also confirm that no row already has `external_id like 'lmsync:%'`.
2. **Who writes them today:** a recent `max(synced_at)` means something still writes them. Search lectual, lectual.app and (by a person) lawmatics-mcp for a writer. By default this sync never touches them.
3. **f3loev's 0063 `call_kind` column:** `select column_name, is_nullable, column_default from information_schema.columns where table_name = 'crm_calendar_event'`. If any column outside 0059/0098 exists live, say whether a Lawmatics row would trip a NOT NULL or CHECK on it.
4. **Live constraint names:** `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.crm_calendar_event'::regclass`. Confirm the upsert target `crm_calendar_event_source_external_uniq` and `crm_calendar_event_lawmatics_uniq`, and that no other unique key exists.
5. **`lawmatics_connection` columns live:** confirm that `last_sync_at` is absent before 0118, and that the status CHECK is 0077's.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Lawmatics connection | runs | no active connection (`invalid` included): firm skipped | connection read failed: route answers 500 with a fixed reason, nothing written |
| `last_sync_at` | cutoff = max(Nov 1, value − 2 days) | before 0118: Nov 1 | Nov 1 (safe: matching prevents duplicates) |
| `/prospects` (+ includes) | plan | (n/a) | truncated / failed / unrecognised / includes dropped: no leads for that firm, counted |
| `/contacts` | emails filled | (n/a) | truncated / failed: no leads for that firm, counted |
| `/events` | plan | (n/a) | truncated / failed / unrecognised / out of time: no calendar row written or removed, counted |
| One prospect by id | rules applied | (n/a) | consult stored unlinked, counted |
| Refused key (401/403) | (n/a) | (n/a) | connection set `invalid`, counted as `reauthNeeded`, said on the button and Integrations |
| Came-back flag exists? | write or skip | (n/a) | no flag written, counted |
| Today "Came back" | rows / nothing | (n/a) | "Can't show returning clients right now. Refresh to try again." |
| Lead page, Today, calendar (Lawmatics half) | consults | Lawmatics not connected: "Consults from Lawmatics aren't shown: Lawmatics isn't connected." | "Lawmatics consults couldn't be read just now." Never "No consults". |

## MUST NEVER HAPPEN
- A write to Lawmatics. A send of any kind. A queue draft. An automation rule fired. A matter opened outside the 4 AM hired step.
- Any lead's stage moved by this sync. Any lead put in a `won`, `lost` or `nurture` stage by it. A Lost, Won or Nurture lead moved because it came back.
- A second lead for a person who already has one.
- A row stamped with another firm's `org_id`, or a lead or matter link to another firm's record.
- A calendar row removed after an incomplete read, or ANY `source = 'lawmatics'` row without the `lmsync:` prefix updated or removed.
- A description, body, location or attendee address stored, logged or counted. Any URL other than an allowlisted https join link stored.
- `lawmatics_stage_unmapped` / `hired_in_lawmatics` written by the daily sync. Two came-back rows for one lead and prospect.
- A name, email, title, link or `LawmaticsApiError.message` in a log, response, `agent_run` row, result line, `last_error` or error text.
- A failed read shown as "no consults", "nothing new" or no returning clients.
- "Last successful run" set by a run that was cut short, failed or left people over the cap.
- The service role in dashboard code. The button's action uses the session only and hands the org id to the runner, as `syncHiredMattersAction` does today.

## Files likely touched
- **New:**
  - `src/lib/lawmatics/prospect-sync-plan.ts`, `consult-sync-plan.ts`, `events-normalize.ts`;
  - `src/lib/lawmatics/daily-sync.ts` (the runner: reads, steps, budgets, cutoff, its own writes);
  - `src/lib/calendar/lawmatics-read.ts`;
  - `src/lib/today/came-back.ts`;
  - `docs/pge/2026-11-17-agentic-ip-os/0118-proposed.sql.txt`.
- **Changed:**
  - `src/lib/lawmatics/client.ts` (deadline, signal, 429 retries), `hired-sync.ts` (accepts the shared read; its rules unchanged);
  - `src/app/api/cron/lawmatics-matters/route.ts`, `src/lib/cron/ny-hour.ts`, `vercel.json` (4 new entries);
  - `src/app/dashboard/settings/integrations/lawmatics/{actions.ts,page.tsx}` and the button component;
  - `src/lib/calendar/{consult-sources,consult-sources-live,outlook-read,events}.ts`, `src/app/dashboard/calendar/page.tsx`;
  - `src/app/dashboard/leads/[id]/page.tsx`, `src/lib/lead-step/load.ts`;
  - `src/components/calendar/TodayConsults.tsx`, `src/components/today/OwnerToday.tsx`, `src/components/today/owner/OwnerConsults.tsx`;
  - `src/lib/today/load-needs-you.ts`, the lead timeline formatter;
  - `src/lib/agents/stage-keeper/run.ts`, `src/lib/stage-keeper/held-consult.ts`, `src/lib/agents/morning-brief/sections.ts`;
  - `src/lib/ui/words.ts`, `src/lib/db/types.ts` (`last_sync_at`, hand-added until codegen).
- **AGENTS.md:** a "Lawmatics daily sync" section, and the cron notes updated.

## Tests to write
**Pure planner, prospects** (`tests/lawmatics/prospect-sync-plan.test.ts`):
1. Cutoff:
   - no stored value → 2026-11-01;
   - stored value → max(Nov 1, value − 2 days);
   - an unreadable value → Nov 1;
   - a prospect before the cutoff, or with no created date → nothing.
2. "Last successful run" is set only for a complete prospect step with nothing over the cap, to the run's start time. A cap hit leaves it unchanged.
3. A lead with that `lawmatics_id` → nothing written.
4. Email matches:
   - one unlinked open-stage lead with the same or a blank name → writes `lawmatics_id` only, even when `planImport` lists field changes;
   - a differently named lead → skipped;
   - two leads → skipped;
   - an open-stage lead linked to another Lawmatics id → skipped.
5. Came back:
   - a Lost, Won or Nurture lead with the email → linked (id only when it had none), stage unchanged, one `came_back` row with the right `stage_category`;
   - a second run → no second row;
   - an unreadable "already flagged" read → no row;
   - a merged lead → its keeper.
6. Hired by `status`, by `converted_date`, or by sideloaded stage name → "left for the hired sync".
7. `includeDropped`, or a truncated or failed `/contacts` → no leads for that firm.
8. Stage age: `lawmatics_synced_at` null, `stage_entered_at` = run time, `created_at` and `last_activity_at` = the Lawmatics created date; `stageAgeDisplay` reads "0d in stage".
9. No email, no name → skipped and counted. Two prospects with one email → one create.
10. Never a `won`, `lost` or `nurture` target (property test). A firm with no open stage → nothing.
11. Source comes from `leadOriginFromProspect`; nothing known → blank. `contactCreates` are dropped.
12. Over 50 creates → 50 planned, the rest counted, cursor not advanced.

**Pure planner, consults** (`tests/lawmatics/consult-sync-plan.test.ts`, `events-normalize.test.ts`):
13. Consult matching:
    - "30 Minute Consultation - X" by title, "Complimentary Consultation" by event type, "Topic: Discovery Call with Y - X", "Strategy Session" and **"Initial call"** → consult;
    - "Court hearing" → not stored;
    - `isConsultTitle` agrees with a copy of lawmatics-mcp's `isConsult` on the whole table.
14. Links:
    - prospect id first; else one lead by attendee email; two or none → next rule;
    - a merged lead → its keeper;
    - a lead created earlier in the same run is linked;
    - a Lost lead is linked and not moved.
15. A prospect outside the cutoff with a consult and no lead → one targeted read, then the same rules (new lead, link or came back). A read that fails or names another id → unlinked and counted. These count toward the 50 cap.
16. A matter is linked only when exactly one matter has the prospect id.
17. Times:
    - no offset → refused;
    - all-day → UTC midnight with `all_day`;
    - end before start → dropped.
18. Stored fields:
    - `location`, `attendee_emails`, `organizer_email` and `contact_name` are null;
    - no description text reaches any column;
    - `join_url` is set only for an https Zoom, Teams or Meet link found in the description;
    - any other link → null.
19. Rescheduled → one update. Cancelled → removal.
20. Complete read:
    - this sync's own row in the window and missing from the read → removed;
    - outside the window → kept;
    - a legacy row without `lmsync:` → never touched;
    - an Outlook row → never touched.
21. Unrecognised record shapes → unusable, never guessed.

**Runner, fake fetch** (`tests/lawmatics/daily-sync.test.ts`; tests never call Lawmatics):
22. Every write carries the connection row's `org_id`. A second firm's connection writes only its own rows.
23. The `/prospects` request carries both `include=stage,practice_area,contact` and `fields=all`. `/contacts` is swept.
24. Truncated `/prospects` → no lead, and consults still run. Truncated `/events` → no calendar write or delete.
25. Order:
    - 4 AM is hired, prospects, consults;
    - a daytime tick runs no hired step and no Adobe step;
    - a prospect made a lead in the daytime and hired before the next 4 AM gets one lead and one matter.
26. Idempotent: a second run with the same data → no writes. A 23505 is counted, and the run goes on.
27. No Lawmatics write method is called (spied). A grep test holds the new files to `listAll` / `get`.
28. Counts only: nothing logged or returned contains a fixture name, email, title, link, description or a `LawmaticsApiError` body.
29. 401:
    - the connection is set `invalid` (fenced on id, org and `active`) with a fixed `last_error`;
    - `reauthNeeded` is counted;
    - the next run skips that firm.
30. 429:
    - waits for `Retry-After` (capped) and retries at most twice inside the budget;
    - still refused → a failed read.
31. Budget:
    - a hung request is aborted at its deadline;
    - a step that cannot fit is skipped;
    - nothing is planned past 270 s;
    - a cut-short step does not set "last successful run".
32. The `lead_created` row carries `source: "lawmatics-daily-sync"` and no `lawmatics_stage_unmapped`.

**Route guard** (`tests/cron/routes.test.ts`, `tests/cron/ny-hour.test.ts`):
33. The route:
    - without `CRON_SECRET` → 401;
    - outside the allowed hours → 200 `{ skipped: "not this hour" }` with nothing read.
34. The guard table:
    - each allowed hour (4, 12, 16) runs exactly once every day of 2026 and 2027;
    - allowed hours are at least 2 apart;
    - `vercel.json` has exactly 12 entries, and the pairs above.

**Button gate** (`tests/lawmatics/sync-now-action.test.ts`):
35. Owner, admin and senior admin run it for their own firm only. Every other role, signed out and an unreadable role → a fixed sentence, and the runner is never called.
36. The result line is counts only. A refused key, out of time and a failed step each have their own sentence.

**Readers:**
37. Today's card (both layouts):
    - Lawmatics source states and labels;
    - an Outlook and a Lawmatics row for the same call (same join link, or same lead within 15 minutes) show once;
    - a Lawmatics failure never hides Outlook or Zoom.
38. Lead page and `lead-step/load.ts`: a Lawmatics consult shows for a firm WITHOUT the Mailboxes feature.
39. Calendar page: a Lawmatics row is labelled, a twin shows once, and Lawmatics rows show without Mailboxes.
40. Today "Came back":
    - three states, and the words come from `words.ts`;
    - a row disappears after a later `stage_changed` on the lead;
    - every existing `ai_insight` reader ignores `came_back` rows.
41. Stage Keeper:
    - a linked future Lawmatics consult gives a suggestion card, never a move;
    - a Lost, Won or Nurture lead gives nothing;
    - a sensitive title gives nothing;
    - a legacy row gives nothing.

## Done when
- Tests 1 to 41 pass, plus `pnpm test`, `pnpm lint`, `pnpm build`.
- The five pre-build checks are answered on dev and prod and written up in this folder.
- Blocker 1 is answered, and the normaliser's names are updated to it.
- `0118-proposed.sql.txt` is in this folder. Whether it is applied is the owner's call; the code works either way.
- On lectual-dev with a test Lawmatics account:
  - a first "Sync from Lawmatics now" brings in prospects since Nov 1 (counts read by a person);
  - a new prospect appears as a lead reading "0d in stage";
  - a prospect whose email is on a Lost lead shows "Came back" on Today and leaves the stage alone;
  - a consult appears on the lead page, both Today layouts and the calendar, with no location or attendee list stored;
  - rescheduling moves it, and cancelling removes it;
  - a revoked test key turns the connection to "Reconnect".
- AGENTS.md has the new section, and `vercel.json` has the 12 entries above.

## Blockers
1. **The Lawmatics shape.** A person runs it, outside tests, with the firm's own token, and records only attribute and relationship NAMES and counts, no client data:
   - the `GET /v1/events` record shape and where the description and invitees sit;
   - whether `/events` honours a date filter;
   - how times are given (offset or named zone) and how all-day events are marked;
   - the totals of events, prospects and contacts;
   - whether `/prospects` honours `fields=all` and `include` together;
   - whether `GET /prospects/<id>` works with `include`;
   - whether 429s carry `Retry-After`.

   The client's safety cap is 3,000 records per sweep. If any total is over it and the date filter is ignored, every read is cut short and nothing ever syncs. If so, the generator stops and asks.
2. **The pre-build checks** above.

## Defaults chosen (Taylor may override)
1. **Refused key (401/403):** the connection is set to `invalid` (0077's existing value, the same one the manual importer sets), so Integrations shows "Reconnect", and the cron skips the firm until someone reconnects. No migration.
2. **A consult for a prospect outside the cutoff:** that prospect's lead is still made (or linked, or flagged came back) through one targeted read, with the same matching rules. It counts toward the cap.
3. **Rate limits (429):** wait for `Retry-After` (capped at 10 s, else 2 s then 5 s), at most 2 retries per request, only inside the step's budget; still refused = a failed read.
4. **Stage Keeper:** a Lawmatics consult makes a suggestion card, never an automatic move, and nothing at all for a lead outside an open stage.
5. **A prospect with no email:** skipped and counted ("need an email in Lawmatics"), as the importer does.
6. **Consult prep:** stays Outlook only.
7. **Intake link:** match by email only. The intake submission's `lawmatics_contact_id` is not used (it names a contact, not the prospect).
8. **Button:** one "Sync from Lawmatics now" (hired matters, new leads, consults), replacing "Sync hired matters now".
9. **Time zone:** a time with no UTC offset is refused, never guessed. All-day events are stored as UTC midnight of their date.
10. **Legacy Lawmatics calendar rows:** never updated or deleted by this sync (only `lmsync:` rows are its own).
11. **Daytime runs:** new prospects and consults only. Hired matters, the hired lead move and the Adobe check stay at 4 AM.
12. **Join link:** stored as the URL only, from an allowlisted https Zoom, Teams or Meet link in the description. The description is never stored.
13. **"Came back" on Today:** shown for 14 days, or until someone moves the lead's stage.

## OPEN QUESTIONS for Taylor
None remain for the contract to proceed. Each default above stands unless Taylor overrides it. Applying migration 0118 is the owner's call: without it, every run plans from 2026-11-01, which is safe but brings deleted leads back.
