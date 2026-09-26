import { describe, it, expect, vi } from "vitest";

import { createLawmaticsClient } from "@/lib/lawmatics/client";
import { prospectsPayload } from "../__fixtures__/lawmatics.fixture";

/**
 * The include fallback must announce itself.
 *
 * When Lawmatics rejects `include=stage,practice_area,contact`, the client
 * retries the page without it so the pull still returns something. That is the
 * right behaviour — but it used to be SILENT, and the consequence is uniquely
 * misleading: the record count comes back complete, so nothing looks wrong,
 * while every relationship-backed field (stage, contact) is null. The planner
 * then honestly reports "this record has no stage" for every record, which
 * reads as a fact about the firm's data rather than about our request.
 *
 * A real dry run against RPB's book returned 450 stage-less records, and the
 * only way to tell "they genuinely have no stage" from "we never asked for it"
 * was to go and look in Lawmatics by hand. These tests exist so that question
 * is answered on screen.
 */
function fakeFetch(handler: (url: string) => { status: number; body: unknown }) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    urls.push(href);
    const { status, body } = handler(href);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  return { fetchImpl, urls };
}

describe("listAll — the include fallback reports itself", () => {
  it("flags includeDropped when the server rejects the include", async () => {
    const { fetchImpl, urls } = fakeFetch((url) =>
      url.includes("include=")
        ? { status: 422, body: { error: "unknown include path" } }
        : { status: 200, body: prospectsPayload([{ id: "1", matterName: "M1" }]) },
    );
    const client = createLawmaticsClient({ token: "t", fetchImpl });
    const res = await client.listAll("/prospects", { include: "stage,practice_area,contact" });

    // The retry happened and records still came back — the fallback is intact.
    expect(res.records).toHaveLength(1);
    expect(urls.some((u) => u.includes("include="))).toBe(true);
    // ...but it is no longer silent.
    expect(res.includeDropped).toBe(true);
    expect(res.includeDroppedReason).toMatch(/422/);
    // Deliberately NOT folded into `truncated`: the count is complete.
    expect(res.truncated).toBe(false);
  });

  it("leaves includeDropped false on a normal pull", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: prospectsPayload([{ id: "1", matterName: "M1", stage: "New PNC" }]),
    }));
    const client = createLawmaticsClient({ token: "t", fetchImpl });
    const res = await client.listAll("/prospects", { include: "stage" });
    expect(res.includeDropped).toBe(false);
    expect(res.includeDroppedReason).toBeUndefined();
  });

  it("still propagates a non-include failure instead of masking it as a dropped include", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, body: { error: "boom" } }));
    const client = createLawmaticsClient({ token: "t", fetchImpl });
    await expect(client.listAll("/prospects", { include: "stage" })).rejects.toThrow();
  });
});
