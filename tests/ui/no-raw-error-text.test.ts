import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, stripAndCollect, walk } from "./_scan";

/**
 * Sprint 31: a thrown value's own text never reaches a screen. Walks src/app/dashboard and
 * src/components, drops comments, and fails on `err.message`, `error.message`, `e.message` (or any
 * `...Error.message`) and on `String(err)` unless the line only logs it or only tests it.
 */
const RAW = /\b(?:[A-Za-z_]*[eE]rr(?:or)?|e|ex|exception)\??\.message\b|\bString\((?:err|error|e|ex)\)/;

/** A stored `last_error` or an import failure's `f.message` is data, never a sentence for the screen. */
const STORED = /\{[\w?.]*\blast_error\s*\}|\bf\.message\b/;

type Allow = { file: RegExp; reason: string };

const ALLOW: Allow[] = [
  { file: /^src\/components\/feedback\/FeedbackTrailRecorder\.tsx$/, reason: "records a client error into the sanitised feedback trail; never rendered" },
  {
    file: /^src\/app\/dashboard\/(quotes|matters|leads|campaigns|proposals|settings\/team)\/errors\.ts$/,
    reason: "friendly*Error helpers: a database error (one carrying a code) never passes its message; only errors written as sentences for a person (typed or plain) do, and the helper documents it",
  },
  { file: /^src\/app\/dashboard\/matters\/\[id\]\/(actions|intake-request-actions)\.ts$/, reason: "DocumentFlowError / IntakeRequestError messages are fixed sentences written for a person" },
  { file: /^src\/app\/dashboard\/documents\/new\/\[matterId\]\/(loe|opinion-letter|trademark-clearance)\/actions\.ts$/, reason: "only a DocumentFlowError's own sentence passes; anything else is a fixed sentence" },
  { file: /^src\/app\/dashboard\/leads\/\[id\]\/actions\.ts$/, reason: "only a PrepConsultFlowError's own sentence passes; anything else is a fixed sentence" },
  { file: /^src\/app\/dashboard\/forms\/actions\.ts$/, reason: "only an IntakeFormError's own sentence passes" },
  { file: /^src\/app\/dashboard\/settings\/integrations\/lawmatics\/actions\.ts$/, reason: "LawmaticsNotConnectedError / PlanChangedError carry sentences written for a person" },
  { file: /^src\/app\/dashboard\/queue\/actions\.ts$/, reason: "requireFirmReviewer throws the sign-in / role sentence; the generic catch below it uses a fixed sentence" },
  { file: /^src\/app\/dashboard\/brain\/actions\.ts$/, reason: "friendlyBrainError passes only a message that starts 'You don't have permission to'; anything else is the fixed fallback" },
];

export function rawErrorHits(file: string, source: string): string[] {
  const { code } = stripAndCollect(source, true);
  const hits: string[] = [];
  code.split("\n").forEach((line, i) => {
    if (STORED.test(line)) {
      // A stored error is drawn only through the fixed-sentence picker.
      if (!/integrationErrorLine\(/.test(line) && !/console\./.test(line) && !/^\s*(last_error|\w+\??:)/.test(line)) hits.push(`${file}:${i + 1}\t${line.trim().slice(0, 140)}`);
      return;
    }
    if (!RAW.test(line)) return;
    if (/console\.(error|warn|info|log)\(/.test(line)) return;
    if (/\.(test|includes|startsWith)\(/.test(line) && !/[{`]\s*\$?\{?[^}]*\.message/.test(line.replace(/\.(test|includes|startsWith)\([^)]*\)/g, ""))) return;
    hits.push(`${file}:${i + 1}\t${line.trim().slice(0, 140)}`);
  });
  return hits;
}

describe("no raw error text on a screen", () => {
  const files = [...walk("src/app/dashboard"), ...walk("src/components")].filter((f) => !f.endsWith(".d.ts"));

  it("finds err.message nowhere outside logs and the documented sentence-carrying errors", () => {
    const hits: string[] = [];
    for (const file of files) {
      if (ALLOW.some((a) => a.file.test(file))) continue;
      hits.push(...rawErrorHits(file, fs.readFileSync(path.join(ROOT, file), "utf8")));
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("every allow-list entry still matches a file", () => {
    for (const a of ALLOW) expect(files.some((f) => a.file.test(f)), a.reason).toBe(true);
  });

  it("catches the pre-sprint patterns (Brain, Leads, Campaigns, actions)", () => {
    const samples = [
      "loadError = err instanceof Error ? err.message : String(err);",
      'error: err instanceof Error ? err.message : "Couldn\'t load this campaign\'s steps.",',
      "loadError = err instanceof Error ? err.message : \"Couldn't load campaigns.\";",
      "return { error: `Couldn't save: ${error.message}` };",
      "<p>{loadError ?? error.message}</p>",
    ];
    for (const s of samples) expect(rawErrorHits("x.tsx", s), s).toHaveLength(1);
  });

  it("does not flag a log line or a message that is only tested", () => {
    expect(rawErrorHits("x.ts", 'console.error("failed", err.message);')).toEqual([]);
    expect(rawErrorHits("x.ts", "if (/forbid/i.test(err.message)) return null;")).toEqual([]);
  });

  it("catches a stored last_error or an import failure message drawn verbatim", () => {
    for (const s of ["<div>{c.last_error}</div>", "<p>Last run: {conn.last_error}</p>", "<Row detail={f.message} />", "{`: ${conn.last_error}`}"]) {
      expect(rawErrorHits("x.tsx", s), s).toHaveLength(1);
    }
    expect(rawErrorHits("x.tsx", "<div>{integrationErrorLine(c.status, c.last_error)}</div>")).toEqual([]);
  });

  it("an Integrations mailbox row never draws a sentinel stored error", async () => {
    const { integrationErrorLine } = await import("@/lib/ui/words");
    const sentinel = "SENTINEL pg: duplicate key value violates unique constraint crm_lead_x";
    for (const status of ["active", "reauth", "error", "revoked"]) {
      const line = integrationErrorLine(status, sentinel);
      expect(line).toBeTruthy();
      expect(line).not.toContain("SENTINEL");
    }
    expect(integrationErrorLine("active", null)).toBeNull();
    const src = fs.readFileSync(path.join(ROOT, "src/app/dashboard/settings/integrations/page.tsx"), "utf8");
    expect(src).toContain("integrationErrorLine(c.status, c.last_error)");
    expect(src).not.toMatch(/\{c\.last_error\}/);
  });
});

describe("the allow-listed friendly*Error helpers pass only typed, person-written errors", async () => {
  const { friendlyCampaignError } = await import("@/app/dashboard/campaigns/errors");
  const { friendlyQuoteError } = await import("@/app/dashboard/quotes/errors");
  const { friendlyMatterError } = await import("@/app/dashboard/matters/errors");
  const { friendlySettingsError } = await import("@/app/dashboard/settings/team/errors");
  const { CampaignAdvanceError } = await import("@/lib/campaigns/advance");
  const { ReadableError } = await import("@/lib/ui/readable-error");
  const { APPROVALS_NOT_READY } = await import("@/lib/ui/words");

  const helpers = {
    friendlyCampaignError,
    friendlyQuoteError,
    friendlyMatterError,
    friendlySettingsError,
  } as const;
  const ENV_NAME = /\b[A-Z][A-Z0-9]+_[A-Z0-9_]{2,}\b/;

  for (const [name, fn] of Object.entries(helpers)) {
    it(`${name}: a queue 502 never shows its text or the sentinel`, () => {
      const out = fn(new Error("SENTINEL Queue API 502: detail"), "Couldn't save.");
      expect(out).not.toContain("SENTINEL");
      expect(out).not.toMatch(/Queue API|502/);
      expect(out).toBe(APPROVALS_NOT_READY);
    });

    it(`${name}: a missing-setting error shows no environment-variable name`, () => {
      const out = fn(new Error("Queue API not configured — set QUEUE_API_URL and DASHBOARD_API_TOKEN"), "Couldn't save.");
      expect(out).not.toMatch(ENV_NAME);
      expect(out).not.toMatch(/Queue API/);
    });

    it(`${name}: TypeError, TimeoutError and any other plain Error become the fallback`, () => {
      expect(fn(new TypeError("fetch failed: ECONNRESET"), "FALLBACK")).toBe("FALLBACK");
      expect(fn(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }), "FALLBACK")).toBe("FALLBACK");
      expect(fn(new Error("SENTINEL something internal"), "FALLBACK")).toBe("FALLBACK");
      expect(fn("boom", "FALLBACK")).toBe("FALLBACK");
    });

    it(`${name}: a typed ReadableError passes its sentence, unless it carries a setting name or a queue message`, () => {
      expect(fn(new ReadableError("Enter an email address."), "FALLBACK")).toBe("Enter an email address.");
      expect(fn(new ReadableError("Set QUEUE_API_URL first."), "FALLBACK")).toBe("FALLBACK");
    });
  }

  it("a CampaignAdvanceError is typed and passes through the campaign helper", () => {
    expect(friendlyCampaignError(new CampaignAdvanceError("This campaign is paused."), "x")).toBe("This campaign is paused.");
  });
});
