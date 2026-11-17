# Open questions

Only questions that only these people can answer. No answer is guessed in the contracts: where a sprint needs one, it says what it does until it is answered (usually: the safer behaviour, or the part is not built).

## Taylor (founder / operator)

| # | Question | Sprint | Until answered |
|---|---|---|---|
| T1 | ~~Production migration: OK to apply **0106** to lectual-prod?~~ **Answered (director, Nov 17): 0106 is already on lectual-prod** (recorded 2026-11-12 as 0106_proposal_engagement_letter, verified); 0103 since Nov 10. | 5 | Nothing waits on it |
| T2 | Who holds the **USPTO API key**: one Lectual key for the deployment (USPTO data is public, not a firm account), or each firm's own? | 3 | Watcher reads "isn't switched on"; tests use fixtures |
| T3 | **Adobe Sign**: which account and developer app; is it each firm's own Adobe Sign account (like LawPay) or a Lectual one? Who registers the webhook URL? | 5 | Built per firm (the LawPay rule); live runs wait |
| T4 | Decision 11 says "the letter and **invoice** go out with the proposal". What is the invoice: a Lawmatics invoice someone creates, the LawPay pay step on the proposal page, or something else? May Lectual create it? | 5 | Nothing creates an invoice; the existing pay step is used |
| T5 | When a proposal is **signed and paid**, should the lead move to a `won` stage? Today only the hired-matter sync may do that ("nothing else may copy this"). | 5 | The chain opens the matter and does not move the lead |
| T6 | **Dawn's access to billing**: give her a role that sees billing, or a per-person "billing access" list (planned in 0113)? And what Lectual role is she? | 8 | Billing stays owner-only |
| T7 | Should admins see whether a colleague's **personal Outlook** is connected? Today RLS hides it from everyone else, so the accounts checklist can only say "Only Rayn can see this". Showing it needs a small schema change. | 1, 4 | The checklist says "Only <name> can see this" |
| T10 | Sprint 9 (the lead page where Lectual does the step): **"build it"?** The contract is written and NOT approved. | 9 | Not started |
| T11 | Stage plan S2-3: remove the thirteen old columns (copied from the matter list, zero leads) from the Intake board? | 2 | They stay |
| T12 | Sprint 10 default: the card's **source** is picked from the firm's list only (no typed new source). Keep? | 10 | As stated |
| T13 | Sprint 10 default: **Mark no-show** logs straight away with a 5-second Undo and an optional note (no reason asked first). Keep? | 10 | As stated |
| T14 | Sprint 10 default: on phones the opened card is a **full-screen sheet** (not a ~90% bottom sheet). Keep? | 10 | As stated |
| T15 | Sprint 10 default: a board card's **bottom line** shows owner, next step AND last activity (not only owner and next step). Keep? | 10 | As stated |
| T8 | Approval routing (and the planned "drafts go to" setting) is stored in the Proposals settings row, so a firm without the Proposals feature can't save it. Is that acceptable for RPB, or should routing move to its own table? | 4 | Kept where it is; RPB has Proposals |

## Caitlyn (operations lead)

| # | Question | Sprint | Until answered |
|---|---|---|---|
| C1 | The confirmed **lead stage list**: exact names, order, and for each stage who it waits on (us / the client / nobody). Answered: "in the SOP"; intake settled Nov 12; the rest is S2-1 to S2-11. | 2, 8 | Sprint 2 ships the settled intake part |
| C2 | Which stage is **No Show / Reschedule** (one stage or two), and where a lead goes after a rebooked consult. Now S2-2. | 2 | Not built |
| C3 | **Time targets** in calendar days for each lead stage and each matter docket stage. | 8 | Matter stages use today's fallback; lead stages use any stored number |
| C4 | Who gets the **Day 1/2/4/6/7 proposal follow-up tasks**: the lead's assignee, you, Rayn, or someone else? | 7 | The lead's assignee, else unassigned |
| C5 | The exact **grace period** after a proposal expires before suggesting Long-Term Nurture ("about two weeks": 14 days from expiry, or 21 days from sending?). | 7 | Not built until a number is given |
| C6 | How is the **Monday team call** recorded and titled (Zoom or Fathom, which account, the title), so the meeting assistant reads that call and nothing else? | 6 | Assistant ends "no meeting marked" |
| C7 | The Lectual **roles** of Caitlyn, Rayn and Dawn, and confirmation that Rebecca's account is the attorney-tier one. | 1, 4, 8 | Checklist shows what is set; nothing is changed |
| C9 | **Amor**: does Amor have a Lectual account, and with which role? (Taylor, Nov 17: follow-up tasks go to Amor.) | 7 | Tasks go to the lead's assignee, else unassigned |
| C10 | The welcome email: paste its text from the trademarks@ mailbox into the firm's template setting (Caitlyn or Taylor; R8). Not a question, an action; listed so it isn't lost. | 5 | Welcome step `blocked` |
| C8 | Which members are **filed-matter owners** for the "No open deadline" flag and the 30/7-day alerts: everyone, or a named list? | 3 | Shown to everyone who can see the matter |

## Stage plan questions from the SOP (Sprint 2)

Where the SOP contradicts itself, or the live board and the SOP disagree. Sprint 2 ships the unambiguous intake part and changes none of these until answered.

| # | Question | Who | Until answered |
|---|---|---|---|
| S2-1 | "Follow-Up" is a live unnumbered intake column with 31 leads: keep it, or fold it into 1 Potential New Client? | Caitlyn, Taylor | Stays as it is |
| S2-2 | No Show / Reschedule: a stage, or a mark on the lead? (Replaces C2.) | Caitlyn | A mark only (the existing consult outcomes); a rescheduled consult stays in Consultation Scheduled |
| S2-3 | Remove the thirteen old columns from the Intake board? (Same as T11.) | Taylor | They stay |
| S2-4 | Pre-filing numbers: SOP v0.4 says 8 to 16 with 9 and 10 merged; Caitlyn said "9 to 17 or whatever the counts are". Which? | Caitlyn | Live numbers stay |
| S2-5 | The merged stage's name (live 9 Comprehensive Search + 10 Preparing Opinion Letter). | Caitlyn, Rebecca | Both live stages stay |
| S2-6 | Which pre-filing stage waits for the balance (15 Send Invoice for Remaining Balance, 16 Full Balance Received, or another)? | Caitlyn | No `waiting_on` change |
| S2-7 | Keep 17 Application Filed as its own stage? | Caitlyn | Kept |
| S2-8 | Add 27 Maintenance? | Caitlyn, Rebecca | Not added |
| S2-9 | The exact names of 19D, 19H and 19I. The SOP's table calls 19D "Payment for OA Response Sent" while its text describes the invoice-sent stage (live: "Invoice for OA Response Sent", waiting on the client). | Caitlyn | Live names stay |
| S2-10 | Add an "SOU Filed" stage? | Caitlyn, Rebecca | Not added |
| S2-11 | Does 23 Trademark Abandoned stay OPEN during the revival window, as the SOP says? | Caitlyn, Rebecca | As live today |

## Rebecca (attorney)

| # | Question | Sprint | Until answered |
|---|---|---|---|
| R1 | Which USPTO statuses map to which **docket stage**, and which **deadline kinds** count as "USPTO deadlines" for the close guard. | 3 | Guard uses every open deadline on a TM matter; watcher map holds only statuses you confirm |
| R2 | The **close override**: only you, or any attorney or owner? Is a written reason enough? | 3 | Owner and attorney roles, reason required |
| R3 | The facts-only **client notice** text the USPTO watcher drafts for each status you want notices for (publication, registration, others). | 3 | No notice is drafted for a status without approved text |
| R4 | Which existing drafts belong to each kind Rayn may clear (decision 15): filing receipts, publication/registration notices, form and payment reminders, requests for information. In particular: are the monthly filing updates routine? | 4 | They stay attorney-only |
| R5 | May Rayn clear the **proposal follow-ups** (Day 1/2/4/6/7)? They carry the proposal link, so today they are attorney-only. | 7 | Attorney-only |
| R6 | The five **follow-up email texts** (Day 1, 2, 4, 6, 7) and the **"last day" sentence** for the proposal email. | 7 | Not drafted; default template only after your OK |
| R7 | The **over-time nudge** texts per client-waiting stage. | 8 | Task only, no email |
| R8 | The **welcome email** and **questionnaire** used when a client is signed and paid. Answered for the welcome email: the one in the trademarks@ mailbox, as it stands (Taylor, Nov 17; text to be pasted, C10). Still open: does the questionnaire stay as it is? | 5 | Welcome: blocked until pasted; questionnaire: the current one |

## Answers (Taylor, Nov 17, in this order, as given)

How Taylor's reply lines were matched to the questions is our reading; items marked "(check)" should be confirmed.

| # | Answer | What it means for the plan |
|---|---|---|
| T1 | "yes" | Moot: the director verified that **0106 is already on lectual-prod** (since 2026-11-12) and 0103 since Nov 10. No production migration is outstanding. |
| T2 | "i will get the key" | Taylor gets the USPTO API key; the watcher stays "not switched on" until it is set |
| T3 | "rebeccas" | Rebecca's Adobe Sign account (the firm's own, per-firm connection) |
| T4 | "the custom lawmatics pay link" | The "invoice" is the firm's custom Lawmatics pay link on the proposal; Lectual creates no invoice |
| T5 | "yes" | Signed and paid moves the lead to a `won` stage (a second named exception beside the hired-matter sync) |
| T6 | "will get her access soon" | Dawn's access is coming; role/billing list still to set (check which) |
| T7 | "owners can see what mailbox is connected" | Owners (only) may see whether a colleague's Outlook is connected; needs the small schema change |
| T8 | (no answer) | Open |
| C1 | "its in the SOP" | Stage list is in Caitlyn's SOP; read it from there (director holds the SOPs) |
| C2 | "pending" | Open |
| C3 | "pending" | Open |
| C4 | "amor" | Follow-up tasks go to Amor (check: Amor's account/role in Lectual) |
| C5 | (no answer) | Open (check) |
| C6 | "zoom or fathom" | The Monday call is recorded in Zoom or Fathom; title and account still needed (check) |
| C7 | "in the sop" | Roles are in the SOP |
| C8 | "rayn her and rebecca" | Deadline alerts go to Rayn, Caitlyn and Rebecca (check: "her" = Caitlyn) |
| R1–R7 | "will get with rebecca on these" | Open; Taylor will take them to Rebecca |
| R8 | "the welcome email is in the trademarks@ email" | Use the welcome email as it stands in the trademarks@ mailbox; questionnaire still to confirm |

### Still open after Taylor's answers (director's reading, Nov 17)
T6 (Dawn's role), T8, T10, T11, C2 (now S2-2), C3, C5, C6 (account and title; "zoom or fathom" only), C9 (Amor), C10 (paste the welcome text), R1 to R7, the questionnaire half of R8, and S2-1 to S2-11.

## Added Nov 17 (first reply, Sprint 7)

| # | Question | Who | Until answered |
|---|---|---|---|
| R9 | The **first-reply template** for a new enquiry, and whether Rayn may clear first replies | Rebecca / Caitlyn | No first reply is drafted |
| C11 | The firm's **booking link** for consults | Caitlyn | Draft says "[booking link]" with a CHECK FIRST |
