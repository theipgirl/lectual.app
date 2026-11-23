# Session recap, 2026-11-23: phasing out Lawmatics, what the SOPs say

## What was asked

1. Could Claude (or Claude in Chrome) audit how RPB uses Lawmatics, and is it worth it now
   that Lectual has taken over so much? ("Don't do anything yet.")
2. Taylor then said: Lawmatics should be phased out, and look at the documents Caitlyn made
   in SharePoint.

Nothing in Lawmatics, Lectual or SharePoint was changed. Five documents were read.

## What was read

There are no SOW documents in Caitlyn's OneDrive. Her "Legal Operations" folder holds four
SOPs, which is what was read, plus one older Lawmatics document from the info@ mailbox:

| Document | Version | Signed off? |
|---|---|---|
| SOP - Intake and Marketing Workflow (Phases 1-7) | v2.0, Oct 7 (Caitlyn) | No |
| SOP - Trademark Pre-Filing Workflow (Phases 8-16) | 0.4, Oct 26 | No. 9 decisions and 12 questions open |
| SOP - Trademark Post-Filing Workflow (Phases 18-27) | 0.1, Oct 27 | No. First draft |
| SOP - Client Intake - Agents (Lectual) | 1.0, Oct 2 | No. "Draft for Lead Attorney approval" |
| RPB Lawmatics Implementation Guide v2 (info@ attachments) | undated | A build request for the Lawmatics rep, not a record of what exists |

Not everything came through: sections 5, 14, 15 and 17-20 of the intake SOP (the open
decisions register among them) and its appendices were missing from the text returned.

## What was found

**1. The SOPs plan to build more in Lawmatics, not less.** The pre-filing and post-filing SOPs
mark about twenty things "to build" there: six invoice templates (office action response,
office action extension, statement of use, notice of allowance extension, revival,
maintenance), payment reminders at day 3 and 7, "Filed - Follow-Up #1 to #4", statement of
use reminders, post-registration nurture, the 4.5-year and 9-year maintenance reminders, and
renaming the stages to 8-27 (Q12). None of the four SOPs mentions a phase-out.

**2. Nobody has written down what is live in Lawmatics today.** The Implementation Guide is a
wish list. The SOPs disagree with each other: the intake SOP says the post-consult follow-ups
are sent by hand; the agents SOP says Lawmatics sends them by itself at 48 and 96 hours when
the stage becomes "Post Consultation Email Sent"; the guide plans a 7-day sequence from
"Pending LOE + Payment". The consult credit is $200 in one and $250 in another. The stage
list is 11 stages in one document and "about 55" in another.

**3. What Lawmatics does that Lectual does not do yet** (from the SOPs, checked against the
project notes, not against the live account):

| Lawmatics job | In Lectual today |
|---|---|
| Invoices and payment links: signing payment, remaining balance, every post-filing fee | Not built. A pay link is typed into a proposal and "Mark paid" is a stopgap. LawPay per firm exists for the older quotes only. |
| Booking the $200 strategy session, with payment, confirmation and reminder by email and text | Not built. Lectual reads the calendar; it has no booking page and no text messages. |
| Client forms with file upload: Trademark Form (79368), Statement of Use form (91241) | Partly. Intake forms and matter intake requests exist; files are internal only, a client can't upload. |
| Emails that send by themselves: form reminders, payment reminders, monthly "filed" follow-ups, nurture, maintenance reminders | Not allowed today. Everything Lectual writes is a draft for approval. This is a rule to decide, not only a build. |
| Signature requests: engagement letter, consent to file | Engagement letter: done on the proposal page (trademark). Consent to file: not built. |
| The firm's email templates (the "Firm Email Templates - Intake 2026" handbook, 41 pages) | Not in Lectual. |
| Matter documents, and the OneDrive folder tree `RPB Law/Lawmatics/CLIENTS/<name> (id)/<matter> (id)` | Lectual has its own file store; the OneDrive tree is named by Lawmatics ids. |
| Stages, board, weekly review, deadlines, reports, lead capture forms | Lectual has these. |

**4. Lectual itself leans on Lawmatics in six places** that a phase-out has to unwind: matters
are created from Lawmatics "Hired" (the hired-matter sync); the acceptance note, signed
letter, accepted proposal and mailing address are filed there; every intake pushes tags
there; the lead importer and Reconcile read it; the owner's Billing card reads its invoices;
payment is taken there.

**5. One risk that exists today.** The agents SOP says "tags fire drips": applying a tag is how
Lawmatics starts its email sequences. Lectual pushes tags on every intake (source tag, Hot /
Warm / Cold Lead, UTM). Whether any of those starts a client email is not written anywhere.

## Recommendation given

- The earlier answer changed. A "use Lawmatics better" audit is still not worth it. An
  **inventory of what is live** is worth it now, because the documents can't supply it and a
  phase-out can't be planned without it.
- **Stop building new things in Lawmatics.** Every "to build" item in the two trademark SOPs
  goes to Lectual instead. That also settles their open questions Q1, Q7, Q8, Q11 and Q12.
- Order of replacement: payments and invoices first (everything after signing depends on
  them), then client forms with upload, then the rule for automatic emails, then booking and
  texts, then signature requests, then files and the export.

## Decisions

- Taylor: Lawmatics is to be phased out.
- Not decided: whether to stop new Lawmatics builds now; whether Lectual may ever send a
  client email without a per-email approval; what replaces booking and text messages.

## Not done

- The inventory itself (nothing was read from the Lawmatics account).
- The Obsidian vault can't be reached from this cloud session (no computer folder is
  attached), so this note is only in the repo.
- Omi was checked: it has no action item about Lawmatics, and its newest items are still
  dated Oct 12.
