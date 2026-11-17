# Recap 2026-11-17: USPTO notice reader, open-source check

**Ask:** USPTO notice reader (suggestions): read USPTO mail in trademarks@, recognise the notice type, suggest a stage move, an unconfirmed deadline, and attaching the notice. First check whether an open-source repo already does this.

**Finding:** None found. Only trademark-specific hits were bulk-XML parsers (jlroo/uspto) and a patent-side client (pyUSPTO). Office action APIs are patent-side. Commercial docketing (Alt Legal, DocketTrak, DeadlineDocket, GleanMark) does it, closed source.
Unconfirmed: whether the TSDR API returns trademark office action text (sources conflict).

**Facts to build on:** most office actions have a 3-month response period counted from the date in the notice email heading; some differ, so the notice text is authoritative.

**Plan:** build in-app, reusing the Sprint 17 pattern (rule-based classifier like `src/lib/reconcile/milestones.ts`, suggestions as `ai_insight` rows, never auto-send, deadline unconfirmed until an attorney confirms).

## Action items
- [ ] Decide scope: rule-based notice-type classifier first (no model), model only for deadline extraction fallback
- [ ] Collect 10-20 real USPTO notice emails from trademarks@ (redacted) as test fixtures
- [ ] Confirm with Taylor: which notice types to cover first (office action, publication, NOA, SOU, registration, abandonment)
- [ ] Spec the suggestion card + "unconfirmed deadline" state (attorney confirm)
- [ ] Check TSDR/ODP API for trademark document retrieval before relying on it
