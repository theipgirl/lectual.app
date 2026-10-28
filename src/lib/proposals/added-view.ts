import type { AcceptedSnapshot } from "./types";

/**
 * Staff-facing view of what the client wrote on `/p/<token>` (Sprint 28 B, Spec 3). Read from the accepted snapshot
 * only: an ADDED class carries `client_added` and an OPEN class `client_entry`, and in the snapshot the label of
 * both is the client's own plain-text description (cleaned by `client-classes.ts`). Staff pages show that text as
 * React text, never HTML, and label it as written by the client.
 */
export type ClientAddedClass = { brand: string; description: string };
export type ClientDescribedClass = { brand: string; prompt: string; description: string };

function namesOf(snapshot: AcceptedSnapshot | null | undefined) {
  return Array.isArray(snapshot?.content?.names) ? snapshot.content.names : [];
}

export function clientAddedClasses(snapshot: AcceptedSnapshot | null | undefined): ClientAddedClass[] {
  const out: ClientAddedClass[] = [];
  for (const nm of namesOf(snapshot)) {
    for (const c of Array.isArray(nm?.classes) ? nm.classes : []) {
      if (c?.client_added === true && snapshot?.selection?.[c.id] === true) out.push({ brand: String(nm.name ?? ""), description: String(c.label ?? "") });
    }
  }
  return out;
}

/** Ticked open classes the client described: the firm's question and the client's answer. */
export function clientDescribedClasses(snapshot: AcceptedSnapshot | null | undefined): ClientDescribedClass[] {
  const out: ClientDescribedClass[] = [];
  for (const nm of namesOf(snapshot)) {
    for (const c of Array.isArray(nm?.classes) ? nm.classes : []) {
      const description = String(c?.label ?? "").trim();
      if (c?.client_entry === true && c.client_added !== true && snapshot?.selection?.[c.id] === true && description) {
        out.push({ brand: String(nm.name ?? ""), prompt: String(c.prompt ?? ""), description });
      }
    }
  }
  return out;
}

/** "adding 2 classes", or "" when the client added none. */
export function addedClassesPhrase(added: readonly ClientAddedClass[]): string {
  return added.length === 0 ? "" : `adding ${added.length} ${added.length === 1 ? "class" : "classes"}`;
}
