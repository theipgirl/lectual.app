# Contract: Lawmatics daily sync (new prospects and booked consults)

**Status:** DRAFT v2 for Taylor's approval, revised after the strict review (Nov 23). Nothing is built.
**Size:** medium. **Schema:** none expected (checks below, some to run before building). **Evaluator:** strict on the tenant fence, on "never writes to Lawmatics" and on the calendar delete rule; quality pass on the rest.

## The problem
Someone who books a consult in Lawmatics does not exist in Lectual. This week's consults have no lead and no calendar row. Today only two things come over from Lawmatics on their own:
- **Hired clients**, through the hired-matter sync (`src/lib/lawmatics/hired-sync*.ts`, daily in the 4 AM New York hour).
- **Nothing else.** The only calendar SYNC is Outlook's (`src/lib/calendar/outlook-sync.ts`). Most consult readers filter on `source = 'outlook'` or sit behind the Mailboxes feature. Two do not filter on source: `src/lib/calendar/events.ts` (the calendar page's base reader, which already returns any `source = 'lawmatics'` rows, with no label and no dedupe) and `src/lib/intake/working-load.ts` (the Leads "Working" set).

The manual importer (Settings → Integrations → Lawmatics) can bring people in, but only when a person presses it.

## Goal
Every day, without anyone pressing a button:
1. A new Lawmatics prospect becomes a lead in the firm's new-enquiry stage.
2. A consult booked in Lawmatics becomes a calendar row, linked to the lead.

Both then show on the calendar, on the lead page ("Consult booked") and on Today's Consults card (both Today layouts), and the Stage Keeper can use a booked consult as evidence.

## Scope
**In**
1. **New prospects.** Each Lawmatics prospect created on or after the cutoff and inside the rolling window, that is not hired, becomes a lead in the new-enquiry stage. An unlinked lead with the same email and a name that agrees is linked (it gets `lawmatics_id`) instead of being duplicated.
2. **Consults.** Lawmatics events in the read window that are consults are stored as `crm_calendar_event` rows with `source = 'lawmatics'` and an `external_id` that marks them as this sync's own. They are linked to a lead and set `is_consult = true`. Rescheduled events are updated. Cancelled or deleted events are removed, but only this sync's own rows and only after a complete read.
3. **Readers widened** so Lawmatics consults appear wherever Outlook consults do (full list under "Where it shows").
4. **One route, three steps,** in the existing `/api/cron/lawmatics-matters/` route. The 4 AM run is hired sync, then new prospects, then consults (then Adobe if Sprint 5a ships). The daytime runs are new prospects and consults only.
5. **"Sync from Lawmatics now"** on Settings → Integrations → Lawmatics: admin tier only, for the session's own firm, counts only.
6. **More than one run a day** (see Frequency; the plan decides how many).
7. **Client changes needed by the sync:** a per-request deadline and an `AbortSignal` on the Lawmatics client (`src/lib/lawmatics/client.ts`).

**Out**
- Any write to Lawmatics. Any email, text or queue draft. Any automation rule. Opening a matter (that stays the hired sync's job, 4 AM only). Moving an existing lead's stage (the Stage Keeper may act on the evidence, under its own rules and open question 4).
- Updating an existing lead's fields (name, phone, source). The manual importer still does fill-blank updates when a person runs it.
- Lawmatics contacts with no prospect (the importer's `contactCreates`). Only prospects become leads daily; `/contacts` is read only to fill emails and names.
- Consult prep (the `consult-prep` agent) for Lawmatics consults: open question 6.
- Non-consult Lawmatics events (court dates, internal meetings): open question 2.
- Changing `lawmatics_connection.status` on a refused key (open question 15; counted, not stored, by default).

## Firm rules (same as the hired sync, plus the review's)
- **The firm's own connection only.** Service role, per ACTIVE `lawmatics_connection` row, token from `firmToken(admin, orgId)` (lectual 0077). There is no deployment-wide Lawmatics token and none is added.
- **The org comes from the connection row.** Every read is filtered on that row's `org_id`, and every insert, upsert and update is stamped with it. It never comes from Lawmatics data or from a request.
- **Sweep with `listAll`.** Lawmatics ignores query parameters silently, so any filter we send is a hint only. Every rule (created date, event window, event type) is applied again on our side.
- **Fail closed per step, per firm.** A truncated, failed or unrecognised read writes nothing for that step for that firm, and counts it. One firm failing never stops another. The consult step still runs when the prospect step failed: it links to the leads that exist.
- **Counts only.** No names, emails, titles, event text, locations or links anywhere a log, a cron response, `agent_run`, the button's result line or an error message can reach. **`LawmaticsApiError.message` is never logged or returned:** it carries up to 500 characters of Lawmatics' response body. Only the HTTP status class is kept (`auth` for 401/403, `rate` for 429, `server`, `timeout`, `shape`).
- **Nothing sent, nothing fired.** No mail, no queue item, no `runRules`, no matter handoff, no Lawmatics write. A grep test holds the new files to read calls (`listAll`, `get`).
- **A refused key is visible.** A 401 or 403 from Lawmatics counts the firm as `reauthNeeded` (separately from other failures) in the cron response and in the button's line ("Lawmatics no longer accepts your firm's key. Reconnect it above."). Open question 15 asks whether the connection should also be marked.
- **Caps per firm per run:** 50 lead creates, 50 lead links, 500 calendar rows written, 200 calendar rows removed. Past a cap, the rest wait for the next run and are counted as "over the per-run limit".
- **Merged leads (lectual 0107).** A merged lead is never written. A Lawmatics id or email that only a merged lead holds is skipped for a lead create (the importer's `LEAD_MERGED_IMPORT_SKIP`). For a calendar link it is followed through `merged_into_id` to the keeper.
- **Three-state reads everywhere.** Each read is ok, not set up, or couldn't be read. "No consults" and "nothing new" are only said about a read that worked.

## The Lawmatics reads (exact requests)
One set of reads per firm per run, shared by the steps that need it:
1. **`/prospects`:** `listAll("/prospects", { include: "stage,practice_area,contact", params: { fields: "all" } })`. This is the importer's include plus the hired sync's `fields: "all"`, in ONE request. It is used by the hired step (through `normalizeHiredProspect`) and by the prospect step (through the importer's `normalizeProspect` + `mergeContact`). **Not verified:** that Lawmatics honours `fields=all` and `include` together. Blocker 1 checks it. If it does not, the run makes the two requests the steps make today (`fields: "all"` for hired, the include for prospects), and each step fails closed on its own read.
2. **`/practice_areas`:** as the hired sync reads it today (names for its matter types). Hired step only.
3. **`/contacts`:** `listAll("/contacts")`, as `pullSource` does (`import.ts`), to fill emails and names (`mergeContact`). It is a second sweep with its own 3,000-record cap, so it is a second source of truncation. **For the daily prospect step, a truncated or failed `/contacts` read writes NO leads for that firm** (stricter than the manual importer, which carries on with a warning; a person is watching that one, nobody watches the cron). The hired step does not depend on it. The consult step does not either (it re-reads leads from Lectual).
4. **Tag and custom-field names** (`readOriginLookups`): optional. A failed read only skips the source rules that need them.
5. **`/events`:** see (b).

**`includeDropped`.** When Lawmatics returns the prospects but drops the sideloaded records (`ListResult.includeDropped`), stage names are unknown, so `isHiredStageName` cannot fire. In that case **the prospect step writes nothing for that firm** and counts it as "Lawmatics didn't return stages". The hired step is unaffected: it reads `status` and `converted_date`, which are attributes.

## (a) New prospects

**Planner:** a new pure file, `src/lib/lawmatics/prospect-sync-plan.ts`. It filters the records (window, hired, cutoff), then calls the importer's own `planImport` (`import-plan.ts`) with the practice-area filter off, so there is one set of matching rules, not two. From its result it keeps only:
- **`creates`** → insert a lead (capped at 50);
- **`updates` with `linksRecord === true` and `matchedBy === "email"`** → write `lawmatics_id` only, fenced `.is("lawmatics_id", null)` and `.is("merged_into_id", null)`. **The field changes in that update are ignored:** no fill-blank, no source, no name.

Everything else writes nothing and is counted by reason: `unchanged`, updates matched by Lawmatics id, `unmapped`, every `skipped`, and `contactCreates`, which are dropped.

**Which prospects** (filtered before `planImport`):
1. Created on or after `PROSPECT_SYNC_CUTOFF` (open question 1) AND created in the last **14 days** (rolling window; no cursor is stored). A prospect with no readable created date is outside the window.
2. Not hired. The prospect is left to the hired sync when its `status` is hired (case-insensitive), it has a `converted_date`, or its sideloaded stage name is a hired name (`isHiredStageName`). These are counted as "left for the hired sync".

**`planImport`'s own skips, unchanged and counted:** no Lawmatics id; the same id twice in the response; no usable email (open question 5); **no name on the record**; two Lawmatics records reaching one lead; only a merged lead matches; several leads share the email; **the email is already linked to a different Lawmatics id**; the email belongs to a differently named lead; another prospect in the same pull claims the email; the firm has no open stage.

**Dedupe, in order (the importer's rules):**
1. **By `lawmatics_id`.** A lead that already has this id (from the importer, an earlier run or the hired sync) → nothing. This is how a prospect the importer already brought in is treated: left alone, never updated by this sync.
2. **By email, case-insensitive.** Exactly one unlinked lead with that email and a name that does not contradict → link it. **This is true whatever stage the lead is in, including Lost, Won and Nurture**: `planImport` does not look at the stage. The link changes no stage. Open question 2 asks whether a Lost, Won or Nurture match should be linked, skipped, or reported.
3. **Within the pull,** two prospects sharing one email → the first wins and the second is skipped.

This matters for intake forms. A person who fills in a Lectual intake form is already a lead, and is pushed to the firm's Lawmatics. The next day the sync sees that Lawmatics record and links it by email instead of making a second lead. Open question 7 asks whether to link first through the intake submission's stored `lawmatics_contact_id` instead.

**The writes (the runner's own, not the importer's).** `applyImport` writes through the signed-in scoped client and cannot be reused by a cron. The runner (`src/lib/lawmatics/daily-sync.ts`) has its own service-role writes, all stamped with the connection row's `org_id`:
- **Lead insert:** `org_id`, `first_name`, `last_name`, `email`, `phone`, `business_name`, `website`, `practice_area`, `referral_source`, `referral_detail` (from `leadOriginFromProspect` through `normalizeProspect`; unknown = blank, never "Lawmatics"), `current_stage_id` = `newEnquiryStage` (never `won`, `lost` or `nurture`), `lawmatics_id`. Inserted one row at a time, so a 23505 (another writer took the same `lawmatics_id` under `crm_lead_org_lawmatics_id_uniq`) is counted and the rest go on. No `assigned_to`, `lane` or temperature.
- **Stage age (the rule):**
  - `created_at` = the Lawmatics created date;
  - `stage_entered_at` = the run time;
  - **`lawmatics_synced_at` is left NULL on create.**

  `stageAgeDisplay` (`src/lib/lifecycle/stage-age.ts`) treats a lead with `lawmatics_id` as imported. It reads "In stage since import" only when `stage_entered_at` equals `created_at` or the import time. With a past created date and no `lawmatics_synced_at`, neither matches, so the card reads "0d in stage" and counts up from the day the sync filed it. (The importer sets `lawmatics_synced_at` to the run time and lets `stage_entered_at` default to now, which is exactly the "since import" case.) The link write likewise sets `lawmatics_id` only.
- **`last_activity_at`** = the Lawmatics created date. Lists sort on it, so a person who enquired 10 days ago does not jump to the top as if they wrote today. A future or unreadable date is not written (the column default stands).
- **Timeline row:** one `lead_created` `crm_activity` row per created lead, `actor_type system`, payload `{ source: "lawmatics-daily-sync", lawmatics_id }`. **It does NOT carry `lawmatics_stage_unmapped` or `hired_in_lawmatics`:** those flags feed the Leads board's "Needs a stage decision" filter and badges, and a daily feed would flood them. A failed timeline row is counted and never undoes the lead.

**Known limit:** a lead a person deletes in Lectual comes back on the next run while its prospect is still inside the 14-day window. Moving it to Lost (or merging it) is the supported way to clear one.

## How the hired sync and this sync stay apart
- **Order at 4 AM: hired, then new prospects, then consults** (then Adobe). Daytime runs: new prospects, then consults.
- The prospect step skips every hired prospect, so it never makes a lead for someone the hired sync makes a matter for.
- **A prospect who becomes hired after this sync made their lead:** the next 4 AM hired run finds the lead by `lawmatics_id` (its first rule), sets the matter's `lead_id` and moves the lead to the signed stage, as it does today. There is still one lead and one matter. Between a daytime run and the next 4 AM, such a person is a lead in the new-enquiry stage with no matter, which is the same as today.
- Consults run last, and **re-read the firm's leads after the prospect inserts**, so a consult can link to a lead made a moment earlier.
- If the `/prospects` read fails, is cut short, or drops its includes, the prospect step writes nothing. The hired step follows its own rule on its own read, as today.

## (b) Consults

**Lawmatics resource (NOT verified against a live Lawmatics).** Nothing in `src/lib/lawmatics/` reads events today, and lawmatics-mcp is not in this session. From the public API reference the resource is expected to be `GET /v1/events` (appointments). The attributes are expected to be along the lines of:
- `name`;
- start and end (`start_date` / `end_date` or `starts_at` / `ends_at`);
- `all_day`;
- `location`;
- a status or cancelled flag;
- an event type (attribute or relationship);
- a relationship to the prospect (`prospect`, `eventable` or similar) and to invitees.

Every one of these names is unverified. Blocker 1 checks the real shape. The normaliser tries the likely names (as `hired-sync-normalize.ts` and `lead-origin.ts` do) and treats an unrecognised record as unusable, never guessed.

**Normaliser:** new `src/lib/lawmatics/events-normalize.ts` (pure). The output per event is:
- id;
- title (capped; open question 13);
- start, end, all-day;
- location (capped; open question 13);
- event-type name;
- cancelled;
- the prospect id from its own relationship;
- attendee emails (lowercased, at most 50).

No description or notes are kept. **Times:**
- A start or end with no UTC offset is refused (the event is unusable and counted), unless Blocker 1 shows Lawmatics names the zone in another field. Then that named zone is used, and nothing is ever assumed (open question 10).
- An all-day event is stored as UTC midnight of its civil date with `all_day = true`, the form the readers already expect (`starts_at.slice(0, 10)` is the date).
- An event whose end is before its start is dropped and counted (the table's CHECK would refuse it anyway).

**Planner:** new `src/lib/lawmatics/consult-sync-plan.ts` (pure).
- **Window:** events that start from now − 7 days to now + 60 days. Events outside it are ignored, since Lawmatics may ignore our date filter.
- **Consult or not (`is_consult`):** the title OR the event-type name matches `isConsultTitle` (`src/lib/calendar/outlook-parse.ts`: strategy session | discovery call | consult | initial call). One regex covers Outlook, Zoom and Lawmatics. Open question 2 asks Taylor and the director to confirm it matches lawmatics-mcp's consult-brief rules (`enumerate.ts`: Strategy Session / Discovery Call).
- **Which events are stored:** consults only (open question 2). A non-consult event is not stored. One of this sync's own rows that is no longer a consult is removed like a vanished one.
- **Lead link (in order),** against the leads re-read after the prospect step:
  1. the event's own prospect id equals a lead's `lawmatics_id`, followed through `merged_into_id` to the keeper;
  2. else exactly ONE lead whose email equals an attendee email, case-insensitive (`buildLeadIndex` + `linkLead`, the Outlook rule; none or two is null, never a guess), also followed to the keeper;
  3. else null. The row is still stored and shows on the calendar, unlinked.

  A consult whose prospect was created before the window or the cutoff therefore has no lead created for it. Open question 3 asks whether it should.
- **Matter link:** `matter_id` = the matter whose `lawmatics_id` equals the event's prospect id, when exactly one exists in the firm; else null.
- **This sync's own rows are marked.** `external_id` = `lmsync:` + the Lawmatics event id (at most 256 characters; a longer id is unusable and counted). Every upsert, update and delete is fenced on `org_id`, `source = 'lawmatics'` AND `external_id like 'lmsync:%'`. A `source = 'lawmatics'` row without that prefix (legacy, from the unmerged 0059 work, or written by anything else) is never updated or deleted by this sync.
- **Row written:**
  - `org_id` (from the connection row);
  - `source = 'lawmatics'`, `external_id` (as above), `lawmatics_id` = the bare event id;
  - `title`, `starts_at`, `ends_at`, `all_day`, `location`, `event_type`;
  - `lead_id`, `matter_id`, `is_consult = true`, `attendee_emails`;
  - `join_url`, only when a link field is an https URL;
  - `synced_at`.

  `mailbox_connection_id` and `organizer_email` stay null.
- **Upsert key:** `onConflict: "org_id,source,external_id"` (0098's plain unique constraint, the one the Outlook sync uses). If a row that is not this sync's already holds the same `(org_id, lawmatics_id)` (0059's unique), the write fails with 23505. It is counted as "held by an older Lawmatics row" and the other row is left untouched. The pre-build checks below decide whether that can happen at all.
- **Rescheduled:** the same event id with new times updates the row.
- **Cancelled or vanished:** rows are removed only after a COMPLETE read: no page failed, the read was not truncated, the shape was recognised, and the read finished inside the budget. Only this sync's own rows with that `org_id` and a `starts_at` inside the window are removed. Ids are computed from a select first, then deleted in small `in` chunks (the Outlook sync's method). An event Lawmatics marks cancelled counts as vanished. A cut-short or failed read writes nothing for that firm (no upserts either), so the calendar never shows half a week.

## Where it shows (readers to change)
| Place | File(s) | Change |
|---|---|---|
| Calendar page, base read | `src/lib/calendar/events.ts` | Already returns every source, Lawmatics included, with no label and no dedupe. It gains `source` and `external_id` in its select (it must still work on a database without 0098: on 42703 it falls back to today's columns). |
| Calendar page | `src/app/dashboard/calendar/page.tsx` (≈214–221) | Today the Outlook half reads only behind `orgHasModule("mailbox")`. Lawmatics rows come from the base read whatever the Mailboxes feature says, labelled "Lawmatics". A Lawmatics consult and an Outlook consult that are the same call (same lead, starts within 15 minutes, or a shared join link) show once, and the Outlook row is kept. |
| Lead page "Consult booked" | `src/app/dashboard/leads/[id]/page.tsx` (≈189, `hasMailbox ? loadBookedConsult(...)`), `src/lib/calendar/outlook-read.ts` `loadBookedConsult` | Split into two reads. Outlook keeps its Mailboxes gate. A new `loadBookedLawmaticsConsult` (`src/lib/calendar/lawmatics-read.ts`) runs whenever Lawmatics is connected, NOT behind Mailboxes. The card shows the earliest of the two. |
| Lead step facts | `src/lib/lead-step/load.ts` `readConsult` (≈207–216) | Today it returns `notSetUp("mailbox-off")` before reading anything. It reads Lawmatics consults first; the Mailboxes gate applies to the Outlook half only. A firm with Lawmatics and no Mailboxes gets its booked consult. |
| Today's Consults card, logic | `src/lib/calendar/consult-sources.ts`, `consult-sources-live.ts` | A third source, `lawmatics`, with its own `SourceState` and `sourceNote` sentence. `TodayConsultsResult` gains `lawmatics`. Merge: sort by start. One row per call: a shared `joinKey`, OR the same lead with starts within 15 minutes. Twins are kept in the order Outlook, Lawmatics, Zoom, and a lead link found on any twin is kept. |
| Today's Consults card, UI | `src/components/calendar/TodayConsults.tsx` (≈9, 20) | The hard-coded `SOURCE_LABEL` and the source list gain `lawmatics: "Lawmatics"`. |
| Owner Today | `src/components/today/OwnerToday.tsx`, `src/components/today/owner/OwnerConsults.tsx` (≈10, 24) | Same: label and source list gain Lawmatics. |
| Leads "Working" set | `src/lib/intake/working-load.ts` | Already reads every source (no change; a test pins that Lawmatics consults count, and that a legacy non-consult row does not). |
| Stage Keeper | `src/lib/agents/stage-keeper/run.ts` `readConsults` | Reads `source in ('outlook','lawmatics')`, Lawmatics limited to this sync's own rows. See "Stage Keeper evidence". `readiness-read.ts` stays about Outlook. |
| Held-consult last touch | `src/lib/stage-keeper/held-consult.ts` | Reads both (this sync's own Lawmatics rows); forward only, as now. |
| Morning brief consults | `src/lib/agents/morning-brief/sections.ts` | Reads both. The Lawmatics half is not behind the Mailboxes feature. |
| Consult prep | `src/lib/agents/consult-prep/run.ts` | Unchanged (Outlook only) unless Taylor says otherwise (open question 6). |

**Stage Keeper evidence.** An Outlook consult counts when the title says consult, or when a lead is linked and the organizer is one of the firm's own mailboxes. A Lawmatics consult has no organizer rule, and it may have been booked by the client themselves through a Lawmatics scheduler. That is weaker evidence than a call the firm organised: a booking is not a call that will happen.

**Recommendation:** a Lawmatics consult becomes a Stage Keeper SUGGESTION card (the existing `ai_insight` path that a person accepts), not a move, whatever the agent's autonomy, unless Taylor says otherwise (open question 4). Every other Stage Keeper rule holds: forward only, no `won`/`lost`/`nurture`, the sensitive guard, `signal_key` = `<lead>:calendar:<row id>`. When the same call is in Outlook and Lawmatics, the Outlook signal acts and the Lawmatics key is recorded among `also_signal_keys`.

## Frequency
**What the repo shows.** `vercel.json` has 8 entries, two per job one UTC hour apart (EST and EDT). `shouldRunNow` (`src/lib/cron/ny-hour.ts`) lets through only the tick in the job's New York hour. AGENTS.md says "on Hobby a cron fires anywhere in its scheduled hour", so the project is treated as Hobby today.

**Hobby (to check against Vercel's current limits page before adding entries).** Each cron entry runs at most once a day, somewhere in its hour. More runs a day mean more daily entries on the same path at other hours, each as an EST/EDT pair.

**Ordering on Hobby is not guaranteed inside one hour.**
- `lawmatics-matters` (:08) and `mailbox-sync` (:53) both fall in the 4 AM hour, and either can fire anywhere in it. The mailbox-sync's Stage Keeper may therefore run before the Lawmatics consults are stored.
- The Stage Keeper also runs in the 5 AM agents cron (a second run is a no-op through `signal_key`). So a consult stored at 4 AM is seen at the latest at 5 AM.
- **Consults stored by a daytime run are not seen by the Stage Keeper until the next morning** (or a person's Run now). That is accepted: they still show on the calendar, the lead page and Today right away.

**Pro:** any schedule down to every minute, on time.

**Recommendation:**
- Keep the 4 AM New York run: hired, prospects, consults, Adobe.
- **On Hobby:** add two daytime runs, around noon and 4 PM New York. That is four new `vercel.json` entries (two pairs), e.g. `8 16`/`8 17` and `8 20`/`8 21` UTC; the generator re-derives them. Daytime runs do prospects and consults only.
- **On Pro:** one hourly entry from 7 AM to 7 PM New York, with the guard checking the New York hour range. Same steps; the full set only at 4 AM.
- "Sync now" covers anything in between.

**The guard.**
- `CronJob` is a closed union with one hour per job. `INTENDED_NY_HOUR` becomes `Record<CronJob, readonly number[]>`. Every existing job keeps a one-element list; `lawmatics-matters` gets `[4, 12, 16]`. The job id and the route path are NOT renamed (vercel.json, the route tests and AGENTS.md name them).
- `shouldRunNow` returns the matched hour, so the route knows whether it is the 4 AM tick (full) or a daytime tick (prospects and consults).
- **Allowed hours for one job must be at least 2 apart.** The two entries of a pair are one UTC hour apart, so adjacent allowed hours would let both entries of a pair through and run twice. A unit test checks the table.
- `tests/cron/ny-hour.test.ts` walks every day of 2026 and 2027 and checks each hour of each job runs exactly once a day.

**Adobe and the hired lead move are daily only.** The Adobe sweep that Sprint 5a puts in this route runs only on the 4 AM tick; daytime ticks skip it. The hired sync, including its lead-to-won move, also runs only at 4 AM (open question 14 asks whether daytime runs should include them).

**Budget (the route has `maxDuration = 300`).**
- **Lawmatics client:** every request gets a deadline (20 s, through `src/lib/http/timeout.ts`), and `listAll` / `get` accept an `AbortSignal`. Today `client.ts` has neither, so one hung request can eat the whole route. A timed-out request is a failed read (fail closed), counted as `timeout`.
- **Wall budget:** 270 s (30 s of headroom under `maxDuration`). Firms run one after another.
- **Per firm:** at most 150 s. Inside that:
  - hired step: up to 60 s (4 AM only);
  - prospect step: up to 45 s;
  - consult step: up to 45 s.
- **Adobe:** up to 60 s at 4 AM, after all firms, inside what is left (its contract's slice).
- **Starting:** a step whose slice cannot fit in what is left is skipped and counted ("out of time"), never started. A firm is not started with under 60 s left.
- **Mid-step:** a step that runs out of time mid-read aborts through the signal and writes nothing (a read that did not finish is not complete).
- **Pro:** with hourly runs on Pro the same numbers hold.

## "Sync from Lawmatics now"
- One button on Settings → Integrations → Lawmatics, replacing "Sync hired matters now" (open question 8). It runs every step a 4 AM run does, except Adobe.
- `syncLawmaticsAction`:
  - re-resolves the role inside the action (`requireImportAdmin`: owner, admin, senior admin);
  - takes the org from `resolveFirmSession()`, never the form;
  - passes the runner `{ orgId }`, so only that firm's connection is read.
- **Its own budget:** the settings page segment exports `maxDuration = 300`, and the action passes the runner a 240 s budget (like Run now's `AGENT_RUN_BUDGET_MS`). Past it the line says "Lawmatics took too long. Try again shortly." and nothing half-read is written.
- **Result line,** counts only, e.g. "Added 3 leads, linked 1, 2 need a look. 4 consults updated, 1 removed. Added 0 matters, linked 0."
  - A failed step names the step ("Couldn't read Lawmatics events, so the calendar wasn't changed."), never raw text.
  - A refused key: "Lawmatics no longer accepts your firm's key. Reconnect it above."
  - No connection: "Lawmatics isn't connected for your firm."
- `revalidatePath` for the Leads list, the calendar, Today and the settings page.

## Data (migrations)
**No migration is expected.** Checked against the migration text in `lectual`:
- `crm_lead.lawmatics_id` has the partial unique index `crm_lead_org_lawmatics_id_uniq (org_id, lawmatics_id) where lawmatics_id is not null` (0034). Two leads can never hold one prospect id, so a race with the importer loses at the insert (23505, counted).
- `crm_calendar_event` (0059 base + 0098):
  - `source in ('lawmatics','outlook')`;
  - `lawmatics_id` nullable but required for `source = 'lawmatics'`;
  - `external_id` optional for Lawmatics rows, at most 256 characters;
  - unique `(org_id, lawmatics_id)` (0059) and unique `(org_id, source, external_id)` (0098);
  - composite FKs keep `lead_id` and `matter_id` in the same firm.

  The planned row satisfies all of these.
- **No cursor table:** the 14-day prospect window and the event window replace one.
- `src/lib/db/types.ts` already has these columns.
- **Tenant isolation:** no new table, so no new isolation case. The existing `crm_calendar_event` and `crm_lead` cases cover the tables written.

**Read-only checks before building** (on lectual-dev AND lectual-prod; the generator reports the answers in this folder and stops if any surprises):
1. **Legacy Lawmatics rows:** `select org_id, count(*), min(synced_at), max(synced_at), count(external_id) from crm_calendar_event where source = 'lawmatics' group by org_id`. Also: do any rows have `external_id like 'lmsync:%'` already (there must be none)?
2. **Who writes them today:** a recent `max(synced_at)` means something still writes them. Search lectual (`git grep crm_calendar_event`), lectual.app and lawmatics-mcp (by a person, since that repo is not in this session) for a writer. Open question 11 asks whether the sync may ever touch them; by default it never does.
3. **f3loev's 0063 `call_kind` column:** `select column_name from information_schema.columns where table_name = 'crm_calendar_event'`. If `call_kind` (or any column not in 0059/0098) exists live, say whether it has a NOT NULL or CHECK that a Lawmatics row would trip.
4. **Live constraint names:** `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.crm_calendar_event'::regclass`. Confirm that `crm_calendar_event_source_external_uniq` (the upsert target) and `crm_calendar_event_lawmatics_uniq` exist under those names and definitions, and that no other unique key exists.

## Reads with three states
| Read | ok | not set up | couldn't be read |
|---|---|---|---|
| Lawmatics connection | runs | no active connection: firm skipped, "Lawmatics isn't connected" | connection read failed: route answers 500 with a fixed reason, nothing written |
| `/prospects` (+ includes) | plan | (n/a) | truncated / failed / unrecognised / includes dropped: no leads for that firm, counted |
| `/contacts` | emails filled | (n/a) | truncated / failed: no leads for that firm, counted |
| `/events` | plan | (n/a) | truncated / failed / unrecognised / out of time: no calendar row written or removed, counted |
| Refused key (401/403) | (n/a) | (n/a) | counted as `reauthNeeded`, said on the button |
| Firm's leads, stages, matters | plan | (n/a) | nothing written for the step that needs them |
| Lead page, Today, calendar (Lawmatics half) | consults | Lawmatics not connected: "Consults from Lawmatics aren't shown: Lawmatics isn't connected." | "Lawmatics consults couldn't be read just now." Never "No consults". |

## MUST NEVER HAPPEN
- A write to Lawmatics. A send of any kind. A queue draft. An automation rule fired. A matter opened outside the 4 AM hired step.
- An existing lead's stage moved by this sync, or any lead put in a `won`, `lost` or `nurture` stage by it.
- A second lead for a person who already has one (by Lawmatics id, or by email with an agreeing name).
- A row stamped with another firm's `org_id`, or a lead or matter link to another firm's record.
- A calendar row removed after an incomplete read, or ANY `source = 'lawmatics'` row without the `lmsync:` prefix updated or removed.
- `lawmatics_stage_unmapped` / `hired_in_lawmatics` written by the daily sync.
- A name, email, title, location, link or `LawmaticsApiError.message` in a log, response, `agent_run` row, result line or error text.
- A failed read shown as "no consults" or "nothing new".
- The service role in dashboard code. The button's action uses the session only and hands the org id to the runner, the cron's own code path, as `syncHiredMattersAction` does today.

## Files likely touched
- **New:** `src/lib/lawmatics/prospect-sync-plan.ts`, `consult-sync-plan.ts`, `events-normalize.ts`, `daily-sync.ts` (runner: reads, steps, budgets, its own writes), `src/lib/calendar/lawmatics-read.ts` (three-state Lawmatics consult reads).
- **Changed:**
  - `src/lib/lawmatics/client.ts` (deadline + signal), `hired-sync.ts` (accepts the shared read; its rules unchanged);
  - `src/app/api/cron/lawmatics-matters/route.ts`, `src/lib/cron/ny-hour.ts`, `vercel.json`;
  - `src/app/dashboard/settings/integrations/lawmatics/{actions.ts,page.tsx}` and the button component;
  - `src/lib/calendar/{consult-sources,consult-sources-live,outlook-read,events}.ts`, `src/app/dashboard/calendar/page.tsx`, `src/app/dashboard/leads/[id]/page.tsx`, `src/lib/lead-step/load.ts`;
  - `src/components/calendar/TodayConsults.tsx`, `src/components/today/OwnerToday.tsx`, `src/components/today/owner/OwnerConsults.tsx`;
  - `src/lib/agents/stage-keeper/run.ts`, `src/lib/stage-keeper/held-consult.ts`, `src/lib/agents/morning-brief/sections.ts`, `src/lib/ui/words.ts`.
- **AGENTS.md:** a "Lawmatics daily sync" section, and the cron notes updated (hours list, ordering on Hobby).

## Tests to write
**Pure planner, prospects** (`tests/lawmatics/prospect-sync-plan.test.ts`):
1. A prospect created after the cutoff and inside 14 days with a new email → one create in the new-enquiry stage.
2. Before the cutoff, older than 14 days, or with no created date → nothing.
3. A lead with that `lawmatics_id` → nothing written.
4. Email matches:
   - one unlinked lead with the email and the same or a blank name → a link that writes `lawmatics_id` only, even when `planImport` lists field changes;
   - a differently named lead → skipped;
   - two leads with the email → skipped;
   - an email linked to another Lawmatics id → skipped;
   - a Lost or Won match follows open question 2's answer.
5. Hired by `status`, by `converted_date`, or by sideloaded stage name → "left for the hired sync".
6. `includeDropped`, or a truncated or failed `/contacts` → no leads for that firm.
7. Stage age:
   - a created lead has `lawmatics_synced_at` null, `stage_entered_at` = run time, `created_at` and `last_activity_at` = the Lawmatics created date;
   - `stageAgeDisplay` reads "0d in stage", not "In stage since import".
8. No email, no name → skipped and counted. Two prospects with one email → one create.
9. Never a `won`, `lost` or `nurture` target (property test over random stage lists). A firm with no open stage → nothing.
10. Only a merged lead matches → skipped.
11. Source comes from `leadOriginFromProspect`; nothing known → blank. `contactCreates` are dropped.
12. Over 50 creates → 50 planned, the rest counted.

**Pure planner, consults** (`tests/lawmatics/consult-sync-plan.test.ts`, `events-normalize.test.ts`):
13. "Strategy Session", "Discovery Call", "Initial Consult" by title or by event type → consult; "Court hearing" → not stored.
14. Links:
    - prospect id first; else one lead by attendee email; two or none → null;
    - a merged lead → its keeper (both link paths);
    - a lead created earlier in the same run is linked.
15. A matter is linked only when exactly one matter has the prospect id.
16. Times:
    - no offset → refused;
    - all-day → UTC midnight of the civil date with `all_day`;
    - end before start → dropped.
17. Rescheduled (same id, new times) → one update. Cancelled → removal.
18. Complete read:
    - one of this sync's own rows in the window missing from the read → removed;
    - outside the window → kept;
    - a legacy `source='lawmatics'` row without the prefix → never touched;
    - an Outlook row → never touched.
19. Unrecognised record shapes → unusable, never guessed. No description field ever reaches the row.

**Runner, fake fetch** (`tests/lawmatics/daily-sync.test.ts`; tests never call Lawmatics):
20. Every insert, upsert and delete carries the connection row's `org_id`. A second firm's connection writes only its own rows.
21. The `/prospects` request carries both `include=stage,practice_area,contact` and `fields=all`. `/contacts` is swept.
22. Truncated `/prospects` → no lead for that firm, and consults still run. Truncated `/events` → no calendar write or delete for that firm.
23. Order and the hired sync:
    - 4 AM order is hired, prospects, consults;
    - a daytime tick runs no hired step and no Adobe step;
    - a prospect made a lead by a daytime run and hired before the next 4 AM gets one lead and one matter, linked.
24. A second run with the same data → no writes (idempotent). A 23505 on a lead insert or a held `lawmatics_id` is counted, and the run goes on.
25. No Lawmatics write method is called (spied). A grep test holds the new files to `listAll` / `get`.
26. Counts only:
    - nothing logged or returned contains a fixture name, email, title, location or a `LawmaticsApiError` body (console spied, response checked);
    - a 401 counts `reauthNeeded`.
27. Budget:
    - a hung request is aborted at its deadline and counted;
    - a step that cannot fit is skipped;
    - the route never plans past 270 s.
28. The `lead_created` row carries `source: "lawmatics-daily-sync"` and no `lawmatics_stage_unmapped`.

**Route guard** (`tests/cron/routes.test.ts`, `tests/cron/ny-hour.test.ts`):
29. The route:
    - without `CRON_SECRET` → 401;
    - outside the allowed New York hours → 200 `{ skipped: "not this hour" }` with nothing read.
30. The guard table:
    - every day of 2026 and 2027, each allowed hour of each job runs exactly once;
    - allowed hours of every job are at least 2 apart.

**Button gate** (`tests/lawmatics/sync-now-action.test.ts`):
31. Owner, admin and senior admin run it for their own firm only (the org passed to the runner is the session's). Every other role, signed out and an unreadable role → a fixed sentence, and the runner is never called.
32. The result line is counts only. A failed step names the step. Out of time and a refused key have their own sentences.

**Readers:**
33. Today's card (both layouts):
    - Lawmatics source states and sentences;
    - `TodayConsults` and `OwnerConsults` render the Lawmatics label;
    - an Outlook and a Lawmatics row for the same call show once;
    - a Lawmatics failure never hides Outlook or Zoom.
34. Lead page and `lead-step/load.ts`: a Lawmatics consult shows as "Consult booked" for a firm WITHOUT the Mailboxes feature.
35. Calendar page: a Lawmatics row is labelled, a same-call twin shows once, and Lawmatics rows show without Mailboxes.
36. Stage Keeper:
    - a linked future Lawmatics consult gives a suggestion card (or the answer to open question 4), never a move by default;
    - a sensitive title gives nothing;
    - a legacy row gives nothing.

## Done when
- Tests 1 to 36 pass, plus `pnpm test`, `pnpm lint`, `pnpm build`.
- The four pre-build checks are answered on dev and prod and written up in this folder.
- Blocker 1 is answered (the real event shape, `fields`+`include`, totals), and the normaliser's names are updated to it.
- On lectual-dev with a test Lawmatics account:
  - a prospect created in Lawmatics appears as a lead after "Sync from Lawmatics now", reading "0d in stage";
  - a consult booked for them appears on the lead page, both Today layouts and the calendar;
  - rescheduling moves it, and cancelling removes it.
- AGENTS.md has the new section, and the `vercel.json` changes match the chosen plan.

## Blockers
1. **The Lawmatics shape (a person runs it, outside tests, with the firm's own token, and records only attribute and relationship NAMES and counts, no client data):**
   - the `GET /v1/events` record shape;
   - whether `/events` honours a date filter;
   - how events give times (offset or named zone) and represent all-day;
   - the total number of events, prospects and contacts;
   - whether `/prospects` honours `fields=all` and `include` together;
   - Lawmatics' rate limit (open question 12).

   The client's safety cap is 3,000 records per sweep. If events, prospects or contacts are over it and the date filter is ignored, every read is "cut short" and nothing ever syncs. If so, the generator stops and asks.
2. **The pre-build checks** above (legacy rows, their writer, `call_kind`, constraint names).
3. **The Vercel plan** (open question 9).

## OPEN QUESTIONS for Taylor
1. **Cutoff date.** Which date should new prospects count from? Suggestion: the day this ships, so the sync never reaches back over people the importer or the spreadsheet already handled. (The hired sync uses Oct 28, 2026.)
2. **Event type names, and Lost/Won/Nurture matches.** (a) Which Lawmatics event types are consults? We plan to use the Outlook and Zoom words: strategy session, discovery call, consult, initial call. Please confirm with the director that this matches lawmatics-mcp's consult-brief rules (Strategy Session / Discovery Call), and say whether other Lawmatics events should show on the Lectual calendar too. As written, only consults are stored. (b) When a new Lawmatics prospect has the same email as a lead in Lost, Won or Nurture, should the sync link it (no stage change), skip it and show it as "needs a look", or make a new lead? We suggest skip and show.
3. **A consult for someone outside the window.** If a consult is booked for a Lawmatics prospect created before the cutoff or the 14-day window, and no lead exists, should the sync create the lead (in the new-enquiry stage)? As written it stores the consult unlinked.
4. **Should a Lawmatics consult move leads?** A Lawmatics booking may be self-booked by the client, so we recommend it only makes a suggestion card for a person to accept, not an automatic move. Or should it move leads like an Outlook consult?
5. **A prospect with no email.** We recommend skipping them and showing the count ("2 need an email in Lawmatics"), as the importer does. Alternative: create them, matched by Lawmatics id only.
6. **Consult prep for Lawmatics consults.** Should the consult-prep assistant also prepare consults booked in Lawmatics? (It drafts to the approval queue only.)
7. **Intake link first?** When a person came through a Lectual intake form, the form stores the Lawmatics contact id it created. Should the sync link by that id before trying the email?
8. **One button or two.** One "Sync from Lawmatics now" button for hired matters, new leads and consults, replacing "Sync hired matters now". OK?
9. **How often, and which Vercel plan.** Hobby: runs at about noon and 4 PM New York (two cron entries each, landing somewhere in the hour). Pro: hourly 7 AM to 7 PM, on time. Which plan is the project on, and which do you want?
10. **Lawmatics time zone and all-day events.** Does the firm's Lawmatics give event times with a UTC offset, or in the firm's zone? How does it mark all-day events? (Blocker 1 checks; this is the business answer if it is ambiguous.)
11. **Legacy Lawmatics calendar rows.** If the database already has Lawmatics calendar rows from earlier work, who writes them, and may this sync ever replace or delete them? As written it never touches them.
12. **Lawmatics rate limits.** Do you know the firm's Lawmatics API limit? Three sweeps a run, three runs a day, plus "Sync now", should be well under any normal limit, but a 429 is counted as a failed read.
13. **What to store about an event.** Store the event title and location (as Outlook does), or only the event type and time? Titles and locations can carry client details.
14. **Daytime runs.** Should daytime runs also add hired matters (and move hired leads to signed) and run the Adobe check, or leave those to 4 AM as written?
15. **A refused Lawmatics key.** When the cron gets a 401/403, should it mark the firm's Lawmatics connection as needing reconnect (Settings would then say so), or only count it as written? Marking it may need a database change if the connection's status list has no such value.
16. **Rolling window.** New prospects are read from the last 14 days each run. A lead deleted in Lectual inside that window comes back on the next run (moving it to Lost is the way to clear it). Is 14 days right?
