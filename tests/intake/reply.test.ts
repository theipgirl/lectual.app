import { describe, it, expect } from "vitest";
import { replyState } from "@/lib/intake";

describe("replyState", () => {
  it("both null -> unknown", () => {
    expect(replyState({ last_inbound_at: null, last_outbound_at: null })).toBe("unknown");
  });

  it("inbound set, outbound null -> replied", () => {
    expect(
      replyState({ last_inbound_at: "2026-09-10T00:00:00.000Z", last_outbound_at: null }),
    ).toBe("replied");
  });

  it("outbound set, inbound null -> awaiting", () => {
    expect(
      replyState({ last_inbound_at: null, last_outbound_at: "2026-09-10T00:00:00.000Z" }),
    ).toBe("awaiting");
  });

  it("inbound strictly after outbound -> replied", () => {
    expect(
      replyState({
        last_inbound_at: "2026-09-12T00:00:00.000Z",
        last_outbound_at: "2026-09-10T00:00:00.000Z",
      }),
    ).toBe("replied");
  });

  it("outbound strictly after inbound -> awaiting", () => {
    expect(
      replyState({
        last_inbound_at: "2026-09-10T00:00:00.000Z",
        last_outbound_at: "2026-09-12T00:00:00.000Z",
      }),
    ).toBe("awaiting");
  });

  it("equal timestamps -> awaiting", () => {
    const t = "2026-09-10T00:00:00.000Z";
    expect(replyState({ last_inbound_at: t, last_outbound_at: t })).toBe("awaiting");
  });
});
