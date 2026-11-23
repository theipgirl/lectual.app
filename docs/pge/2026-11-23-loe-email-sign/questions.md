# Questions: engagement letter by emailed link (Nov 23)

## Open questions
Each is decided conservatively in the contracts until the owner answers. None is picked for the owner.

- **Q1 (Sprint A, D3) The name on the letter.** The spec makes the letter final when the link is sent, but the client types their full
  legal name on the signing page afterwards, and the letter merges `{{signer_name}}`. Default: the letter uses the full legal name from
  "Your details", and the typed name at signing must equal it (case and spaces folded); a mismatch is refused and the client sends a
  fresh link. Alternative: ask for the typed name on the review step before sending. Owner/attorney to confirm.
- **Q2 (Sprint A, D4) The letter's dates.** Both `{{date}}` and `{{signed_date}}` become the date the link was sent (the text is final
  then); the real signing time is on the signature record and the certificate. Should the attorney's template drop `{{signed_date}}`
  for this path, or is the send date acceptable?
- **Q3 (Sprint A, D9) Showing the address.** The proposal page masks the address the link went to ("s•••@example.com"). Show it in full?
- **Q4 (Sprint A, D10 and D15) A letter the firm has replaced.** Two cases. (a) Replaced BEFORE a link is sent: no link is emailed
  and the client signs in-app as today. (b) Replaced WHILE a link is open (the firm approves a new letter template version): the
  contracts read spec decision 2's "a new letter version closes it" as covering a new letter TEMPLATE version as well as a new
  proposal version, so the link is closed (`proposal_changed`) and refused, and the client signs in-app (readiness is off for a
  replaced letter). This is the conservative reading; it is NOT confirmed. Alternatives: let the open link sign the letter it was
  sent with; or refuse both paths until the firm starts a new version. **`LOE_EMAIL_SIGNING` stays off until the owner answers.**
- **Q5 (Sprint B, D-B4) Filing the IN-APP signed copy in Lectual.** Decision 4 asks for the signed copy in Documents & files. Default:
  only link signatures get the new `signed_loe_file` step; in-app signatures stay exactly as today. Should in-app signatures be filed too?
- **Q6 (Sprint A, D13) Repeated failed sends.** If sending keeps failing for a firm (sending domain not verified on Resend, a wrong key,
  Resend down), the contracts fall back after 3 failed sends for one proposal version in 24 hours: the page goes back to signing on
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

## When the switch may go on
`LOE_EMAIL_SIGNING=on` is set for no deployment until ALL of: 0117 applied and its isolation cases pass; Sprint B shipped (a link
signature must never print without its certificate); Q4, Q6 and Q7 answered by the owner.
