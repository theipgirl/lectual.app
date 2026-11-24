# Lawmatics Configuration Inventory — RPB Law Firm

Nov 24, 2026 · @RPB Law Firm

## Summary

The account runs 19 active automations out of 71. Several of them still message clients for a November 17 masterclass that has already happened. The no-show and long-term-nurture follow-ups are broken or switched off. Hired status is always set by hand.

### What can email or text a client or lead on its own today

| What sends | What starts it | Channel |
| --- | --- | --- |
| "Nov 17 - Masterclass Tonight Text" and "Nov 17 - Masterclass Has Begun Text" | Contact tag "Source: Masterclass Registration Form", added automatically when anyone fills "Register for RPB Law's Masterclass" | SMS |
| "Masterclass Nov 2026 - Confirmation & Day After (Matter)" | Registering for the event "The Trademark Masterclass" | 2 emails + 2 SMS |
| "UGW Welcome Email (Copy) (Copy)" | Tag "UGW 2026" | Email from Rebecca |
| "Paid Consultaion" | "RPB Law Legal Strategy Session Form" submitted | Email |
| "Client Feedback Form Response" | "Client Feedback Form" submitted | Email |
| "TEST LOE Automation" | Tag "TEST LOE Send" | E-sign request |
| "TM-Letter of Consent – Send Request" | Living-person trademark question answered Yes | E-sign request |
| TM-03A / OT-3A no-show sequences | Stage "No Show / Reschedule (Manual Internal Task)" (appear never to run) | Email + SMS |
| Reminders: Trademark Form (3 and 5 days), LOE signature (1–10 days), appointments (1 day before), invoices (due date and +5 days) | Form sent, document sent, appointment booked, invoice due | Email (+ text for forms and LOEs) |

### Triggers that Lectual touches

- "UGW 2026" starts an active client welcome email.
- "Story2Profit 2026" starts an active internal email to Rebecca.
- "Source: Masterclass Registration Form" starts the two active masterclass texts.
- "Masterclass Nov 2026" starts only inactive texts.
- "Hot Lead", "Warm Lead", "Cold Lead", "Source: Direct", "webinar" and the other event tags start nothing.
- No "UTM:" or "Campaign:" tags exist.
- Hired is set by hand; no automation reads or sets it.
- The form "Black Friday Bundle – Master Class Nov 2026" starts the active TM-02 and OT-2 automations on every fill.

### Plan and limits

"Team" plan at $279 a month with 10 seats (6 used, all Admin). Add-ons: Time & Billing for 2 users, and SMS at 1,500 a month (8 used this cycle). There was a one-time Premium Onboarding charge of $1,499. The next bill is on 12/21/2026 for $376. Limits on automations, contacts, e-signatures and emails were not shown.

Account size: 738 matters, 810 contacts, 71 automations, 249 email templates, 38 forms, 150 tags, 72 pipeline stages.

### Ten things worth a second look

1. The Nov 17 masterclass texts are still active. Anyone who registers now gets "starts TODAY" and "has begun" texts at once.
2. Form 78941, an intake form created about two years ago, has been renamed into the Black Friday checkout. It still starts the active practice-area automations. Someone else edited it and its payment-plan copy shortly before this review.
3. The no-show automations (TM-03A, OT-3A) have an exit rule that every matter meets, and 0 runs. OT-3A also shows a "\<sub\_status\_missing>" error.
4. Long-term nurture is off. The automations name stages ("Long Term Nurture (BL)", "Undecided (BL)", "New Lead (BL)") that don't match the real stage names.
5. The statement-of-use specimen form has no file-upload field, even though its heading asks for an upload.
6. The welcome email has been sent 53 times by hand. "Engagement Confirmed" has never been sent. 38 engagement letters expired unsigned.
7. Trademark Form reminders go out at 3 and 5 days, not 3, 7 and 14. They stop on a stage, not on form submission.
8. OAuth client secrets for 7 developer apps are visible to every user, and all 6 users are Admins.
9. Data hygiene: three "how did you hear" fields, two package prices ($1,950 vs $1,650), "cybermondaytest" on 749 records, two masterclass tag spellings, about 100 unused tags, two intake pipelines, and today's test records in live data.
10. Gaps: no confirmation email for the 15-minute free consult, no office-action form, Invoice Settings wouldn't open, and there's no OneDrive folder template.

## A. Plan and add-ons

The firm is on the "Team" plan with 6 of 10 seats used. Every user is an Admin. Paths: Settings > Billing, User Management, LMPay.

| Item | Detail |
| --- | --- |
| Plan | "Team", $279.00/mo, account "Active" |
| Add-on | "Time & Billing User" × 2 at $29 = $58 |
| Add-on | "SMS Add-On", 1,500 messages, $39; 8 used this cycle (6 out, 2 in) |
| One-time charge | "Premium Onboarding" $1,499 (listed under Charges, not in the $376 total) |
| Total / next bill | $376.00 on December 21, 2026 |
| Payment method | Visa on file (digits withheld); billing user and address blank |
| LMPay | "Active" since 12/11/2024; TRUST "IOLTA ACCOUNT" and OPERATING "RPB Law Operating", both Active |

**Users** ("4 of 10 User Seats Available")

| First name | Role | Status | Mail | Calendar | 2FA | Zoom | Teams | T&B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dawn | Admin | Accepted | ✓ | – | ✓ | – | – | – |
| Rebecca (account 1) | Admin | Accepted | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| Rebecca (account 2) | Admin | Firm Owner | – | – | ✓ | – | – | – |
| Rayn | Admin | Accepted | ✓ | ✓ | ✓ | – | – | ✓ |
| Taylor | Admin | Accepted | – | ✓ | ✓ | ✓ | – | – |
| Caitlyn | Admin | Accepted | – | – | ✓ | – | – | – |

The Mail and Calendar columns are unlabeled icons in Lawmatics; that they mean mail sync and calendar sync is my reading.

Not confirmed: plan limits (automations, contacts, e-signatures, emails); whether two-way SMS, MMS, Event Management or Merlin AI are included; Merlin Copilot seats.

## B. Automations

There are 71 workflows (19 active, 52 inactive), all in "Root Folder". Paths: Automations > Workflows and Automations > Reminders. Active automations were read through their read-only Preview. Inactive ones open in the editor, so for those only the trigger, exit rule and step names were read. "Runs" is the "Matters Ran" counter. No count of people currently in an automation is shown.

### Active (19)

| Name | Trigger | Actions in order | Messages client? | Exit rule | Runs |
| --- | --- | --- | --- | --- | --- |
| "TEST LOE Automation" | Matter tag "TEST LOE Send" | Request Signature "TEST LOE Template" (requester Taylor) | E-sign (test) | none | 1 |
| "Nov 17 - Masterclass Tonight Text" | Contact tag "Source: Masterclass Registration Form" | SMS "starts TODAY at 7 PM EST" + Zoom link | SMS | none | 77 |
| "Nov 17 - Masterclass Has Begun Text" | Same tag | SMS "has begun! We're live now" + Zoom link | SMS | none | 77 |
| "Masterclass Nov 2026 - Registration Form Source Tag" | Filled "Register for RPB Law's Masterclass" | Add contact tag "Source: Masterclass Registration Form" | No (starts the texts above) | none | 76 |
| "Masterclass Nov 2026 - Confirmation & Day After (Matter)" | Registered for "The Trademark Masterclass" | Email "…#1 - Registration Confirmation (Workflow)" → SMS → wait 1 day → Email "…#3 - Before Class Assessment (Workflow)" → SMS | Email + SMS, from firm's email | none | 44 |
| "Story2Profit 2026" | Matter tag "Story2Profit 2026" | Email "New lead" to Rebecca | No (internal) | none | 26 |
| "UGW Welcome Email (Copy) (Copy)" | Matter tag "UGW 2026" | Email "UGW submit HTML" from Rebecca | Email | none | 146 |
| "Trademark Form Automation" | Filled "Trademark Form" | Task "Trademark Form Filled" for Rayn, +1 day | No | none | 1 |
| "Paid Consultaion" | Filled "RPB Law Legal Strategy Session Form" | Email "30 Minutes Appointment Confirmation… (1)", cc Rebecca | Email | none | 19 |
| "Client Feedback Form Response" | Filled "Client Feedback Form" | If/Else → "For Positive Feedback (4 or 5 Stars)" or "For Less-Than-Great Feedback (1 to 3 Stars)" from Rebecca | Email | Either email clicked | 2 |
| "OT-01C Post Manual 'Needs More Information' Email Sent by Attorney (Follow-Up Workflow)" | Field "Attorney Selected - PNC Client Interest Form Selection" = "Needs more information" | 3 tasks for lead attorney, 5 days apart | No | none | 0 |
| "OT-2 Matter Update – Assign Practice Area: Other" | Filled "Black Friday Bundle – Master Class Nov 2026" | If/Else → Practice Area "Other" → task → wait | No | none | 61 |
| "TM-02 Matter Update – Assign Practice Area: Trademark" | Filled "RPB Law Legal Strategy Session Form", "RPB Law Client Interest Trademark Form" or "Black Friday Bundle – Master Class Nov 2026" | If/Else → Practice Area "Trademark Law" → review task | No | none | 126 |
| "OT-3 Consultation Scheduled – Other" | Event "30 Minute Consultation" created | Stage → "Consult Scheduled" | No | none | 89 |
| "TM-03 Consultation Scheduled – Trademark" | Event "15 Minute Complimentary Consultation" or "30 Minute Consultation" created | Stage → "Consult Scheduled" | No | none | 135 |
| "OT-3A Reschedule / No Show – Other Consultation" | Stage "No Show / Reschedule (Manual Internal Task)" AND Practice Area Other | Email + SMS → 1d → call task → 2d → email + SMS → 4d → task → 4d → email + SMS → 4d → attribute change (shows "error: \<sub\_status\_missing>") → Stage "Long Term Nurture (BL)" | Email + SMS | Status not PNC OR stage not No Show OR Status not Lost | 0 |
| "TM-03A Reschedule / No Show – Trademark Consultation (Manual Trigger)" | Stage "No Show / Reschedule (Manual Internal Task)" | Same pattern with "\[PNC - Trademark\] … Reminder #1–#3" | Email + SMS | Same | 0 |
| "TM-Letter of Consent – Send Request" | Living-person trademark question = Yes | Task → wait → Request Signature "Letter of Living Consent" (requester Rebecca) | E-sign | none | 2 |
| "F. Classifications" | Classifications field has any value | Task "Fill Out Consult Notes Form" for Rebecca | No | none | 3 |

### Inactive (52)

| Name | Trigger | Steps | Runs |
| --- | --- | --- | --- |
| "Masterclass Nov 2026 - Text #4 / #5 / #6 / #7" | Matter tag "Masterclass Nov 2026" | Delay(s) → SMS | 0 |
| "Masterclass Nov 2026 - Text #8 Thank You (Attended, Wed)" | none | none | 0 |
| "Masterclass Nov 2026 - Registration Tag (Matter)" | Registered for the masterclass | Change Attributes | 47 |
| "Masterclass Nov 2026 - Confirmation & Day After" / "…Registration Tag" (All Contacts) | Registered for the masterclass | Emails/SMS / attribute | 0 |
| "Story2Profit 2026" (copy) | Tag "Story2Profit 2026" | Email | 8 |
| "UGW Welcome Email (Copy)" | Tag "UGW 2026" | 2 emails | 39 |
| "Pathset — NURTURE Sequence" | Stage "Nurture" OR (invoice form AND Trademark LOE signed) | 4 emails with delays | 0 |
| "Pathset — MEDIUM Readiness Follow-Up" | Stage "Discovery Call Scheduled" | 5 emails with delays | 0 |
| "Pathset — HIGH Readiness Follow-Up" | Stage "Legal Strat Session Scheduled" | 3 emails + task; exits at "Pending LOE + Payment" | 0 |
| "Legal Strategy Session" | Filled "RPB Law Strategy Session" (listed twice) | none | 0 |
| "Christmas Email" (date based; second copy trigger based) | Blank / none | none | 0 |
| "\[LM TEST\]" | Minutes before "Initial Consultation" | none | 0 |
| "TM-Free & Paid Consultation Flow (Initial Setup)" and "(Copy)" | Black Friday form / Legal Strategy Session form | If/Else → 3 emails | 36 / 5 |
| "Consultations with Rebecca – Team Attendee Automation" × 2 | Consult event created | If/Else only | 0 |
| "GC-01 New Lead Acknowledgment – 'General Counsel Services' Selection" | Black Friday form AND General Counsel | Email → attribute | 4 |
| "OT-01 New Lead Acknowledgment – 'Other' Selection" | Black Friday form AND Business/Entertainment/Other | Email → attribute → task | 47 |
| "General LOE & Invoice Generation" | Filled "General LOE Form" | Task, If/Else, 4 × Create Invoice | 6 |
| "OT - 2A - Post-Consult: LOE Document + Invoice Prep (Manual Trigger & Send)" | Field "Ready to Send 'Other' General LOE + Invoice…" = Yes | Task, attribute, wait | 0 |
| "v2 TM-08 …" and "v3 TM-08 … (Copy)" (SOU specimen request) | Stage "NOA Issued 1(b) Applications" OR NOA field = Yes | Tasks, attributes, waits (v2 also Create Invoice); exit when SOU form filled AND SOU fee paid | 0 |
| "TM-07 Office Action Issued – Response Workflow (Manual Trigger)" | Stage "Office Action Issued" | Tasks, attributes, waits; exit on invoice paid | 0 |
| "v2.TM-07 … (Copy)" | Stage "Office Action Issued" | Email | 0 |
| "TEMPLATE - Tag" | Tag "OA Issued" | Task → wait → email | 0 |
| "Auto-Tag When 'Review OA Daily' Task is Completed" | Task tagged "Review OA Daily" done | Attribute | 0 |
| "TM-06 Application Filed – Send Filing Receipt" | Task tagged "trademark filed" done | Tasks, email, SMS | 0 |
| "Test - Daily Docketing Reminder" | Registered for test event | Email | 0 |
| "Post-Reg — Trademark Registration Confirmation (Copy)" | Registration email opened | Tasks, 4 emails | 0 |
| "Post-Reg — … Nurture + Maintenance Dates" | Registration email field = Yes OR Stage "Trademark Registration" | Tasks, 3 emails | 0 |
| "LEGACY — Trademark Intake Flow (Old Sequence)" | Black Friday / Contact / Masterclass forms | Attribute, 5 emails | 0 |
| "3. LLC (Business Formation) Test" | LLC event / questionnaire | If/Else only | 0 |
| "\[ARCHIEVED\] TM-04 Post-Consult – Trademark Email (Manual Trigger)" | "Send Post Consult Email" = True | Email | 2 |
| "\[ARCHIVED\] TM-04A LOE + Invoice – Trademark Post-Consult" | "Send LOE" True AND Trademark AND invoice ≥ $10 | Signature request, 2 × Create Invoice | 6 |
| "Invoice - Send 2nd Invoice" | Invoice form AND Trademark LOE signed | 2 attribute changes | 0 |
| "TEMPLATE- Unqualified" / "TEMPLATE- Qualified" | Unqualified / Qualified = True | Emails, attributes | 0 |
| "TEMPLATE- Long Term Nurture" | Stage "Long Term Nurture (BL)" | 4 emails; exits if stage changes or Hired | 0 |
| "TEMPLATE- Undecided" / "TEMPLATE- New Lead" | Stage "Undecided (BL)" / "New Lead (BL)" | Emails, tasks, form sends | 0 |
| "Website Contact Form Submitted" | Black Friday form OR Masterclass form | Task, attribute | 0 |
| "test automation", "TM Test", "tag/task test", "Internal Task - Daily OA Reminder", "Internal Daily Reminder: OA Checks", "TM-07A OA Extension Request – Filing Confirmation" | none | none | 0 |

### Reminders (Automations > Reminders)

- **Forms:** "Trademark Form" at 3 and 5 days, email and text. They stop when Stage is "+ Trademark Form Completed".
- **Documents:** 13 reminders, email and text. Trademark Letter Of Engagement, Trademark LOE and General LOE at 3, 7 and 10 days; Copyright LOE at 1 and 3 days. All stop at Stage "LOE Signed/ Invoice Paid". GLOE2 at 1 and 3 days stops at Status Lost.
- **Appointments:** 1 day before for "30 Minute Consultation", "15 Minute Complimentary Consultation" and "Client Meeting- Active Clients Only".
- **Appointment confirmations:** "30 Minute Consultation" and "Client Meeting- Active Clients Only" only.
- **Invoices:** at the due date and 5 days after, 8:00 AM.
- **Cancellations/no-shows, events, event confirmations, signature packets:** none.

### Answers to your ten questions

1. **Tag-started.** Active: Nov 17 texts ("Source: Masterclass Registration Form"), "Story2Profit 2026", "UGW 2026", "TEST LOE Send". Inactive: "Masterclass Nov 2026", "OA Issued", task tags "Review OA Daily" and "trademark filed".
2. **Stage-started.** Active: only TM-03A and OT-3A ("No Show / Reschedule"). None start from Post Consultation Email Sent, Pending LOE, Legal Strategy Session Complete, Invoice Paid, Consult Scheduled or Hired.
3. **48/96 hours after a proposal stage:** none found.
4. **Long-term nurture:** exists ("TEMPLATE- Long Term Nurture", "Pathset — NURTURE Sequence") but is **off**.
5. **TM-08:** no exact match. "v2 TM-08…" and "v3 TM-08… (Copy)" exist, both **inactive**.
6. **Trademark Form reminders:** at 3 and 5 days, not 3/7/14. They stop on a stage, not on submission.
7. **Welcome / Engagement Confirmed:** no active automation sends either. The welcome email was sent 53 times by hand; Engagement Confirmed has 0 sends.
8. **Invoice Paid / Hired / invoices:** nothing active does any of these. Inactive flows can create invoices.
9. **Masterclass:** the registration tag, confirmation sequence and two Nov 17 texts are still active. Texts #4–#8 are inactive. The tag is spelled "Masterclass Nov 2026".
10. **Match-all / old clients:** none active. The Nov 17 texts and Client Feedback target PNC, Hired and Lost matters alike.

## C. Tags

There are 150 tags. Only about 37 are in use; most of the structured tag families are empty. Path: Settings > Tags ("Usage Count" column).

### Flagged tags

| Tag | Count | Starts an automation? |
| --- | --- | --- |
| "UGW 2026" | 314 | Yes: "UGW Welcome Email (Copy) (Copy)" (active, client email); "(Copy)" inactive |
| "Story2Profit 2026" | 27 | Yes: "Story2Profit 2026" (active, internal email); a copy is inactive |
| "Source: Masterclass Registration Form" | 76 | Yes: both Nov 17 texts (active, SMS) |
| "Masterclass Nov 2026" | 48 | Inactive only (Texts #4–#7) |
| "Master Class Nov 2026" | 2 | No |
| "Masterclass Nov 2026 - Attended" | 30 | No |
| "Black Friday Bundle" | 2 | No (a form of the same name is a trigger) |
| "webinar" | 1 | No |
| "Hot Lead" / "Warm Lead" / "Cold Lead" | 56 / 89 / 11 | No |
| "Source: Direct" | 14 | No |
| "Wealth Affair", "BPN", "Render ATL Leads", "Melanin Money", "MM- No Consults", "Legal Assessment" | 27 / 24 / 17 / 28 / 43 / 13 | No |
| "cybermondaytest" | 749 | No |
| "TEST LOE Send" | 2 | Yes: "TEST LOE Automation" (active) |
| "OA Issued" | 0 | Inactive only |
| "UTM:…" / "Campaign:…" | none exist | n/a |

### Other tags in use

"website" (124), "automation applied" (40), "trademarklead" (37), "#trademarkpipeline" (20), "form template" (15), "email template" (10), "AB" (6), "attach filing receipt" (4), "template" (4), "Trademark Law" (3), "instant trademark package", "trademark package", "initial YES email sent", "manual sent" (2 each), "Payment Plan", "amor", "PA - Business Law" (1 each).

### Unused tag families (count 0)

OPS (4), BILL (8), CAMP (20), MKT (26), FU (3), SRC (9), QUAL (6), VAL (4), URG (6), SERV (21), PA (4 of 5). Also "Office Action Issued", "Review OA Daily", "post-trademark registration", "trademark filed", "custom email (dupe of main)", and a tag named ",".

Not confirmed: whether each tag sits on contacts or matters, and whether any If/Else branch checks a tag.

## D. Pipelines, stages and statuses

There are 5 pipelines with 72 stages. Hired is set by hand. Paths: Settings > Pipelines, the Pipeline board, Settings > Matters.

| Pipeline | Stages | Stages in order (matter count where read) |
| --- | --- | --- |
| "Intake Pipeline" (default board) | 14 | PNC Other Practice Area (24) · PNC Trademark (7) · Other Practice Area Form Filled Out (0) · Consult Scheduled (56) · No Show / Reschedule (Manual Internal Task) (3) · Post Consultation Email Sent (14) · Undecided / Questions (3) · LOE / Invoice Sent (Manual Internal Task) (5) · Invoice Paid (0) · Invoice Saved: Needs Atty Review (0) · LOE / Signed Pending Payment (0) · Payment Paid - Awaiting LOE Signature (0) · LOE Signed/ Invoice Paid (0) |
| "Trademark Workflow" | 43 | Welcome Packet Sent/Trademark Form Sent → + Trademark Form Completed → search, opinion letter and strategy call stages → application preparation and filing → office action stages (notify, invoice, payment, responses, extensions) → Potential/Trademark Abandoned → NOA and SOU stages → Publication for Opposition, Started, Ended → Awaiting Trademark Registration → Trademark Registration |
| "Lost Leads" | 1 | Long Term Nurture |
| "Business Law Pipeline" | 3 | Entity Formation & State Filings · Website & Compliance Policies · Post-Formation & Maintenance |
| "NEW - Intake Pipeline" | 11 | New PNC · Discovery Call Scheduled · Discovery Call No Show · Discovery Call Complete · Legal Strat Session Scheduled · Legal Strategy Session No Show · Legal Strategy Session Complete · Pending LOE + Payment · Nurture · Lost Lead · Hired Client |

Counts were read only for the Intake Pipeline: 112 matters with "Show All Matters" off, all valued at $0. Reading the other pipelines would mean changing the board's pipeline dropdown, which was off-limits. "Track Time in Stage" was checked on one stage (Consult Scheduled: on); the other 71 weren't opened.

| Status | Sub-statuses |
| --- | --- |
| PNC | none |
| HIRED | "Probono" |
| LOST | "Unresponsive Pre Consultation", "Unresponsive Post Consultation" |

- **Hired** is set by hand; no automation sets it. "Hired Client" is a separate stage in NEW - Intake.
- **Auto numbering** is on; the next hired matter number is 92.
- **No converted/conversion date** custom field exists.
- **Relationship types:** Registered Agent, Other, Client 2. **Custom views:** Default only.
- **Mismatch:** automations reference "Long Term Nurture (BL)", "Undecided (BL)" and "New Lead (BL)", which don't exist under those names.

## E. Custom fields

There are 125 matter fields, 21 contact fields, and no company or client fields. None of the requested LOE fields exist, and "Where did you hear about us?" isn't there either. Paths: Settings > Custom Fields, Settings > Practice Areas.

| Asked for | Found (exact spelling) | Type | Lives on |
| --- | --- | --- | --- |
| "Where did you hear about us?" (SOP) | not found |  |  |
| "How did you hear about us?" (Lectual) | "How did you hear about us?" | Multi-select (Event, Other, Referral, Search Engine, Social m…) | Matter |
| Other versions | "How did you hear about RPB Law Firm?" | Picklist (Event, Other, Referral, Search Engine, Social Media, Current Client) | Matter |
|  | "How did you hear about RPB Law?" | Multi-select (Event, Instagram, Other, Referral, Search Engin…) | Matter |
| "Referred By" | "Referred By" | Text | Matter |
| "Specify Source" | "Specify Source" | Text | Matter |
| "Name of Trademark" | "Name of Trademark" | Text | Matter |
| "Practice Area" | "Practice Area" (plus "Practice Area(s)", "Practice Area Requested"; contact "Practice Area Of Interest") | Picklist | Matter |
| "Case Title" / "Case Number" | not a custom field |  |  |
| LOE Package / Fee Chart / Classes / Legal Fee / USPTO Fees / Signature Deadline | none found |  |  |
| Conversion date | not found |  |  |

**Fields that do the LOE job today:**

- "LOE Type" (picklist), "Send LOE" (true/false), "TEST LOE Fee Section" (text area, created 11/23/2026)
- "Legal Fee Total" and "Gov. Filing Fee Total" (both text, not money)
- "Legal Services Fee 1–5" (money), "Goods/Services 1–5" (text), "Goods/Services USPTO Fee 1–5" (money)
- "Number of Classifications for Goods/Services" (text)
- Two package picklists with different prices: "Which trademark package would you like to proceed with?" (ESSENTIAL™ $1,950) and "What trademark package would you like to move forward with?" (ESSENTIAL™ $1,650)

**Practice areas:** Business Law, Contracts, Entertainment Law, General Counsel Services, Other, Trademark Law. Statute of limitations is disabled for all six.

**Duplicates:** "Are you the only author?" (picklist and text versions), the living-person trademark question (picklist and text), and contact "Domicile Address - Zipcode" and "- Zip Code".

## F. Forms

There are 38 custom forms. Two of the believed form IDs (83902, 82004) don't exist, and the statement-of-use form has no upload field. Path: Custom Forms (`/custom-forms`). Field details come from each form's View page; builders weren't opened, so field mappings, hidden fields and show/hide logic weren't read. • marks a required field.

| Form (ID) | Found? | Fields and structure | Linked to |
| --- | --- | --- | --- |
| "Trademark Form" (79368) | Yes | •Name prefix, •first, •last, •phone, •email, •owner type, mailing address, •proposed mark type, living-person question, website/social questions, •in use?, goods and services, foreign meaning, •previously filed?, notes, **"Evidence Uploads"** (JPG/PDF, optional). No payment or signature. | Starts "Trademark Form Automation" and "TM-Letter of Consent"; reminders at 3 and 5 days |
| "Notice of Allowance (NOA): Statement of Use Image Form" (91241) | Yes | •Contact info, •Name of Trademark, •type, •classes, •two first-use dates, •image description. **No file-upload field** despite an upload heading. | Exit condition for inactive TM-08 flows |
| Reschedule (believed 83902) | No; the match is "Reschedule Your 30 Minute Legal Strategy Session" (92677) | Contact info, address, a built-in 30-minute Zoom booking calendar | Possibly the no-show SMS link (unconfirmed) |
| Office action (believed 82004) | Not found |  |  |
| "Stay Connected" variants (130025, 123699, 123559, 82632) | Yes | Name, email, phone, •Practice Area(s), comments; 123699 also requires "How did you hear about us?" | No automation starts from them |
| "Get Connected" | Not found |  |  |
| "Register for RPB Law's Masterclass" (139764) | Yes; marked Internal | Name, email, phone, event picker showing "No Future Events are Available" | Starts the tag → Nov 17 texts (active) |
| "Trademark Package" (95328) | Yes | Order: **1 Client Details → 2 Terms and Conditions → 3 Complete Payment**. No signature step. | None |
| "Black Friday Bundle – Master Class Nov 2026" (78941) | Yes | "$3,997 + government filing fees"; 1 Basic Information → 2 Pay. Created about two years ago, edited just before this review. | Starts active TM-02 and OT-2 plus several inactive intake flows |
| "Black Friday Bundle – Payment Plan (3 × $1,437)" (139662) | Yes | Same two-step layout; edited just before this review | Used in the "test" e-signature packet |

**All other forms:** Speaking Engagements; Pay Your Legal Fee Invoice (two forms, 125810 and 89667); Pay Your Government Filing Fees Invoice; RPB Law Complimentary Legal Strategy Session Form; Book Rebecca P. Beliard, Esq. for a Speaking Engagement; RPB Law Strategy Session Scheduling Form; RPB Law Strategy Session; Client Interest Trademark Form; Pay Your Trademark Legal Invoice(s); Trademark Package 2 (wouldn't open); RPB Law Legal Strategy Session Form; RPB Law Client Interest Trademark Form; Discovery Call; Help Us Improve – Feedback Form; Client Feedback Form; General LOE Form; TM Classification Client Selection; Client Meeting Request; Pay Your Trademark Legal Invoice; Schedule a 30 Minute Consultation; RPB Law Firm Client Interest Form (Matter Review); Copyright Registration Form; RPB Law Contact Form; Consultation Notes (Internal); Trademarks 101; Limited Liability Company Questionnaire.

## G. Email and text templates, campaigns, audiences

There are 249 email templates in one folder ("Root Folder") and no separate text-message template library. No campaign is scheduled. Paths: Marketing > Emails, Campaigns, Audiences.

**Template types:** Workflow/Campaign about 215; Document Reminder 7; Document Send 5; Appointment Reminder 4; Appointment Confirmation 3; Invoice Reminder 2; Form Reminder 2; Event Confirmation 1; Form Send 1; File Request Send 1. SMS text lives inside automations.

| Family | Examples (sends) |
| --- | --- |
| Broadcasts and events | "WA" (538), "WEBINAR AND BF 1–4" (\~540 each), "Trademark Package 2026" (659), "Inspire Bermuda" (661), "Tenth Year" (544), "BPN Email 1–2", "CC Email 1–4", "ATL Email 1–3", "Flourish Media Workshop" series, Black Friday / Cyber Monday 2025, National Black Business Day, World IP Day, Melanin Money, holidays |
| Masterclass | "Masterclass Nov 2026 - #1 / #3 / #4…", "Nov 17 - Tonight at 7PM" (129), "Starts in One Hour", "We're Live", "Not Too Late", "Thank You (Attended)", "We Missed You (No Show)" |
| UGW | "UGW" (824), "UGW Email 1–4", "UGW submit HTML" (199), plus four unused variants |
| PNC / intake | "PNC Email 1" (880), "PNC Email 3–4", client-interest acknowledgements, attorney Yes / No / Needs-More-Info follow-ups, reschedule/no-show reminders, "Decline Email - Cannot Take Matter" |
| Onboarding / LOE | **"\[Client Intake – Onboarding\] New Trademark Client Welcome Email"** ("Welcome to RPB Law Firm Family!", 53 sends); **"\[Client Intake\] Signed LOE/Legal Fee Invoice Paid"** ("Engagement Confirmed – Next Steps…", 0 sends); Document LOE send templates |
| Trademark process | Pre-filing, filing, office action, NOA/SOU, USPTO notices, registration, renewal, abandonment |
| Nurture | "\[NURTURE\]", "\[MEDIUM\]", "\[HIGH\]" day series; "LTN 1–4"; "Undecided Email 1–3"; "New Lead Email 1–3" (almost all 0 sends) |
| System | Appointment confirmation/reminder, document/form/invoice reminder, and invoice emails (all 0 sends) |

**Templates used by active automations or reminders:**

- Masterclass #1 and #3: "Confirmation & Day After"
- "UGW submit HTML": UGW welcome
- "New lead": Story2Profit (internal)
- "30 Minutes Appointment Confirmation… (1)": Paid Consultaion
- Both feedback emails: Client Feedback
- "\[PNC - Trademark\] / \[PNC - Other\] Reschedule…": TM-03A and OT-3A
- All system reminder templates: Reminders

The welcome email has no automation behind it. Engagement Confirmed has never been sent.

**Campaigns (3), none scheduled:** "LM TEST - Email 2" (audience deleted, 6 sends, 08/20/2025); "LM TEST - Email 1" (audience deleted, 2 sends); "Cyber Monday Test" (audience "Cyber Monday Sale Test", 4 sends, 11/29/2024).

| Audience | Type | Matches |
| --- | --- | --- |
| Everyone | Contact | 651 |
| Cyber Monday Sale Test | Contact | 651 |
| PNC Audience | Matter | 513 |
| Urban Golf Weekend 2026 | Contact | 140 |
| Client Audience | Matter | 137 |
| Trademark End of Year Audience List | Contact | 102 |
| Trademark Masterclass - November 2026 | Matter | 73 |
| … - Did Not Attend | Matter | 45 |
| Melanin Money - Unbooked | Matter | 38 |
| … - Attended | Matter | 28 |
| 90 days and Over without communication | Contact | 24 |
| Wealth Affair | Contact | 23 |
| Render ATL | Matter | 16 |
| Melanin Money | Matter | 10 |
| Acquisition Blueprint - Gamal Codner | Contact | 0 |

## H. Appointments and booking

There are 13 appointment types, none with a price. Confirmations cover only two of them, and no-show handling is manual. Paths: Settings > Appointments / Events, Settings > Calendar, Marketing > Event Management.

| Appointment type | Length |
| --- | --- |
| Discovery Call with Taylor McGhee | 30 min |
| Complimentary Consultation | 30 min |
| Meeting with Taylor McGhee | 30 min |
| Candidate Interview | 30 min |
| 30 Minute Consultation | 30 min |
| LLC (Business Formation) Test | 30 min |
| Trademark Discussion | 30 min |
| Law Firm Weekly Meeting | 59 min |
| 15 Minute Complimentary Consultation | 15 min |
| Client Meeting- Active Clients Only | 30 min |
| Speaker Inquiry | 20 min |
| Professional Development Meeting | 30 min |
| Initial Consultation | 15 min |

- **Paid vs free:** no rate is set on any type. The paid consult runs through the "RPB Law Legal Strategy Session Form" and the "Paid Consultaion" automation.
- **Confirmations:** "30 Minute Consultation" and "Client Meeting- Active Clients Only" only. **None for the 15-minute complimentary consult.**
- **Reminders:** email 1 day before for the 30-minute, 15-minute and client-meeting types. All confirmation and reminder templates show 0 sends.
- **No-show and cancellation:** none in Reminders. TM-03A and OT-3A need a manual stage change and appear never to run.
- **Booking forms:** Schedule a 30 Minute Consultation; RPB Law Strategy Session Scheduling Form; Complimentary Legal Strategy Session Form; Reschedule form (92677).
- **Calendar (Taylor's settings):** Exchange, info@ mailbox, two-way sync. Working hours Tuesday and Thursday only, 9:30am–2:00pm ET. Bookable from the next day, 30-minute buffer, up to 2 weeks ahead.
- **Zoom:** connected for Rebecca and Taylor. Teams: none.

| Event | Date | Max registrants | Registrants |
| --- | --- | --- | --- |
| The Trademark Masterclass | 11/17/2026 7:00pm EST | no cap | 49 |
| Trademarks 101 | 06/11/2026 | no cap | 1 |
| Test Event - June | 06/04/2026 | no cap | 9 |

No future events exist, and there are no event types or event reminders.

## I. Documents and signing

The firm uses Lawmatics' built-in e-signature: 164 requests so far, of which 95 are completed and 38 expired. Paths: Docs & Forms > Document Templates, E-Signatures (list only), E-Signature Packets, File Request Templates.

| Template | Type | E-sign | Tags |
| --- | --- | --- | --- |
| TEST LOE Template | DocX | Yes | none |
| Trademark Letter Of Engagement | Custom | Yes | Trademark Law |
| Trademark LOE | Custom | Yes | none |
| General LOE | Custom | Yes | none |
| GLOE2 | Custom | Yes | none |
| Copyright LOE | Custom | Yes | none |
| Letter of Living Consent | Custom | Yes | Trademark Law |
| Copyright Registration - LOE | Custom | No | none |
| Legal Services - LOE | Custom | No | none |
| Untitled | Custom | No | none |

| Status | Count | Mostly |
| --- | --- | --- |
| Completed | 95 | Trademark LOE 40, Trademark Letter Of Engagement 25, General LOE 15 |
| Expired | 38 | Trademark LOE 30 |
| Sent (unsigned) | 16 | Trademark LOE 8 |
| Viewed (unsigned) | 10 | General LOE 5 |
| Partially Submitted | 2 | TEST LOE (today) |
| Canceled | 2 | Trademark Letter Of Engagement |
| Declined | 1 | Trademark Letter Of Engagement |

- **Signature reminders:** see Section B. They stop only at Stage "LOE Signed/ Invoice Paid".
- **Audit trail:** GPS and IP capture are both enabled.
- **E-signature packet:** "test", which pairs the Black Friday payment-plan form with "General LOE" (created yesterday).
- **File request template:** "Specimen" (1 file, created 10/14/2024 by Dawn).

Not found: signer-order and expiry settings; where signed copies are filed. OneDrive syncs new records (Section K).

## J. Billing

LMPay and LawPay are both connected, and QuickBooks Online is connected too. There are about 135 invoices, with $1,901 outstanding and 2 past due.

| Item | Finding |
| --- | --- |
| Processors | LMPay Active (TRUST "IOLTA ACCOUNT", OPERATING "RPB Law Operating"); 8am LawPay Connected; Confido not listed |
| QuickBooks | QuickbooksOnline Connected; sync rules not seen |
| Invoices | Paid 130 (9 Flat Fee), Draft 3, Past Due 2; latest three are today's tests |
| Invoice types seen | Flat Fee, blank, "Trademark Filing Government Fee"; no "Remaining Balance Invoice" type |
| Invoice reminders | At due date and +5 days, 8:00 AM, Standard and Government Fee invoices |
| Payment forms | Pay Your Legal Fee Invoice (×2), Pay Your Government Filing Fees Invoice, Pay Your Trademark Legal Invoice(s), Trademark Package, Black Friday bundle and payment plan |
| Payment plans / Auto Pay | No firm setting seen; only the Black Friday payment-plan form |
| Invoice emails | Default Online, Default Offline, Custom General (0 sends); no receipt template seen |
| Trust | "Trust Account" and "Trust Fund Requests" pages exist (not opened) |

Invoice Settings would not open (the link returned to the Dashboard). Scheduled reports are available; see Section M.

## K. Integrations

Zoom, LawPay, RingCentral, QuickBooks Online and OneDrive are connected. Seven developer apps exist, three of them named for Lectual or Claude. Paths: Settings > Integrations, Mail Sync, Email Domain, Developers.

| Connected | Not connected |
| --- | --- |
| Zoom, 8am LawPay, RingCentral, QuickbooksOnline, OneDrive | Microsoft Teams, Google Ads, Meta Ads, CallRail, Attorney Share, and all case-management tools (Clio, Smokeball, MyCase, Filevine and others) |

- **Mail sync:** not set up for Taylor. Others probably have it (Section A icons). The sending domain rpblawfirm.com is Validated. A BCC logging address exists (withheld). "Send From My Outbox" wasn't found.
- **Calendar:** Exchange, two-way (Section H).
- **OneDrive:** "sync all new records" is **on**. No folder-naming setting is shown, and Practice Area Folder Groups are empty, so the "CLIENTS / person / matter" tree couldn't be confirmed. SharePoint isn't listed. Zapier isn't listed.
- **Webhooks:** none listed.

| Developer app | Description |
| --- | --- |
| MCP | "this is the new one for audit agent" |
| Partial Form capture | "melanin money lead capture" |
| NEW MCP - TAGS | "This is to create the tags" |
| Pathset | Auto-imports qualified leads with tags, stage and intake brief |
| Claude | "Claude - lectual plugin" |
| Lectual | "dashboard" |
| Lectual (RPB) | "Lectual OAuth app for RPB (rotated Oct 2026)" |

The client IDs, secrets and redirect URIs for these apps are shown in plain text on the Developers page. They are withheld here.

## L. Duplicates and data

Both email-matching settings are on, so a repeat form fill lands on the existing contact and matter. The account holds 738 matters and 810 contacts.

| Setting (Settings > Firm Settings) | State |
| --- | --- |
| Match Contacts by Email | Enabled |
| Form Fills Match Matter by Email | Enabled |
| Default Company Matter ON for Matter Forms | Disabled |
| Enable Sales Team | Disabled |

- **Contact types:** Client 11, RPB Law Firm (Admin) 1, RPB Law Placeholder Contact 3. The rest have no type.
- **Export options (CSV, none run):** Export Matters, Export Contacts, Export Companies, Export Bounces. An Import page and a Recovery Bin also exist.
- **Consequence:** past clients who fill the renamed Black Friday form trigger TM-02 and OT-2 on their existing matter.

## M. Reports and dashboards

There are three saved reports, none filtered and none subscribed. Analytics does show lead source and conversion.

| Report | Type | Matches | Subscription | Created by |
| --- | --- | --- | --- | --- |
| RPB Law Firm Client Interest Form | Matter | 738 | None | Karen, 04/08/2026 |
| List of Matters | Matter | 738 | None | Karen, 04/08/2026 |
| Contacts List | Contact | 810 | None | Karen, 04/08/2026 |

- **Subscriptions:** each report has "Setup Subscription", so scheduled reports are available on this plan. No unpaid-invoice report exists yet.
- **Dashboard:** "RPB Law Firm Dashboard". This month: 64 new matters and 2 new clients. Overall conversion is 17.75%. It also has source stats and a "Requires Attention" list.
- **Analytics:** leads at a glance, monthly goals (15 new leads, 15 new clients), source overview, conversion by source, and matter volume over time.
- **Sources:** Email Newsletter, Event, Instagram, LinkedIn, Other, Referral, Search Engine, Social Media, Threads, Website.
- **Marketing Sources campaigns** (e.g. "Book Legal Strategy Session $149 / $200", "Stay Connected $149 / $200") all show $0 spend and 0 hired.
- **ROI Tracker:** exists, not opened.

Karen isn't one of the current six users.

## Method and what was touched

The review was read-only, done 23–24 November 2026 in the firm's signed-in Lawmatics account.

- Nothing was saved, sent, run, toggled, typed or submitted.
- One stage edit panel (Consult Scheduled) was opened and closed with Cancel.
- Two inactive automations opened in their editors by following their links. Only their When/Until panels were expanded.
- The OneDrive settings page was read and left with Back.
- A support chat window that opened on its own was minimized.
- No client record, inbox, file, invoice or e-sign request was opened. Client names, emails, phones, keys and secrets are left out; staff appear by first name.
- Counts reflect the moment of reading. Two forms were being edited by someone else during the review.
