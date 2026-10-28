/**
 * Did the calendar's own reads land? A null means that read failed (a read that
 * found nothing is an empty array, not null). When every read the view needed
 * failed, the page says so instead of drawing a blank week: an empty grid over
 * a failed read tells a firm nothing is due.
 */
export type CalendarReadState =
  | { kind: "ok" }
  | { kind: "partial"; failed: string[] }
  | { kind: "unavailable" };

export function calendarReadState(reads: {
  deadlines: unknown | null;
  tasks: unknown | null;
  /** `undefined` when the view does not read events (agenda). */
  events: unknown | null | undefined;
}): CalendarReadState {
  const attempted: [string, boolean][] = [
    ["docket dates", reads.deadlines !== null],
    ["tasks", reads.tasks !== null],
  ];
  if (reads.events !== undefined) attempted.push(["consults and meetings", reads.events !== null]);
  const failed = attempted.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length === 0) return { kind: "ok" };
  if (failed.length === attempted.length) return { kind: "unavailable" };
  return { kind: "partial", failed };
}
