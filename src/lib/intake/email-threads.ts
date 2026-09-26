/**
 * Client for lawmatics-mcp's `GET /api/mail/threads` (blueprint §12.1).
 *
 * That endpoint is the ONLY way this repo sees the firm's mail: Graph
 * credentials live on the lawmatics-mcp deployment, never here. It is read-only
 * on that side — it cannot send, reply, mark read, or return a message body —
 * and this client is read-only by construction: one GET, no other verb.
 *
 * DELIBERATELY NOT `server-only`. scripts/sync-intake-email.ts imports it by
 * relative path under bare tsx, exactly as the other operator CLIs import their
 * pure modules. There is nothing browser-unsafe in here, but nothing should
 * import it from a client component either: it reads DASHBOARD_API_TOKEN.
 *
 * THREE-STATE, like src/lib/queue/load.ts and the endpoint itself. A window
 * that could not be read must never reach a caller as an empty one — "no mail"
 * and "we could not look" are different answers, and confusing them tells a
 * firm nobody followed up on a lead who was in fact emailed twice.
 */

/** The env this client needs. Named here so the CLI can refuse with a real sentence. */
export const THREADS_ENV_VARS = ["QUEUE_API_URL", "DASHBOARD_API_TOKEN"] as const;

export type ThreadStatus = "ok" | "not-configured" | "error";

export type Party = { name: string | null; address: string | null };

/** One message, exactly as §12.1 puts it on the wire. */
export type ThreadMessage = {
  id: string;
  conversationId: string | null;
  mailbox: string;
  folder: "inbox" | "sent";
  direction: "inbound" | "outbound";
  /** ISO timestamp, or null when Graph carried neither sent nor received time. */
  at: string | null;
  from: Party;
  to: Party[];
  cc: Party[];
  subject: string | null;
  /** ≤ 300 chars of plain text. Never a body — the endpoint does not fetch one. */
  preview: string;
  webLink: string | null;
};

export type ThreadsResponse = {
  status: ThreadStatus;
  detail: string | null;
  mailbox: string;
  since: string | null;
  until: string | null;
  count: number;
  /** A folder hit the endpoint's hard cap — this window is INCOMPLETE. */
  truncated: boolean;
  messages: ThreadMessage[];
};

export type ThreadsEnv = {
  apiUrl: string | null;
  token: string | null;
  /** The var names that are absent, for the CLI's refusal message. */
  missing: string[];
};

export function threadsEnv(env: NodeJS.ProcessEnv = process.env): ThreadsEnv {
  const apiUrl = env.QUEUE_API_URL?.trim() || null;
  const token = env.DASHBOARD_API_TOKEN?.trim() || null;
  return {
    apiUrl,
    token,
    missing: THREADS_ENV_VARS.filter((name) => !env[name]?.trim()),
  };
}

// ── parsing ──────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function party(v: unknown): Party {
  const raw = (v ?? {}) as Record<string, unknown>;
  return { name: str(raw.name), address: str(raw.address)?.toLowerCase() ?? null };
}

function parties(v: unknown): Party[] {
  return Array.isArray(v) ? v.map(party) : [];
}

function message(v: unknown, fallbackMailbox: string): ThreadMessage | null {
  const raw = (v ?? {}) as Record<string, unknown>;
  const id = str(raw.id);
  if (!id) return null; // No id means no dedupe key and no idempotent write. Drop it.
  const folder = raw.folder === "sent" ? "sent" : "inbox";
  return {
    id,
    conversationId: str(raw.conversationId),
    mailbox: (str(raw.mailbox) ?? fallbackMailbox).toLowerCase(),
    folder,
    // Trust the endpoint's own direction call — it knows FIRM_DOMAINS and this
    // side does not. Only the folder is a usable fallback here.
    direction: raw.direction === "outbound" || folder === "sent" ? "outbound" : "inbound",
    at: str(raw.at),
    from: party(raw.from),
    to: parties(raw.to),
    cc: parties(raw.cc),
    subject: str(raw.subject),
    preview: typeof raw.preview === "string" ? raw.preview : "",
    webLink: str(raw.webLink),
  };
}

/**
 * Normalize a `/api/mail/threads` body — from the API or from a file saved by a
 * previous pull (`--from-json`). Unparseable input is `error`, never `ok` with
 * zero messages.
 */
export function parseThreadsResponse(raw: unknown, fallbackMailbox: string): ThreadsResponse {
  if (raw === null || typeof raw !== "object") {
    return errorResponse(fallbackMailbox, "response was not a JSON object");
  }
  const body = raw as Record<string, unknown>;
  const status: ThreadStatus =
    body.status === "ok" || body.status === "not-configured" || body.status === "error"
      ? body.status
      : "error";
  const messages =
    status === "ok" && Array.isArray(body.messages)
      ? body.messages
          .map((m) => message(m, fallbackMailbox))
          .filter((m): m is ThreadMessage => m !== null)
      : [];

  return {
    status,
    detail: str(body.detail),
    mailbox: (str(body.mailbox) ?? fallbackMailbox).toLowerCase(),
    since: str(body.since),
    until: str(body.until),
    count: typeof body.count === "number" ? body.count : messages.length,
    truncated: body.truncated === true,
    messages,
  };
}

function errorResponse(mailbox: string, detail: string): ThreadsResponse {
  return {
    status: "error",
    detail,
    mailbox: mailbox.toLowerCase(),
    since: null,
    until: null,
    count: 0,
    truncated: false,
    messages: [],
  };
}

// ── fetching ─────────────────────────────────────────────────────────────────

export type FetchThreadsOptions = {
  apiUrl: string;
  token: string;
  mailbox: string;
  since?: string | null;
  until?: string | null;
  /** Injectable for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * One mailbox, one window. Never throws: a transport failure comes back as
 * `error` with a detail, so the caller decides what to do about a half-read
 * window instead of a stack trace deciding for it.
 */
export async function fetchThreads(opts: FetchThreadsOptions): Promise<ThreadsResponse> {
  const url = new URL("/api/mail/threads", opts.apiUrl.endsWith("/") ? opts.apiUrl : `${opts.apiUrl}/`);
  url.searchParams.set("mailbox", opts.mailbox);
  if (opts.since) url.searchParams.set("since", opts.since);
  if (opts.until) url.searchParams.set("until", opts.until);

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
    });
    // 404 is the endpoint saying "not an allowlisted mailbox" without saying
    // which ones are. Surface it as exactly that, and not as an empty inbox.
    if (res.status === 404) {
      return errorResponse(opts.mailbox, `mailbox not available on ${opts.apiUrl} (404)`);
    }
    const body = await res.json().catch(() => null);
    if (body === null) return errorResponse(opts.mailbox, `HTTP ${res.status} with no JSON body`);
    const parsed = parseThreadsResponse(body, opts.mailbox);
    if (!res.ok && parsed.status === "ok") {
      return errorResponse(opts.mailbox, `HTTP ${res.status}`);
    }
    return parsed;
  } catch (err) {
    return errorResponse(opts.mailbox, err instanceof Error ? err.message : String(err));
  }
}

// ── merging mailboxes ────────────────────────────────────────────────────────

export type MergedThreads = {
  messages: ThreadMessage[];
  /** Per-mailbox status — a failed mailbox is named, never averaged away. */
  sources: Array<Pick<ThreadsResponse, "mailbox" | "status" | "detail" | "count" | "truncated">>;
  truncated: boolean;
  /** True when every mailbox read succeeded. The CLI refuses to --apply otherwise. */
  complete: boolean;
  duplicates: number;
};

/**
 * Merge the firm's two shared boxes into one timeline.
 *
 * trademark@ and intake@ both receive most client threads, so the same Graph
 * message id turns up twice. Deduping on id is what keeps "3 touches" from
 * becoming "6 touches" the day the second mailbox was added to the allowlist.
 * The FIRST copy wins, so the mailbox listed first on the command line is the
 * one the activity row will name.
 */
export function mergeThreadResponses(responses: readonly ThreadsResponse[]): MergedThreads {
  const byId = new Map<string, ThreadMessage>();
  let duplicates = 0;
  for (const res of responses) {
    for (const msg of res.messages) {
      if (byId.has(msg.id)) {
        duplicates += 1;
        continue;
      }
      byId.set(msg.id, msg);
    }
  }
  const messages = [...byId.values()].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  return {
    messages,
    sources: responses.map((r) => ({
      mailbox: r.mailbox,
      status: r.status,
      detail: r.detail,
      count: r.count,
      truncated: r.truncated,
    })),
    truncated: responses.some((r) => r.truncated),
    complete: responses.length > 0 && responses.every((r) => r.status === "ok"),
    duplicates,
  };
}
