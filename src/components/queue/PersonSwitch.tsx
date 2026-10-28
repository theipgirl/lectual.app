import Link from "next/link";
import type { SwitchCounts, WhoFilter } from "@/lib/queue/routing";
import { whoParam } from "@/lib/queue/routing";

/**
 * "Mine (N) · Rebecca (N) · Everyone (N)": who the list is filtered to. Links keep the status tab. Counts are
 * numbers only when the queue was read; the page does not draw this at all otherwise.
 */
export function PersonSwitch({ status, who, counts, mineEnabled }: { status: string; who: WhoFilter; counts: SwitchCounts; mineEnabled: boolean }) {
  const href = (value: string) => `/dashboard/queue/?status=${status}&who=${encodeURIComponent(value)}`;
  const current = whoParam(who);
  const pills: { key: string; label: string }[] = [
    ...(mineEnabled ? [{ key: "me", label: `Mine (${counts.mine})` }] : []),
    ...counts.people.map((p) => ({ key: p.userId, label: `${p.name} (${p.count})` })),
    { key: "all", label: `Everyone (${counts.everyone})` },
  ];
  return (
    <nav aria-label="Whose approvals" className="lx-segs" data-queue-who>
      {pills.map((p) => (
        <Link key={p.key} href={href(p.key)} prefetch={false} aria-current={p.key === current ? "page" : undefined}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
