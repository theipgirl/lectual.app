import type { LibraryItem } from "@/lib/intake-forms/packages";

/**
 * What the setup checklist is computed from: one reading per fact, each either
 * "could not be read" or the facts for that item. A failed read is its own
 * value, never an empty list, so it can never be mistaken for "nothing there".
 */
export type Reading<T> = { ok: true; value: T } | { ok: false };

export type SetupState = {
  /** `null` = the firm has no profile row yet. */
  profile: Reading<{ displayName: string | null; emailSignature: string | null } | null>;
  /** How many people are in the member directory. */
  members: Reading<{ count: number }>;
  /** The firm's module list. Unreadable is NOT "no modules". */
  modules: Reading<string[]>;
  /** The mailbox connections the caller can see (RLS: their own plus the firm's shared ones). */
  mailboxes: Reading<{ provider: string; status: string }[]>;
  /** `null` = no connection. */
  lawmatics: Reading<{ status: string } | null>;
  meetings: Reading<{ provider: string; status: string }[]>;
  lawpay: Reading<{ status: string } | null>;
  /** The firm's agent setting rows. No row means the agent is off. */
  agents: Reading<{ enabled: boolean }[]>;
  intakeForms: Reading<{ status: string }[]>;
  /** The service library items; "packages saved" counts the ones the intake form would offer. */
  services: Reading<Pick<LibraryItem, "active" | "kind">[]>;
  /** A deployment fact (the AI key is set or it is not); reading it cannot fail. */
  aiConfigured: boolean;
};

export type SetupItemId =
  | "profile"
  | "team"
  | "outlook"
  | "lawmatics"
  | "meetings"
  | "lawpay"
  | "agents"
  | "intake"
  | "packages"
  | "ai";

export type SetupItemStatus = "done" | "to-do" | "couldnt-check";

export type SetupItem = {
  id: SetupItemId;
  label: string;
  status: SetupItemStatus;
  /** One line: why it matters, or why it is not done, or why it could not be checked. */
  why: string;
  /** Where "Set up" goes. Always an existing route. */
  href: string;
};

export type SetupChecklist = {
  items: SetupItem[];
  doneCount: number;
  /** Always 10. */
  total: number;
  /** True only when every one of the ten items is `done`. */
  complete: boolean;
};
