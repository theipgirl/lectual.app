import type { Reading, SetupState } from "@/lib/setup/types";

export const ok = <T,>(value: T): Reading<T> => ({ ok: true, value });
export const bad = { ok: false } as const;

/** Every item short of done (modules on, AI key unset): the baseline each "only this item is done" test starts from. */
export const NOTHING_DONE: SetupState = {
  profile: ok(null),
  members: ok({ count: 1 }),
  modules: ok(["mailbox", "agents"]),
  mailboxes: ok([]),
  lawmatics: ok(null),
  meetings: ok([]),
  lawpay: ok(null),
  agents: ok([]),
  intakeForms: ok([]),
  services: ok([]),
  aiConfigured: false,
  lectual: { lawpayApp: true, zoomApp: true },
};

/** All ten done. */
export const ALL_DONE: SetupState = {
  profile: ok({ displayName: "Hartwell IP", emailSignature: "Best,\nHartwell IP" }),
  members: ok({ count: 3 }),
  modules: ok(["mailbox", "agents"]),
  mailboxes: ok([{ provider: "microsoft", status: "active" }]),
  lawmatics: ok({ status: "active" }),
  meetings: ok([{ provider: "fathom", status: "active" }]),
  lawpay: ok({ status: "active" }),
  agents: ok([{ enabled: true }]),
  intakeForms: ok([{ status: "live" }]),
  services: ok([{ active: true, kind: "legal_fee" }]),
  aiConfigured: true,
  lectual: { lawpayApp: true, zoomApp: true },
};

export const ITEM_IDS = ["profile", "team", "outlook", "lawmatics", "meetings", "lawpay", "agents", "intake", "packages", "ai"] as const;

/** The state keys each item reads, so a test can say which items an unreadable key must take down. */
export const READS_OF: Record<(typeof ITEM_IDS)[number], (keyof SetupState)[]> = {
  profile: ["profile"],
  team: ["members"],
  outlook: ["modules", "mailboxes"],
  lawmatics: ["lawmatics"],
  meetings: ["meetings"],
  lawpay: ["lawpay"],
  agents: ["modules", "agents"],
  intake: ["intakeForms"],
  packages: ["services"],
  ai: [],
};

export const ROLE_NAMES = ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "social_media", "clerk", "viewer"] as const;
export const ADMIN_TIER = ["owner", "admin", "senior_admin"] as const;
export const OTHER_ROLES = ROLE_NAMES.filter((r) => !(ADMIN_TIER as readonly string[]).includes(r));
