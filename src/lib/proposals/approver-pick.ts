/** A firm names at most this many approvers (the same limit `validate.ts` enforces on save). */
export const MAX_APPROVERS = 10;

export type ApproverPick = {
  /** "2 of 10 chosen". */
  summary: string;
  /** Whether the box for `userId` is disabled: unchecked boxes lock once the limit is reached. */
  disabled: (userId: string) => boolean;
};

export function approverPick(chosen: readonly string[], max: number = MAX_APPROVERS): ApproverPick {
  const set = new Set(chosen);
  return {
    summary: `${set.size} of ${max} chosen`,
    disabled: (userId) => set.size >= max && !set.has(userId),
  };
}
