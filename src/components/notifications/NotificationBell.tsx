import { loadBell } from "@/lib/notifications";
import { listMemberDirectory } from "@/lib/members/directory";
import { BellPopover, type BellCount, type BellList } from "./BellPopover";
import { firstNameOf, toRowViews } from "./view";

/** User id to first name, for "Taylor assigned you…". A failed read gives {}: the sentences say "Someone". */
export async function loadActorNames(): Promise<Record<string, string>> {
  try {
    const names: Record<string, string> = {};
    for (const member of await listMemberDirectory()) {
      const name = firstNameOf(member);
      if (name) names[member.userId] = name;
    }
    return names;
  } catch {
    return {};
  }
}

/**
 * The bell in the top bar. Loaded on the server so the count is there on first
 * paint, and it can never take the layout down: a failed read renders the "!"
 * state, not an error and not a zero.
 */
export async function NotificationBell() {
  let count: BellCount = { status: "unavailable" };
  let list: BellList = { status: "unavailable" };
  try {
    const bell = await loadBell();
    if (bell.count.status === "ok") count = { status: "ok", unread: bell.count.data };
    if (bell.list.status === "ok") {
      list = { status: "ok", rows: toRowViews(bell.list.data, await loadActorNames()) };
    }
  } catch {
    // Both stay "unavailable".
  }
  return <BellPopover count={count} list={list} />;
}
