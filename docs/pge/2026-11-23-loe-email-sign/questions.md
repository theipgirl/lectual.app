# Questions: engagement letter by emailed link (Nov 23)

## Open questions
Each is decided conservatively in the contracts until the owner answers. None is picked for the owner.

- **Q1 (Sprint A, D3) The name on the letter.** The spec makes the letter final when the link is sent, but the client types their full
  legal name on the signing page afterwards, and the letter merges `{{signer_name}}`. Default: the letter uses the full legal name from
  "Your details", and the typed name at signing must equal it (case and spaces folded); a mismatch is refused and the client sends a
  fresh link. Alternative: ask for the typed name on the review step before sending. Owner/attorney to confirm.
  **`LOE_EMAIL_SIGNING` stays off until the owner answers** (v3, evaluator B4).
- **Q2 (Sprint A, D4) The letter's dates.** Both `{{date}}` and `{{signed_date}}` become the date the link was sent (the text is final
  then); the real signing time is on the signature record and the certificate. Should the attorney's template drop `{{signed_date}}`
  for this path, or is the send date acceptable? As built, a signed letter can state a signing date days before the real one,
  so this is not a conservative default. **`LOE_EMAIL_SIGNING` stays off until the owner answers** (v3, evaluator B4).
- **Q3 (Sprint A, D9) Showing the address.** The proposal page masks the address the link went to ("s•••@example.com"). Show it in full?
- **Q4 (Sprint A, D10 and D15) A letter the firm has replaced.** Two cases. (a) Replaced BEFORE a link is sent: no link is emailed
  and the client signs in-app as today. (b) Replaced WHILE a link is open (the firm approves a new letter template version): the
  contracts read spec decision 2's "a new letter version closes it" as covering a new letter TEMPLATE version as well as a new
  proposal version, so the link is closed (`proposal_changed`) and refused, and the client signs in-app (readiness is off for a
  replaced letter). This is the conservative reading; it is NOT confirmed. Alternatives: let the open link sign the letter it was
  sent with; or refuse both paths until the firm starts a new version. **`LOE_EMAIL_SIGNING` stays off until the owner answers.**
- **Q5 (Sprint B, D-B4) Filing the IN-APP signed copy in Lectual.** Decision 4 asks for the signed copy in Documents & files. Default:
  only link signatures get the new `signed_loe_file` step; in-app signatures stay exactly as today. Should in-app signatures be filed too?
- **Q6 (Sprint A, D13, D21-D23) Repeated failed sends.** If sending keeps failing for a firm (sending domain not verified on Resend, a
  wrong key, Resend down, a database error while the link is made), the contracts fall back after 3 counted failures for one
  proposal version in 24 hours (v3: a failure before or after the request exists, or an uncertain mail answer, all count): the page goes back to signing on
  the page as today ("We couldn't send the email. Reload the page to sign here instead."). Is in-app signing an acceptable fallback
  for a firm that chose emailed links, and is 3 in 24 hours the right threshold? Alternatives: tell the firm and hold the client; or
  no fallback. **`LOE_EMAIL_SIGNING` stays off until the owner answers.**
- **Q7 (Sprint A, D13) A wrong address, or a mail that bounces.** The link goes only to the proposal's `client_email` (frozen on a live
  version). If that address is wrong, or the mail bounces after Resend accepted it, the app cannot tell, and the client cannot fix
  the address on the page. Today the firm can start a new version with the corrected address. Should the page offer the client
  anything (for example "sign here instead" after a link is sent, or a line telling them to contact the firm), or should the firm be
  told of bounces? Default in the contracts: nothing new; the page shows the masked address so the client can see where it went.
  **`LOE_EMAIL_SIGNING` stays off until the owner answers.**
- **Q8 (Sprint A, D16) A script-style typed signature.** The spec's evidence lists a "typed style". No script face is bundled for the
  PDF and none may be added without a decision, so the contracts offer one typed style (`print`), drawn in the page's body face and
  in DejaVu Sans on the certificate, with the words "Typed signature". 0117 still accepts `script`. Is a script style wanted (it needs
  a bundled font licensed for the PDF and served from `/_next/static/`)?

- **Q9 (Sprint A build, item 9 step 1) What a client sees when the send limiter refuses.** The contract's exact-strings table has
  no sentence for it. Built conservatively with an existing sentence, `SEND_MESSAGES.send_failed` ("We couldn't send the email. Try
  again."), and the refusal is never counted (so the bearer link can't trip the fallback). A dedicated sentence ("Too many emails
  just now...") would need the owner's wording. The switch is off anyway.
- **Q10 (Sprint A build, item 14) Which signature mode is selected first.** The contract asks for the typed alternative to come
  first in the focus order; it does not say which mode is selected on load. Built: "Draw" is selected, and the "Type it instead"
  radio is placed BEFORE the canvas so a keyboard user reaches it first. Confirm, or select "Type" on load.

## Decisions recorded with the v3 contracts (evaluator's second refusal; none answers an open question)
- Every failure after a request exists closes it and is counted; every `signing_open` answer is mapped; the database reports
  its own preconditions to readiness (0117 `signing_readiness`) so the app and 0117 cannot disagree (Sprint A D21, D22).
- An uncertain mail answer keeps the link open and counts as a failure; a client-caused refusal (rate limit, missing details) is
  never counted, so the bearer `/p/` link cannot be used to skip the email proof (D23).
- The close-on-change is re-armed after every send (D14).
- Settings reads its status line through the scoped client only (D26).
- 0117's checks are NULL-safe (D27).
- Q1 and Q2 now gate the switch (D24).

## When the switch may go on
`LOE_EMAIL_SIGNING=on` is set for no deployment until ALL of: 0117 applied and its isolation cases pass; Sprint B shipped (a link
signature must never print without its certificate); Q1, Q2, Q4, Q6 and Q7 answered by the owner (v3: Q1 and Q2 added; they
decide the name and the dates written into the SIGNED letter, so the builder's defaults D3 and D4 are not left standing on their
own). The same list is in Sprint A blocker 4, item 4 (the `.env.example` / `env.ts` comment), item 21 and D24, Sprint B item 12,
and the 0117 header.
