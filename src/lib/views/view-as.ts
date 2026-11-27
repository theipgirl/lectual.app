import "server-only";
import { loadFirmSessionCore, resolveFirmSession, type FirmSession } from "@/lib/firm/session";
import { listMemberDirectory } from "@/lib/members/directory";
import { getProposalSettings, isCurrentUserApprover } from "@/lib/proposals/store";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveQueueRole } from "@/lib/queue/roles";
import { listConnections } from "@/lib/mailbox/connections";
import { hasRole, type Role } from "@/lib/auth/roles";
import { perRequest } from "@/lib/views/request-memo";
import { readPreviewState } from "@/lib/views/view-as-flag";
import { PREVIEW_OFF, viewerOf, type PreviewState, type ViewerIdentity } from "@/lib/views/view-as-rules";

/**
 * "Whose view" vs "whose session" (spec "The seam"). The session stays the signed-in owner's: RLS, writes and the log are
 * theirs. The VIEWER is the teammate while previewing, else the signed-in person. Memoized per request.
 *
 * LAYOUTS, PAGES AND SERVER COMPONENTS ONLY. No server action and no route handler may import this module
 * (tests/views/view-as-no-viewer-in-actions.test.ts): actions keep deciding with the session, and in a preview they are
 * refused before deciding anything.
 */
export type ResolvedViewer = {
  session: Extract<FirmSession, { kind: "ok" }>;
  viewAs: null | { targetUserId: string; targetRole: Role; targetName: string; startedAt: string };
  viewer: ViewerIdentity;
  /** off = no preview (or not set up); on = previewing (writes refused); unknown = couldn't check (writes refused). */
  previewState: "off" | "on" | "unknown";
  /** A preview is on but the teammate's row couldn't be read from the team list: the owner's own view is drawn. */
  teamUnreadable: boolean;
  /** View as can be offered at all on this database (0117 and 0116's guard are on). */
  viewAsAvailable: boolean;
};

export function resolveViewer(): Promise<ResolvedViewer | null> {
  return perRequest("view-as-viewer", readViewer);
}

async function readViewer(): Promise<ResolvedViewer | null> {
  const core = await loadFirmSessionCore();
  if (core.kind !== "ok") return null;
  const self: ViewerIdentity = { userId: core.user.id, role: core.role, displayName: core.displayName };
  const state: PreviewState = await readPreviewState().catch(() => PREVIEW_OFF);
  const viewAsAvailable = state.kind !== "not-set-up";
  if (state.kind === "unknown") {
    return { session: core, viewAs: null, viewer: self, previewState: "unknown", teamUnreadable: false, viewAsAvailable };
  }
  if (state.kind !== "on") {
    return { session: core, viewAs: null, viewer: self, previewState: "off", teamUnreadable: false, viewAsAvailable };
  }
  let target: ViewerIdentity | null = null;
  let teamUnreadable = false;
  try {
    const members = await listMemberDirectory();
    const row = members.find((m) => m.userId === state.targetUserId);
    if (row) target = { userId: row.userId, role: row.role, displayName: row.displayName ?? row.email ?? "Teammate" };
  } catch {
    teamUnreadable = true;
  }
  const { viewAs, viewer } = viewerOf({ self, state, target });
  return { session: core, viewAs, viewer, previewState: "on", teamUnreadable, viewAsAvailable };
}

/** The teammate being previewed (their id, role and name), or null: outside a preview every twin below IS its session helper. */
async function previewViewer(): Promise<ViewerIdentity | null> {
  const v = await resolveViewer().catch(() => null);
  return v?.viewAs ? v.viewer : null;
}

/** The viewer's role, for what is DRAWN. Outside a preview: exactly `currentRole()`. Null = unreadable (satisfies nothing). */
export async function viewerRole(): Promise<Role | null> {
  const p = await previewViewer();
  return p ? p.role : currentRole();
}

/** `resolveQueueRole`'s twin for drawing: the viewer's role when it is in `allowed`, else null. Outside a preview it IS resolveQueueRole. */
export async function viewerQueueRole(allowed: Role[]): Promise<Role | null> {
  const p = await previewViewer();
  if (p) return allowed.includes(p.role) ? p.role : null;
  return resolveQueueRole(await getScopedClient(), allowed);
}

/** `callerHasRole`'s twin for drawing: the viewer ranks at or above `required`. */
export async function viewerHasRole(required: Role): Promise<boolean> {
  const role = await viewerRole();
  return role !== null && hasRole(role, required);
}

/** `isCurrentUserApprover`'s twin for drawing: the viewer's id in `client_proposal_setting.approver_user_ids`. */
export async function isViewerApprover(): Promise<boolean> {
  const p = await previewViewer();
  if (!p) return isCurrentUserApprover();
  try {
    const setting = await getProposalSettings();
    return !!setting && setting.approver_user_ids.includes(p.userId);
  } catch {
    return false;
  }
}

/** True while previewing (or unchecked): the places that must show a fixed sentence ask this. */
export async function inPreview(): Promise<boolean> {
  const v = await resolveViewer().catch(() => null);
  return Boolean(v && v.previewState !== "off");
}

/**
 * resolveFirmSession() as the VIEWER sees it, for pages and server components that decide what to draw from a session's
 * role and user id ("Mine", "yours", page gates). Outside a preview it is resolveFirmSession() unchanged. While previewing,
 * `role`, `displayName`, `member` and `user.id` are the teammate's; the teammate's own account settings
 * (`user_metadata`) and email are not readable, so they are empty. Reads still run as the signed-in owner (RLS), and
 * nothing here can write: every action refuses in a preview.
 */
export async function resolveViewSession(opts?: { signInNext?: string }): Promise<FirmSession> {
  const s = await resolveFirmSession(opts);
  if (s.kind !== "ok") return s;
  const v = await resolveViewer().catch(() => null);
  if (!v || !v.viewAs) return s;
  return {
    ...s,
    role: v.viewer.role,
    displayName: v.viewer.displayName,
    member: { role: v.viewer.role, org_id: s.org.id },
    actingAsStaff: false,
    isPlatformAdmin: false,
    switchableFirms: [],
    user: { ...s.user, id: v.viewer.userId, email: undefined, user_metadata: {} },
  };
}

/** The teammate being previewed, or null. Private places (bell, notifications, Copilot, own mail and Outlook) ask this. */
export async function previewingAs(): Promise<{ userId: string; name: string } | null> {
  const v = await resolveViewer().catch(() => null);
  return v?.viewAs ? { userId: v.viewAs.targetUserId, name: v.viewAs.targetName } : null;
}

/**
 * Layer d (provider reads that may refresh a token): null outside a preview; otherwise skip every provider read. Keyed on
 * the FLAG (on, or couldn't be checked), not on whether a teammate could be named: a token must never be refreshed while
 * the state is unknown or the teammate is unreadable. `sharedOnly` when a teammate is shown (their view has no personal
 * connection of the owner's).
 */
export async function consultPreview(): Promise<{ name: string | null; sharedOnly: boolean } | null> {
  const v = await resolveViewer().catch(() => null);
  if (!v || v.previewState === "off") return null;
  return { name: v.viewAs?.targetName ?? null, sharedOnly: Boolean(v.viewAs) };
}

/**
 * The mailbox connections to DRAW: `listConnections()` (the caller's own personal ones plus the firm's), except while
 * View as's flag is on or couldn't be checked, when only the firm's SHARED mailboxes are listed: the owner's personal
 * mailboxes are never shown in a teammate's view (D2). `hidPersonal` says personal rows were left out.
 */
export async function listConnectionsForViewer(): Promise<Awaited<ReturnType<typeof listConnections>> & { hidPersonal?: boolean }> {
  const [res, preview] = await Promise.all([listConnections(), inPreview()]);
  if (!preview || !res.ok) return res;
  return { ...res, connections: res.connections.filter((c) => c.scope === "firm"), hidPersonal: true };
}
