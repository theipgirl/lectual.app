import { describe, it, expect } from "vitest";
import { buildVoiceSystemPrompt, DEFAULT_VOICE } from "@/lib/voice/profile";

describe("voice profile", () => {
  it("injects firm tone + attorney name into a system prompt", () => {
    const p = buildVoiceSystemPrompt({
      tone: "warm and editorial",
      attorney_name: "Rebecca P. Beliard",
      signature: "RPB Law",
    });
    expect(p).toContain("warm and editorial");
    expect(p).toContain("Rebecca P. Beliard");
    expect(p).toContain('Sign communications as "RPB Law"');
  });
  it("uses defaults when profile is empty", () => {
    const p = buildVoiceSystemPrompt({});
    expect(p).toContain(DEFAULT_VOICE.tone);
  });
  it("always includes the not-a-lawyer guardrail", () => {
    expect(buildVoiceSystemPrompt({})).toContain("not a lawyer");
  });
});
