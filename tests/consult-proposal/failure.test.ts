import { describe, expect, it } from "vitest";
import { ProposalEmailError } from "@/lib/consult-proposal/email";
import {
  ConsultStageError,
  consultFailureLine,
  describeConsultFailure,
  scrubForLog,
} from "@/lib/consult-proposal/failure";

class EnvVarError extends Error {
  name = "EnvVarError";
  constructor(readonly key: string, readonly reason: "missing" | "invalid" = "missing") {
    super(`Environment variable ${key} is not set.`);
  }
}

describe("describeConsultFailure", () => {
  it("names the missing service-role key", () => {
    const m = describeConsultFailure("env", new EnvVarError("SUPABASE_SERVICE_ROLE_KEY"));
    expect(m).toContain("the server key (SUPABASE_SERVICE_ROLE_KEY) isn't set on this deployment");
    expect(m).toContain("Nothing was sent.");
  });

  it("names any other missing server setting, by name only", () => {
    expect(describeConsultFailure("env", new EnvVarError("NEXT_PUBLIC_SUPABASE_URL", "invalid"))).toMatch(
      /server setting \(NEXT_PUBLIC_SUPABASE_URL\) is invalid/,
    );
  });

  it("explains each proposal-link rule and shows the resolved address", () => {
    const http = describeConsultFailure("email", new ProposalEmailError("x", "not_https"), { origin: "http://lectual.app" });
    expect(http).toMatch(/must start with https:\/\//);
    expect(http).toContain('"http://lectual.app"');
    expect(http).toMatch(/withdrawn/);
    expect(http).toContain("Nothing was sent.");
    expect(describeConsultFailure("email", new ProposalEmailError("x", "claude_link"))).toMatch(/never a claude\.ai link/);
    expect(describeConsultFailure("email", new ProposalEmailError("x", "invalid_url"), { origin: "null" })).toMatch(/isn't a web address/);
  });

  it("maps queue failures to specific sentences", () => {
    expect(describeConsultFailure("queue", new Error("Queue API 502: Bad gateway"))).toMatch(
      /approval queue didn't accept the draft \(it answered HTTP 502\)/,
    );
    expect(describeConsultFailure("queue", new Error("Queue API not configured — set QUEUE_API_URL and DASHBOARD_API_TOKEN"))).toMatch(
      /isn't configured on this deployment/,
    );
    expect(describeConsultFailure("queue", new TypeError("fetch failed"))).toMatch(/couldn't be reached/);
    expect(describeConsultFailure("queue", new Error("weird"))).toMatch(/step: queue/);
  });

  it("gives database stages friendly text with the stage, and always the assurance", () => {
    for (const stage of ["check", "settings", "insert", "event", "queue", "draft", "email", "env"] as const) {
      const m = describeConsultFailure(stage, new Error("boom"));
      expect(m).toContain(`step: ${stage}`.replace("step: insert", "database step: insert").replace("step: event", "database step: event"));
      expect(m).toContain("Nothing was sent.");
    }
    expect(describeConsultFailure("marker", new Error("x"))).toMatch(/Reject the email now waiting/);
  });

  it("unwraps a ConsultStageError", () => {
    const e = new ConsultStageError("env", new EnvVarError("SUPABASE_SERVICE_ROLE_KEY"));
    expect(describeConsultFailure("env", e)).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("consultFailureLine", () => {
  it("is one JSON object with event, stage, name and a short message", () => {
    const line = JSON.parse(consultFailureLine("insert", new TypeError("nope")));
    expect(line).toEqual({ event: "consult_proposal_failed", stage: "insert", name: "TypeError", message: "nope" });
  });

  it("reads a PostgREST-style error object", () => {
    const line = JSON.parse(consultFailureLine("settings", { code: "42501", message: "permission denied for table x" }));
    expect(line).toMatchObject({ stage: "settings", name: "DbError:42501", message: "permission denied for table x" });
  });

  it("never logs emails, tokens or more than 500 characters", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
    const msg = `bad for sevetri@example.com with ${jwt} and Bearer abc.def and ${"A".repeat(60)} ${"z ".repeat(600)}`;
    const out = JSON.parse(consultFailureLine("draft", new Error(msg))).message as string;
    expect(out).not.toContain("sevetri@example.com");
    expect(out).not.toContain("eyJ");
    expect(out).not.toContain("abc.def");
    expect(out).not.toContain("AAAAAAAAAA");
    expect(out.length).toBeLessThanOrEqual(500);
    expect(scrubForLog("a@b.co")).toBe("[email]");
  });
});
