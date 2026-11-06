/** The firm's stages a lead can be sent to from the weekly review: only `lost` and `nurture`. Pure. */
export type CloseStage = { id: string; name: string; category: "lost" | "nurture" };

export function closeStagesOf(stages: readonly { id: string; name: string | null; category: string | null }[]): CloseStage[] {
  return stages
    .filter((s): s is { id: string; name: string; category: "lost" | "nurture" } => (s.category === "lost" || s.category === "nurture") && !!s.name)
    .map((s) => ({ id: s.id, name: s.name, category: s.category }));
}
