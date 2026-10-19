# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# lectual.app — project guidance

**What this is:** the final-MVP firm workspace for Lectual (Oath Innovation Inc). It is a new
**frontend** over the same Supabase backend as `theipgirl/lectual`. It is not a new backend.
Plan: `docs/MVP-PLAN.md`. Design: `design/` (one visual system; tokens live in
`src/app/globals.css`).

## Where the rules live
`theipgirl/lectual` owns the database, and its `AGENTS.md`, `brain/decisions.md` and
`supabase/migrations/` are binding here too. In particular:
- **No migrations in this repo.** Schema changes go in `lectual/supabase/migrations` (one chain,
  first-merged-wins numbering). Apply each one to BOTH lectual-dev and lectual-prod.
- **The tenant-isolation gate lives in `lectual`** (`tests/tenant-isolation.test.ts`), and every
  new tenant table adds a case there.
- **UPL firewall:** software, not a law firm; flat fees only; nothing implies legal advice.
- **Queue reads have three states** (`src/lib/queue/load.ts`): ok, unconfigured, unavailable. Never two.
- **Modules fail closed.** Gate the PAGE and the ACTION with `orgHasModule()`, and use `notFound()`.
  The rail (`src/lib/nav.ts`) is a courtesy, not the gate.
- **DB access:** only `getScopedClient()` (RLS on `active_org_id`). The service-role client
  (`src/lib/db/admin.ts`) is lint-fenced and only for jobs that stamp the row's own `org_id`.
- **Deploys:** production ships from `main` only. Never "Promote to Production" on a preview.

## Ported code
See `PORTED_FROM.md`. When changing a ported file, consider whether `lectual` needs the same fix.

## LawPay (per-firm) — `docs/lawpay-setup.md`
- Each firm signs in to ITS OWN LawPay account (lectual 0080 `lawpay_connection`). There is no
  deployment-wide LawPay key; never add one. Charges use the firm's own account secret, looked up
  by the quote's org_id. Sealed columns have no SELECT grant: name the columns.
- The charged amount comes ONLY from the signed snapshot (`signingChargeForQuote`), to the mapped
  OPERATING account. The account kind is never defaulted or inferred. The pending `crm_payment` row is
  written before LawPay is called; 0080's index allows one open signing charge per quote.
- Only a 401/403 on the firm's key pauses the firm's card payments (`reauth`). A refusal of one request
  never does: the payment token in it came from an anonymous visitor. A quote allows 5 failed card
  attempts, then the form is withdrawn (the link has no login and no rate limiter).
- Trust flag and mode are checked against the SEALED gateway credentials at charge time. The readable
  `accounts` column is admin-writable through the API, so it is never the last word on trust vs operating.
- Payment-state reads are five-state (received / confirming / payable / manual / unavailable). A failed
  read is never "unpaid".
- Tests never call LawPay. Unset `LAWPAY_OAUTH_*` means "not configured", and manual recording keeps working.

## Meetings (Fathom / Zoom) — `docs/meetings-setup.md`
- Each firm connects ITS OWN Fathom (API key, pasted, checked, sealed) or Zoom (OAuth, PKCE, sealed
  rotating refresh token) in lectual 0081 `meeting_source_connection`. No deployment-wide Fathom or
  Zoom credential; never add one. That is why Meetings has no module gate.
- `crm_meeting` rows are inserted only by the service-role importer, stamped with the importing
  connection's org_id. Staff change only the link columns. Transcripts are stored (privileged,
  org-scoped like consult notes).
- Meeting reads are three-state (ok / unavailable / none): a failed read is never "no meetings".
- "Draft follow-up" goes to the approval queue only (agents module + queue required). Never send.
- Tests never call Fathom or Zoom. Unset `ZOOM_OAUTH_*` means Zoom is "not set up"; Fathom still works.

## Consult details (filing basis per mark) — Aug 29 SOP §2.2
- Stored in `crm_consult_note.notes.consult_details` (jsonb, beside lectual's own keys; no schema change,
  no module gate: it is the firm's own rows). `src/lib/consult/` owns the rules; `classes`/`class_count`
  stay lectual's.
- It records what was SAID: per mark, word/design, classes with goods/services, filing basis
  `1a` / `1b` / `unknown`, first-use date if stated; plus package and discount as noted. A basis the model
  gives with no evidence is stored as `unknown`. `unknown` is shown and stored as unknown, never guessed or carried.
- Filled by the post-consult drafter and Meetings "Draft follow-up" (same call as the email, never put in
  the email). Saving it never blocks or repeats the queued draft, and never overwrites existing details.
  A meeting's details go on a note of the app's own (keyed to the meeting), never on lectual's note for the
  same recording: claiming that one would get the call drafted twice.
- A 1a/1b is kept only when the model quotes words that really are in what it was given (`sourceText`, the prompt);
  a paraphrase or invention is stored as `unknown`. Class numbers and first-use dates not found there are dropped too.
- Nothing is relied on until a person reviews it on the lead page (stamped with who and when). Saves are
  conditional on `rev`: a stale form is refused. Only REVIEWED details carry onto a matter, when it opens by
  signed quote or the hired stage, only onto a TM matter, only when the NEWEST consult details are the reviewed ones
  (a newer unreviewed or unreadable record blocks the carry), and only for the mark being filed; several marks with none chosen, or a
  mismatched mark, carry nothing, and the `matter_opened` timeline row says what was or wasn't carried.
- Reads are three-state: details / none / couldn't be loaded. Unreadable saved details are reported, not hidden.

## JSX text spacing: keep the `{" "}`
Next 16.2.7's compiler DROPS the leading space of JSX text that contains an HTML entity
(`&apos;`, `&amp;`, `&rsquo;`…) and runs onto another line, even if that is only the line
break before the closing tag: `{email} is signed in, but isn&apos;t…` rendered as
"…gmail.comis signed in", and Today's "couldn't be read" warning lost its space the same
way. An explicit `{" "}` survives,
so never "tidy" one away. The `lectual/no-glued-jsx-text` lint rule (`eslint-rules/`) catches
this and plain-JSX line-break glue (`{name}↵word`); `pnpm lint --fix` writes the `{" "}`.

## Commands
`pnpm build` · `pnpm lint` · `pnpm test`. Env: copy `.env.example` to `.env.local` and fill it in
from lectual-dev.
