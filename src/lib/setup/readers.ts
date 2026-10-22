import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { aiConfigured } from "@/lib/ai/claude";
import { getOrgProfile } from "@/lib/org/profile";
import { listMemberDirectory } from "@/lib/members/directory";
import { listConnections } from "@/lib/mailbox/connections";
import { getLawmaticsConnection } from "@/lib/lawmatics/connection";
import { listMeetingConnections } from "@/lib/meetings/connection";
import { getLawPayConnection } from "@/lib/payments/lawpay-connection";
import { listIntakeForms } from "@/lib/intake-forms/store";
import { listServiceItems } from "@/lib/quotes/service-library";
import type { SetupReaders } from "./build";

/**
 * The live readers: the app's existing ones, plus the two small table reads
 * that had no reader of their own (the module list and the agent settings).
 * Everything goes through the caller's scoped client, so RLS answers for the
 * caller's active firm only. There is no service-role use here and no write.
 */
export const liveReaders: SetupReaders = {
  getOrgProfile,
  listMemberDirectory,
  async readModules() {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_org").select("modules").maybeSingle();
    // No visible org row is a failed read too, not a firm with no modules.
    if (error || !data) return { ok: false };
    return { ok: true, modules: data.modules ?? [] };
  },
  listConnections,
  getLawmaticsConnection,
  listMeetingConnections,
  getLawPayConnection,
  async readAgentSettings() {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("agent_setting").select("agent, enabled");
    if (error) return { ok: false };
    return { ok: true, rows: (data ?? []).map((r) => ({ enabled: r.enabled === true })) };
  },
  listIntakeForms,
  listServiceItems: () => listServiceItems(false),
  aiConfigured,
};
