"use server";

// Ported from lectual src/app/(firm)/dashboard/settings/actions.ts (member
// actions only). The guards — admin gate, no self-change, rank ceilings,
// never leave the firm ownerless — all live in @/lib/settings and RLS.
// Changed: errors go through friendlySettingsError so database text never
// reaches the screen.

import { revalidatePath } from "next/cache";
import { inviteMember, removeMember, setMemberRole } from "@/lib/settings";
import { ROLES, type Role } from "@/lib/auth/roles";
import { friendlySettingsError } from "./errors";

export type MemberActionState = { error?: string; notice?: string; warning?: string };

const PATH = "/dashboard/settings/team/";

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export async function setMemberRoleAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const userId = String(formData.get("userId") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!userId) return { error: "Missing member." };
  if (!isRole(roleRaw)) return { error: "Choose a valid role." };
  try {
    await setMemberRole(userId, roleRaw);
  } catch (err) {
    return { error: friendlySettingsError(err, "Couldn't update this member's role.") };
  }
  revalidatePath(PATH);
  return { notice: "Role updated." };
}

export async function inviteMemberAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const email = String(formData.get("email") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!email.trim()) return { error: "Enter an email address." };
  if (!isRole(roleRaw)) return { error: "Choose a valid role." };

  let notice: string;
  try {
    const result = await inviteMember(email, roleRaw);
    notice =
      result.outcome === "already_member"
        ? `${result.email} is already on your team (${result.role}). Nothing changed.`
        : result.outcome === "added_existing_user"
          ? `${result.email} already had a Lectual account and was added as ${result.role}.`
          : `Invite sent to ${result.email} as ${result.role}.`;
  } catch (err) {
    return { error: friendlySettingsError(err, "Couldn't invite this person.") };
  }
  revalidatePath(PATH);
  return { notice };
}

export async function removeMemberAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Missing member." };
  let warning: string | undefined;
  try {
    warning = (await removeMember(userId)).warning;
  } catch (err) {
    return { error: friendlySettingsError(err, "Couldn't remove this member.") };
  }
  revalidatePath(PATH);
  return warning ? { warning } : { notice: "Removed and signed out." };
}
