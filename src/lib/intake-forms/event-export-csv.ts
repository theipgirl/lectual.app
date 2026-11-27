import { isEventCode } from "./event-name";
import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { CSV_BOM, CSV_MAX_ROWS, csvLine } from "./csv";
import { canExportCsv } from "./export-csv";
import { buildEventPeople } from "./event-people";
import { loadEventPeople } from "./load-results";

/**
 * `GET /dashboard/forms/event-export/?event=<code>`: one booth event's people as
 * a CSV. Its own entry point, so it resolves the caller itself, every time:
 *
 *   401  not signed in;
 *   403  a role that may not export, or one that could not be established;
 *   400  no event code, or one not shaped like a booth code (EVENT_CODE_PATTERN);
 *   404  the firm has no booth cards for that code;
 *   413  more than CSV_MAX_ROWS cards: told, not cut;
 *   500/503  a read that failed or a table that isn't there: never a
 *            header-only file that reads as "nobody".
 *
 * Scoped client only; read-only; no raw database message reaches the response.
 * Temperature is staff-only and so is this file (same roles as the intake CSV).
 */

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export const EVENT_CSV_HEADER = ["Name", "Email", "Phone", "Business", "Taken at (UTC)", "Score", "Band", "Temperature", "Finished", "Gaps"] as const;

export async function exportEventCsv(request: Request): Promise<Response> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return text(401, "Sign in to export.");
    const role = await supabase.rpc("current_org_role", undefined, { get: true });
    if (role.error || !canExportCsv(role.data)) return text(403, "Your role can't export event results.");
  } catch {
    return text(503, "We couldn't check your access just now. Try again shortly.");
  }

  const code = new URL(request.url).searchParams.get("event") ?? "";
  if (!isEventCode(code)) return text(400, "Choose an event to export.");

  const read = await loadEventPeople(code, { contact: true, max: CSV_MAX_ROWS, show: CSV_MAX_ROWS });
  if (read.status === "unconfigured") return text(503, "Event assessments aren't switched on for your firm yet. Lectual will turn them on.");
  if (read.status === "unavailable") return text(500, "We couldn't read this event's people. Refresh to try again.");
  if (read.value.over) {
    return text(413, `That event has more than ${CSV_MAX_ROWS.toLocaleString("en-US")} people, which is too many for one file.`);
  }
  if (read.value.total === 0) return text(404, "That event isn't in your firm.");

  const people = buildEventPeople(read.value.cards, read.value.leads);
  const lines = [csvLine([...EVENT_CSV_HEADER])];
  for (const p of people) {
    lines.push(
      csvLine([
        p.leadFound ? p.name : "Lead not available",
        p.email,
        p.phone,
        p.business,
        p.takenAt,
        p.score === null ? "" : String(p.score),
        p.band ?? "",
        p.temperature ?? "",
        p.finished ? "Yes" : "No",
        p.gaps.join("; "),
      ]),
    );
  }
  const safe = code.replace(/[^a-z0-9-]/gi, "-");
  return new Response(CSV_BOM + lines.join("\r\n") + "\r\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safe}-results.csv"`,
      "cache-control": "no-store",
    },
  });
}
