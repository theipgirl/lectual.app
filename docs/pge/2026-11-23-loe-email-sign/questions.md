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
- **Q4 (Sprint A, D10) A letter the firm has replaced since the proposal went live.** Default: no link is emailed for it and the client
  signs in-app as today. Alternative: refuse signing until the firm starts a new version. ("A new letter version closes it" is read as
  a new proposal version; 0117 closes the link when the version is superseded.)
- **Q5 (Sprint B, D-B4) Filing the IN-APP signed copy in Lectual.** Decision 4 asks for the signed copy in Documents & files. Default:
  only link signatures get the new `signed_loe_file` step; in-app signatures stay exactly as today. Should in-app signatures be filed too?
