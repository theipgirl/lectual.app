/** The shapes the Engagement letter settings page draws. Pure types and rules: no server imports. */

import type { LoeKindName } from "./kinds";

export type LetterStatus = "draft" | "approved" | "retired";

export type LetterVersion = {
  id: string;
  kind: LoeKindName;
  version: number;
  status: LetterStatus;
  title: string;
  body: string;
  updatedAt: string;
  approvedAt: string | null;
};

export type ApproverNames = { status: "ok"; names: string[] } | { status: "unreadable" };

export type LetterPageModel =
  | { status: "not-set-up" }
  | { status: "unavailable" }
  | {
      status: "ok";
      /** May write a draft (owner, admin, senior admin). */
      canEdit: boolean;
      /** Named approver, signed in, and a role that can write. */
      canApprove: boolean;
      approvers: ApproverNames;
      versions: LetterVersion[];
    };

/** The newest version first, per kind. */
export function versionsOfKind(versions: readonly LetterVersion[], kind: LoeKindName): LetterVersion[] {
  return versions.filter((v) => v.kind === kind).sort((a, b) => b.version - a.version);
}

export function draftOf(versions: readonly LetterVersion[]): LetterVersion | null {
  return versions.find((v) => v.status === "draft") ?? null;
}

export function approvedOf(versions: readonly LetterVersion[]): LetterVersion | null {
  return versions.find((v) => v.status === "approved") ?? null;
}
