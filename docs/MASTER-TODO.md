# Master to-do

One list across sessions. Each session adds its action items here and checks them against Omi.
Newest section first. Tick an item when it is done; don't delete it.

## 2026-11-12: LOE on the proposal, one builder, simpler editor

Spec: `docs/specs/2026-11-12-proposal-loe-and-builder-design.md`

### Taylor

- [ ] Read the spec and say go (or what to change).
- [ ] Decide: may the owner still delete a proposal that has a signed engagement letter? (Recommended: yes, with a warning.)
- [ ] Show Rebecca the mockup and get from her:
  - [ ] the clean engagement letter text, trademark and general (the copy Dawn has holds a prior client's data);
  - [ ] her OK that a typed full name is an acceptable signature for her engagement letters;
  - [ ] replacement wording for the two client-page lines that no longer fit (spec 4.7);
  - [ ] which details the letter needs from the client (legal name, business, address, title);
  - [ ] her OK that the signed letter ends with an automatic exhibit of what the client chose. On Nov 11 she said to stop typing the package into the LOE; this keeps that, because nobody types it.
- [ ] Approve applying migration 0106 to lectual-prod when it is ready (dev first).

### Dawn / the firm

- [ ] Sevetri Wilson's engagement letter still needs its fee chart filled by hand. The app can't fill it for a multi-brand, per-mark proposal until this is built.

### Claude, next session

- [ ] Write the task-level implementation plan for sprints E1 and L1.
- [ ] Start Track 1 (E1 editor) and Track 2 (L1 migration and letter settings) in parallel after Taylor's go.
- [ ] Rewrite the two lectual-plugin skills that still say "payment first" (`draft-engagement-letter`, `process-consult`).

### Omi cross-check (2026-11-12)

- Omi has no action item about proposals, the engagement letter or the proposal maker. Nothing above duplicates an Omi item.
- Omi's newest action items are dated Oct 12. Anything said since then is not in Omi's list.
- Open Omi items that touch Lectual or RPB work, carried here so they are not lost:
  - [ ] Provide the Zoom credentials needed for the workflow setup (Omi, Oct 10).
  - [ ] Research lead-generation compensation models for attorneys and possible white-label firms (Omi, Oct 10). Note the flat-fee-only rule in `lectual/brain/decisions.md`.
  - [ ] Recruit 100 founders to take the assessment (Omi, Oct 10).
  - [ ] Update the launch deck with the team's latest meeting notes (Omi, Oct 9).
