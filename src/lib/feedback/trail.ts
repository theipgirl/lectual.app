/**
 * The "session transcript" behind Send feedback: a small ring buffer kept in sessionStorage.
 *
 * What it holds, and only this: the last 30 dashboard route paths with timestamps (query string and hash
 * dropped, uuid segments kept as they are), the last 20 client-side errors (message and file:line, each
 * cut at 300 characters, email-shaped text replaced), the viewport, the user agent and the app build.
 * There is no field for a stack, page text, a form value, a title or a record name, so nothing of the
 * kind can be recorded. Pure: storage is passed in, so it is tested without a browser.
 */

export const MAX_ROUTES = 30;
export const MAX_ERRORS = 20;
export const MAX_FIELD_CHARS = 300;
export const MAX_TRAIL_BYTES = 20_480;
export const TRAIL_STORAGE_KEY = "lectual_feedback_trail";

export type TrailRoute = { path: string; at: string };
export type TrailError = { message: string; source: string; at: string };
export type Trail = {
  routes: TrailRoute[];
  errors: TrailError[];
  viewport: { width: number; height: number } | null;
  userAgent: string | null;
  build: string | null;
};

export function emptyTrail(): Trail {
  return { routes: [], errors: [], viewport: null, userAgent: null, build: null };
}

const EMAIL_LIKE = /[^\s<>()"',;:]+@[^\s<>()"',;]+/g;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

/** Anything email-shaped becomes [email]; the result is cut at 300 characters. */
export function redactForTrail(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(EMAIL_LIKE, "[email]").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_CHARS);
}

/** A route path with no query string or hash; null when it is not a path. */
export function cleanPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const bare = path.split("#")[0].split("?")[0].trim();
  if (!bare.startsWith("/")) return null;
  return redactForTrail(bare) || null;
}

const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && ISO.test(v) ? v : null);

export function recordRoute(trail: Trail, path: string, at: string): Trail {
  const clean = cleanPath(path);
  const when = isoOrNull(at);
  if (!clean || !when) return trail;
  const last = trail.routes[trail.routes.length - 1];
  if (last && last.path === clean) return trail;
  return { ...trail, routes: [...trail.routes, { path: clean, at: when }].slice(-MAX_ROUTES) };
}

export function recordError(trail: Trail, error: { message: unknown; source?: unknown; at: string }): Trail {
  const when = isoOrNull(error.at);
  const message = redactForTrail(error.message);
  if (!when || !message) return trail;
  const entry: TrailError = { message, source: redactForTrail(error.source), at: when };
  return { ...trail, errors: [...trail.errors, entry].slice(-MAX_ERRORS) };
}

export function withEnvironment(trail: Trail, env: { width: number; height: number; userAgent: string; build: string | null }): Trail {
  const dim = (n: number) => (Number.isFinite(n) && n >= 0 && n < 100_000 ? Math.round(n) : 0);
  return {
    ...trail,
    viewport: { width: dim(env.width), height: dim(env.height) },
    userAgent: redactForTrail(env.userAgent) || null,
    build: redactForTrail(env.build ?? "") || null,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Rebuilds a trail from anything: unknown keys are dropped, every cap is applied again, garbage is an empty trail. */
export function sanitizeTrail(input: unknown): Trail {
  try {
    if (!isRecord(input)) return emptyTrail();
    let trail = emptyTrail();
    if (Array.isArray(input.routes)) {
      for (const r of input.routes.slice(-MAX_ROUTES * 2)) {
        if (isRecord(r)) trail = recordRoute(trail, r.path as string, r.at as string);
      }
    }
    if (Array.isArray(input.errors)) {
      for (const e of input.errors.slice(-MAX_ERRORS * 2)) {
        if (isRecord(e)) trail = recordError(trail, { message: e.message, source: e.source, at: e.at as string });
      }
    }
    const vp = input.viewport;
    if (isRecord(vp) && typeof vp.width === "number" && typeof vp.height === "number") {
      const dim = (n: number) => (Number.isFinite(n) && n >= 0 && n < 100_000 ? Math.round(n) : 0);
      trail = { ...trail, viewport: { width: dim(vp.width), height: dim(vp.height) } };
    }
    return { ...trail, userAgent: redactForTrail(input.userAgent) || null, build: redactForTrail(input.build) || null };
  } catch {
    return emptyTrail();
  }
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** JSON of the trail, never over 20,480 bytes: the oldest entries go first (the longer list loses one at a time). */
export function serializeTrail(trail: Trail): string {
  let t = sanitizeTrail(trail);
  let json = JSON.stringify(t);
  while (byteLength(json) > MAX_TRAIL_BYTES && (t.routes.length > 0 || t.errors.length > 0)) {
    t = t.routes.length >= t.errors.length ? { ...t, routes: t.routes.slice(1) } : { ...t, errors: t.errors.slice(1) };
    json = JSON.stringify(t);
  }
  return json;
}

export function parseTrailJson(json: unknown): Trail {
  if (typeof json !== "string" || json.length > MAX_TRAIL_BYTES * 2) return emptyTrail();
  try {
    return sanitizeTrail(JSON.parse(json));
  } catch {
    return emptyTrail();
  }
}

export type TrailStorage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };

export function loadTrail(storage: TrailStorage | null | undefined): Trail {
  try {
    return parseTrailJson(storage?.getItem(TRAIL_STORAGE_KEY));
  } catch {
    return emptyTrail();
  }
}

export function saveTrail(storage: TrailStorage | null | undefined, trail: Trail): void {
  try {
    storage?.setItem(TRAIL_STORAGE_KEY, serializeTrail(trail));
  } catch {
    // Storage full or blocked: feedback still works without a transcript.
  }
}

/** The trail as a readable list for the email. */
export function formatTrail(trail: Trail): string {
  const lines: string[] = ["Session transcript", ""];
  lines.push(`Routes (${trail.routes.length}, oldest first):`);
  if (trail.routes.length === 0) lines.push("  (none recorded)");
  for (const r of trail.routes) lines.push(`  ${r.at}  ${r.path}`);
  lines.push("", `Client errors (${trail.errors.length}, oldest first):`);
  if (trail.errors.length === 0) lines.push("  (none recorded)");
  for (const e of trail.errors) lines.push(`  ${e.at}  ${e.message}${e.source ? `  [${e.source}]` : ""}`);
  lines.push("");
  lines.push(`Viewport: ${trail.viewport ? `${trail.viewport.width} x ${trail.viewport.height}` : "unknown"}`);
  lines.push(`User agent: ${trail.userAgent ?? "unknown"}`);
  lines.push(`App build: ${trail.build ?? "none"}`);
  return lines.join("\n");
}
