import { ROLE_LABEL } from "@/lib/auth/roles";

/** The question asked before a role changes. Its own file: the Team form (a client component) imports it, and the role table's lists are server-side. */
export function roleChangeQuestion(name: string, from: string, to: string): string {
  return `Change ${name}'s role from ${ROLE_LABEL[from] ?? from} to ${ROLE_LABEL[to] ?? to}?`;
}
