import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { CSV_MAX_ROWS, buildCsv } from "./csv";
import { formQuestions } from "./form-questions";
import { loadCsvSubmissions } from "./load-results";
import { parseRange } from "./performance";
import { loadIntakeForm } from "./store";

/**
 * `GET /dashboard/forms/export/?form=<id>&range=<7|30|90>`: an intake's people
 * and answers as a CSV. A route handler is its own entry point (no layout, no
 * page check), so it resolves the caller itself, every time:
 *
 *   401  not signed in;
 *   403  a role that may not export (viewer, social_media), or one that could
 *        not be established: the read fails closed;
 *   404  a form id that is malformed or not this firm's;
 *   413  more than CSV_MAX_ROWS people in the range: told, not cut;
 *   500/503  a read that failed or a table that isn't in this environment:
 *        never a header-only file that reads as "nobody".
 *
 * Staff only because this is the one surface that moves answers out of the app
 * (same roles that may write matters). Scoped client only; read-only; no raw
 * database message ever reaches the response.
 */

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

const FORM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canExportCsv(role: unknown): role is Role {
  return typeof role === "string" && (ROLES as readonly string[]).includes(role) && MATTER_WRITE_ROLES.includes(role as Role);
}

export async function exportIntakeCsv(request: Request, now = new Date()): Promise<Response> {
  let supabase: Awaited<ReturnType<typeof getScopedClient>>;
  try {
    supabase = await getScopedClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return text(401, "Sign in to export.");
    const role = await supabase.rpc("current_org_role");
    if (role.error || !canExportCsv(role.data)) return text(403, "Your role can't export intake answers.");
  } catch {
    return text(503, "We couldn't check your access just now. Try again shortly.");
  }

  const url = new URL(request.url);
  const formId = url.searchParams.get("form") ?? "";
  if (!FORM_ID.test(formId)) return text(404, "That intake isn't in your firm.");
  const range = parseRange(url.searchParams.get("range"));

  const loaded = await loadIntakeForm(formId);
  if (loaded.status === "unconfigured") return text(503, "Intake forms aren't switched on for your firm yet. Lectual will turn them on.");
  if (loaded.status === "unavailable") return text(500, "We couldn't load that intake. Refresh to try again.");
  if (!loaded.form) return text(404, "That intake isn't in your firm.");
  const form = loaded.form;

  const read = await loadCsvSubmissions(form.id, range, now);
  if (read.status === "unconfigured") return text(503, "Intake answers aren't switched on for your firm yet. Lectual will turn them on.");
  if (read.status === "unavailable") return text(500, "We couldn't read the answers. Refresh to try again.");
  if (read.value.over) {
    return text(413, `That range has more than ${CSV_MAX_ROWS.toLocaleString("en-US")} people, which is too many for one file. Choose a shorter range.`);
  }

  const body = buildCsv(read.value.rows, formQuestions(form.kind, form.config));
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${form.slug.replace(/[^a-z0-9-]/gi, "-")}-last-${range}-days.csv"`,
      "cache-control": "no-store",
    },
  });
}
