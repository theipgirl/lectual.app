/**
 * Where a validation issue belongs on the editor.
 *
 * `validateContent` reports paths like `names[1].marks[0].desc`. The editor
 * has one form per section, so each issue is shown inside the form that can fix
 * it, in words ("Prosperall, mark 1, description"), not as a path.
 */

import type { ProposalContent } from "@/lib/proposals/types";
import type { ValidationIssue } from "@/lib/proposals/validate";

export type IssueGroups = {
  /** Not attached to one form (no brand name, content unreadable). */
  general: ValidationIssue[];
  details: ValidationIssue[];
  message: ValidationIssue[];
  pricing: ValidationIssue[];
  /** Keyed by the brand name's INDEX in `content.names`. */
  names: Map<number, ValidationIssue[]>;
  adjustments: ValidationIssue[];
  includes: ValidationIssue[];
};

export function groupIssues(issues: readonly ValidationIssue[]): IssueGroups {
  const g: IssueGroups = { general: [], details: [], message: [], pricing: [], names: new Map(), adjustments: [], includes: [] };
  for (const issue of issues) {
    const p = issue.path;
    const nameIndex = /^names\[(\d+)\]/.exec(p);
    if (nameIndex) {
      const i = Number(nameIndex[1]);
      g.names.set(i, [...(g.names.get(i) ?? []), issue]);
    } else if (/^(title|client_email|expires_on|pay_url|client)(\.|$)/.test(p)) g.details.push(issue);
    else if (/^(greeting|recommendation|office_action_note)$/.test(p)) g.message.push(issue);
    else if (/^pricing(\.|$)/.test(p)) g.pricing.push(issue);
    else if (/^adjustments(\[|$)/.test(p)) g.adjustments.push(issue);
    else if (/^includes(\[|$)/.test(p)) g.includes.push(issue);
    else g.general.push(issue);
  }
  return g;
}

const FIELD_WORDS: Record<string, string> = {
  desc: "description",
  label: "label",
  id: "id",
  kind: "type",
  preselected: "starts ticked",
  name: "name",
  what: "what it is",
  note: "note",
  value: "value",
  included: "included",
  base_cents: "base price",
  per_class_cents: "price per class",
  full_name: "full name",
  first_name: "first name",
  company: "company",
};

/** "names[1].marks[0].desc" -> "Prosperall, mark 1, description". */
export function describeIssuePath(path: string, content: ProposalContent | null): string {
  const parts: string[] = [];
  const re = /([A-Za-z_]+)(?:\[(\d+)\])?/g;
  let name: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const [, key, idx] = m;
    const n = idx === undefined ? null : Number(idx);
    if (key === "names" && n !== null) {
      name = content?.names?.[n]?.name?.trim() || `Brand name ${n + 1}`;
      parts.push(name);
    } else if (key === "marks" && n !== null) parts.push(`mark ${n + 1}`);
    else if (key === "classes" && n !== null) parts.push(`class ${n + 1}`);
    else if (key === "adjustments" && n !== null) parts.push(`adjustment ${n + 1}`);
    else if (key === "includes" && n !== null) parts.push(`included row ${n + 1}`);
    else if (key === "pricing") parts.push("package prices");
    else if (key === "price_override") parts.push("this brand’s price");
    else if (key === "client_email") parts.push("client email");
    else if (key === "expires_on") parts.push("expiry date");
    else if (key === "pay_url") parts.push("pay link");
    else if (key === "office_action_note") parts.push("office action note");
    else if (key === "client") parts.push("client");
    else parts.push(FIELD_WORDS[key] ?? key.replace(/_/g, " "));
  }
  return parts.join(", ");
}

/**
 * The first problem a person should look at: errors before warnings, and within each in the order
 * the sections are drawn (who, general, each brand name, package, then the More options sections).
 * Returns the very issue object, so the page can mark exactly that one with the "first problem" anchor.
 */
export function firstProblem(groups: IssueGroups): ValidationIssue | null {
  const names = [...groups.names.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, list]) => list);
  const inPageOrder = [...groups.details, ...groups.general, ...names, ...groups.pricing, ...groups.message, ...groups.adjustments, ...groups.includes];
  return inPageOrder.find((i) => i.level === "error") ?? inPageOrder[0] ?? null;
}

/** The id the first problem's list item carries, and the "Go to first problem" link points at. */
export const FIRST_PROBLEM_ID = "pe-first-problem";
