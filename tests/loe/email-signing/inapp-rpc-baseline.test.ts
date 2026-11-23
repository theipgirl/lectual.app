import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(fn: () => unknown) => void>(),
  runAcceptanceFollowups: vi.fn(async () => {}),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

import { acceptPublicProposal } from "@/lib/proposals/public";
import { NOW, TOKEN, browserSigning, world } from "../../proposals/signing-world";

/**
 * T1 (second half): the in-app signing path writes the SAME rpc arguments as before the sprint, with `LOE_EMAIL_SIGNING` unset
 * and with it `on` while another condition fails (no mail entry for the firm). Recorded from commit 62868c1 (WRITE_BASELINE=1).
 * The snapshot's `acceptedAt` / `accepted_at` are this test's fixed clock.
 */
const FILE = join(__dirname, "__baseline__", "inapp-rpc-args.json");

beforeEach(() => {
  mocks.after.mockReset();
  vi.unstubAllEnvs();
});

async function signOnce(): Promise<unknown> {
  const w = world({ proposal: { expires_on: "2026-12-31" } });
  const b = await browserSigning(w.db);
  const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing, { ip: "203.0.113.7", userAgent: "TestBrowser/1.0" });
  if (!r.ok) throw new Error(r.message);
  return w.rpcCalls.map((c) => ({ fn: c.fn, args: c.args }));
}

describe("T1: the in-app path's rpc arguments are unchanged", () => {
  it("switch unset", async () => {
    vi.stubEnv("LOE_EMAIL_SIGNING", "");
    const calls = await signOnce();
    if (process.env.WRITE_BASELINE === "1") {
      mkdirSync(join(__dirname, "__baseline__"), { recursive: true });
      writeFileSync(FILE, `${JSON.stringify(calls, null, 2)}\n`);
    }
    expect(existsSync(FILE)).toBe(true);
    expect(JSON.parse(JSON.stringify(calls))).toEqual(JSON.parse(readFileSync(FILE, "utf8")));
  });

  it("switch on but the firm has no mail entry (gate off)", async () => {
    vi.stubEnv("LOE_EMAIL_SIGNING", "on");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("FIRM_CLIENT_MAIL_FROM", "");
    const calls = await signOnce();
    expect(JSON.parse(JSON.stringify(calls))).toEqual(JSON.parse(readFileSync(FILE, "utf8")));
  });
});
