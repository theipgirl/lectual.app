# Master to-do

One list across sessions. Each session adds its action items here and checks them against Omi.
Newest section first. Tick an item when it is done; don't delete it.

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
