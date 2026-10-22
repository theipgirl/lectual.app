import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  alertBody,
  alertSubject,
  alreadyAlerted,
  ALERT_ERROR_MAX_CHARS,
  DEFAULT_ALERT_FROM,
  errorSignature,
  redactEmails,
  sendFailureAlert,
  utcDayStart,
  type FailureAlertInput,
} from "@/lib/agents/failure-alert";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";

/** The env module caches each variable on first read, so a test that sets env loads a fresh copy. */
async function configFromEnv() {
  vi.resetModules();
  return (await import("@/lib/agents/failure-alert")).alertConfigFromEnv();
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ["AGENT_FAILURE_ALERT_TO", "AGENT_FAILURE_ALERT_FROM", "RESEND_API_KEY"]) delete process.env[k];
});

const input: FailureAlertInput = {
  orgId: "org-1",
  firmName: "RPB Law",
  agent: "morning-brief",
  runId: "run-9",
  startedAt: "2026-10-22T11:30:00.000Z",
  finishedAt: "2026-10-22T11:31:00.000Z",
  error: "Queue API 500 invalid input value for enum",
  vercelEnv: "production",
  commitSha: "abc123",
};
const config = { apiKey: "re_key", to: ["bugs@lectual.app"], from: DEFAULT_ALERT_FROM };

const adminWith = (rows: Array<{ id: string; error: string | null }> | "error" | "throw") => {
  const { client, log } = fakeAdmin((q) => {
    if (q.table !== "agent_run") return undefined;
    if (rows === "throw") throw new Error("boom");
    return rows === "error" ? { data: null, error: { message: "x" } } : { data: rows, error: null };
  });
  return { admin: client as unknown as SupabaseClient, log };
};
const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("B2: the content", () => {
  it("the subject is exactly [Lectual bug] <agent> failed for <firm name>", () => {
    expect(alertSubject("morning-brief", "RPB Law")).toBe("[Lectual bug] morning-brief failed for RPB Law");
  });

  it("the body names firm, org, agent, run, times, deployment, and the stored error", () => {
    const body = alertBody(input);
    for (const part of ["RPB Law", "org-1", "morning-brief", "run-9", "2026-10-22T11:30:00.000Z", "2026-10-22T11:31:00.000Z", "production @ abc123", input.error]) {
      expect(body).toContain(part);
    }
  });

  it("omits the commit when it is not set, and bounds the error at 2,000 characters", () => {
    expect(alertBody({ ...input, commitSha: null })).toContain("Deployment: production\n");
    const long = alertBody({ ...input, error: "x".repeat(5_000) });
    expect(long.split("Stored error:\n")[1]).toHaveLength(ALERT_ERROR_MAX_CHARS);
  });

  it("replaces anything that looks like an email address, in the error and the firm name", () => {
    const body = alertBody({ ...input, error: "Send failed for amara@client.example (cc a.b+c@x.co.uk).", firmName: "Smith <smith@firm.com> Law" });
    expect(body).not.toMatch(/@client|@x\.co|@firm/);
    expect(body).toContain("[email]");
    expect(redactEmails("no address here")).toBe("no address here");
    expect(alertSubject("email-intel", "ops@firm.com")).not.toContain("@");
  });

  it("has no summary or client field in its input type", () => {
    const src = readFileSync("src/lib/agents/failure-alert.ts", "utf8");
    const type = src.match(/export type FailureAlertInput = \{[\s\S]*?\n\};/)?.[0] ?? "";
    expect(type).not.toMatch(/summary|client|lead|email/i);
  });
});

describe("B3: the error signature and the dedupe", () => {
  it("is the first sentence with digit runs normalised", () => {
    expect(errorSignature("Queue API 500 for 3 leads. Details follow.")).toBe(errorSignature("Queue API 502 for 17 leads. Other details."));
    expect(errorSignature("Queue API 500 for 3 leads. x")).not.toBe(errorSignature("Graph read failed for 3 leads. x"));
  });

  it("an earlier same-signature row suppresses; a different signature does not", () => {
    expect(alreadyAlerted([{ error: "Queue API 500 invalid input value for enum" }], "Queue API 502 invalid input value for enum")).toBe(true);
    expect(alreadyAlerted([{ error: "Queue API 500 broke. A" }], "Queue API 502 broke. B")).toBe(true);
    expect(alreadyAlerted([{ error: null }, { error: "Other thing." }], "Queue API 500 broke.")).toBe(false);
    expect(alreadyAlerted([], "x")).toBe(false);
  });

  it("the read asks for this org + agent, error rows, since UTC midnight, excluding the current run", async () => {
    const { admin, log } = adminWith([]);
    await sendFailureAlert({ admin, input, config, fetchImpl: okFetch() });
    const q = log.find((r: Recorded) => r.table === "agent_run") as Recorded;
    const f = Object.fromEntries(q.filters.map((x) => [`${x.op}:${x.column}`, x.value]));
    expect(f).toMatchObject({
      "eq:org_id": "org-1",
      "eq:agent": "morning-brief",
      "eq:status": "error",
      "gte:started_at": "2026-10-22T00:00:00.000Z",
      "neq:id": "run-9",
    });
    expect(utcDayStart("2026-10-22T23:59:59Z")).toBe("2026-10-22T00:00:00.000Z");
  });

  it("sends when nothing earlier matches, skips when it does, and sends when the history cannot be read", async () => {
    const f1 = okFetch();
    expect(await sendFailureAlert({ admin: adminWith([]).admin, input, config, fetchImpl: f1 })).toBe("sent");
    expect(f1).toHaveBeenCalledTimes(1);

    const f2 = okFetch();
    expect(await sendFailureAlert({ admin: adminWith([{ id: "r0", error: "Queue API 500 invalid input value for enum" }]).admin, input, config, fetchImpl: f2 })).toBe("deduped");
    expect(f2).not.toHaveBeenCalled();

    for (const rows of ["error", "throw"] as const) {
      const f3 = okFetch();
      expect(await sendFailureAlert({ admin: adminWith(rows).admin, input, config, fetchImpl: f3 })).toBe("sent");
      expect(f3).toHaveBeenCalledTimes(1);
    }
  });
});

describe("B4: configuration and failure", () => {
  it("reads recipients only from AGENT_FAILURE_ALERT_TO, split on commas and trimmed; default From; override From", async () => {
    process.env.RESEND_API_KEY = "re_key";
    process.env.AGENT_FAILURE_ALERT_TO = " bugs@lectual.app , list@clickup.example ,";
    const c = await configFromEnv();
    expect(c).toEqual({ apiKey: "re_key", to: ["bugs@lectual.app", "list@clickup.example"], from: "Lectual alerts <noreply@lectual.app>" });
    process.env.AGENT_FAILURE_ALERT_FROM = "Ops <ops@lectual.app>";
    expect((await configFromEnv())?.from).toBe("Ops <ops@lectual.app>");
    const src = readFileSync("src/lib/agents/failure-alert.ts", "utf8");
    expect(src.match(/\bto:/g)?.length).toBe(2); // the type and the send body
    expect(src).not.toMatch(/db\/admin/);
  });

  it("unset recipient list or unset key means off: nothing is read or sent", async () => {
    process.env.RESEND_API_KEY = "re_key";
    expect(await configFromEnv()).toBeNull();
    delete process.env.RESEND_API_KEY;
    process.env.AGENT_FAILURE_ALERT_TO = "bugs@lectual.app";
    expect(await configFromEnv()).toBeNull();
    const f = okFetch();
    const { admin, log } = adminWith([]);
    expect(await sendFailureAlert({ admin, input, fetchImpl: f })).toBe("off");
    expect(f).not.toHaveBeenCalled();
    expect(log).toHaveLength(0);
  });

  it("posts one Resend request with bearer key, from, to, subject", async () => {
    const f = okFetch();
    await sendFailureAlert({ admin: adminWith([]).admin, input, config, fetchImpl: f });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_key");
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: "Lectual alerts <noreply@lectual.app>",
      to: ["bugs@lectual.app"],
      subject: "[Lectual bug] morning-brief failed for RPB Law",
    });
  });

  it("a non-2xx or a rejected send is swallowed with one log line carrying no content", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = vi.fn(async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    expect(await sendFailureAlert({ admin: adminWith([]).admin, input, config, fetchImpl: refused })).toBe("failed");
    const rejected = vi.fn(async () => Promise.reject(new Error("net down for amara@client.example"))) as unknown as typeof fetch;
    expect(await sendFailureAlert({ admin: adminWith([]).admin, input, config, fetchImpl: rejected })).toBe("failed");
    expect(err).toHaveBeenCalledTimes(2);
    for (const call of err.mock.calls) expect(String(call[0])).not.toMatch(/Queue API|amara|org-1/);
  });
});
