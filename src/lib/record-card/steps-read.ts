import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { CardRead, CardTask } from "./model";

/**
 * The soonest OPEN next step for each lead or matter on a page (Sprint 10 Part 2), through the scoped client: no service
 * role, no write. One read per chunk of 80 ids (a longer `.in()` is a URL too long). Three-state: a failed chunk makes the
 * WHOLE read `unavailable`, so a row never says "No next step" over a read that failed. Never throws.
 */
const CHUNK = 80;

export async function loadOpenSteps(kind: "lead" | "matter", ids: readonly string[]): Promise<CardRead<Record<string, CardTask | null>>> {
  const out: Record<string, CardTask | null> = {};
  for (const id of ids) out[id] = null;
  if (ids.length === 0) return { status: "ok", value: out };
  try {
    const db = await getScopedClient();
    const column = kind === "lead" ? "lead_id" : "matter_id";
    const chunks: (readonly string[])[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    // The chunks are read at once; ANY chunk failing makes the whole read unavailable.
    const results = await Promise.all(
      chunks.map((chunk) =>
        db
          .from("crm_task")
          .select("id, title, due_at, assignee_id, lead_id, matter_id, created_at")
          .eq("status", "open")
          .in(column, chunk as string[])
          .order("due_at", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .limit(1000),
      ),
    );
    for (const { data, error } of results) {
      // A chunk that hit the cap may have cut rows off: a row would then read "No next step" wrongly, so say couldn't-load.
      if (error || (data ?? []).length >= 1000) return { status: "unavailable" };
      for (const t of data ?? []) {
        const owner = (kind === "lead" ? t.lead_id : t.matter_id) as string | null;
        if (owner && owner in out && out[owner] === null) out[owner] = { id: t.id, title: t.title, dueAt: t.due_at, assigneeId: t.assignee_id };
      }
    }
    return { status: "ok", value: out };
  } catch {
    return { status: "unavailable" };
  }
}
