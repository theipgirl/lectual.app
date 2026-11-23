# Lectual audits: one picture (Nov 23, 2026)

This brings together every audit, review and recorded conversation about Lectual into one page. Nothing was built or changed to write it.
Sources are in brackets. "Page" means one of your published pages; "repository" means the product's own record; "meeting" means a recorded call.

## 1. The short answer

Lectual is still confusing for these seven reasons. The most important comes first.

1. **Lectual covers only half of how the firm works, and the firm has not settled the other half.** People still use the spreadsheet and Lawmatics too and enter things twice (meeting, Nov 9; Nov 12). 88 of 257 written steps happen only outside Lectual (SOPs compared, Nov 17). The firm has 40 open decisions and has taken none of them (client lifecycle).
2. **The same job is done in several places, and some screens come in two versions.** Caitlyn had to switch boards to find approvals (meeting, Oct 16), and Taylor said every table and board looks different (meeting, Nov 17). The checklist page counts 43 inconsistencies (page: Design Inconsistency Checklist, Nov 17). There is an owner view and a team view, and there are four ways to get set up (repository, "Screens in two versions").
3. **One thing has several names.** People were unsure about Leads vs Intake and Copilot vs agent (meeting, Nov 12; Nov 10). Section, column and button names differ from screen to screen (page: Design Inconsistency Checklist, Nov 17). The repository lists more than a dozen renames, and the old words still show in places (repository, "Same thing, two names").
4. **Much of the work is "done" but you cannot see it.** Fourteen database updates are not applied or their status is not recorded, and about 47 items were never checked on a real screen or against a live service (repository, "Features waiting on a database update"; "Marked never verified"). Caitlyn could not edit, and Amor had no access (meeting, Nov 23; Nov 9).
5. **Numbers and statuses that people do not trust.** Rebecca said nobody understands the $26,000 figure, and Rayn's items showed in the wrong court (meeting, Nov 10). Counters disagreed, and switches said "on" with nothing connected (page: Lectual Platform — Master Audit & Fix List, Oct 19). "Isn't switched on" can mean several different things (repository, "Places that say not switched on").
6. **The people it is for have hardly used it, and nobody has been trained.** Taylor is the only daily user, and no training session is on record (meeting notes, Nov 3 to Nov 23). The audits since Oct 19 were run on drawn copies of the screens, not by people using the product (page: Design before and after, Nov 17; repository, "Marked never verified").
7. **The plan for what Lectual should look like kept changing.** At least five design directions exist and do not agree (page: Lectual Dashboard Directions, Sep 11; page: Lectual — Agentic IP OS concept, Nov 17). The repository keeps old rules next to the rules that replaced them (repository, "Sections that supersede"). Taylor said she was a little confused about the Matters page herself (meeting, Nov 17).

**What the audits have done well:** they found the screen-level problems in detail, and most of those were changed in the code. **What none of them has done:** watch the people at the firm use Lectual for real work on the live system, from a new lead through to a filed mark.

## 2. The audits so far

| Name | Date | What it looked at | Findings | What became of them | Where it lives |
|---|---|---|---|---|---|
| Master Audit & Fix List | Oct 19 | The live RPB system, every main page, the database, the plans | 5 headlines, 13 broken, about 20 design fixes | Many were later reworked in sprints; not tracked item by item. Not known | Page |
| Fix & Integration List | Oct 19 | Integrations, data cleanup, the 38 Firm Brain entries | about 15, plus 7 contradictions for Rebecca | 14 bad deadlines retired; the rest not known | Page |
| Oct 20 test notes | Oct 20 | Titles, navigation, calendar, counts, names | 10 | 9 changed; 1 labelled rather than fixed. Not checked on a real screen | Repository (the notes themselves are missing) |
| Agent run failure | Oct 22 | The overnight agent run cut off | 3 | Fixed in code | Repository |
| Sprint 31 to 34 clean-ups | Oct | Plain words, menus, phone, settings, pages | Not stated | Built; 6 items marked not built | Repository |
| Editor audit | Nov 12 | The proposal editor (7 Save buttons) | 1 big one | Rebuilt as one Save; not checked on a real screen | Repository |
| Engagement letter reviews | Nov 12 | Signing, letter, PDF, database | 6 | Fixed in code; not checked on a real screen | Repository |
| Editor fixes | Nov 12 | 4 bugs the owner hit | 4 | Changed; scroll fix not checked on a Mac | Repository |
| Design early look | Nov 17 | Matters, Intake, Proposals | about 20 notes | Replaced by the next row | Page |
| Design before and after | Nov 17 | About 25 screens at desktop and phone width | 17 + 14 | 15 of 17 fixed, 14 of 14 fixed, about 5 still open. **On a branch, not merged** | Page |
| Owner view: design vs build | Nov 17 | 47 owner-view screens against the boards | About 33 with listed differences | Built; "not verified yet" in a browser | Page |
| Design Inconsistency Checklist | Nov 17 | Every screen, both shells | 43 (5 broken) | 5 decided, 4 need your pick, none marked done | Page |
| Visual review and checker rounds | Nov 17 | Every screen area, drawn copies | Not counted | Look-only fixes in code | Repository |
| SOPs compared with Lectual | Nov 17 | 257 SOP steps | 21 differences, 5 fix-now, 36 questions | 4 fix-now items fixed (one checked on the live system); the rest are open | Page |
| Review rounds on Leads, merging and the lead page | Nov 17 | Leads page, merge, lead page | Not counted | Fixed in code; not checked on a real screen | Repository |
| Approvals routing review (Sprint 4) | Nov 20 | Passing drafts to a drafter | 10+ | Fixed in code; one blocker still open | Repository |
| Strict review of the Adobe signing plan | Nov 22 | A plan on paper | about 21 decisions | Nothing built; on hold | Repository |
| Client lifecycle review | Nov 23 | The 30-phase client journey | 31, plus 10 gaps | Applied to the document; the 40 decisions are all open | Repository, docs/rpb |
| Lawmatics phase-out read | Nov 23 | 4 SOPs and the Lawmatics guide | about 5 | Open | Repository |

The product has been measured against several different designs:
- Screen Spec, Sep 9: cut the menu from 22 entries to 11 and merge Calendar into Home (page: Lectual Screen Spec, Sep 9).
- Design Decisions, Sep 11: new names (Intake, IP.OS) and keep Home, Today and Calendar separate (page: RPB Law OS Design Decisions, Sep 11).
- Dashboard Directions, Sep 11: four designs for Today, with "Whose Court" recommended (page: Lectual Dashboard Directions, Sep 11).
- Owner view mock-ups, Nov 10: 48 boards and eight role views. Only the owner view is built (page: Lectual owner view — mockups for review, Nov 10).
- Mock-ups for the lead page, editable cards and the proposal flow, Nov 12 to Nov 17 (pages: Lead page mockup; Editable cards mockup; Proposal Flow Mockup).
- Agentic IP OS concept, Nov 17: a different layout and colour scheme, with no menu of list pages (page: Lectual — Agentic IP OS concept, Nov 17).

## 3. Every finding, merged

Labels used: MA = Master Audit (Oct 19); FIL = Fix & Integration List (Oct 19); CL = Design Inconsistency Checklist (Nov 17); BA = Design before and after (Nov 17); DvB = Owner view: design vs build (Nov 17); SOP = SOPs compared (Nov 17); LC = client lifecycle; repo = repository; mtg = meeting.

**Cause 1: half a process**
- The Monday meeting still runs on the spreadsheet; Lectual has no fees, no count of sessions booked and no full deadline list. Weekly review. SOP T14; mtg Nov 9; LC. **Open**
- Matter stage numbers differ from the SOP; stages are kept in two systems; 33 had to be fixed by hand. Matters. SOP T1, B12. **Open**
- The order of paying and signing changed three times; Lectual has the client sign before paying. Proposals. SOP B8; mtg Nov 9, Nov 10; LC. **Open**
- A signed proposal does not open a matter. Proposals, Matters. LC. **Open**
- Invoices and payment stay in Lawmatics; Mark paid is a stopgap; Dawn cannot see invoices. Proposals, Matters. SOP T7; repo. **Open**
- An approved email becomes a draft in the approver's own Outlook, with no copies. Approvals. SOP B4; mtg Oct 27. **Open**
- Nothing reads USPTO notices; deadlines are typed in by hand. Matters. SOP T3; LC; repo. **Open**
- Deadline safety nets: a flag for no open deadline, 7- and 30-day alerts, and a block on closing a matter with a deadline open. Matters, Today. SOP T3; repo. **Changed, not checked on a real screen**
- Intake forms add Lawmatics tags that start client emails nobody approved. Forms. SOP B3. **Open**
- The Stage Keeper moves leads on its own, but the agents SOP says it should only suggest. Leads. SOP B2. **Open**
- The same person shows up twice, from two sources or in two stages. Leads. mtg Nov 12; FIL; repo (merge). **Changed, not checked on a real screen**
- Proposals Rebecca missed were on the spreadsheet, not in Lectual. Proposals. mtg Nov 9. **Not known**
- No-shows have no stage and no follow-ups. Leads. mtg Oct 16; SOP T11. **Open**
- The Weekly review filed an unpaid office-action invoice as waiting on the USPTO. Weekly review. SOP C1; repo. **Fixed** (checked on the live system)

**Cause 2: same job, several places**
- Rebecca approves through email, text, Zoom and Lectual. Approvals. mtg Oct 16, Nov 6. **Open**
- The approval deck for the owner is built but sits behind a switch that is off. Approvals. DvB; repo. **Changed, not checked on a real screen**
- Every table and board looks different. All lists. mtg Nov 17; CL 2, 3; BA. **Open** (only Intake has moved to the new look)
- View switches were drawn four ways. All lists. CL 1; repo. **Changed, not checked on a real screen**
- The owner view and the team view are drawn differently. Shell. CL 9, 17, 26, 30; DvB. **Open**
- The Matters page showed intake clients. Matters. mtg Nov 17; DvB M1; repo. **Changed, not checked on a real screen**
- The Weekly review opened a side panel; Taylor wanted a card. Weekly review. mtg Nov 17; repo. **Changed, not checked on a real screen**
- The lead page did not say what the Weekly review said. Lead page. mtg Nov 17; repo. **Changed, not checked on a real screen**
- There were two quotes and proposals pages. Proposals. MA; CL 22; repo. **Changed, not checked on a real screen**
- The proposal maker is confusing for anyone but Taylor: ten forms and seven Save buttons. Proposals. mtg Nov 10; repo; Proposal Flow Mockup. **Changed, not checked on a real screen**
- The Leads list showed about 280 import rows, no paging and dead chips. Leads. DvB; MA. **Changed, not checked on a real screen**
- Main menu headings opened reports instead of the work. Menu. MA. **Not known**
- Home, Today and Calendar answer the same question. Today. page: Design Decisions; Screen Spec. **Not known**

**Cause 3: several names**
- Leads vs Intake. Menu, Leads. mtg Nov 12; CL 22; DvB M2; repo. **Open** (both still in use)
- Proposals/Quotes, Mail/My Mail, Approvals/Your deal/Needs you. Menu. CL 22. **Open**
- Column names: Owner/Whose court, Last touch/Last contact, Our turn/Us. Lists. CL 23 (needs your pick). **Open**
- Six or more phrases mean "someone must act". Several screens. repo. **Open**
- Copilot vs agent vs assistant. AI tools. mtg Nov 10; CL 22; repo. **Open**
- "Cards" means three different things. Approvals, Weekly review, Today. repo. **Open**
- Matters vs pre-filing and post-filing. Matters. mtg Nov 12; DvB M1. **Changed, not checked on a real screen**
- Dates are written eight ways, including "6 days ago". All. CL 20; mtg Nov 17; repo. **Changed, not checked on a real screen**
- A client showed under the company name instead of his own. Weekly review. mtg Nov 17; repo. **Changed, not checked on a real screen**
- Card buttons on Approvals had the wrong labels. Approvals. mtg Nov 12. **Fixed** (changed during the call)

**Cause 4: numbers and statuses**
- Rebecca said nobody understands the $26,000 "proposals out" figure; she wants trademarks counted, such as 7 of 10. Today, Reports. mtg Nov 10. **Open**
- Items waiting on the client showed as Rayn's to do. Weekly review. mtg Nov 10. **Not known**
- Switches and agents said "on" with nothing connected and no runs. Settings, Assistants. MA; FIL. **Not known**
- Counts disagree between screens; some are labelled, others differ by design. Menu badge, Pipeline, Today. MA; repo. **Changed, not checked on a real screen**
- 16 "overdue" deadlines were left over from an import. Today. MA; FIL. **Fixed** (14 retired; 2 left for the attorney)
- "Isn't switched on" covers several different situations that look the same. Many. repo. **Open**

**Cause 5: built, cannot see it** (details in section 4)
- Rebecca had no account and no approvers were set. Settings. MA; FIL. **Not known**
- Caitlyn could not edit; Amor had no access; Rayn has not tried. Access. mtg Nov 9, Nov 23. **Open**
- The mailbox is not connected; Microsoft needs Dawn's approval as administrator. Mail. mtg Nov 17; MA. **Open**

**Cause 6: hardly used**
- Rebecca could not find the assessment results and asked to be shown on screen. Forms. mtg Oct 21. **Not known**
- No training has happened. Everyone. mtg Nov 9, Oct 30. **Open**

**Phone, size and look** (these support causes 2 and 6)
- Text smaller than 13px, and the typewriter font, on lists. All. CL 15, 16; BA. **Changed, not checked on a real screen**
- Phone screens: cut lines, chips off the edge, tables that scroll sideways. Many. BA; DvB; CL 18. **Open** (the Settings tab row and the Weekly review List still affected)
- Text boxes show no keyboard focus. All forms. CL 43. **Open**
- Some dates use the wrong time zone. Meetings, Matters, Mail. CL 21. **Open**
- Colours turn dark on a computer set to dark mode. Account menu, owner pages. CL 11. **Open**

Counts in this section (53 lines): Fixed 3, Changed, not checked on a real screen 15, Open 28, Not known 7.
**Left out:** about 30 smaller look items (chips, pills, buttons, corners, pop-ups, empty states) are on the Design Inconsistency Checklist. The remaining SOP differences are on the SOPs compared page (B1 to B21, D1 to D14). The lower-priority polish items are on the Master Audit.

## 4. Built, but nobody can use it yet

**Waiting on a database update** (repository, "Features waiting on a database update")
- 0108: you can see colleagues' connected mailboxes. Until then the screen says "Only <name> can see this".
- 0110: the database refuses to close a matter that has an open deadline, and records attorney overrides. The app's own check already works.
- 0112: "Pass to the drafter" and "Make the draft in my Outlook". This also needs a change to the queue service that is not yet deployed (the ship blocker).
- 0115: the firm's own columns on the Weekly review List, with money columns for the owner only.
- 0116: a database guard on members. The app's check is already in place.
- 0113 (Adobe signing): proposed but not built, and on hold. 0109, 0111 (the USPTO watcher) and 0114 (time targets and billing view) are planned and have no file yet.
- Status not recorded: 0098 (Outlook calendar, the Stage Keeper setting, morning brief, consult prep, inbox summary), 0099 (saved Copilot chats), 0100 (change the pay link), 0101 (reset an acceptance), 0107 (merge duplicate leads).
- The sources disagree on whether 0106 (the engagement letter) reached the live database on Nov 12 or later (repository, "Features waiting on a database update").

**Behind a switch or setting** (repository, "Built but switched off or hidden")
- The owner view, including the approval deck and owner Today: a rollout switch that is off by default.
- Assistants and the Stage Keeper: off until a setting is saved.
- Sending from Outlook: off.
- Proposal tags on the Weekly review: turned off in code.
- Lawmatics letter fields and the worksheet's Lawmatics sync: both off.
- Copilot: hidden without the AI key.
- Features such as Mailboxes, Proposals, Agents, Shortcuts and Document Center are each switched on per firm.

**Waiting on the firm**
- The engagement letter stays off until Rebecca approves a version (repository, "Features waiting on a database update").
- The welcome email is blocked until its text is pasted in (repository, "not built").
- Follow-up emails, the first reply and the meeting assistant are each waiting on an answer (repository, "not built").
- Deadline alerts need someone to choose who receives them, and "Drafts go to" needs a drafter named (repository).
- Rebecca's footer line is still pending (repository, "LOE pipeline reviews").

**Waiting on someone outside**
- Dawn's Microsoft approval for the mailbox (meeting, Nov 17).
- An Adobe account at the API level (repository, "Strict-evaluator ratification").
- The change to the queue service (repository, "Sprint 4 director review").

**Built and on, but never checked** (repository, "Marked never verified")
- About 47 items: 11 on proposals, 6 on the letter, 6 on Lawmatics, 5 on the shell, 5 on the Weekly review, 4 on Leads, 4 on Approvals.
- Six Lawmatics connections were written from the published instructions and never tried on a live account.

That is 25 items in all. Each one is work that is "done" and that nobody at the firm can see yet.

## 5. Names

| Old name | Current name | Where the old name still shows |
|---|---|---|
| Queue | Approvals | Web addresses; the owner deck is also "Your deal" and "Needs you" (repository; page: Design Inconsistency Checklist, Nov 17) |
| Leads / PNC | Intake (section), Leads (list) | Both in use; "PNC" kept for the spreadsheet; lead pages live at /leads/ (repository; meeting, Nov 12) |
| Agents / Autopilot | Assistants | Web address; "Agents settings" and "Agent toolkit" (repository; page: Design Inconsistency Checklist) |
| Skills | Shortcuts | Web address (repository) |
| Firm brain | Firm notes | Web address (repository) |
| IP.OS | AI tools | Report name; the design files (repository) |
| Modules | Features | Settings address (repository) |
| Lane | Temperature | Code only (repository; page: Master Audit, Oct 19) |
| Quotes / Quotes & proposals / Client proposals | Proposals | The older quotes page is also labelled Proposals (repository) |
| Mail / My Mail | Mail | Both (page: Design Inconsistency Checklist) |
| Table | List | Older notes say Table / Board (repository) |
| Matters / Active matters / All matters | Matters | Menu group and report (repository) |
| Approve (proposal) | Saved; sent = Link live | Database words (repository) |
| Owner / Assigned to / Whose court | Not decided | Lists (page: Design Inconsistency Checklist, item 23) |
| Last touch / Last contact / Last heard from | Not decided | Lists and the lead page (same) |

## 6. The same job in more than one place

**See what needs me today**
- Team Today (Needs you, consults, deadlines).
- Owner Today (behind the switch).
- Approvals "Mine".
- The "Waiting on you" strip on the Weekly review.
- The top card on each lead page.
- The notification bell.
- The morning brief.

Who should use which: the owner uses owner Today once the switch is on; for everyone else this is not decided (repository, "Overlapping views").

**See all leads**
- The Leads page (sets; trademark leads only).
- Pipeline (view only, any practice area).
- The Weekly review (only leads past first contact).
- Reconcile.
- The Intake report.

Not decided (repository; SOPs compared, Nov 17, B15).

**See all matters**
- Matters (only matters past the signed engagement letter; intake matters behind a link).
- Pipeline.
- The Weekly review.
- The Active matters report.

Not decided (repository, "Monday meeting changes").

**Run the Monday meeting**
- The spreadsheet (used today).
- The Weekly review Board, the default.
- The owner's editable sheet (List).
- The plain List for everyone else.
- The Cards deck.

The plan is the Weekly review from the week of Nov 23 (meeting, Nov 12). Rebecca chairs (client lifecycle).

**Approve what goes to a client**
- The team Approvals list.
- The owner deck (behind the switch).
- One approval page.
- Yes on the lead page.
- Email, text and Zoom outside Lectual (meeting, Nov 6).

The owner is meant to use the deck; the others are not decided (repository).

**Make a proposal**
- Three ways in on New proposal: from a consult, ask Copilot, start from scratch.
- The card on a lead.
- The card on a matter.
- The meeting's "Create proposal".
- The Copilot drawer.
- The older Quotes page.

Taylor is the only person who makes proposals (meeting, Nov 17).

**Get set up**
- The first sign-in tour.
- The Getting started page.
- Setup under Settings.
- The Today card.

Not decided (repository, "Overlapping views").

## 7. Where the audits disagree with each other

| Subject | One says | Another says |
|---|---|---|
| The Matters list, Nov 17 | Grouped by Intake, Pre-filing and Post-filing (page: Owner view: design vs build) | Stage-group chips gone (page: Design early look); grouped by Our turn and Waiting on the client (page: Design before and after). The Intake group was later removed (repository, "Monday meeting changes") |
| Leads or Intake | Leads becomes Intake (page: Design Decisions, Sep 11; Design vs build M2) | Having both is a problem (page: Design Inconsistency Checklist, item 22) |
| Home and Calendar | Merge Calendar into Home (page: Screen Spec, Sep 9) | Keep Home, Today and Calendar separate (page: Design Decisions, Sep 11) |
| Intake's new look | Already live (page: Design Inconsistency Checklist, item 2) | On its own branch, not merged (page: Design vs build, L2) |
| Look fixes | 15 of 17 fixed (page: Design before and after) | 43 items still listed; "not recounted" (same page; Checklist) |
| Merging duplicate leads | The database part is live (SOPs compared, Nov 17, "Already in progress") | Only on the test database (same page, T12); not checked on a real database (repository) |
| Engagement letter on the live database | Applied Nov 12 (repository, to-do list) | Not applied as of Nov 12 (repository, Nov 12 recap); confirmed Nov 17 (repository) |
| How long a proposal stays open | 14 days (SOP) | 10 days (Lectual); 7 days (meeting, Nov 10) (client lifecycle) |
| Patents | Out of scope (page: Positioning, Jul 24) | Listed as a practice area (pages: Lectual Gate, Docket, Nov 17; page: Agentic IP OS concept) |
| Rebecca's account | She has none (page: Master Audit, Oct 19) | She is the owner-view user (page: Owner view mock-ups, Nov 10) |

## 8. What no audit has looked at

- **The people using it.** Taylor is the only daily user. Rebecca opened Lectual on Nov 9 to check proposals. Caitlyn tests it but could not edit on Nov 23. Rayn has a login and has not tried it (Nov 23). Dawn does not use it. Amor had no access on Nov 9 (meeting, Oct 16 to Nov 23). No audit watched any of them do a task.
- **Training.** None is on record; the first session was still being arranged on Nov 9 (meeting, Nov 9).
- **The live system.** The only audit run on the live RPB system was the Oct 19 Master Audit. Everything since uses drawn copies of the screens with made-up data (page: Design before and after; repository, "Marked never verified").
- **One client from start to finish.** No audit followed one lead through consult, proposal, signing, payment, matter and filing in Lectual. The client lifecycle covers the process, not the screens (client lifecycle).
- **A real phone.** Phone width was checked only in drawn copies (page: Owner view: design vs build, "Not verified yet").
- **Dark mode, keyboard use and screen readers.** These were flagged but never tested (page: Design Inconsistency Checklist, items 11 and 43; repository).
- **Live Lawmatics, Outlook and Zoom.** Six Lawmatics connections were never tried on a live account (repository).
- **Never reviewed at all:** Mail, Campaigns, Copilot, Firm notes, Shortcuts and Getting started (page: Design before and after, "Not shown here").

## 9. What to do next

1. **Settle the process decisions that the screens depend on.** These are: the order of signing and paying; which system holds the true stage; which mailbox approved emails come from; the meeting day; and when a lead becomes a matter.
   Decision for the owner and the managing attorney. Answers cause 1.
2. **Switch on what is built, or say no to it.** For each of the 25 items in section 4: apply the database update, turn on the owner view for Rebecca, approve the letter, or drop the item.
   Decision for the owner, then work to schedule. Answers cause 4.
3. **Give everyone working access, and connect the mailbox.** That means Caitlyn's editing, Amor's and Rayn's logins, and Dawn's Microsoft approval.
   Work to schedule. Answers causes 4 and 6.
4. **Choose one place for each job in section 6, write it down, and hide the rest from people who do not need them.**
   Decision for the owner. Answers cause 2.
5. **Pick names once.** Answer the four "needs your pick" items on the checklist, choose between Leads and Intake, and finish the glossary.
   Decision for the owner. Answers cause 3.
6. **Run one real Monday meeting from the Weekly review, and one real client from lead to filing.** Note every place someone reached for the spreadsheet, Lawmatics or a text message.
   Decision for the managing attorney; work to schedule. Answers causes 1, 5 and 6.
7. **Keep one current picture.** Mark the old design directions as retired, and remove the replaced rules from the repository record.
   Work to schedule. Answers cause 7.
8. **Stop screen-by-screen audits for now.** More of them would not help until steps 1 to 6 are done. The next review should be the people at the firm doing real work, on the live system, on their own phones.
   Decision for the owner. Answers causes 6 and 7.

**Why this order.** Most of the confusion comes from decisions not taken and work not switched on, not from screens drawn badly. The screen audits have already found and changed most of the look problems. Their open items are small, and none has been checked on a real screen. Settling the process first (1) tells you which screens matter. Switching things on and giving people access (2, 3) turns "done" into something people can see. Choosing places and names (4, 5) cuts down the duplicates. Only then does a real trial (6) show what is still confusing for the people Lectual is for.

## 10. Sources and limits

**Read:**
- Your published pages, 24 in all, with 3 set aside as not about Lectual.
- The repository's record: 28 review rounds, the lists of what is not built, never checked and waiting on the database, and the renames.
- Notes and parts of the transcripts of recorded meetings from Oct 2 to Nov 23.
- The SOPs-compared page (Nov 17).
- Four sections of the client lifecycle document.

**Not available:**
- The raw Oct 20 test notes. Only the repository's response to them survives.
- Every evaluator verdict file, which was not saved with the code.
- Any recorded training session.
- The Sep 17 demo and the Nov 2 meeting, which were not read.
- Rebecca's side of the Oct 27 and Nov 10 calls, which was mostly not transcribed.
- The unrecorded Nov 10 board review.
- The SOP sections that could not be read.

**What this means.** The picture of what was built and found is solid, because it comes from the record itself. The picture of what the firm's people find confusing is thin: most of it comes from Taylor and Caitlyn, who are building and rolling Lectual out, not from the people who will use it every day. Many items marked "changed" have never been seen working on a real screen, so treat them as unproven.
