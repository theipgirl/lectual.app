# Lectual audits: one picture (Nov 23, 2026)

This page brings together your published audit pages, the repository's own record of reviews, and what was said in the recorded meetings that could be read. Section 10 lists what could not be read. Nothing was built or changed to write it.
Sources are in brackets. "Page" means one of your published pages; "repository" means the product's own record; "meeting" means a recorded call; "SOPs" means the firm's written procedures.

## 1. The short answer

**Read this first.** Nearly every comment on record about Lectual being confusing comes from Taylor and Caitlyn, the two people building it and setting it up. Rayn, Dawn and Amor have barely used it, so nobody yet knows what confuses the people Lectual is for (meeting notes, Oct 16 to Nov 23).

In short: Lectual was built faster than the firm settled how it works. The team has barely used it. It also shows the same things in several places and under several names.

The seven causes, most important first:

1. **It covers only half of how the firm works.** The spreadsheet and Lawmatics are still in use, and some things are entered twice. 88 of the 257 steps in the SOPs still happen only in Lawmatics, Outlook or at the USPTO. The firm has 40 open decisions; a few have answers given in meetings that have not yet been written into the SOPs. *Evidence: the team in meetings, the SOP comparison page, the repository.*
2. **It is hardly used, and nobody has been trained.** Taylor is the only daily user. The reviews since Oct 19 looked at the code and at pictures of the screens filled with made-up data; none watched a person at the firm use the product. *Evidence: the meetings, the audit pages, the repository.*
3. **The same job is in several places.** Caitlyn and Taylor (both building it) found approvals spread across boards and every table and board drawn differently. The owner and the team see two different versions of the main screens, and different roles see different menus. *Evidence: the builders, the audit pages, the repository.*
4. **One thing has several names**, such as Leads and Intake, or Copilot, agent and assistant. *Evidence: the builders, one remark probably Rebecca's, the audit pages, the repository.*
5. **Much is built but nobody can see it.** 28 built things are waiting to be switched on, and about 47 have never been tried by a person in the real product. Caitlyn could not edit and Amor had no access, so people could not have seen them anyway. *Evidence: the repository, the audit pages, the team's access problems.*
6. **Numbers people do not trust.** Taylor told Rebecca that nobody understands the $26,000 "proposals out" figure. Items waiting on the client showed as the law clerk's to do. The message "isn't switched on" appears for several reasons, and the screen does not say which. *Evidence: the meetings, the Oct 19 audit, the repository.*
7. **The plan kept changing.** Six designs have been drawn since Sep 9, and they do not agree. The product's rule book keeps old rules beside the ones that replaced them. This mostly confuses the people building Lectual; the team has not seen the design pages. *Evidence: the builders and the pages only.*

**Done well:** the audits found the screen problems in detail, and most of them were changed in the code. **Not done by any audit:** watching the firm's people use Lectual for real work, from a new lead through to a filed mark.

## 2. The audits so far

| Name | Date | What it looked at | Findings | What became of them | Where it lives |
|---|---|---|---|---|---|
| Master Audit & Fix List | Oct 19 | The live RPB system, every main page, the database, the plans | 5 headlines, 13 broken, 12 design fixes | Many reworked later in sprints, but not tracked item by item; not known | Page |
| Fix & Integration List | Oct 19 | Integrations, data cleanup, the 38 Firm Brain entries | about 15, plus 7 contradictions for Rebecca | 14 bad deadlines retired; rest not known | Page |
| Oct 20 test notes | Oct 20 | Titles, navigation, calendar, counts, names | 10 | 9 changed, 1 labelled rather than fixed; whether checked on a real screen is not stated | Repository (the notes themselves are missing) |
| Agent run failure | Oct 22 | The overnight agent run being cut off | 3 | Fixed in code | Repository |
| Sprint 31 to 34 clean-ups | Oct | Plain words, menus, phone, settings, pages | Not stated | Built; 6 items marked not built | Repository |
| Editor audit | Nov 12 | The proposal editor (7 Save buttons) | 1 big one | Rebuilt as one Save; not checked on a real screen | Repository |
| Engagement letter reviews | Nov 12 | Signing, letter, PDF, database | 6 | Fixed in code; not checked on a real screen | Repository |
| Editor fixes | Nov 12 | 4 bugs the owner hit | 4 | Changed; scroll fix not checked on a Mac | Repository |
| Design early look | Nov 17 | Matters, Intake, Proposals | Not counted | Replaced by the next row | Page |
| Design before and after | Nov 17 | About 25 screens at desktop and phone width | 17 + 14 | 15 of 17 fixed, 14 of 14 fixed, about 5 still open; built but not yet released | Page |
| Owner view: design vs build | Nov 17 | 47 owner-view screens against the boards | About 33 with listed differences | Built; "not verified yet" in a browser | Page |
| Design Inconsistency Checklist | Nov 17 | Every screen, both versions | 43 (5 broken) | 5 decided, 4 need your pick, none marked done | Page |
| Visual review and checker rounds | Nov 17 | Every screen area, pictures of the screens | Not counted | Look-only fixes in code | Repository |
| SOPs compared with Lectual | Nov 17 | 257 SOP steps | 21 differences, 5 fix-now, 36 questions | Fix-now: 3 fixed, 1 partly (wording waits on the attorney), 1 open; the rest open | Page |
| Review rounds on Leads, merging, the lead page (Sprint 10) | Nov 17 | Leads page, merge, lead page | Not counted | Fixed in code; not checked on a real screen | Repository |
| Deadline safety review | Nov 20 to 23 | Closing matters, deadline alerts | Not counted | Extended to registered marks; database update not applied | Repository |
| Approvals routing review (Sprint 4) | Nov 20 | Passing drafts to a drafter | 10+ | Fixed in code; one blocker and one decision still open | Repository |
| Strict review of the Adobe signing plan | Nov 22 | A plan on paper | about 21 decisions | Nothing built; on hold | Repository |
| Client lifecycle review | Nov 23 | The client journey, in 30 steps | 31, plus 10 gaps | Applied to the document; the 40 decisions are open | Repository, docs/rpb |
| Lawmatics phase-out read | Nov 23 | 4 SOPs and the Lawmatics guide | about 5 | Open | Repository |

Six different designs have been drawn since Sep 9, from the Screen Spec to the Agentic IP OS concept. Section 7 lists where they disagree (pages, Sep 9 to Nov 17).

## 3. Every finding, merged

Labels used: MA = Master Audit (Oct 19); FIL = Fix & Integration List (Oct 19); CL = Design Inconsistency Checklist (Nov 17); BA = Design before and after (Nov 17); DvB = Owner view: design vs build (Nov 17); SOP = SOPs compared (Nov 17); LC = client lifecycle; repo = repository; mtg = meeting.

**Cause 1: half a process**
- The Monday meeting still runs on the spreadsheet. Lectual has no fees, no count of sessions booked and no full deadline list; a deadlines strip was added after Nov 17. Weekly review. SOP T14; mtg Nov 9; LC. **Open**
- Matter stage numbers differ from the SOPs, the stage is kept in two systems, and 33 stages had to be fixed by hand. Matters. SOP T1, B12. **Open**
- The order of paying and signing changed three times. The Nov 10 meeting chose sign then pay, which is what Lectual does, but the SOP has not been changed. Proposals. SOP B8; mtg Nov 9, Nov 10; LC. **Open**
- A signed proposal does not open a matter. Proposals, Matters. LC. **Open**
- Invoices and payment stay in Lawmatics; Mark paid is a stopgap; Dawn cannot see invoices. Proposals, Matters. SOP T7; repo. **Open**
- An approved email becomes a draft in the approver's own Outlook, with no copies. Approvals. SOP B4; mtg Oct 27. **Open**
- Nothing reads USPTO notices; deadlines are typed in by hand. Matters. SOP T3; LC; repo. **Open**
- Deadline safety nets were added: a flag when there is no open deadline, alerts at 7 and 30 days, and a block on closing a matter with a deadline open. Matters, Today. SOP T3; repo. **Changed, not checked on a real screen**
- Intake forms add Lawmatics tags that start client emails nobody approved. Forms. SOP B3. **Open**
- The assistant that moves leads between stages does it on its own; the agents SOP says it should only suggest. Leads. SOP B2. **Open**
- The same person shows up twice, from two sources or in two stages. Leads. mtg Nov 12; FIL; repo (merge). **Changed, not checked on a real screen**
- Proposals Rebecca missed were on the spreadsheet, not in Lectual. Proposals. mtg Nov 9. **Not known**
- A no-show can be logged on the lead's timeline, but there is no no-show stage and no follow-ups. Leads. mtg Oct 16; SOP T11. **Open**
- The Weekly review filed an unpaid office-action invoice as waiting on the USPTO. Weekly review. SOP C1; repo. **Fixed** (the repository says this was checked on the live system; no matter was in that stage, so it has not been seen working on a real one)

**Cause 2: hardly used**
- Rebecca could not find the assessment results and asked to be shown on screen. Forms. mtg Oct 21. **Not known**
- No training has happened. Everyone. mtg Oct 30, Nov 9. **Open**

**Cause 3: same job, several places**
- Rebecca approves through email, text, Zoom and Lectual. Approvals. mtg Oct 16, Nov 6. **Open**
- The owner's approval deck is built but behind a switch Lectual has not turned on. Approvals. DvB; repo. **Changed, not checked on a real screen**
- Every table and board looks different. All lists. mtg Nov 17; CL 2, 3; BA. **Open** (only Intake has the new look)
- View switches were drawn four ways. All lists. CL 1; repo. **Changed, not checked on a real screen**
- The owner view and the team view are drawn differently. Menus, Today. CL 9, 17, 26, 30; DvB. **Open**
- The Matters page showed intake clients. Matters. mtg Nov 17; DvB M1; repo. **Changed, not checked on a real screen**
- The Weekly review opened a side panel; Taylor wanted a card. Weekly review. mtg Nov 17; repo. **Changed, not checked on a real screen**
- The lead page did not say what the Weekly review said. Lead page. mtg Nov 17; repo. **Changed, not checked on a real screen**
- There are two proposals pages. The older one is hidden when the Proposals feature is on, and it has the same name. Proposals. MA; CL 22; repo. **Open**
- The proposal maker confuses everyone but Taylor: ten forms and seven Save buttons. Proposals. mtg Nov 10; repo; Proposal Flow Mockup. **Changed, not checked on a real screen**
- The Leads list showed about 280 import rows, with no paging and chips that did nothing. Leads. DvB; MA. **Changed, not checked on a real screen**
- Main menu headings opened reports instead of the work. Menu. MA; repo. **Changed, not checked on a real screen**
- Home, Today and Calendar answer the same question. Today. pages: Design Decisions; Screen Spec. **Not known**

**Cause 4: several names**
- Leads vs Intake. Menu, Leads. mtg Nov 12; CL 22; DvB M2; repo. **Open** (both still in use)
- Proposals and Quotes; Mail and My Mail; Approvals, Your deal and Needs you. Menu. CL 22. **Open**
- Column names: Owner or Whose court; Last touch or Last contact; Our turn or Us. Lists. CL 23 (needs your pick). **Open**
- Six or more phrases mean "someone must act". Several screens. repo. **Open**
- Copilot vs agent vs assistant. AI tools. mtg Nov 10; CL 22; repo. **Open**
- "Cards" means three different things. Approvals, Weekly review, Today. repo. **Open**
- Matters vs pre-filing and post-filing. Matters. mtg Nov 12; DvB M1. **Changed, not checked on a real screen**
- Dates are written eight ways, including "6 days ago". All. CL 20; mtg Nov 17; repo. **Changed, not checked on a real screen**
- A client showed under his company name instead of his own. Weekly review. mtg Nov 17; repo. **Changed, not checked on a real screen**
- The card buttons on Approvals had the wrong labels. Approvals. mtg Nov 12. **Fixed** (changed during the call)

**Cause 5: built, but nobody can see it** (details in section 4)
- Rebecca had no account and no approvers were set on Oct 19. She has signed in since (Nov 9); whether approvers are set is not known. Settings. MA; FIL; mtg Nov 9. **Not known** (approvers)
- Caitlyn could not edit; Rayn has a login but has not tried it. Access. mtg Nov 23. **Open**
- The mailbox is not connected; Microsoft needs Dawn's approval as administrator. Mail. mtg Nov 17; MA. **Open**

**Cause 6: numbers and statuses**
- Taylor said nobody understands the $26,000 "proposals out" figure; Rebecca wants trademarks counted instead, such as 7 of 10. Today, Reports. mtg Nov 10. **Open**
- Items waiting on the client showed as the law clerk's to do. Weekly review. mtg Nov 10. **Not known**
- Switches and agents said "on" with nothing connected and no runs. Settings, Assistants. MA; FIL. **Not known**
- Counts disagree between screens; some are labelled, others differ by design. Menu badge, Pipeline, Today. MA; repo. **Changed, not checked on a real screen**
- 16 "overdue" deadlines were left over from an import. Today. MA; FIL. **Fixed** (14 retired; 2 left for the attorney)
- "Isn't switched on" covers several different situations that look the same. Many. repo. **Open**

**Cause 7: the plan kept changing.** See the designs line in section 2, and section 7.

**Phone, size and look** (these support causes 2 and 3)
- Text smaller than 13px, and the typewriter font, on lists. All. CL 15, 16; BA. **Changed, not checked on a real screen**
- Phone screens: cut-off lines, chips running off the edge, tables that scroll sideways. Many. BA; DvB; CL 18. **Open** (the Settings tab row and the Weekly review List are still affected)
- Text boxes show no keyboard focus. All forms. CL 43. **Open**
- Some dates use the wrong time zone. Meetings, Matters, Mail. CL 21. **Open**
- Colours turn dark on a computer set to dark mode. Account menu, owner pages. CL 11. **Open**

Counts in this section (53 lines): Fixed 3, Changed, not checked on a real screen 15, Open 29, Not known 6.

**Left out:** about 30 smaller look items (chips, pills, buttons, corners, pop-ups, empty states) on the Design Inconsistency Checklist. The rest of the SOP differences (B1 to B21, D1 to D14) are on the SOPs compared page. Lower-priority polish is on the Master Audit.

## 4. Built, but nobody can use it yet

### Built, waiting to be switched on (28 items)

**A database update that is not applied** (repository, "Features waiting on a database update"):
1. Seeing colleagues' connected mailboxes (0108).
2. The database refusing to close a matter with an open deadline, and recording overrides (0110). The app's own check is built.
3. Passing an approved email to the drafter, and "Make the draft in my Outlook" (0112). This also needs a change to another Lectual service that has not been released.
4. The firm's own columns on the Weekly review List (0115).
5. A database guard on team members (0116). The app's own check is built.

**A database update whose status is not recorded** (same):
6. Outlook calendar reading (0098).
7. The setting for the assistant that moves leads (0098).
8. The morning brief (0098).
9. Consult prep (0098).
10. The inbox summary (0098).
11. Saved Copilot chats (0099).
12. Changing the pay link on a live proposal (0100).
13. Resetting a client's acceptance (0101).
14. Merging duplicate leads (0107). This is built; whether its update is on the live database is to be checked.

**A switch or setting that is off** (repository, "Built but switched off or hidden"):
15. The owner view, with the approval deck and owner Today. Lectual has not turned it on.
16. The other assistants, which are off until a setting is saved.
17. Sending from Outlook.
18. Proposal tags on the Weekly review.
19. Lawmatics letter fields.
20. The worksheet's Lawmatics sync.
21. Copilot, which is hidden without the AI key.

**Waiting on the firm:**
22. Signing the engagement letter. Its database update is on the live database; the notes give two dates, Nov 12 and Nov 17. Signing stays off until Rebecca approves a version of the letter (repository).
23. The welcome email, until its text is pasted in (repository, "not built").
24. The meeting assistant, until the Monday call's title is given (same).
25. Deadline alerts, until someone chooses who receives them (repository).
26. "Drafts go to", until a drafter is named (repository).
27. Rebecca's footer line (repository, "LOE pipeline reviews").

**Waiting on someone outside:**
28. The Outlook mailbox connection, which needs Dawn's Microsoft approval (meeting, Nov 17).

**Separately**, about 47 built items have never been tried by a person in the real product or against the live service (repository, "Marked never verified"):
- 11 on proposals, 6 on the letter, 6 on Lawmatics (never tried on a live account), 5 on the shell, 5 on the Weekly review, 4 on Leads, 4 on Approvals, and 6 elsewhere.
- Some of these are also among the 28 above.

### Not built yet

The repository lists 38 things not built: 31 by choice or still pending, and 7 held up by questions nobody has answered yet (repository, "Everything the repository marks not built"). The ones that matter most here:
- Adobe signing (0113, on hold).
- The USPTO watcher (0111).
- Stage "waiting on" (0109).
- Time targets per stage, and a billing view for anyone but the owner (0114, planned only).
- The day 1 to 7 follow-up emails.
- A first-reply email.
- A no-show stage.
- LawPay taking payment on the proposal.
- Emailing the signed letter to the client.
- Client portals and SMS.

## 5. Names

| Old name | Current name | Where the old name still shows to a person |
|---|---|---|
| Queue | Approvals | The owner deck is also "Your deal" and "Needs you" (page: Design Inconsistency Checklist, Nov 17) |
| Leads / PNC | Intake (section), Leads (list) | Both in use; "PNC" kept for the spreadsheet (repository; meeting, Nov 12) |
| Agents | Assistants | "Agents settings" and "Agent toolkit" (page: Design Inconsistency Checklist) |
| Quotes / Quotes & proposals / Client proposals | Proposals | The older quotes page is also labelled Proposals (repository) |
| Mail / My Mail | Mail | Both (page: Design Inconsistency Checklist) |
| Owner / Assigned to / Whose court | Not decided | Lists (same page, item 23) |
| Last touch / Last contact / Last heard from | Not decided | Lists and the lead page (same) |

Other renames (Shortcuts, Firm notes, AI tools, Features, Temperature) survive only in web addresses and code (repository, "Same thing, two names").

## 6. The same job in more than one place

- **See what needs me today:** team Today; owner Today (behind the switch); "Mine" on Approvals; the "Waiting on you" strip on the Weekly review; the top card on each lead page; the bell; the morning brief. Owner Today is for the owner once the owner view is on. For everyone else, no source says which to use (repository).
- **See all leads:** the Leads page (trademark leads only); Pipeline (view only, every practice area); the Weekly review (leads past first contact); Reconcile; the Intake report. No source says which one each person should use (repository; SOPs compared, Nov 17, B15).
- **See all matters:** Matters; Pipeline; the Weekly review; the Active matters report. Which to use is not decided. On Nov 17 Matters was narrowed to matters past the signed letter (repository).
- **Run the Monday meeting:** the spreadsheet (today); the Weekly review Board (the default); the owner's editable List; the plain List; the Cards deck. The plan is the Weekly review from the week of Nov 23 (meeting, Nov 12). Rebecca appears to chair it. The SOPs put the meeting on a Wednesday; the recorded meetings are on Mondays (client lifecycle).
- **Approve what goes to a client:** the team Approvals list; the owner deck (behind the switch); a single approval page; Yes on the lead page; email, text and Zoom (meeting, Nov 6). The owner is meant to use the deck; for the others this is not decided (repository).
- **Make a proposal:** the three ways in on New proposal (from a consult, Ask Copilot, from scratch); the card on a lead; the card on a matter; the meeting's "Create proposal"; the Copilot drawer; the older Quotes page. Only Taylor makes proposals (meeting, Nov 17).
- **Get set up:** the first sign-in tour; Getting started; Setup under Settings; the Today card. No source says which one each person should use (repository).

## 7. Where the audits disagree with each other

| Subject | One says | Another says |
|---|---|---|
| The Matters list, Nov 17 | Grouped by Intake, Pre-filing and Post-filing (page: Owner view: design vs build) | The group chips are gone (page: Design early look); grouped by Our turn and Waiting on the client (page: Design before and after). The Intake group was later removed (repository) |
| Leads or Intake | Leads becomes Intake (page: Design Decisions, Sep 11; Design vs build M2) | Having both is a problem (page: Design Inconsistency Checklist, item 22) |
| Home and Calendar | Merge Calendar into Home (page: Screen Spec, Sep 9) | Keep Home, Today and Calendar separate (page: Design Decisions, Sep 11) |
| Intake's new look | Already live (page: Design Inconsistency Checklist, item 2) | On its own line of work, not released (page: Design vs build, L2) |
| Look fixes | 15 of 17 fixed (page: Design before and after) | 43 items still listed, and "not recounted" (same page; Checklist) |
| Merging duplicate leads | The database part is live (SOPs compared, "Already in progress") | Only on the test database (same page, T12); not checked on a real database (repository). So it is built; whether it is switched on is to be checked |
| Engagement letter on the live database | Applied Nov 12 (repository, to-do list) | Verified on the live database Nov 17 (repository). It is on the live database; only the date differs |
| How long a proposal stays open | SOP: 14 days, though its own note says 7 or 5 are used in practice. Firm notes: 14 days, but the consult credit expires after 1 week (page: Fix & Integration List) | Lectual: 10 days when drafted from a call, no default when made by hand (SOPs compared, B6). Meeting, Nov 10: 7 days plus two weeks' grace. **Not settled** (client lifecycle, decision 15) |
| Patents | Out of scope (page: Positioning, Jul 24) | Listed as a practice area (pages: Lectual Gate, Docket, Agentic IP OS concept, Nov 17) |

## 8. What no audit has looked at

- **The people using it.** Taylor is the only daily user. Rebecca opened Lectual on Nov 9 to check proposals. Caitlyn tests it but could not edit on Nov 23. Rayn has a login and has not tried it (Nov 23). Dawn does not use it. Amor had no access on Nov 9 and had an admin view by Nov 12. No audit watched any of them do a task (meeting, Oct 16 to Nov 23).
- **Training.** None is on record. The first session was still being arranged on Nov 9 (meeting, Nov 9).
- **The live system.** Only the two Oct 19 audits looked across the live RPB system. Since then it was touched only in passing: the Oct 20 test pass, the Oct 22 overnight failure, the owner's Nov 12 editor bugs, and one SOP check on Nov 17. The design reviews used pictures of the screens with made-up data (pages; repository).
- **One client from start to finish.** No audit followed one lead through consult, proposal, signing, payment, matter and filing. The client lifecycle covers the process, not the screens (client lifecycle).
- **A real phone, dark mode, keyboard use and screen readers.** These were checked only in pictures, or flagged but never tested (page: Owner view: design vs build; Checklist items 11 and 43).
- **Live Lawmatics.** Six Lawmatics connections were never tried on a live account (repository).
- **Mail and Copilot** have not been reviewed since the Master Audit on Oct 19. **Campaigns, Firm notes, Shortcuts and Getting started** have never been reviewed (page: Design before and after, "Not shown here").

## 9. What to do next

1. **Give everyone working access and connect the mailbox.** That means Caitlyn's editing and Dawn's Microsoft approval; Rayn and Amor already have logins.
   *Work to schedule.* Answers causes 2 and 5.
2. **Run one real Monday meeting from the Weekly review with the people it is meant for, and follow one client from lead to filing, watched, with notes taken** of every place someone reaches for the spreadsheet, Lawmatics or a text.
   *Decision for the managing attorney; work to schedule.* Answers causes 2 and 1.
3. **Decide only the process questions that the trial shows are in the way**, for example the true stage, the mailbox, or the meeting day.
   *Decision for the owner, the managing attorney and Caitlyn.* Answers cause 1.
4. **Switch on or drop each of the 28 built items in section 4.** Building anything not yet built is out of scope for this step.
   *Decision for the owner, then work to schedule.* Answers cause 5.
5. **Choose one place per job, per person, for each job in section 6, and write it down.**
   *Decision for the owner.* Answers cause 3.
6. **Pick names once.** Answer the four "needs your pick" items on the checklist and choose between Leads and Intake.
   *Decision for the owner.* Answers causes 4 and 6.
7. **Keep one current picture.** Mark the old designs as retired, and remove replaced rules from the rule book.
   *Work to schedule.* Answers cause 7.
8. **Pause screen-by-screen audits until steps 1 to 4 are done.** More of them would not help yet.
   *Decision for the owner.* Answers causes 2 and 7.

**Why this order.** Nearly all the confusion on record is the builders'. Only a real trial with the team can show which confusion is the team's and which is the builders'. Access comes first because the trial needs it. Decisions, switching things on and naming follow from what the trial shows.

## 10. Sources and limits

- **Read:** your published pages (26 read: 23 about Lectual, 3 set aside); the repository's record of 28 review rounds, its lists of what is not built, never checked and waiting on the database, and its renames; notes and parts of the transcripts of meetings from Oct 2 to Nov 23; the SOPs compared page (Nov 17); four sections of the client lifecycle.
- **Not available:** the raw Oct 20 test notes; every evaluator verdict file; any training session; the Sep 17 demo and the Nov 2 meeting (not read); most of Rebecca's side of the Oct 27 and Nov 10 calls; the unrecorded Nov 10 board review; some SOP sections.
- **What this means:** the picture of what was built and found is solid, because it comes from the record itself. The picture of what the team finds confusing is thin, because it comes mostly from the two people building Lectual. Items marked "changed" have never been seen working on a real screen.
