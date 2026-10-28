import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { RunNowInput } from "../../src/lib/agents/run-now";

/**
 * The card's controls with each state a run can leave behind. useActionState is stood in for so the state a
 * finished run returns can be put in front of the component without a browser.
 */

const ready: Omit<RunNowInput, "running"> = {
  agent: "intake-triage",
  role: "owner",
  enabled: true,
  autopilot: "clear",
  aiConfigured: true,
  databaseUpdate: "applied",
};

async function controls(runState: Record<string, unknown>, opts: { running?: boolean; run?: Partial<Omit<RunNowInput, "running">> } = {}) {
  let call = 0;
  vi.doMock("react", async () => {
    const actual = await vi.importActual<typeof import("react")>("react");
    return {
      ...actual,
      // First call is the settings form, second is Run now.
      useActionState: () => (call++ % 2 === 0 ? [{}, () => {}, false] : [runState, () => {}, Boolean(opts.running)]),
    };
  });
  vi.doMock("@/app/dashboard/agents/actions", () => ({ runAgentNowAction: vi.fn(), saveAgentSettingAction: vi.fn() }));
  const { AgentControls } = await import("../../src/components/agents/AgentControls");
  return renderToStaticMarkup(
    createElement(AgentControls, { agent: "intake-triage", name: "Intake triage", enabled: true, autonomy: "draft", canManage: true, runInput: { ...ready, ...opts.run } }),
  );
}
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const runButton = (html: string) => /<button[^>]*>(?:Run now|Running\.\.\.)<\/button>/.exec(html)?.[0] ?? "";

describe("Run now controls: the result line", () => {
  beforeEach(() => vi.resetModules());

  it("idle: an enabled button and no line at all", async () => {
    const html = await controls({});
    expect(runButton(html)).toContain("Run now");
    expect(runButton(html)).not.toContain("disabled");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it("success: the summary and 'N read, M drafts written', not an alert", async () => {
    const html = await controls({ ok: true, message: "Scored 3 leads.", itemsIn: 5, draftsOut: 2 });
    expect(decode(html)).toContain(">Scored 3 leads. · 5 read, 2 drafts written<");
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("skipped: the summary with the skip wording", async () => {
    const html = await controls({ ok: true, skipped: true, message: "No approval queue is connected.", itemsIn: 0, draftsOut: 0 });
    expect(html).toContain(">Skipped. No approval queue is connected.<");
    expect(html).not.toContain('role="alert"');
  });

  it("failure: 'The run failed: <error>' in the alert style", async () => {
    const html = await controls({ error: "The run failed: model overloaded" });
    expect(html).toMatch(/<p role="alert"[^>]*>The run failed: model overloaded<\/p>/);
    expect(html).toContain("var(--wine)");
  });

  it("a refusal the action sent back shows as the alert", async () => {
    const html = await controls({ error: "Assistants paused for your firm, so none of them run. Resume them first." });
    expect(html).toContain('role="alert"');
  });
});

describe("Run now controls: running and blocked", () => {
  beforeEach(() => vi.resetModules());

  it("while running: the button reads 'Running...', is disabled, and the line says why", async () => {
    const html = await controls({}, { running: true });
    expect(runButton(html)).toContain("Running...");
    expect(runButton(html)).toContain("disabled");
    expect(html).toContain("Running. This can take a minute.");
    expect(html).toContain('aria-describedby="run-reason-intake-triage"');
    expect(html).not.toContain('role="alert"');
  });

  it("blocked: the button is disabled and described by the visible reason", async () => {
    const html = await controls({}, { run: { enabled: false } });
    expect(runButton(html)).toContain("disabled");
    expect(runButton(html)).toContain('aria-describedby="run-reason-intake-triage"');
    expect(html).toContain('<p id="run-reason-intake-triage" class="lx-note" style="margin:0">Switch the assistant on first.</p>');
  });

  it("the unreadable Autopilot reason is the warn note", async () => {
    const html = await controls({}, { run: { autopilot: "unreadable" } });
    expect(decode(html)).toContain("We couldn't check whether assistants are paused, so nothing will run.");
    expect(html).toMatch(/id="run-reason-intake-triage"[^>]*color:var\(--warn\)/);
  });

  it("a blocked button and a leftover result can show together; only the error is an alert", async () => {
    const html = await controls({ ok: true, message: "Ran.", itemsIn: 1, draftsOut: 0 }, { run: { enabled: false } });
    expect(html).toContain("Switch the assistant on first.");
    expect(html).toContain("Ran. · 1 read, 0 drafts written");
    expect(html).not.toContain('role="alert"');
  });
});
