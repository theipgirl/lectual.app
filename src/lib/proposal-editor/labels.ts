import type { ProposalStatus } from "@/lib/proposals/types";
import { STATUS_WORDS } from "./vocabulary";

/** Pill wording per status (the words themselves live in vocabulary.ts). */
export const STATUS_LABEL: Record<ProposalStatus, string> = STATUS_WORDS;

/** `lx-pill-*` tone per status. Saved is "warn": its link is not live yet. */
export function statusTone(status: string): "ok" | "warn" | "risk" | "mute" {
  switch (status) {
    case "approved":
      return "warn";
    case "sent":
    case "accepted":
      return "ok";
    case "withdrawn":
      return "risk";
    default:
      return "mute";
  }
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as ProposalStatus] ?? status;
}

/** "Rebecca Bryant" -> "Rebecca"; an email -> its local part; blank -> null. */
export function firstNameOf(display: string | null | undefined): string | null {
  const v = (display ?? "").trim();
  if (!v) return null;
  const word = v.includes("@") ? v.split("@")[0] : v.split(/\s+/)[0];
  return word || null;
}

/** "Rebecca", "Rebecca or Taylor", "Rebecca, Taylor or Sam". */
export function joinOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
