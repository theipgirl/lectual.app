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
- Each firm signs in to ITS OWN LawPay account (lectual 0076 `lawpay_connection`). There is no
  deployment-wide LawPay key; never add one. Charges use the firm's own account secret, looked up
  by the quote's org_id. Sealed columns have no SELECT grant: name the columns.
- The charged amount comes ONLY from the signed snapshot (`signingChargeForQuote`), to the mapped
  OPERATING account. The account kind is never defaulted or inferred. The pending `crm_payment` row is
  written before LawPay is called; 0076's index allows one open signing charge per quote.
- Only a 401/403 on the firm's key pauses the firm's card payments (`reauth`). A refusal of one request
  never does: the payment token in it came from an anonymous visitor. A quote allows 5 failed card
  attempts, then the form is withdrawn (the link has no login and no rate limiter).
- Trust flag and mode are checked against the SEALED gateway credentials at charge time. The readable
  `accounts` column is admin-writable through the API, so it is never the last word on trust vs operating.
- Payment-state reads are five-state (received / confirming / payable / manual / unavailable). A failed
  read is never "unpaid".
- Tests never call LawPay. Unset `LAWPAY_OAUTH_*` means "not configured", and manual recording keeps working.

## Commands
`pnpm build` · `pnpm lint` · `pnpm test`. Env: copy `.env.example` to `.env.local` and fill it in
from lectual-dev.
