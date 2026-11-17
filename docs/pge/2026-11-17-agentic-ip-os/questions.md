# Open questions

Only questions that only these people can answer. No answer is guessed in the contracts: where a sprint needs one, it says what it does until it is answered (usually: the safer behaviour, or the part is not built).

## Taylor (founder / operator)

| # | Question | Sprint | Until answered |
|---|---|---|---|
| T1 | Production migrations: OK to apply **0103** (hand-off events) and **0106** (engagement letter and signatures) to lectual-prod? | 4, 5 | Sprint 4's hand-off to Rayn and Sprint 5 stay dev-only |
| T2 | Who holds the **USPTO API key**: one Lectual key for the deployment (USPTO data is public, not a firm account), or each firm's own? | 3 | Watcher reads "isn't switched on"; tests use fixtures |
| T3 | **Adobe Sign**: which account and developer app; is it each firm's own Adobe Sign account (like LawPay) or a Lectual one? Who registers the webhook URL? | 5 | Built per firm (the LawPay rule); live runs wait |
| T4 | Decision 11 says "the letter and **invoice** go out with the proposal". What is the invoice: a Lawmatics invoice someone creates, the LawPay pay step on the proposal page, or something else? May Lectual create it? | 5 | Nothing creates an invoice; the existing pay step is used |
| T5 | When a proposal is **signed and paid**, should the lead move to a `won` stage? Today only the hired-matter sync may do that ("nothing else may copy this"). | 5 | The chain opens the matter and does not move the lead |
| T6 | **Dawn's access to billing**: give her a role that sees billing, or a per-person "billing access" list (planned in 0113)? And what Lectual role is she? | 8 | Billing stays owner-only |
| T7 | Should admins see whether a colleague's **personal Outlook** is connected? Today RLS hides it from everyone else, so the accounts checklist can only say "Only Rayn can see this". Showing it needs a small schema change. | 1, 4 | The checklist says "Only <name> can see this" |
| T8 | Approval routing (and the planned "drafts go to" setting) is stored in the Proposals settings row, so a firm without the Proposals feature can't save it. Is that acceptable for RPB, or should routing move to its own table? | 4 | Kept where it is; RPB has Proposals |

## Caitlyn (operations lead)

| # | Question | Sprint | Until answered |
|---|---|---|---|
| C1 | The confirmed **lead stage list**: exact names, order, and for each stage who it waits on (us / the client / nobody). | 2 (blocked), 8 | Sprint 2 does not start |
| C2 | Which stage is **No Show / Reschedule** (one stage or two), and where a lead goes after a rebooked consult. | 2 | Not built |
| C3 | **Time targets** in calendar days for each lead stage and each matter docket stage. | 8 | Matter stages use today's fallback; lead stages use any stored number |
| C4 | Who gets the **Day 1/2/4/6/7 proposal follow-up tasks**: the lead's assignee, you, Rayn, or someone else? | 7 | The lead's assignee, else unassigned |
| C5 | The exact **grace period** after a proposal expires before suggesting Long-Term Nurture ("about two weeks": 14 days from expiry, or 21 days from sending?). | 7 | Not built until a number is given |
| C6 | How is the **Monday team call** recorded and titled (Zoom or Fathom, which account, the title), so the meeting assistant reads that call and nothing else? | 6 | Assistant ends "no meeting marked" |
| C7 | The Lectual **roles** of Caitlyn, Rayn and Dawn, and confirmation that Rebecca's account is the attorney-tier one. | 1, 4, 8 | Checklist shows what is set; nothing is changed |
| C8 | Which members are **filed-matter owners** for the "No open deadline" flag and the 30/7-day alerts: everyone, or a named list? | 3 | Shown to everyone who can see the matter |

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
| R8 | The **welcome email** and **questionnaire** used when a client is signed and paid: the current ones, unchanged? | 5 | The current ones |
