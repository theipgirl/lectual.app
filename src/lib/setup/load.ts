import "server-only";
import { buildSetupState, type SetupReaders } from "./build";
import { liveReaders } from "./readers";
import type { SetupState } from "./types";

/** The firm's setup state, read for the caller's active org. Never throws; a failed read is that item's "couldn't check". */
export function loadSetupState(readers: SetupReaders = liveReaders): Promise<SetupState> {
  return buildSetupState(readers);
}
