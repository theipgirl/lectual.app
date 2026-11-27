# Automatic consult prep (PGE contract, DRAFT; not approved, nothing built)

Owner request (Taylor, Nov 24): once a lead is in **Consultation Scheduled**, the assistant does the full
consult prep on its own and sends it to Rebecca. It reads the lead's Lawmatics and the file from the form
they completed, then does the whole prep-consult skill. The lead page's "Prep this consult" panel stops
asking questions (practice area, what the client needs, session time, Zoom link).

Status: PLAN, updated with Taylor's answers (Nov 24, section 7). Building starts only after Taylor says go on S1.

## 1. What exists today (mapped Nov 24)

| | Lead page "Prep this consult" | In-app `consult-prep` assistant (Sprint 17) | lawmatics-mcp pre-consult brief | lectual-plugin `prep-consult` skill |
|---|---|---|---|---|
| Starts when | A person fills in 4 fields and presses Draft | The daily 5 AM run, for an **Outlook** consult in the next 24 h that is linked to a lead | 7:30 AM / 8 PM sweeps, sent by Resend 24 h and 1 h before each **Lawmatics** consult | A person asks Claude in Cowork |
| Reads | The lead's name and email, plus the typed fields | Lead record, mail subjects, past meetings, intake and assessment answers, the event's time and join link | Lawmatics prospect and custom fields (intake answers), USPTO knockout search, model judgment (Opus) | Lawmatics contacts and matters, notes and transcripts, the appointment activity |
| Writes | BRIEFING and CLIENT_EMAIL drafts in Approvals | BRIEFING facts card, plus a CLIENT_EMAIL draft (agent-toolkit firms only) | Email to Rebecca, cc info@, with the USPTO CSV and the packages PDF | Drafts in the queue; the full brief only in chat |
| Judgment (classes, risk, package) | Forbidden (`assertNoJudgmentContent`) | Forbidden (facts only) | Yes: likely classes, preliminary risk read, package tier, questions; prices only from config | Yes: preliminary and labelled attorney-to-confirm; no TESS search |
| Tenancy | Multi-firm | Multi-firm, service role, org-fenced | **RPB only, one deployment-wide Lawmatics token** | n/a |

Gaps against the ask:
1. **Nothing starts on the stage.** The only after-move hook is `runRules("stage_changed")`. It runs on a person's move only (never on a Stage Keeper move) and cannot start an assistant.
2. **The in-app assistant ignores Lawmatics consults.** It reads `source = 'outlook'` rows only, but RPB books in Lawmatics (the daily sync writes those as `lmsync:` rows).
3. **No Lectual code reads the Lawmatics prospect's intake custom fields for prep.** The read client and the per-firm token (`firmToken`) exist.
4. **Lectual has no full brief.** The classes, risk read, package, USPTO pull and packages PDF exist only in lawmatics-mcp, which is single-firm and uses a deployment token. Lectual must never call it on a firm's behalf (rule: each firm's own Lawmatics token).
5. **There is no per-firm internal-email path.** `sendInternalMail` has no recipient guard; today's only caller reads recipients from env.
6. **Rebecca would get double email** if Lectual adds a brief while the lawmatics-mcp 24 h / 1 h briefs stay on.
7. Uploaded client files (`crm_file`) are not read by any prep.

## 2. Design (one engine, in Lectual)

**Engine: port, don't call.** The judgment half of lawmatics-mcp's `src/consult-brief/` is ported into
`src/lib/consult-prep-brief/` (recorded in `PORTED_FROM.md`), made per-firm: the firm's own token, the firm's
own package list (`client_proposal_setting.pricing` via `normalisePackages`, never hard-coded prices) and the
firm's time zone. The ported parts are the USPTO knockout, the class/risk/package judgment, the questions and
the packages PDF. Once Lectual's brief is live for RPB, lawmatics-mcp's brief is switched off
(`CONSULT_PREP_ENABLED=false`), so there is one engine and one set of emails (section 7, Q1).

**Trigger: the stage, with a safety sweep.**
- *On entry:* after a lead enters the firm's consult-scheduled stage, the prep run for that one lead starts
  in `after()`. The stage is resolved by the existing rule: `stageForSignal("consult-scheduled")`, firm
  mapping first, then "Consultation Scheduled", etc. This covers both move paths: `moveLeadStage` (a person,
  the board, bulk move, review, reconcile) and `moveAsAgent` (the Stage Keeper). It never fails or delays
  the move.
- *Sweep:* the Lawmatics daily sync (4 AM / 12 PM / 4 PM) and the 5 AM assistants run look for leads in that
  stage that have no prep for their current consult, and prep them. Leads that reach the stage some other
  way get prepped there too, as do consults booked in Lawmatics after the move.
- *Once per consult:* the key is `<lead>:<event id>:<start time>`, or `<lead>:stage:<stage_changed row id>`
  when no consult event exists yet. A reschedule (new start time) or a later-linked event gives a fresh prep.
  The marker is today's `queue_drafted` row with `source: "consult-prep"` plus an `event_id`, so the lead-step
  engine ("What Lectual did", "next morning run") keeps working unchanged.

**Inputs: read on their own, three-state.** Each input is ok, not recorded, or couldn't load. A failed read
never reads as "none".
- The lead record. Practice area comes from the lead, else Lawmatics. "What they need" comes from their own
  intake answers, else Lawmatics' "description of legal inquiry" field.
- Their Lawmatics prospect (`GET /prospects/<lawmatics_id>`, `fields=all`, per-firm token, read-only client),
  including its intake custom fields, matched by label like the ported `facts.ts`.
- **"The file from the form completion"**, per Q2's answer. By default, the newest Lectual intake or
  assessment submission's answers, plus the list of files uploaded on the lead (names and types only; no
  file contents go to a model in this release).
- The consult's date, time and join link, from the calendar row: Lawmatics (`lmsync:`) or Outlook.
  Anything missing says "not recorded"; nothing is invented.
- Past meetings and mail subjects, as the facts card reads them today.

**Output.**
1. **The brief to Rebecca, three times per consult** (Taylor, Nov 24):
   - **Sends:** once **when booked**; again **24 hours before**, only if it was booked more than 24 hours
     ahead; and again **1 hour before**. Each send is the same brief, rebuilt with the newest facts, and the
     subject says which one it is ("Consult prep", "Tomorrow", "In 1 hour").
   - **Timing:** the 24 h and 1 h sends are handed to Resend with `scheduled_at`, from whichever run plans them.
     Lectual has no hourly job, so this is the same method lawmatics-mcp uses.
   - **Ids:** the Resend email id of each scheduled send is kept on the prep marker (`crm_activity` payload,
     ids only). A reschedule or a cancellation seen by the Lawmatics sync or the Outlook sync **cancels** the
     scheduled sends (`POST /emails/{id}/cancel`). This is new: lawmatics-mcp never cancels. A reschedule then
     plans fresh ones.
   - **Idempotency key:** `consult-prep:<org>:<lead>:<event>:<startISO>:<booked|24h|1h>`.
   - **To:** the firm's **Consult prep recipients**, a firm note like the deadline-alert one. It holds member
     ids (To), resolved to member addresses at send time, plus **Cc** addresses the admin tier sets. For RPB,
     To = Rebecca and Cc = info@.
   - **Recipient guard, run before every send:**
     - To must be a current member of that firm.
     - Cc must be on one of the firm's own domains: the domains of its connected mailboxes, or a domain the
       admin tier lists.
     - The lead's own address is never allowed.
     - An empty To sends nothing.
   - **Path:** sent through `sendInternalMail` (gains `cc` and `scheduledAt`, still the only file that names Resend).
     The From address must be on a domain verified on the firm's Resend account. Section 6 covers why
     lawmatics-mcp's briefs may not be reaching Rebecca today.
   - **Content:** the skill's sections: header, client snapshot, marks, prior call, likely classes (preliminary,
     attorney to confirm), preliminary risk read, package recommendation (from the firm's list), and 3 to 5
     questions. S2 attaches the USPTO CSV and the packages PDF. Every judgment is labelled preliminary. No
     legal advice; the brief goes to the firm only.
2. **The brief on the client's page** (Taylor, Nov 24):
   - The lead page (and the matter page, once one exists) gets a **Consult prep** card showing the newest brief
     in full, with its status line.
   - The brief is stored as the internal BRIEFING item in Approvals, which the card reads through the existing
     queue reader. The card shows three states: brief, none yet, or couldn't load.
   - In S2 the packages PDF and the USPTO CSV are also saved to the lead's **Documents & files**. That is the
     first service-role `crm_file` write: the org comes from the lead row and the path rule stays the same.
     It needs a review (section 7, Q5).
3. **The client-prep email stays a DRAFT** in Approvals, as today. It is written only for firms whose wording
   is set up (agent-toolkit), and it is never sent by Lectual.

**Lead page panel (`#prep-consult`): no questions.** It shows status only:
- "Prepared and sent to Rebecca, Nov 24, 2:10 PM", or
- "Waiting: no consult time yet, prep runs when it's booked", or
- what couldn't load.

It offers **View the brief** and **Re-run prep**. Re-run is for the admin tier and attorneys, and makes a
fresh prep with a new key and its own confirm. `prepConsultAction` and its form are removed.

**Model:** Sonnet (`agentModel("consult-prep")`). No Opus, per the agent-models rule. Prices never come from
the model.

**No schema change expected.** The recipients live in the firm note, the markers in `crm_activity`, the brief
in the queue. The agent id stays `consult-prep`, so the `agent_setting` / `agent_run` CHECKs are unchanged.

## 3. Sprints
- **S1, trigger and facts brief:**
  - the stage hook and the sweeps;
  - the Lawmatics prospect and consult reads;
  - all of the "form" inputs: Lectual answers, Lawmatics intake answers, and the file list;
  - the recipients setting (To plus Cc) and the guard;
  - the three sends with cancel-on-change;
  - the facts brief, emailed and shown on the client's page;
  - the question-free panel.

  Shippable on its own.
- **S2, judgment:** the ported USPTO knockout, class/risk/package judgment and questions, the packages PDF
  and the attachments (emailed, and saved to Documents & files).

## 4. Firm rules (binding)
- Software, not a law firm: the brief is internal attorney work product, judgments are labelled preliminary,
  and nothing reaches a client automatically.
- Every read and write is fenced on the firm's org. Each firm uses its own Lawmatics token, never a
  deployment one. No client names, emails, marks or brief text in logs, `agent_run`, failure alerts or commits.
- Gates: the `agents` module, the setting on, and Autopilot not paused. The Mailboxes module is no longer
  required for Lawmatics consults.
- Tests never call Lawmatics, USPTO, Resend or a model.
- Migrations: none expected. If one becomes necessary, it is proposed as lectual 0119 and never applied
  without Taylor's OK.

## 5. Done means
- A lead moved (by a person or the Stage Keeper) into the stage gets exactly one prep per consult; a
  reschedule gets one more.
- Rebecca gets one email per consult, from Lectual only, with no duplicate from lawmatics-mcp once S2 cuts over.
- The panel has no inputs. A failed read is named, never blank.
- Lint, typecheck and tests pass. A strict evaluation and an independent review (Opus) pass.

## 6. Not verified yet
- **Why lawmatics-mcp's 24 h and 1 h briefs aren't reaching Rebecca** (Taylor, Nov 24: "she's not getting
  those briefs"). Likely causes, none checked:
  - a `BRIEF_FROM` domain that isn't verified on the rpblawfirm.com Resend key (its CLAUDE.md records exactly
    this 403);
  - `CONSULT_PREP_ENABLED=false`;
  - consult titles that `isConsult` doesn't match;
  - the late 8 PM GitHub tick.

  Lectual's sends would hit the first cause too, so S1 starts by checking the From domain. When Lectual's
  sends go live, lawmatics-mcp's pass is switched off so a later fix there can't double-send.
- The label names of RPB's Lawmatics intake custom fields.
- The USPTO endpoint from Vercel.
- The Resend sending domain for the firm.

## 7. Taylor's answers (Nov 24) and what is still open
1. **Old brief:** Rebecca isn't receiving it. Lectual becomes the only consult brief, and lawmatics-mcp's
   pass is turned off (`CONSULT_PREP_ENABLED=false`) when S1 goes live.
2. **"The file from the form completion":** all of them. That means Lectual intake and assessment answers,
   the Lawmatics intake answers, and the files uploaded on the lead.
3. **When:** when booked, then 24 h before (only if booked more than 24 h ahead), then 1 h before.
4. **Release:** two steps (S1 facts, S2 full judgment). The brief is cc'd to info@ and shown on the
   client's page.
5. *Open, for review:* saving the S2 PDF and CSV into Documents & files means a service-role file write.
   The recommendation is to allow it only from this one place, with the org taken from the lead row.
6. *Open:* Taylor's go-ahead to build S1.
