# Session recap, 2026-11-23 (third part): the Lawmatics inventory prompt and the Lectual audit roundup

## What was asked

1. Give me the Claude in Chrome prompt to do the Lawmatics inventory.
2. Look at the audits done on Lectual, because it is still confusing.

Nothing was changed in Lawmatics, Lectual or any other system.

## What was produced

- `docs/rpb/lawmatics-inventory-chrome-prompt.md`: a look-only prompt for Claude in Chrome, 13 sections (plan, automations, tags,
  stages, fields, forms, templates, booking, signing, billing, integrations, duplicates, reports), stopping after each. Hard rules
  first and last. The orchestrator added three rules (stay out of editors that may save by themselves, no key presses in an editor,
  stop and report anything that may have changed). It has not been run.
- `docs/audits/2026-11-23-lectual-audit-roundup.md` (261 lines, reviewed once, 35 of 37 review points applied): one picture of every
  audit of Lectual and why it is still confusing.

## How it was done

Subagents did the work: one writer for the prompt; three researchers for the audits (the published audit pages, the repository's own
record, what the team said in meetings); one writer for the roundup; one reviewer. The orchestrator set the briefs, reviewed the
prompt's safety rules, and decided the order of causes and recommendations.

## What was found

- Nearly every "confusing" comment on record comes from Taylor and Caitlyn, the two people building and setting Lectual up. Rayn,
  Dawn and Amor have barely used it, so nobody yet knows what confuses the people it is for.
- Seven causes, most important first: it covers half of how the firm works (88 of 257 SOP steps happen outside it); it is hardly
  used and nobody has been trained; the same job is in several places; one thing has several names; much is built but nobody can
  see it (28 built things waiting to be switched on, about 47 never tried by a person in the real product); numbers people do not
  trust; the plan kept changing (six designs since Sep 9).
- Of 53 merged findings: 3 fixed and in use, 15 changed but never checked on a real screen, 29 open, 6 not known.
- No audit watched a person at the firm use Lectual for real work.

## Recommendation given

Stop auditing screens for now. In order: give everyone access and connect the mailbox; run one real Monday meeting from the Weekly
review with the people it is for and follow one client from lead to filing, watched; decide only the process questions that trial
shows are in the way; switch on or drop each of the 28 built items; choose one place per job per person; pick names once; keep one
current picture; pause screen-by-screen audits until the first four are done.

## Not done

- The inventory itself (the prompt has to be run by Taylor in Chrome).
- Could not be reconciled: whether merging duplicate leads is on the live database; what the Matters list looked like on Nov 17
  (three pages describe it three ways); whether the Leads page's new look is released; how long a proposal stays open.
- Not available: the raw Oct 20 test notes, the evaluator verdict files, any recorded training session.
- The Obsidian vault can't be reached from this cloud session.
