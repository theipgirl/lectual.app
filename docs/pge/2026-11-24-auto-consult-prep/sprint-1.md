# Sprint 1: automatic consult prep, trigger + facts brief (build spec)

Read first: `contract.md` (this folder), `AGENTS.md` (binding: three-state reads, words.ts, no-build-words grep, JSX `{" "}`
rule, live() lead guard, service-role rules, no raw error text), and these existing pieces:
- `src/lib/agents/consult-prep/` (run.ts, facts.ts, constants.ts)
- `src/lib/prep-consult/`
- `src/lib/agents/runner.ts`
- `src/lib/agents/stage-keeper/mapping.ts` (`stageForSignal`, `DEFAULT_STAGE_NAMES`)
- `src/lib/pipeline/leads.ts` (`moveLeadStage`) and `src/lib/pipeline/move-as.ts`
- `src/lib/lawmatics/daily-sync.ts`, `client.ts`, `connection.ts`, `src/lib/intake-forms/lawmatics-sync.ts` (`firmToken`)
- `src/lib/mail/internal-mail.ts`
- `src/lib/today/deadline-alerts*.ts` and the Team settings "Deadline alerts" UI (the pattern for a recipient firm note)
- `src/lib/lead-step/` (load.ts, did.ts, next-actions.ts, schedule.ts: they read the prep marker)
- `src/lib/files/read.ts`, `src/lib/answers/`
- the lead page `src/app/dashboard/leads/[id]/page.tsx`, `actions.ts` (`prepConsultAction`), `src/components/leads/LeadExtras.tsx` (`PrepConsult`)
- `/home/user/lawmatics-mcp/src/consult-brief/facts.ts` (tolerant Lawmatics intake-field label mapping, to PORT, recorded in `PORTED_FROM.md`)

No migration. No new dependency. Agent id stays `consult-prep`. Nothing is sent to a client.

## 1. Trigger
- **On entry.** A lead entering the firm's consult-scheduled stage starts a prep for that ONE lead.
  - The stage is resolved with `stageForSignal("consult-scheduled", ...)`, the same resolver the Stage Keeper uses, so there is
    one rule. Put a small pure helper `isConsultScheduledStage(stageId, stages, brainMapping)` in the new module.
  - It is called in `after()` (or the nearest existing deferred mechanism) from `moveLeadStage` (person path) and from `moveAsAgent`
    (Stage Keeper path).
  - It never throws into, delays or changes the move.
  - It runs through the agent runner (`runOneAgent` with a new optional scope `{ leadIds: [id], reason: "stage" }`, or an
    equivalent that keeps EVERY existing gate: the `agents` module, the `consult-prep` setting enabled, Autopilot not paused, the
    `agent_run` row, and the budget).
  - The org always comes from the lead row (service role, org-fenced), never from a caller argument it can't verify.
- **Sweeps.**
  - The existing 5 AM agents run of `consult-prep` (no scope) prepares every candidate.
  - The Lawmatics daily sync (`daily-sync.ts`, all three ticks), after a firm's consult step completes, runs `consult-prep` for
    that firm the same way. Wrap it so it can never change the sync's result. If budget is short, skip it and count it.
- **Candidates** (one run, one org):
  - (a) future consult calendar events (`is_consult = true`, `lead_id` set, start in (now, now + 14 days]) from source
    `lawmatics` (rows with `external_id` like `lmsync:%`) ALWAYS, and from source `outlook` only when the Mailboxes module is on;
  - (b) leads currently in the consult-scheduled stage whose `stage_entered_at` is within the last 3 days and who have no
    future consult event.

  Leads are read with the `live()` filter (merged leads excluded). Never more than 25 preps in one run; the rest go to the next
  run, counted.
- **Prep key and dedupe.**
  - With an event: key `<leadId>:<eventId>:<startISO>`.
  - Without an event: key `<leadId>:stage:<id of the newest stage_changed activity into that stage>` (fall back to
    `stage_entered_at` if that row can't be found).
  - A prep whose key already has a marker is not built again.
  - An event-keyed prep for a lead that got a stage-keyed "booked" email in the last 7 days does NOT send another booked
    email. It only schedules the reminders.
  - The marker stays the existing `queue_drafted` row with `payload.source = "consult-prep"`, `kind`, `event_id` (the event
    id, or `stage:<id>`), `prep_key` and `queueItemId`. Ids only, no content.
  - Make sure `src/lib/lead-step` keeps working: it must not keep promising prep for a lead that has one, and any new
    `kind` value must be handled in `did.ts`.

## 2. Inputs (each read on its own: ok / none / couldn't load; a failed read is never "none")
1. The lead row (existing `readLeadFacts`).
2. The Lawmatics prospect: `GET /prospects/<lead.lawmatics_id>`, `include=practice_area,stage,contact`, `fields=all`, with
   a plain retry when that errors.
   - Use the firm's own token (`firmToken(admin, orgId)`) through the read-only client (`createLawmaticsClient`: get/listAll only).
   - Check that the answer names that id.
   - States: no `lawmatics_id` ("not linked to Lawmatics"), no active connection ("Lawmatics isn't connected"), ok, couldn't load.
   - Port the tolerant intake-field mapping from lawmatics-mcp `facts.ts`: practice area, description of the inquiry, marks,
     business/services, use in commerce vs intent to use, competitors, goals, consult fee paid. Unmatched fields read "not
     recorded".
   - Never log a value.
3. Lectual intake and assessment answers (the existing `readLeadAnswers`).
4. Files uploaded on the lead and on leads merged into it (`crm_file`, org-fenced): file name, type and upload date only. No
   contents.
5. The consult: start time in the firm's time zone, and the join link (`joinHref`) from the event. No event reads "Session:
   not recorded yet".
6. Existing mail summary and meeting history (as the facts card does today).

"What they need" comes first from their own intake answers, else Lawmatics' inquiry description, else "not recorded".
Practice area comes from the lead, else Lawmatics, else "not recorded".

## 3. The brief (S1: facts only, no model call for the brief)
- One pure renderer, `renderConsultBrief(facts) -> { subject, text, html }`, in the new module. HTML must escape every value.
- The skill's order: Header (client, session, prepared at), Client snapshot, What they need, Mark(s), Lawmatics intake
  answers, "In the client's words" (Lectual answers, verbatim, labelled), Files on file, Prior contact (mail summary, meetings),
  Questions to cover: "Not drafted yet", plus one line saying the classes, risk read and package recommendation come in
  the next update.
- All recorded values pass through the existing `scrubJudgmentContent`, except the client's own words, as today.
- Footer: "Internal. Prepared by Lectual for the firm. Not legal advice. Never forward to the client."
- Subject: `Consult prep: <client name> · <session date/time or "time not set">`; reminders are prefixed with "Tomorrow:" and
  "In 1 hour:".
- The same text is also queued as the existing BRIEFING item (headline "Consult prep for <name>") when the firm has a queue.
  That stored item is what the lead page shows.
- The CLIENT_EMAIL draft keeps today's behaviour exactly (agent-toolkit firms only, autonomy not `suggest`, real address,
  model through `ctx.llm`).

## 4. Sending (internal email only)
- **`internal-mail.ts`** gains `cc?: string[]` and `scheduledAt?: string` (ISO), returns the Resend id
  (`{status:"sent", id: string|null}`), and gets `cancelInternalMail({apiKey, id})` (`POST /emails/{id}/cancel`).
  - It is still the only file that names Resend.
  - It never throws and logs no body.
  - Existing callers keep working; update their tests only if the result type forces it.
- **Recipients**: a firm note in `crm_firm_brain_entry`, category `other`, key `consult_prep_recipients`, `data = { user_ids: string[],
  cc: string[] }`.
  - Hidden from the Firm notes page like `deadline_alert_recipients`.
  - Settings -> Team gets a "Consult prep emails" section beside Deadline alerts. The admin tier picks members (To) and types Cc
    addresses.
  - The action re-checks the role and every id against the member directory, and every Cc with the guard below.
- **Recipient guard** (pure, runs before every send AND when saving the setting):
  - To = current members' addresses, resolved by the service role from the member directory equivalent, org-fenced.
  - Each Cc must be a bare address whose domain equals the domain of at least one To address.
  - Nothing equal to the lead's own email (case-insensitive) or to any address in the brief's client fields.
  - Empty To = no send, counted, and the panel says recipients aren't set.
- **From**: `CONSULT_PREP_FROM` env. Unset, or `RESEND_API_KEY` unset, = no email, with the brief still kept in Lectual and the
  panel saying email isn't switched on (platform voice: "isn't switched on for your firm yet. Lectual will turn it on.").
  Add both to `env.ts` / `.env.example`.
- **Three sends per event-keyed prep** (Taylor, Nov 24):
  1. `booked`: sent now when the prep is made.
  2. `24h`: scheduled for start - 24 h, ONLY if the prep was made more than 24 h before start.
  3. `1h`: scheduled for start - 1 h, only if that is in the future; if under 1 h is left, send nothing more after booked.

  More rules:
  - Resend scheduling: only schedule a send whose time is within the next 72 hours. A later one is scheduled by a later run
    (sweeps run several times a day), so keep a record of what is still owed.
  - Stage-keyed preps (no event) send only `booked`.
  - The idempotency key for each send is `consult-prep:<orgId>:<prepKey>:<kind>`.
- **Send records**: one record per send, ids and times only: `{prep_key, kind, resend_id, scheduled_for, status:
  sent|scheduled|cancelled|failed}`.
  - Store them with no migration: an extra `queue_drafted` marker kind, or `ai_insight` rows with `source:
    "consult-prep-send"`. Choose the one whose CHECK constraints allow it (verify against the generated types and existing
    writers), and make every other reader of that table ignore it. Explain the choice in AGENTS.md.
- **Cancel on change**: every run compares the scheduled sends with the current event. Sends are cancelled
  (`cancelInternalMail`) and marked when any of these hold:
  - the event is gone;
  - its start changed;
  - it is no longer a consult;
  - its lead changed.

  A start change is a new prep key, so the new event gets a fresh prep (and, per the 7-day rule above, a new booked email:
  a reschedule IS worth a fresh booked email).
- Nothing about a recipient, the brief or the client goes to logs, `agent_run`, failure alerts or the run summary. Counts only.

## 5. Lead page (the "client's page")
- `#prep-consult` (keep the anchor and the `lead-prep` data-tour token exactly once) becomes a **Consult prep** card with no
  inputs.
- It is shown when the firm has the `agents` module (an unreadable module list shows the card's own "couldn't load"). It is no
  longer tied to agent-toolkit.
- It reads the lead's prep markers and send records (scoped client) and the newest BRIEFING item through the existing queue
  reader. The queue's three states apply.
- Status line:
  - "Prepared Nov 24, 2:10 PM · emailed to Rebecca, cc info@rpblawfirm.com · reminders: Tomorrow 2:00 PM, Nov 25 1:00 PM";
  - "Not prepared yet: it runs when the lead is in Consultation Scheduled";
  - "Prep is off for your firm" (setting off);
  - "No one is set to receive consult prep. Set it in Settings -> Team." (admin tier sees the link);
  - "Couldn't load".
- The brief is shown in full as text, inside a closed `<details>` "View the brief".
- **Re-run prep** (owner/admin/senior_admin/attorney; `InlineConfirm`):
  - `rerunConsultPrepAction(leadId)` re-resolves the role and reads the lead through the scoped client.
  - It runs the prep for that lead with a fresh key suffix `:rerun:<epoch ms>`: a new booked email, and reminders are not
    duplicated. Fixed sentences only.
- Remove `prepConsultAction`, the `PrepConsult` form and `queuePrepConsultDrafts` if nothing else uses them (keep the draft
  builders the agent uses). Update the skills catalog copy for "Prep a consult" (it now lands on the card) and its test.
- `lead-step` must say the truth: prepped means the marker exists for the current consult.
- Words go in `src/lib/ui/words.ts` (a new `// Consult prep (auto)` block). No build words ("module", "agent", "migration",
  "database update" and the rest).

## 6. Gates and safety
- `readiness.ts`: consult-prep no longer requires the Mailboxes module (Lawmatics consults don't need it). Outlook events
  still do.
- The cron summary counts: prepped, emails sent, scheduled, cancelled, skipped (no recipients, email off), failures.
- Tests (vitest, fakes only; never Lawmatics, Resend, USPTO or a model):
  - the pure rules: stage detection, candidate selection, keys, the 3-send plan incl. <24h/<1h/>72h, cancel-on-change,
    the recipient guard, the renderer's escaping and "not recorded";
  - tenancy: a run for org A never reads or writes org B (fake admin client asserting org filters);
  - the move hooks call the trigger and a trigger failure doesn't fail the move;
  - the lead page card states and the removed form;
  - the existing consult-prep, lead-step, skills, readiness and internal-mail tests, updated only where behaviour changed on
    purpose (list them in AGENTS.md).
- Run with `env -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_URL pnpm test` (`tests/setup.ts` wipes a
  real DB otherwise), plus `pnpm lint` and `pnpm exec tsc --noEmit`. `pnpm build` if time allows.
- Add an AGENTS.md section "Automatic consult prep (S1, no schema)" with the rules above, and a `PORTED_FROM.md` entry.
