import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listMemberDirectory } from "@/lib/members/directory";
import { getQueueItem } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { activeOrgModulesOrNull } from "@/lib/org/modules";
import { PREP_SOURCE } from "@/lib/agents/consult-prep/constants";
import { env } from "@/lib/env";
import { PREP_BRIEF_KIND, PREP_SEND_SOURCE } from "./keys";
import { consultPrepCardView, type CardView, type PrepMarker, type Read3, type RecipientsView } from "./card";
import { loadConsultPrepSetting } from "./recipients-store";
import { parseSendRecord, type SendRecord } from "./sends";

/**
 * The reads behind the lead page's Consult prep card. Everything goes through the signed-in caller's scoped client (RLS on
 * the firm); the queue goes through the existing reader. Every source is three-state and none of them throws.
 */

export type ConsultPrepBrief =
  | { status: "none" }
  | { status: "ok"; text: string }
  | { status: "not-kept" }
  | { status: "missing" }
  | { status: "unavailable" };

export type ConsultPrepCardData = { view: CardView; brief: ConsultPrepBrief };

const LEGACY_KIND = "heads_up";

async function readMarkers(leadIds: readonly string[]): Promise<Read3<PrepMarker[]>> {
  try {
    const db = await getScopedClient();
    const { data, error } = await db
      .from("crm_activity")
      .select("created_at, payload")
      .eq("type", "queue_drafted")
      .eq("payload->>source", PREP_SOURCE)
      .in("payload->>kind", [PREP_BRIEF_KIND, LEGACY_KIND])
      .in("lead_id", [...leadIds])
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { status: "unavailable" };
    const value = ((data ?? []) as Array<{ created_at: string; payload: Record<string, unknown> | null }>).map((r) => ({
      prepKey: typeof r.payload?.prep_key === "string" ? r.payload.prep_key : null,
      queueItemId: typeof r.payload?.queueItemId === "string" ? r.payload.queueItemId : null,
      at: r.created_at,
    }));
    return { status: "ok", value };
  } catch {
    return { status: "unavailable" };
  }
}

async function readSends(leadIds: readonly string[]): Promise<Read3<SendRecord[]>> {
  try {
    const db = await getScopedClient();
    const { data, error } = await db
      .from("crm_activity")
      .select("lead_id, created_at, payload")
      .eq("type", "ai_insight")
      .eq("payload->>source", PREP_SEND_SOURCE)
      .in("lead_id", [...leadIds])
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return { status: "unavailable" };
    return { status: "ok", value: ((data ?? []) as Array<{ lead_id: string | null; created_at: string; payload: unknown }>).map(parseSendRecord).filter((r): r is SendRecord => r !== null) };
  } catch {
    return { status: "unavailable" };
  }
}

async function readRecipients(): Promise<Read3<RecipientsView>> {
  const setting = await loadConsultPrepSetting();
  if (setting.status !== "ok") return { status: "unavailable" };
  try {
    const members = await listMemberDirectory();
    const names = setting.userIds.map((id) => members.find((m) => m.userId === id)).filter((m): m is NonNullable<typeof m> => !!m).map((m) => m.displayName ?? m.email ?? "A teammate");
    return { status: "ok", value: { names, cc: setting.cc } };
  } catch {
    return { status: "unavailable" };
  }
}

/** Only the tier that manages the settings can tell "off" from "can't see it" (the same rule the lead step engine uses). */
async function readSetting(adminTier: boolean): Promise<"on" | "off" | "unknown"> {
  try {
    const db = await getScopedClient();
    const { data, error } = await db.from("agent_setting").select("enabled").eq("agent", "consult-prep").maybeSingle();
    if (error) return "unknown";
    if (data) return data.enabled ? "on" : "off";
    return adminTier ? "off" : "unknown";
  } catch {
    return "unknown";
  }
}

async function readBrief(queueItemId: string | null): Promise<ConsultPrepBrief> {
  if (!queueItemId) return { status: "none" };
  try {
    const orgKey = await activeQueueOrgKey();
    if (!orgKey) return { status: "not-kept" };
    const item = await getQueueItem(orgKey, queueItemId);
    const text = (item.final_body ?? item.draft_body ?? "").trim();
    return text ? { status: "ok", text } : { status: "missing" };
  } catch (err) {
    // The queue answers 404 for an item that is gone; anything else is "couldn't load" (the message is never shown).
    return err instanceof Error && /\b404\b/.test(err.message) ? { status: "missing" } : { status: "unavailable" };
  }
}

const UNAVAILABLE = (args: { adminTier: boolean; tz: string }): ConsultPrepCardData => ({
  view: consultPrepCardView({ agents: "unreadable", setting: "unknown", markers: { status: "unavailable" }, sends: { status: "unavailable" }, recipients: { status: "unavailable" }, emailOn: false, adminTier: args.adminTier, tz: args.tz }),
  brief: { status: "none" },
});

/** Never throws: anything that goes wrong is the card's own "couldn't load". */
export async function loadConsultPrepCard(args: { leadIds: readonly string[]; adminTier: boolean; tz: string }): Promise<ConsultPrepCardData> {
  try {
    const modules = await activeOrgModulesOrNull();
    const agents = modules === null ? "unreadable" : modules.includes("agents") ? "on" : "off";
    if (agents !== "on") return { view: consultPrepCardView({ agents, setting: "unknown", markers: { status: "unavailable" }, sends: { status: "unavailable" }, recipients: { status: "unavailable" }, emailOn: false, adminTier: args.adminTier, tz: args.tz }), brief: { status: "none" } };
    const [markers, sends, recipients, setting] = await Promise.all([readMarkers(args.leadIds), readSends(args.leadIds), readRecipients(), readSetting(args.adminTier)]);
    const view = consultPrepCardView({
      agents,
      setting,
      markers,
      sends,
      recipients,
      emailOn: Boolean(env.RESEND_API_KEY?.trim() && env.CONSULT_PREP_FROM?.trim()),
      adminTier: args.adminTier,
      tz: args.tz,
    });
    const brief = view.kind === "prepared" ? await readBrief(view.queueItemId) : ({ status: "none" } as const);
    return { view, brief };
  } catch {
    return UNAVAILABLE(args);
  }
}
