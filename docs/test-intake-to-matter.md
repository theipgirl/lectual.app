# Test script: firm onboarding, then a client from intake to matter

Runs against lectual-dev on this branch's preview:
https://lectual-app-git-claude-lectual-mvp-email-oauth-bklroa-theipgirl.vercel.app

Previews sit behind Vercel Authentication, so open the public links (intake form,
proposal) in a browser that is signed in to Vercel.

## Setup (once)
- Preview env (this branch only): `SUPABASE_SERVICE_ROLE_KEY` (lectual-dev), `SITE_URL`,
  `INTAKE_EVENT_SALT`, `MAILBOX_TOKEN_KEY`, `CRON_SECRET`, `LAWPAY_MODE=test`.
  New variables only reach a NEW preview deployment: push to the branch, or redeploy a
  deployment of this branch. Never redeploy or promote a production deployment for this.
- Supabase lectual-dev → Authentication → URL Configuration lists the preview URL + `/**`.
- A test firm on dev: in `lectual`, `pnpm provision:tenant --name "Test Firm" --slug test-firm --owner <email>`.

## 1. The firm onboards
1. Sign in at `/sign-in` with the owner's email (magic link). You land on Today.
2. Settings → Firm profile: display name, time zone, sign-off.
3. Settings → Team & roles: invite a second member (optional).
4. Settings → Services: add at least one flat-fee service.
5. Intake → Forms: set up and publish the intake form; copy its public link.

## 2. A client, from intake to matter
6. Submit the public intake form (`/i/<slug>`) as the client. A lead appears in Intake.
7. Open the lead; move it through stages; add a note.
8. Quotes & proposals → New quote, linked to that lead. Pick a package; publish; copy
   the client link. The quote must be linked to the lead, or no matter opens on signing.
9. Open `/q/<token>` as the client; sign.
10. The matter opens automatically: check its type, the package taken, the first docket stage.
11. On the quote, Record a payment (manual, operating). Card payment is off until LawPay
    issues the partner app (docs/lawpay-setup.md).
12. On the matter, send intake questions; answer them at `/r/<token>` as the client.

## Not in this test
Gmail/Outlook and LawPay connections (need provider OAuth apps), the approval queue
(`DASHBOARD_API_TOKEN` unset on previews), client portals, SMS, firm self-signup.
