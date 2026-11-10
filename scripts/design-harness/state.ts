/**
 * Mutable harness state. The loader mocks in setup.ts read from here, so a screen sets what the loaders "return"
 * (queue items, review rows, ...) in its render() before building its element.
 */
import type { QueueItem } from "@/lib/queue/api";
import type { CardState } from "@/lib/queue/deck";
import type { DeckSummary } from "@/lib/queue/deck-summary";
import type { TodayConsultsResult } from "@/lib/calendar/consult-sources";
import type { OwnerDeadline, OwnerProposal } from "@/lib/today/owner-rules";
import type { ReviewLoad } from "@/lib/review/load";

export type HarnessState = {
  /** Path the mocked usePathname() returns (drives the active rail row). */
  pathname: string;
  pending: QueueItem[];
  approved: QueueItem[];
  rejected: QueueItem[];
  cardState: CardState;
  deckSummary: DeckSummary;
  consults: TodayConsultsResult;
  deadlines: OwnerDeadline[];
  proposals: OwnerProposal[];
  review: ReviewLoad;
};

export const state = {} as HarnessState;
