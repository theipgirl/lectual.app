# Engagement letter: emailed signing link, signature box, certificate (owner's plan, Nov 23, 2026)

**Owner:** Taylor. **Branch:** `claude/loe-email-sign` (never `main`). **Evaluator: STRICT** (signatures, client email).
**Schema:** a PROPOSAL FILE ONLY in this folder (`0117-proposed.sql.txt`; re-check the number against `lectual/supabase/migrations`,
first-merged-wins; 0108, 0110–0113, 0115, 0116 are spoken for). Nothing is applied to any database by this work.

## Why
Adobe Acrobat Sign (plan cost, partner certification) and Lawmatics e-signature (fixed templates, fee section breaks, no "signed" notice on
the firm's plan) were researched and tested on Nov 23 and set aside. Lectual's own signature (lectual 0106) already records the exact letter,
its fingerprint, time, IP and browser. It lacks: proof the signer controls the client's email address, a recorded consent to sign
electronically, a drawn signature, and a certificate page. This plan adds those four, modelled on what a client sees in Lawmatics.

## Owner decisions (Taylor, Nov 23). Binding. Anything not covered: stop and ask, don't pick.
1. **Flow.** Choose → Your details → Review your letter → the client presses a button and Lectual **emails a signing link** to the address on
   file → the link opens the letter read-only → **the first click is the consent to sign electronically** (nothing can be filled in before it)
   → draw or type the signature + typed full legal name → **Sign** (one act: signs and accepts, as today) → done screen → Pay.
2. **The link is good for 7 days.** It opens only the letter that was emailed. New choices, a new letter version, a reset, a withdrawal or an
   expiry close it; pressing the button again sends a fresh one and closes the old.
3. **No "are you sure?" dialog.** Steps say what comes next instead.
4. **The signed copy** goes to the client by email, is filed on the lead/matter **in Lectual** (Documents & files) and **in Lawmatics**
   (the existing `signed_loe_upload` step). The firm keeps its in-app notice and Lawmatics note.
5. **A certificate page** on the signed PDF: sent to (email), sent at, opened at, consent accepted at (and which consent text, by fingerprint),
   signed at, IP, browser, the letter's fingerprint, the drawn/typed signature.
6. **Attorney countersignature: out of scope.**
7. **This is the first time Lectual emails a client by itself.** The owner approved these emails only: the signing link (sent because the
   client pressed the button) and the signed copy (sent because the client signed). Nothing else is sent. This is an owner-approved exception
   to "nothing sends to a client"; write it into AGENTS.md as such.

## Firm rules (binding on every agent)
- **Off by default, and today's path is untouched.** A firm uses the emailed-link path only when ALL hold: the deployment switch is on
  (an env var, exactly `on`), the 0117 objects exist (judged by error CODE: 42P01 / PGRST205 / 42883 / PGRST202), mail is configured for that
  firm (Resend key + a from-address for THAT firm on its own domain, by org id; no deployment-wide default sender for client mail), and the firm
  has **approved signing words**. Otherwise the client signs exactly as today (0106 path, byte for byte: pin it with a baseline test).
  A firm is never left with no way to sign.
- **Builders write no legal-sounding text.** The consent line, the full consent text, the line beside Sign, the line under the signature box,
  and both emails' subject and body are the ATTORNEY'S words, stored per firm, approved by a named approver (same idea as the letter template),
  snapshotted (text + sha256) onto each signing request. No approved words = the path is off for that firm. Builders may write only step
  labels and status sentences (in `src/lib/loe/client-words.ts` / `src/lib/ui/words.ts`). Never copy Lawmatics' consent text.
- **The letter is final when the link is sent.** The server builds the agreement text itself (stored letter + cleaned details + recomputed
  exhibit via `quoteForAcceptance` + its own firm-zone date), stores it with its sha256 on the request, and the emailed PDF, the signing page
  and the signed PDF all come from THAT stored text. Nothing from the browser is trusted (no price, no text, no email address).
- **The token.** At least 32 random bytes, url-safe; only its sha256 is stored; never logged; compared in constant time. A wrong, expired,
  closed or other-proposal token reads the same ("this link is no longer available") with zero detail. Rate limits on send (per proposal token
  and per address) and on open/sign, in memory like the existing `/p/` limiters (say so: courtesy limits).
- **One signing, once.** Signing goes through ONE database function (service role) that locks the request, checks it is open, unexpired and
  consented, checks the proposal is still the same live version, writes the 0106 signature row + the new evidence, and accepts the proposal,
  in one transaction. A second call changes nothing. `pricing.ts` has no diff. Snapshots are never re-priced.
- **Evidence recorded** (append-only, service role only, org from the proposal row): request sent (to which address, when), opened (when, IP,
  browser), consent (when, consent text sha256), signature (drawn PNG ≤ 100 KB or typed style, its sha256, typed legal name), signed (when, IP,
  browser), agreement sha256. No address, letter text, token or signature bytes in any log, step payload or notice.
- **The signature box:** no new dependency (canvas + pointer events; works by touch; Clear; a typed alternative; keyboard users can use the
  typed alternative). The typed full legal name stays required. Assets only from `/_next/static/` or `/brand/` (the public-assets test).
- **The link is a query on the existing page** (`/p/<token>/?sign=<signing token>`), built only through `clientLinkOrigin`, so the firm's own
  domain keeps working with no new rewrite in `lectual`.
- **Mail:** client mail goes through the one mailer file (`src/lib/mail/internal-mail.ts`, extended for attachments and renamed in its header
  comment), never a second Resend caller. Tests never send. Idempotency keys from the request id. A failed send is a fixed sentence to the
  client ("We couldn't send the email. Try again."), never raw text, and leaves no open request.
- **Signed-copy steps** reuse the acceptance follow-up machinery (`edited` step events, once per round, retryable, fixed sentences):
  a step for the client email and a step for the Lectual file (`crm_file` under the proposal's lead or matter; none linked = `blocked` with the
  existing "no lead or matter" style sentence). Service role only where the public path already uses it, fenced on the proposal row's org.
- **Staff side:** the proposal page's Engagement letter card shows the request state (sent / opened / consent given / signed / expired) from
  granted columns only, three-state reads (a failed read is never "not sent").
- **Settings:** Settings → Client proposals gains the signing words editor + approve (admin tier edits, a named approver approves), and says
  plainly when the path is off and why (no words approved / Lectual hasn't switched it on).
- Standing rules: scoped client on dashboard paths; no secrets printed; no client names, emails or marks in code, tests, docs or commits
  (use obviously fake ones); `pnpm lint`, `pnpm test`, `pnpm build` green; unset live Supabase env vars when running tests
  (`env -u SUPABASE_SERVICE_ROLE_KEY ...`, see AGENTS.md); commit to `claude/loe-email-sign` only; do not push; do not open a PR.

## Sprints
- **A: the request and the signing.** 0117 proposal (tables, functions, RLS, grants, isolation cases as SQL comments/tests text), hand-added
  types, the gate, signing words storage + settings editor + approve, send-link action + email + attached review PDF, the `?sign=` page
  (read-only → consent → signature box → Sign), the one signing function call, fallbacks, tests.
- **B: after signing.** Certificate page in `src/lib/loe/pdf.ts` (signed copy only; `verifySignedCopy` rules still hold: a fingerprint is never
  printed beside text it doesn't match), signed-copy email step, Lectual file step, staff card states, AGENTS.md section, MASTER-TODO items,
  a design-harness screen for the new client states at 1440 / 375.

## Done means
Contract ratified by the strict evaluator; each sprint built to its contract; evaluator re-runs lint, tests, build and reads the diff against
this spec; every NOT VERIFIED item (real browser, real database, real email delivery, Resend attachments) is listed, not hidden.
