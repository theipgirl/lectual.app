# Notifications (the bell)

The bell in the top bar and `/dashboard/notifications/` show what the app has told the signed-in
person. Rows live in `crm_notification` (lectual 0056), one per recipient, readable and
markable only by that person (RLS `user_id = auth.uid()`).

**In-app only.** Nothing here sends email, SMS or a push, and no notification ever reaches a
client. A client-facing message still goes through the approval queue and a person.

## What raises one, and who gets it

| What happened | Who is told | Written by | Wording |
|---|---|---|---|
| A lead is assigned | The new owner (not the person who assigned it) | `notifyAssigned`, `src/lib/notifications/producers.ts` | "Taylor assigned you Ana Ruiz" |
| Someone @mentions a colleague in a note | The mentioned member (not the author) | `src/lib/pipeline/notes.ts` | "Dawn mentioned you on Ana Ruiz" |
| A consult outcome is logged (no-show, reschedule, rebooked) | The lead's owner and every `intake` member, minus the person who logged it | `src/lib/pipeline/consult-outcome.ts` | "No-show logged on Ana Ruiz" |
| A draft is queued for approval | Members who can approve queue items (`QUEUE_APPROVE_ROLES`: owner, admin, senior_admin, attorney), minus the person who queued it | `notifyApprovers`, `src/lib/notifications/approval.ts`, called from `createDraft` | "A draft is waiting for your approval: <headline>" |
| A lead replies by email | The lead's owner; if the lead is unassigned, members in `UNASSIGNED_NOTIFY_ROLES` (owner, admin, senior_admin, attorney, intake) | The mailbox sync, `src/lib/mailbox/apply.ts` | "Ana Ruiz replied" |
| A timer has run more than 8 hours | The timer's owner, once per timer | `notifyTimeRunning`, on the intake page load | "Your timer has been running 8h" |

Every producer goes through `notify()` in `src/lib/notifications/core.ts`, which drops a
self-notification and a recipient who is not a member of the active firm. The mailbox sync is the one
other writer: it runs under the service role and stamps the `org_id` of the mailbox connection it is
syncing.

### Approval alerts and background runs

`createDraft` raises the alert after the queue accepted the draft, and not for a draft that was
deduped into an existing one. It waits at most about three seconds for the alert and then returns the
draft id regardless; a failed or slow alert never fails or delays a draft.

The alert needs a signed-in person (it uses their session to find the firm and to leave them out of the
recipients). A draft queued by a background run with nobody signed in, for example a cron-driven agent,
raises **no** in-app alert: it deliberately does not fall back to the service-role client. Those drafts
still show in the "Waiting on you" count on Today and in the queue. A draft queued from "Run now" or any
page action does alert, because a person is signed in.

`createDraft` takes an optional `leadId`. It is used only to link the alert to the lead and is never sent
to the queue service. Callers that hold a lead pass it; where there is none, the alert links to the queue
item.

## Privacy

A notification holds names and a headline, never content. An approval alert carries the queue id and the
draft's headline, not its body, summary, recipient or subject. A reply notification carries the lead's
name, the time and the sender address, and the page never shows the address; it holds no subject and no
preview, so a sensitive thread (opposing counsel, litigation, settlement) reveals nothing of what was
said. `describeNotification` (`src/lib/notifications/describe.ts`) builds each sentence from the lead name
and headline only and shows a headline as plain text.

## Three states, never two

The bell and the page keep "it loaded" and "it didn't" apart. A failed count shows a "!" (title "Couldn't
load notifications"), never 0. A failed list says it couldn't be loaded. "You're all caught up" appears
only when the read worked and found nothing.

## Dedicated kinds (lectual 0094, applied)

The `crm_notification_kind` enum is `mentioned | assigned | lead_replied | time_running | consult_outcome |
approval_needed` (lectual 0094, applied to lectual-dev and lectual-prod). Consult outcomes and approval
alerts are written under their own kinds, from the `NOTIFICATION_KIND_FOR` map in
`src/lib/notifications/kinds.ts`, which both producers read. They still carry `payload.source`, so a
row reads the same whichever form it is in.

Rows written before the switch are the old form: kind `mentioned` with `payload.source` set to
`consult_outcome` or `approval_needed`. They stay as they are. `describeNotification` renders both forms
to the same label, icon, sentence and link, so old and new rows sit side by side in the bell and on the
page. Do not write a value the enum lacks: the insert would be refused and the notification lost.

## Where it is not

No preferences screen, no push, and no live updates: the bell refreshes on navigation and after marking
read.
