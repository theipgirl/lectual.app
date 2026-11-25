# S2c runbook: switching consult prep emails from lawmatics-mcp to Lectual

Ten steps, in order. Each says what it does, who does it, how to check it, and how to undo it.
Nothing here emails a client. Every email goes only to the people chosen in Settings → Team.

## What the code does (so the steps make sense)

- **Lectual sends no real consult prep email until the switch-over has happened.** `CONSULT_PREP_CUTOVER_AT` must be set,
  valid (a full time WITH a zone, e.g. `2026-12-01T14:30:00-05:00`) and in the past. Unset, invalid or still ahead = no email
  at all. Preps are still built, queued in Approvals, shown on the lead page and their files saved.
- **No backlog when it opens.** Nothing is recorded while emails wait. When the switch-over passes, a prep made earlier gets only
  the reminders still due (a day before, an hour before). Its "booked" email is not sent late.
- **No doubles with lawmatics-mcp.** lawmatics-mcp hands its 24 h and 1 h briefs to Resend ahead of time and never cancels them.
  Lectual works out, from lawmatics-mcp's own schedule (7:30 AM and 8:00 PM New York), the latest time it can have scheduled
  a brief by the switch-over. For a Lawmatics consult that Lectual already knew of when lawmatics-mcp's last run fired, Lectual
  sends nothing lawmatics-mcp may already have covered, and records it as "the old brief was already scheduled for this consult".
  A consult booked (or rescheduled) after that run, an Outlook-only consult, and anything later are Lectual's.
- **Old "waiting" rows don't flood.** Rows written before the switch-over that say an email was held back or failed are ignored
  when it opens: no late "booked" emails, no burst of rebuilds.
- **Reply-to.** `CONSULT_PREP_REPLY_TO` goes on every email, but only if it is on the sender's domain or a recipient's domain.
- **"Send a test brief"** (lead page, Consult prep card, owner only) builds a real full prep for that lead's next consult and
  emails it, marked `[TEST]`, to the Settings → Team people only. It ignores the switch-over and saves nothing.

## 1. Pre-checks

Who: Taylor (with Rebecca for the settings).

- **Packages saved.** Settings → Proposals shows RPB's packages (Essential, Enhanced, Concierge). Without them the full prep
  can't be built.
- **Recipients set.** Settings → Team → "Consult prep emails": Rebecca chosen, Cc `info@rpblawfirm.com`. Save.
- **Assistant on.** Assistants → Consult prep is on, autonomy "draft" (already so on prod).
- **Sending domain.** In the Resend dashboard of the account that owns lectual-app's `RESEND_API_KEY`: Domains →
  `rpblawfirm.com` shows **Verified**. Second check: Emails → a recent worksheet email from `events@rpblawfirm.com` shows
  Delivered (same key, same domain). If the domain is not there, stop: `brief@rpblawfirm.com` would be refused.
- **Read lawmatics-mcp's schedule.** Vercel → lawmatics-mcp → Settings → Environment Variables (Production): note the values of
  `BRIEF_TIMEZONE`, `BRIEF_HOUR`, `EOD_HOUR` and `BRIEF_WEEKDAYS_ONLY` (none is secret). Unset means the defaults: New York,
  7 (the 7:30 AM run), 20 (the 8:00 PM run), not weekdays-only. Lectual assumes the defaults and allows for either weekday setting.
  If the zone or either hour is set to something else, stop and tell the developer before step 6.
- **Pick the switch-over time.** A weekday, between 9:00 AM and 6:00 PM New York, not Friday evening to Monday morning.
  Inside that window lawmatics-mcp's reach is at most about 16 hours. Within an hour BEFORE 7:30 AM or 8:00 PM (from 6:30 AM, or
  from 7:00 PM) the next run may already have fired early, so its reach jumps to the slot after it (11:00 PM, or 7:30 AM next day).
  Over a weekend it reaches to Monday 7:30 AM. Either way more consults are left to lawmatics-mcp.

Check: all four are true. Undo: nothing to undo.

## 2. Merge

Who: Taylor. Merge `claude/consult-prep-s2c` into `main`.

Check: the merge commit is on `main`. Undo: revert the merge commit.

## 3. Set the sender and reply-to on lectual-app, cutover NOT set

Who: Taylor, in Vercel → lectual-app → Settings → Environment Variables → **Production**.

- `CONSULT_PREP_FROM` = `RPB Law Firm <brief@rpblawfirm.com>`
- `CONSULT_PREP_REPLY_TO` = `info@rpblawfirm.com`
- `CONSULT_PREP_CUTOVER_AT`: **leave it unset.**

Why unset rather than a time in the future: unset can't open by itself. A future time opens at that minute whether or not
lawmatics-mcp has been stood down, and if step 7 slips the two systems would both send. Unset keeps every real email shut
until you choose the exact moment in step 6.

Check: the three values (or absence) in Vercel. Undo: delete the two variables.

## 4. Redeploy lectual-app

Who: Taylor. Redeploy the latest `main` production deployment. **Never "Promote to Production" on a preview.**

Check: the deployment is Ready; a lead with a prep shows "not emailed: emails start when the switch-over is done" on its
Consult prep card. Undo: redeploy the previous production deployment.

## 5. Test brief

Who: Rebecca presses it; Taylor checks it.

- Rebecca opens a lead with an upcoming consult → Consult prep card → **Send a test brief** → confirm. It takes one to three
  minutes (two model calls, the USPTO pull, the files). The card then says "Test brief sent to the people set in Settings → Team."
- Taylor checks the copy in `info@rpblawfirm.com` (the Cc):
  - From `RPB Law Firm <brief@rpblawfirm.com>`; Reply-To `info@rpblawfirm.com`;
  - subject starts `[TEST] Consult prep:`; the first line says it is a test;
  - the body has Likely classes, the USPTO knockout, the risk read and the package recommendation;
  - two attachments: `tmSearchResults<date>.xlsx` and `<Client>_Packages_<Mark>.pdf`;
  - press Reply: it is addressed to info@.
- At most 5 test briefs an hour per owner. Nothing is saved, so the lead page does not change.

If it fails, the card says why in one sentence (email not switched on, no one set, the full prep couldn't be built). Fix and press
again. Do not go on to step 6 until a good test has arrived.

The test only goes to members on the firm's email domain (the sender's, or a connected mailbox's). A member who signed up with a
personal address makes it refuse; that is on purpose.

Undo: nothing to undo (nothing was saved).

## 6. Set the switch-over time

Before setting it, count the old rows that will be ignored (Supabase SQL editor, lectual-prod; read only):

```sql
select payload->>'kind' as kind, payload->>'status' as status, count(*)
from crm_activity
where type = 'ai_insight'
  and payload->>'source' = 'consult-prep-send'
  and payload->>'status' in ('withheld', 'failed')
group by 1, 2
order by 1, 2;
```

Each of these was written before the switch-over. Once it passes, Lectual does not send for them (their reminders still follow the
normal rules). The count is for the record; nothing needs fixing.


Who: Taylor, in Vercel → lectual-app → Production.

- `CONSULT_PREP_CUTOVER_AT` = the moment lawmatics-mcp's switch-off will be LIVE (step 7 finished), with its zone, e.g.
  `2026-12-01T14:30:00-05:00`. Pick it about 30 minutes ahead, and finish step 7 before it.
- **Later is safe, earlier is not.** A later time only holds Lectual's emails back a little longer (and widens the window it
  leaves to lawmatics-mcp). An earlier time lets a lawmatics-mcp run that still fires between the two schedule briefs Lectual
  didn't allow for, and Lectual would start sending while lawmatics-mcp still is.
- If step 7 runs late, move this value later and redeploy lectual-app again before it passes.

Check: the value in Vercel parses (an ISO time with `Z` or `-05:00`); a value without a zone is ignored, so emails would stay shut.
Undo: delete it (emails shut again).

## 7. Stand down lawmatics-mcp, then redeploy both

Who: Taylor.

1. Vercel → lawmatics-mcp → Production: `CONSULT_PREP_ENABLED` = `false`. Redeploy lawmatics-mcp. Its morning brief and the
   8 PM recap keep running; only its pre-consult brief stops scheduling new emails.
2. Redeploy lectual-app (it picks up `CONSULT_PREP_CUTOVER_AT` from step 6).
3. Both before the time set in step 6.

What happens to briefs lawmatics-mcp already scheduled: they still go out. They sit on the rpblawfirm.com Resend account and
nothing cancels them. For a consult Lectual already knew of before lawmatics-mcp's last run, Lectual leaves those emails to it, so
Rebecca gets lawmatics-mcp's version once, not two. A consult booked after that run gets Lectual's own emails instead (lawmatics-mcp
may never have seen it); if lawmatics-mcp did see it, that one consult may get both, which beats getting neither.

**A reschedule after the switch-over can give two briefs:** lawmatics-mcp's brief for the OLD time still fires, and Lectual briefs
the new time.

Check: lawmatics-mcp's next cron JSON shows the consult brief pass as `disabled`
(`/api/cron/morning-brief?dry=1` with the cron secret). Undo: see step 9.

## 8. Switch-over day check

Who: Taylor, at the end of the switch-over day and the next morning.

- List the consults of the next three days (Supabase SQL editor, lectual-prod; read only; RPB's org id in place of `<org>`):

```sql
select lead_id, starts_at, created_at, synced_at
from crm_calendar_event
where org_id = '<org>' and is_consult and lead_id is not null
  and starts_at between now() and now() + interval '3 days'
order by starts_at;
```

- Open each lead's page. On the Consult prep card, a consult booked that day should read "emailed" (or show its reminders). If it
  has no brief (Rebecca got nothing from either system), press **Re-run prep**: a re-run always sends its own email.

## 9. Verify

Who: Taylor.

- After the switch-over time, the next sweep (Lawmatics sync at about 12:08 PM and 4:08 PM, the agents at about 5:23 AM, or a
  lead moved into Consultation Scheduled) sends the first real Lectual brief. Rebecca gets it, Cc info@.
- Look at: the sender and reply-to; the subject (no `[TEST]`); the full sections; the two attachments.
- Where the records are:
  - the lead page's Consult prep card: "Prepared … · emailed · reminders: …", or for a consult lawmatics-mcp had,
    "not emailed: the old brief was already scheduled for this consult";
  - the lead's timeline: "Consult prep email: sent" / "…: not emailed: the old brief was already scheduled for this consult";
  - Assistants → Consult prep → run summary: "N emails not sent: the old brief was already scheduled …", counts only;
  - the database: `crm_activity` rows of type `ai_insight` with `payload.source = 'consult-prep-send'` (status `sent`,
    `scheduled`, `superseded`);
  - the Resend dashboard for lectual-app's key: the emails and the scheduled ones.
- For two or three days, check that no consult got both a lawmatics-mcp brief and a Lectual brief for the same slot.

## 10. Rollback

Who: Taylor.

**Stop Lectual's emails** (keep preps building):
- Delete `CONSULT_PREP_CUTOVER_AT` on lectual-app and redeploy. No new real email goes (fail closed). Deleting
  `CONSULT_PREP_FROM` works too, and also stops test briefs.
- Emails Lectual ALREADY handed to Resend (reminders scheduled for later) still go. To cancel them: switch the Consult prep
  assistant off (Assistants page). The 5 AM agents run then cancels every one still scheduled. To cancel at once, cancel
  them by hand in the Resend dashboard of lectual-app's key.

**Bring lawmatics-mcp back:**
- First stop Lectual's emails (above), AND cancel the ones Lectual has already scheduled, or both systems will send:
  switch the Consult prep assistant off, then either cancel the scheduled emails by hand in the Resend dashboard of lectual-app's
  key, or wait until the 5 AM agents run has passed (about 5:23 AM New York; it cancels every one still scheduled). The agents job
  can't be run by hand at another hour: its route only works in its 5 AM hour.
- lawmatics-mcp → Production: `CONSULT_PREP_ENABLED` = `true` (or delete it). Redeploy. It schedules from its next run.

**Undo the code:** revert the merge on `main` and redeploy lectual-app. Its records stay. They do nothing without the code.

## Not verified

- That `rpblawfirm.com` is verified on lectual-app's Resend account (checked in step 1).
- Resend accepting attachments together with `scheduled_at`, and the real `reply_to` behaviour (seen in step 5 for a sent email
  only, not a scheduled one).
- lawmatics-mcp's `BRIEF_WEEKDAYS_ONLY`, `BRIEF_HOUR` and `EOD_HOUR` on prod. Lectual assumes the defaults (7:30 AM, 8:00 PM,
  New York) and allows for either weekday setting. If prod has other hours, tell the developer before step 6.
