import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  AGENT_MODEL_TIER,
  DEFAULT_HAIKU_MODEL,
  DEFAULT_SONNET_MODEL,
  maxOutputFor,
  resolveAgentModel,
  supportsEffort,
  type ModelSubject,
} from "@/lib/ai/agent-models";
import { AGENT_IDS } from "@/lib/agents/types";
import { costFor } from "@/lib/ai/claude";
import { TRIAGE_MAX_TOKENS } from "@/lib/agents/intake-triage";

afterEach(() => {
  vi.restoreAllMocks();
});

const SUBJECTS = Object.keys(AGENT_MODEL_TIER) as ModelSubject[];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("A1: the tier table", () => {
  it("puts classification on Haiku and writing on Sonnet", () => {
    expect(AGENT_MODEL_TIER["intake-triage"]).toBe("haiku");
    expect(AGENT_MODEL_TIER["email-intel"]).toBe("haiku");
    for (const a of ["inbox-summary", "post-consult", "morning-brief", "consult-prep", "staff"] as const) {
      expect(AGENT_MODEL_TIER[a]).toBe("sonnet");
    }
  });

  it("covers every agent id except the Stage Keeper, which imports no Claude helper", () => {
    const missing = AGENT_IDS.filter((a) => a !== "stage-keeper" && !(a in AGENT_MODEL_TIER));
    expect(missing).toEqual([]);
    expect("stage-keeper" in AGENT_MODEL_TIER).toBe(false);
    for (const file of sourceFiles("src/lib/agents/stage-keeper")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/@\/lib\/ai\/claude|callClaude|askClaude/);
    }
  });
});

describe("A2: resolving a tier to an id", () => {
  it("uses the tier defaults with nothing set", () => {
    expect(resolveAgentModel("intake-triage", {})).toBe(DEFAULT_HAIKU_MODEL);
    expect(resolveAgentModel("morning-brief", {})).toBe(DEFAULT_SONNET_MODEL);
  });

  it("AGENT_MODEL_HAIKU and AGENT_MODEL_SONNET override their own tier only", () => {
    const e = { AGENT_MODEL_HAIKU: "haiku-x", AGENT_MODEL_SONNET: "sonnet-y" };
    expect(resolveAgentModel("email-intel", e)).toBe("haiku-x");
    expect(resolveAgentModel("post-consult", e)).toBe("sonnet-y");
  });

  it("AGENT_MODEL alone is the Sonnet override and does not touch Haiku agents; AGENT_MODEL_SONNET wins over it", () => {
    expect(resolveAgentModel("consult-prep", { AGENT_MODEL: "legacy" })).toBe("legacy");
    expect(resolveAgentModel("intake-triage", { AGENT_MODEL: "legacy" })).toBe(DEFAULT_HAIKU_MODEL);
    expect(resolveAgentModel("consult-prep", { AGENT_MODEL: "legacy", AGENT_MODEL_SONNET: "new" })).toBe("new");
  });

  it("an Opus id in any override is ignored with one log line each, and the tier default is used", () => {
    const log = vi.fn();
    expect(resolveAgentModel("morning-brief", { AGENT_MODEL: "claude-opus-5" }, log)).toBe(DEFAULT_SONNET_MODEL);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/AGENT_MODEL names an Opus model and is ignored/);
    expect(log.mock.calls[0][0]).not.toMatch(/claude-opus-5/);
    expect(resolveAgentModel("intake-triage", { AGENT_MODEL_HAIKU: "claude-opus-4-8" }, vi.fn())).toBe(DEFAULT_HAIKU_MODEL);
    expect(resolveAgentModel("post-consult", { AGENT_MODEL_SONNET: "claude-opus-5-5", AGENT_MODEL: "mine" }, vi.fn())).toBe("mine");
  });
});

describe("A3: no path defaults to Opus", () => {
  it("resolves to a non-Opus id for every subject with the env unset", () => {
    for (const s of SUBJECTS) expect(resolveAgentModel(s, {})).not.toMatch(/opus/i);
  });

  it("the source has no Opus default and no agentModel() call without an argument", () => {
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/DEFAULT_AGENT_MODEL/);
      expect(text, file).not.toMatch(/agentModel\(\s*\)/);
    }
    const claude = readFileSync("src/lib/ai/claude.ts", "utf8");
    // The Opus ids stay in the price table only, so past runs still have a cost.
    expect(claude.match(/claude-opus/g)?.length).toBe(3);
  });
});

describe("A5: prices", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
  it("prices both defaults and still the old ids", () => {
    expect(costFor(DEFAULT_SONNET_MODEL, usage)).toBe(12);
    expect(costFor(DEFAULT_HAIKU_MODEL, usage)).toBe(6);
    expect(costFor("claude-opus-5", usage)).toBe(30);
    expect(costFor("something-unknown", usage)).toBeNull();
  });
});

describe("A6: Haiku limits", () => {
  it("the triage request fits the model's output limit, and Haiku is sent no effort setting", () => {
    expect(TRIAGE_MAX_TOKENS).toBeLessThanOrEqual(maxOutputFor(DEFAULT_HAIKU_MODEL));
    expect(supportsEffort(DEFAULT_HAIKU_MODEL)).toBe(false);
    expect(supportsEffort(DEFAULT_SONNET_MODEL)).toBe(true);
  });
});
