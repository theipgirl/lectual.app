# Session recap, 2026-11-24: the Lawmatics inventory, the roundup visual

## What was asked

Taylor ran the Lawmatics inventory with Claude in Chrome and brought back the result. She asked for the one-page visual of the
audit roundup, gave three answers to open questions, and asked for the inventory to be added.

Nothing was changed in Lawmatics, Lectual or any other system from this session.

## Taylor's answers (Nov 24)

- Merging duplicate leads is live in Lectual.
- The Leads page is now called Intake and has its new look.
- Proposals stay open 7 days in Lectual, and that can be set longer on a proposal. (The SOP still says otherwise.)

## What was produced

- `docs/rpb/lawmatics-inventory-2026-11-24.md`: the inventory as Taylor brought it back (look-only, Nov 23 and 24).
- `docs/rpb/client-lifecycle.md` (revision 4, 1,210 lines): the inventory folded into the Lawmatics sections, the steps, the
  disagreements and the decisions. Reviewed against the inventory (28 faults found across two documents, all applied).
- `docs/audits/2026-11-23-lectual-audit-roundup.md` (290 lines): Taylor's answers and the inventory added; same review.
- Visual, new: Lectual Audit Roundup, https://claude.ai/artifact/G4bob4Ro1nmn578fCBB33M (private until shared).
- Visual, updated: RPB Client Lifecycle, https://claude.ai/artifact/9CEapkxwyePAdAPDZ2WhS1 (private until shared). It has a third
  tab, "What is live in Lawmatics", and both earlier tabs are brought into line with revision 4.

## What the inventory found

- 19 of 71 automations are switched on. 150 tags, about 37 in use. 72 stages across 5 pipelines, two of them intake pipelines.
  38 forms, 249 email templates, 738 matters, 810 contacts.
- Plan: "Team" at $279 a month, 6 of 10 seats used, all Admin. With Time & Billing for two users and text messages, $376 a month.
- Signing: 164 signature requests, 95 completed, 38 expired unsigned.
- Nothing sends at 48 and 96 hours after a proposal. Long-term nurture is switched off. The welcome email has been sent 53 times by
  hand. Hired is set by hand. Matching by email is on for contacts and form fills.
- Tags: "UGW 2026" starts a client welcome email; "Story2Profit 2026" starts an internal email; the master class registration tag
  starts two texts; "Hot Lead", "Warm Lead" and "Cold Lead" start nothing; no "UTM:" or "Campaign:" tags exist.

## Act on these first (in Lawmatics; not done from this session)

1. Switch off the two November 17 master class text automations: they text anyone who registers now.
2. The Trademark Form reminders are set to keep going after the form is filled. Whether any have gone out is to check.
3. A test engagement-letter automation is switched on, and test records are in the live data.
4. The old intake form (78941), now the Black Friday checkout, still starts two active automations on every fill.
5. Confirm the "UGW 2026" welcome email should keep sending.
6. Developer app secrets are readable by every user and all six users are Admins. Remove unused apps and renew live ones, with Taylor,
   because three of them connect Lectual and Claude to Lawmatics.
7. 38 engagement letters expired unsigned.

Broken, but reaching nobody: the two no-show automations.

## What the firm could be doing in Lawmatics, after the inventory

40 items: 5 quick wins, 4 stopgaps, 31 to skip. The five: make the Trademark Form reminders stop when the form is filled; have the
Trademark Form ask for what Rayn needs; send the existing "Specimen" file request; add a file upload to the statement of use form;
send the Trademark Form pre-filled from the welcome email.

## The audit roundup, as it stands

55 findings: 4 fixed, 15 changed but never checked on a real screen, 30 open, 6 not known. 27 built things wait to be switched on.
46 firm decisions are open. Still not reconciled: what the Matters list looked like on Nov 17.

## To check, raised by the inventory

- No "UTM:" or "Campaign:" tags exist in Lawmatics. Lectual pushes them only for an intake that arrives with those details.
- Hired is set by hand, and Lectual's matter sync reads a built-in conversion date. Whether that date is filled is to check.
- Matching by email is on, yet duplicate matters were reported on Oct 16.
- The reminder templates all show 0 sends.

## Not done

- No one has checked either visual on a real screen; both were checked in a headless browser.
- The Obsidian vault can't be reached from this cloud session.
- Omi was not re-checked for this part.
