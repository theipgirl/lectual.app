# Master to-do

One list across sessions. Each session adds its action items here and checks them against Omi.
Newest section first. Tick an item when it is done; don't delete it.

## 2026-11-12 (later): the build is done on the branch; what is left before RPB can use it

Merged to `main` in `lectual.app`, `lectual` and `lectual-plugin` on Nov 12, so the app code is deployed. The production database is
untouched: 0106 is on lectual-dev only.

### Taylor

- [ ] Click through production at desktop and phone width (it is live now). Nothing here has run in a real browser or against
      real data: the new edit page, the three ways to start, the client page (choose, details, letter, sign, pay), the PDF download.
- [x] 0106 applied to lectual-prod (Nov 12, on Taylor's instruction). RPB's trademark letter is in Settings as a DRAFT (version 1),
      taken from the Nov 9 letter with the client's details turned into fill-in fields.
- [ ] Approve the letter: Settings, Client proposals, Engagement letter, Approve. Only a signed-in named approver can (Rebecca or
      Taylor). Until then no proposal carries it.
- [x] Merge to `main`. Done Nov 12: lectual.app#28, lectual#37 and lectual-plugin#4 merged, so the new editor and start screen are live
      for RPB. Signing a letter stays off until 0106 is on lectual-prod.
- [ ] The live database credentials in the cloud build environment: decide whether they should be there. An agent's test run reached
      lectual-dev twice by accident (nothing was written). Removing the Supabase variables from the environment's settings prevents it.
- [ ] Decide: may the owner still delete a proposal that has a signed engagement letter? Today yes, and the signed record goes with it.

### Rebecca (through Taylor)

- [ ] Read and approve the full trademark letter: `docs/rpb/engagement-letter-trademark.md`. Then it is pasted into Settings,
      Proposals, Engagement letter, and she approves it there.
- [ ] Supply the general (flat-fee) engagement letter text.
- [ ] Confirm a typed full name is an acceptable signature for her engagement letters.
- [ ] Supply the footer line for a proposal that carries the letter. Until she does, the page shows the firm's usual footer, which says
      the page does not create an attorney-client relationship, on the same page where the client signs the letter.
- [ ] Read the short step wording the client sees (`src/lib/loe/client-words.ts`): the details intro, the letter intro, the signing
      notice ("we record your typed name, the date and time, your device's network address and browser details...").
- [ ] Confirm the hand-built engagement letter path (a client with no Lectual proposal) should still wait for payment first. The
      plugin skill kept that rule; her Nov 11 direction was sign first.

### Checks still to do before go-live (design doc section 8)

- [ ] On a preview behind proposals.rpblawfirm.com: sign a test proposal and confirm the recorded IP is the visitor's, not the proxy's.
- [ ] Confirm the signed PDF lands in the right Lawmatics matter's Engagement folder (never tested against a live Lawmatics).
- [ ] Confirm the PDF builds on Vercel (the fonts are bundled; not run in a deployed function).
- [ ] A two-brand, per-mark-package test proposal end to end: complete Exhibit A, download before and after signing.
- [ ] Sign, reset, sign again on dev: two signature records, one live acceptance.

### Claude, next session

- [ ] Apply 0106 to lectual-prod after Taylor's OK; update both AGENTS.md files.
- [ ] Fix what the preview walk-through turns up.

## 2026-11-12: LOE on the proposal, one builder, simpler editor

Spec: `docs/specs/2026-11-12-proposal-loe-and-builder-design.md`

### Taylor

- [x] Say go. Done Nov 12: the build is running (six sprints, two tracks, PGE as a workflow).
- [ ] Look at the mockup and the spec; anything to change can still go into a later sprint. Mockup: https://claude.ai/artifact/S6dcsicKW5iBFFYE1mgeoM
- [ ] Check each merged sprint on a preview at desktop and phone width. The build environment has no database or live app, so nothing has been seen in a real browser.
- [ ] Copy the session recap into the Obsidian second brain (`docs/recaps/2026-11-12-loe-on-proposal-plan.md`). This cloud session can't reach the vault; sharing the vault folder through the desktop app (Settings, Claude Code, Remote Control) would let a session write it directly.
- [ ] Decide: may the owner still delete a proposal that has a signed engagement letter? (Recommended: yes, with a warning.)
- [ ] Show Rebecca the mockup and get from her:
  - [ ] her read and OK of the full trademark letter as it will appear: `docs/rpb/engagement-letter-trademark.md` (her Nov 9 letter with the client details turned into fill-in fields; the four changes are listed at the top). The general (flat-fee) letter text is still needed from her;
  - [ ] her OK that a typed full name is an acceptable signature for her engagement letters;
  - [ ] replacement wording for the two client-page lines that no longer fit (spec 4.7);
  - [ ] which details the letter needs from the client (legal name, business, address, title);
  - [ ] her OK that the signed letter ends with an automatic exhibit of what the client chose. On Nov 11 she said to stop typing the package into the LOE; this keeps that, because nobody types it.
- [ ] Approve applying migration 0106 to lectual-prod when it is ready (dev first).

### Dawn / the firm

- [ ] Sevetri Wilson's engagement letter still needs its fee chart filled by hand. The app can't fill it for a multi-brand, per-mark proposal until this is built.

### Claude, next session

- [x] Write the sprint plan and start both tracks (running).
- [ ] When the pipeline reports: read the final security review and the isolation audit of 0106, fix what they find, then apply 0106 to lectual-dev and check it with SQL in a rolled-back transaction.
- [ ] Review the rewritten lectual-plugin skills (`draft-engagement-letter`, `process-consult`) before pushing them.
- [ ] Clean up the two build worktrees (`/home/user/wt/editor`, `/home/user/wt/loe`) and their local branches when the last merge is in.

### Omi cross-check (2026-11-12)

- Omi has no action item about proposals, the engagement letter or the proposal maker. Nothing above duplicates an Omi item.
- Omi's newest action items are dated Oct 12. Anything said since then is not in Omi's list.
- Open Omi items that touch Lectual or RPB work, carried here so they are not lost:
  - [ ] Provide the Zoom credentials needed for the workflow setup (Omi, Oct 10).
  - [ ] Research lead-generation compensation models for attorneys and possible white-label firms (Omi, Oct 10). Note the flat-fee-only rule in `lectual/brain/decisions.md`.
  - [ ] Recruit 100 founders to take the assessment (Omi, Oct 10).
  - [ ] Update the launch deck with the team's latest meeting notes (Omi, Oct 9).
