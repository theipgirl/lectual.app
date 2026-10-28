import type { AcceptedSnapshot } from "./types";

/**
 * Staff-facing view of what the client added on `/p/<token>` (Sprint 28 B). Read from the accepted snapshot only:
 * the classes carry `client_added`, and their label is the client's own plain-text description. Staff pages may
 * show that text (React text, never HTML); notes, notices, the timeline and logs never do.
 */
export type ClientAddedClass = { brand: string; description: string };

export function clientAddedClasses(snapshot: AcceptedSnapshot | null | undefined): ClientAddedClass[] {
  const names = Array.isArray(snapshot?.content?.names) ? snapshot.content.names : [];
  const out: ClientAddedClass[] = [];
  for (const nm of names) {
    for (const c of Array.isArray(nm?.classes) ? nm.classes : []) {
      if (c?.client_added === true && snapshot?.selection?.[c.id] === true) out.push({ brand: String(nm.name ?? ""), description: String(c.label ?? "") });
    }
  }
  return out;
}

/** "adding 2 classes", or "" when the client added none. */
export function addedClassesPhrase(added: readonly ClientAddedClass[]): string {
  return added.length === 0 ? "" : `adding ${added.length} ${added.length === 1 ? "class" : "classes"}`;
}
