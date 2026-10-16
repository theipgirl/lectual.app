import { describe, it, expect } from "vitest";
import { outcomeText } from "@/components/queue/format";

describe("what the reviewer is told after approving", () => {
  it("never says 'approved' without saying where the message is now", () => {
    for (const send of ["drafted", "mailbox-google", "mailbox-microsoft", "sent", "manual", "failed", "mailbox-failed", undefined, "none"]) {
      const out = outcomeText("approve", send)!;
      expect(out.text.length).toBeGreaterThan(20);
      if (send !== "sent") expect(out.text).not.toMatch(/\bsent from\b/);
    }
  });
  it("names the approver's own mail client when the draft went there", () => {
    expect(outcomeText("approve", "mailbox-google")!.text).toContain("your Gmail");
    expect(outcomeText("approve", "mailbox-microsoft")!.text).toContain("your Outlook");
  });
  it("treats no channel as 'nothing has gone out', not as success", () => {
    expect(outcomeText("approve", undefined)).toMatchObject({ tone: "warn", text: expect.stringContaining("nothing has gone out") });
  });
  it("ignores anything that isn't an approve or reject", () => {
    expect(outcomeText("<script>", "sent")).toBeNull();
  });
});
