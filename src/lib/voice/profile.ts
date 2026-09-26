export type VoiceProfile = {
  tone: string;
  attorney_name?: string | null;
  signature?: string | null;
};

export const DEFAULT_VOICE: VoiceProfile = {
  tone: "warm, precise, professional",
  attorney_name: null,
  signature: null,
};

/** Builds the per-tenant voice preamble injected into agent system prompts. */
export function buildVoiceSystemPrompt(profile: Partial<VoiceProfile>): string {
  const v = { ...DEFAULT_VOICE, ...profile };
  const lines = [
    `Write in this firm's voice: ${v.tone}.`,
    v.attorney_name ? `You represent ${v.attorney_name}.` : null,
    v.signature ? `Sign communications as "${v.signature}".` : null,
    "You are not a lawyer and do not give legal advice; route legal questions to the attorney.",
  ].filter(Boolean);
  return lines.join(" ");
}
