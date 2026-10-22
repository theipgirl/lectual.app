import { vi } from "vitest";
import { createSseParser, decodeFrame, type CopilotStreamEvent } from "@/lib/copilot/sse";

export const ORG = "22222222-2222-2222-2222-222222222222";
export const LEAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const MATTER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
export type FakeMessage = { content: unknown[]; model: string; usage: Usage };

export const textMessage = (text: string, usage: Partial<Usage> = {}): FakeMessage => ({
  content: [{ type: "text", text, citations: null }],
  model: "claude-sonnet-5",
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
});

export const toolMessage = (calls: Array<{ name: string; input?: unknown }>, usage: Partial<Usage> = {}): FakeMessage => ({
  content: calls.map((c, i) => ({ type: "tool_use", id: `tu-${i}`, name: c.name, input: c.input ?? {} })),
  model: "claude-sonnet-5",
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
});

export type StreamScript = {
  /** Text deltas emitted (in order) before the message resolves. */
  deltas?: string[];
  /** The stream waits on this after its deltas, so a test can hold it open. */
  gate?: Promise<void>;
  /** A thrown error instead of a message. */
  fail?: Error;
  message?: FakeMessage;
};

/** A stand-in for the SDK's `beta.messages.stream()` result: `.on("text")` and `.finalMessage()`. */
function fakeStream(script: StreamScript) {
  const listeners: Array<(delta: string) => void> = [];
  const stream = {
    on(event: string, cb: (delta: string) => void) {
      if (event === "text") listeners.push(cb);
      return stream;
    },
    async finalMessage() {
      for (const d of script.deltas ?? []) listeners.forEach((l) => l(d));
      if (script.gate) await script.gate;
      if (script.fail) throw script.fail;
      return script.message as FakeMessage;
    },
  };
  return stream;
}

/** Mocks @anthropic-ai/sdk; each `stream()` call plays the next script. Returns the recorded request bodies. */
export function mockSdk(scripts: StreamScript[]) {
  const requests: Array<Record<string, unknown>> = [];
  const stream = vi.fn((body: Record<string, unknown>) => {
    requests.push(JSON.parse(JSON.stringify(body)));
    const script = scripts[Math.min(requests.length - 1, scripts.length - 1)];
    return fakeStream(script);
  });
  const create = vi.fn();
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class {
      beta = { messages: { stream, create } };
    },
  }));
  return { requests, stream, create };
}

export function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * The events of a streamed body. `saved` / `save_failed` come after `final` (lectual 0099) and are left out
 * unless asked for, so the tests about the answer keep reading `final` as the last frame.
 */
export function parseBody(text: string, opts: { keepSaveEvents?: boolean } = {}): CopilotStreamEvent[] {
  const parser = createSseParser();
  return parser
    .push(text)
    .map(decodeFrame)
    .filter((e): e is CopilotStreamEvent => e !== null)
    .filter((e) => opts.keepSaveEvents || (e.event !== "saved" && e.event !== "save_failed"));
}

/** Reads a streamed Response to the end. */
export async function readText(res: Response): Promise<string> {
  return await res.text();
}

/** Reads one chunk at a time from a streamed Response body. */
export function chunkReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  return async () => {
    const { done, value } = await reader.read();
    return done ? null : decoder.decode(value);
  };
}

export const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** The few Matter fields the copilot reads; cast, because the full row is irrelevant here. */
export function matterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MATTER_ID,
    org_id: ORG,
    matter_number: "TM-2026-0031",
    title: "AURELIA",
    mark_text: "AURELIA",
    type: "TM",
    status: "open",
    owner_name: null,
    stage_entered_at: new Date().toISOString(),
    stage: { id: "s1", code: "10", label: "Publication", order_index: 10, is_open: true, waiting_on: "uspto" },
    ...overrides,
  };
}

export function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    org_id: ORG,
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    business_name: "Doe Studio",
    mark_text: "DOEWARE",
    last_activity_at: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

type Fn = ReturnType<typeof vi.fn>;

/** Mocks the firm session and the record readers the copilot's tools and context use. */
export function mockFirm(
  opts: {
    session?: unknown;
    listMatters?: Fn;
    getMatter?: Fn;
    getLead?: Fn;
    listLeads?: Fn;
    listUpcomingDeadlines?: Fn;
  } = {},
) {
  const session = opts.session ?? { kind: "ok", user: { id: "user-1" }, org: { id: ORG } };
  const fns = {
    listMatters: opts.listMatters ?? vi.fn(async () => []),
    getMatter: opts.getMatter ?? vi.fn(async () => null),
    getLead: opts.getLead ?? vi.fn(async () => null),
    listLeads: opts.listLeads ?? vi.fn(async () => []),
    listUpcomingDeadlines: opts.listUpcomingDeadlines ?? vi.fn(async () => []),
  };
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => session) }));
  vi.doMock("@/lib/matters", () => ({
    listMatters: fns.listMatters,
    getMatter: fns.getMatter,
    listMatterDeadlines: vi.fn(async () => []),
    listUpcomingDeadlines: fns.listUpcomingDeadlines,
    activityForMatter: vi.fn(async () => []),
    recentActivity: vi.fn(async () => []),
    deadlineKindLabel: (kind: string) => kind.replace(/_/g, " "),
  }));
  vi.doMock("@/lib/pipeline", () => ({ listLeads: fns.listLeads, getLead: fns.getLead }));
  return fns;
}
