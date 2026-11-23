---
date: 2026-11-23
project: Lectual
topic: Engagement letter signing: Adobe and Lawmatics researched, emailed signing link built (off)
tags: [lectual, loe, esign, decision, pge]
---
# LOE signing: research and build, Nov 23 2026

Research page: https://claude.ai/artifact/78FnPKZFHcsBWN3A8p4ziq
Branch: `claude/loe-email-sign` (not merged, switch off). Plan and contracts: `docs/pge/2026-11-23-loe-email-sign/`.

## What was decided
- Adobe Acrobat Sign set aside: Acrobat Pro has no API, Sign Solutions is quote-only, multi-firm use needs partner certification.
- Lawmatics e-signature set aside after a live test: one-off uploads need hand-placed fields, a custom field loses the fee section's
  line breaks, the firm signer is forced, and the firm's plan has no "signed" notice. Tag-triggered automation does work.
- Lawmatics' audit trail has no document fingerprint; Lectual's signature already records more. The gap was proof of email access.
- Build Lectual's own: emailed signing link (7 days), consent as the first click, drawn or typed signature, one Sign, certificate page,
  signed copy to the client and filed in Lectual and Lawmatics. First time Lectual emails a client by itself (two emails only).

## What was built (PGE workflow, 10 agents)
- Contracts (3 versions; the strict evaluator refused twice) and the 0117 schema PROPOSAL (not applied anywhere).
- Sprint A: request, email, `?sign=` page, consent, signature box, signing, signing-words settings. Sprint B: certificate page,
  signed-copy email, Lectual file step, staff card, docs, harness. Both passed strict evaluation; final review passed with notes.
- lint 0 errors, 13,931 tests pass, build green. `pricing.ts` untouched. Feature-off page pinned byte for byte.

## Not verified
A real browser (canvas by touch, 375px), 0117 on any database (33 isolation cases), real email delivery and attachments,
the firm's sending domain on Resend.

## Action items
See `docs/MASTER-TODO.md`, section 2026-11-23.
