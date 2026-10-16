"use server";

import { refresh } from "next/cache";
import { callerHasRole } from "@/lib/auth/current-role";
import { mapLawPayAccount, unmapLawPayAccount } from "@/lib/payments/accounts";
import { lawPayClientCredentials, lawPaySetup } from "@/lib/payments/lawpay-config";
import { disconnectLawPay, refreshLawPayAccounts } from "@/lib/payments/lawpay-connection";

/**
 * Settings → Integrations → LawPay. Every function is its own POST entry point
 * that never renders the page, so each re-checks owner/admin/senior_admin
 * FIRST (AGENTS.md: gate the page AND the action). RLS on lawpay_connection and
 * crm_org_payment_account (admin tier, own org) is the boundary underneath.
 */

export type LawPayActionState = { ok?: boolean; error?: string; message?: string };

const FORBIDDEN: LawPayActionState = { error: "Only owners and admins can manage LawPay." };

export async function mapAccountAction(_prev: LawPayActionState, formData: FormData): Promise<LawPayActionState> {
  if (!(await callerHasRole("senior_admin"))) return FORBIDDEN;
  const result = await mapLawPayAccount({
    // Explicit: the form names its role; there is no default.
    kind: formData.get("kind"),
    accountId: formData.get("account_id"),
    confirmed: formData.get("confirm"),
  });
  if (!result.ok) return { error: result.reason };
  refresh();
  return { ok: true, message: "Saved." };
}

export async function unmapAccountAction(_prev: LawPayActionState, formData: FormData): Promise<LawPayActionState> {
  if (!(await callerHasRole("senior_admin"))) return FORBIDDEN;
  const result = await unmapLawPayAccount(formData.get("kind"));
  if (!result.ok) return { error: result.reason };
  refresh();
  return { ok: true };
}

export async function refreshAccountsAction(): Promise<LawPayActionState> {
  if (!(await callerHasRole("senior_admin"))) return FORBIDDEN;
  const setup = lawPaySetup();
  if (!setup.ready) return { error: "LawPay sign-in isn't set up on this deployment yet." };
  const result = await refreshLawPayAccounts({ root: setup.root, creds: setup.creds });
  refresh();
  if (!result.ok) return { error: result.reason };
  return {
    ok: true,
    message: result.unmapped.length
      ? `Accounts refreshed. LawPay no longer lists the ${result.unmapped.join(" and ")} account you had chosen — choose again.`
      : "Accounts refreshed.",
  };
}

export async function disconnectAction(): Promise<LawPayActionState> {
  if (!(await callerHasRole("senior_admin"))) return FORBIDDEN;
  const result = await disconnectLawPay({ creds: lawPayClientCredentials() });
  refresh();
  if (!result.ok) return { error: result.reason };
  return {
    ok: true,
    message: result.revokedAtLawPay
      ? "LawPay disconnected, and Lectual's access was revoked at LawPay."
      : "LawPay disconnected here. LawPay didn't confirm the revocation — you can also remove Lectual under Authorized Applications in LawPay.",
  };
}
