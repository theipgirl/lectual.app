/**
 * "19A. OA Issued" / "19A · OA Issued" / "19A – OA Issued" / "19A - OA Issued" -> "OA Issued".
 * A name with no leading code ("Application Filed") comes back trimmed and unchanged. If stripping would leave
 * nothing ("17."), the trimmed original is returned. The code is an ordering aid, never part of a stage's name.
 */
export function stripStageCode(label: string): string {
  const stripped = label.replace(/^\s*\d+[A-Za-z]?(?:\s*[.·:)\-–]\s*|\s+)/, "").trim();
  return stripped === "" ? label.trim() : stripped;
}
