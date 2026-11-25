import "server-only";
import { env } from "@/lib/env";
import { createLawmaticsClient } from "@/lib/lawmatics/client";
import { firmToken } from "@/lib/intake-forms/lawmatics-sync";
import { cancelInternalMail, sendInternalMail } from "@/lib/mail/internal-mail";
import { canReceiveDeadlineAlerts } from "@/lib/today/deadline-alerts";
import type { AgentContext } from "@/lib/agents/types";
import { readFirmStyle } from "@/lib/agents/shared";
import type { PrepDeps } from "./engine";
import { buildFullPrep, readFirmForBrief, type FirmForBrief } from "./full";
import { prepFileStore } from "./save-files";

/**
 * Production wiring for a consult prep run. Tests hand the engine their own `PrepDeps`.
 *
 * Everything here is fenced on `ctx.orgId` (the firm the runner was started for): the Lawmatics token is THIS firm's
 * own (`firmToken`, never a deployment-wide one), the member lookup names the firm, and the sender and key are the
 * deployment's Resend settings (unset = email is not switched on).
 */
export function defaultPrepDeps(ctx: Pick<AgentContext, "admin" | "orgId" | "signal" | "fetchImpl"> & Partial<Pick<AgentContext, "llm" | "now" | "timeLeftMs">>): PrepDeps {
  const { admin, orgId } = ctx;
  // The firm's name, slug, zone and package list: read once per run, org-fenced, only when a full prep is built.
  let firm: Promise<FirmForBrief> | null = null;
  const firmOnce = () => (firm ??= readFirmStyle(admin, orgId).then((style) => readFirmForBrief(admin, orgId, style.timeZone)));
  return {
    // S2b: the full prep. The model call is the run's own (`ctx.llm`: Sonnet through agentModel, the cost total, the signal); the USPTO
    // and its images go through the run's fetch; the budget is the run's.
    // (A caller with no model call, such as cancelling a switched-off firm's sends, builds nothing.)
    ...(ctx.llm
      ? {
          full: async (facts: Parameters<NonNullable<PrepDeps["full"]>>[0]) =>
            buildFullPrep(facts, await firmOnce(), {
              llm: ctx.llm!,
              fetch: ctx.fetchImpl ?? fetch,
              timeLeftMs: () => (ctx.timeLeftMs ? ctx.timeLeftMs() : Number.POSITIVE_INFINITY),
              now: ctx.now ?? Date.now,
              signal: ctx.signal,
            }),
        }
      : {}),
    files: prepFileStore(admin, orgId),
    mail: { apiKey: env.RESEND_API_KEY?.trim() || null, from: env.CONSULT_PREP_FROM?.trim() || null },
    mailOut: (m) => sendInternalMail({ ...m, fetchImpl: ctx.fetchImpl, label: "consult-prep" }),
    mailCancel: (c) => cancelInternalMail({ ...c, fetchImpl: ctx.fetchImpl, label: "consult-prep" }),
    prospects: {
      client: async () => {
        const conn = await admin.from("lawmatics_connection").select("id").eq("org_id", orgId).eq("status", "active").maybeSingle();
        if (conn.error) return "unreadable";
        if (!conn.data) return null;
        const token = await firmToken(admin, orgId);
        if (!token) return "unreadable";
        return createLawmaticsClient({ token, signal: ctx.signal });
      },
    },
    memberAddresses: async (userIds) => {
      if (userIds.length === 0) return [];
      const { data, error } = await admin.from("crm_org_member").select("user_id, role").eq("org_id", orgId).in("user_id", [...userIds]);
      if (error) return null;
      const current = ((data ?? []) as Array<{ user_id: string; role: string }>).filter((m) => canReceiveDeadlineAlerts(m.role));
      const out: string[] = [];
      for (const m of current) {
        // `getUserById` does NOT throw on a failure: it answers `{ data: { user: null }, error }`. A lookup that failed, or a
        // current member the directory has no user for, is "couldn't read who gets this", never "no recipient".
        try {
          const res = await admin.auth.admin.getUserById(m.user_id);
          if (res.error || !res.data?.user) return null;
          const email = res.data.user.email;
          if (email) out.push(email);
        } catch {
          return null;
        }
      }
      return out;
    },
  };
}
