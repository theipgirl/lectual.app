import { isUuid } from "./rules";
import type { CreateLeadCandidate } from "./types";

/**
 * Checks the person the browser sends back from "Not in Lectual yet". The preview built this
 * candidate, but a POST can carry anything, so every field is validated again before it can reach a
 * lead row. Pure: no I/O.
 */

const NAME_MAX = 120;
const BUSINESS_MAX = 200;
const EMAIL_MAX = 254;
const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"'.]+(\.[^\s@,;<>"'.]+)+$/;
const KEY = /^[A-Za-z0-9_-]{1,128}$/;

/** What the lead's source reads as: where the person was found. */
export const FOUND_LABEL: Record<CreateLeadCandidate["found"], string> = {
  sheet: "Found in the intake sheet",
  lawmatics: "Found in Lawmatics",
  mailbox: "Found in the mailbox",
};

function text(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const t = value.replace(/\s+/g, " ").trim();
  return t.length > max ? undefined : t || null;
}

export function parseCandidate(input: unknown): CreateLeadCandidate | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (r.found !== "sheet" && r.found !== "lawmatics" && r.found !== "mailbox") return null;

  const firstName = text(r.firstName, NAME_MAX);
  const lastName = text(r.lastName, NAME_MAX);
  const businessName = text(r.businessName, BUSINESS_MAX);
  const email = text(r.email, EMAIL_MAX);
  const practiceArea = text(r.practiceArea, NAME_MAX);
  if (firstName === undefined || lastName === undefined || businessName === undefined || email === undefined || practiceArea === undefined) return null;
  // A lead needs a name; the surname column is the one the pipeline sorts on.
  if (!firstName && !lastName) return null;
  if (email !== null && !EMAIL.test(email)) return null;

  const sheetKey = r.sheetKey === null || r.sheetKey === undefined ? null : typeof r.sheetKey === "string" && KEY.test(r.sheetKey) ? r.sheetKey : undefined;
  const lawmaticsId = r.lawmaticsId === null || r.lawmaticsId === undefined ? null : typeof r.lawmaticsId === "string" && KEY.test(r.lawmaticsId) ? r.lawmaticsId : undefined;
  if (sheetKey === undefined || lawmaticsId === undefined) return null;
  if (r.stageId !== null && r.stageId !== undefined && !isUuid(r.stageId)) return null;

  return {
    found: r.found,
    firstName: firstName ?? "",
    lastName: lastName ?? "",
    businessName,
    email: email ? email.toLowerCase() : null,
    sheetKey,
    lawmaticsId,
    stageId: (r.stageId as string | null | undefined) ?? null,
    practiceArea,
  };
}
