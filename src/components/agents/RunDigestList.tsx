import Link from "next/link";
import type { RunDigest } from "@/lib/agents/digest";

/**
 * The "Overnight run" digest body, shared by Today and the Agents page.
 * Every number in it came from agent_run (src/lib/agents/digest.ts); a log
 * that couldn't be read says so and never reads as "nothing ran".
 */
export function RunDigestList({ digest, paused }: { digest: RunDigest; paused: boolean }) {
  if (digest.status === "unavailable") {
    return (
      <p className="lx-note" role="alert" style={{ margin: 0, color: "var(--warn)" }}>
        The run log couldn&apos;t be read, so we can&apos;t say what the agents did. This is not &ldquo;nothing ran&rdquo;.
      </p>
    );
  }
  if (digest.lines.length === 0 && digest.failures.length === 0) {
    return (
      <p className="lx-note" style={{ margin: 0 }}>
        {paused
          ? `Autopilot is paused, so no agent ran in the last ${digest.windowHours} hours.`
          : `No agent ran in the last ${digest.windowHours} hours.`}
      </p>
    );
  }
  return (
    <ul className="lx-list">
      {digest.failures.map((f) => (
        <li key={`f-${f.agent}`} style={{ padding: "8px 0", display: "grid", gap: 2 }}>
          <span style={{ color: "var(--wine)", fontWeight: 500 }}>{f.text}</span>
          <span className="lx-note">{f.reason}</span>
          <Link href={f.action.href} className="lx-note" style={{ color: "var(--ox)", fontWeight: 500 }}>
            {f.action.label} →
          </Link>
        </li>
      ))}
      {digest.lines.map((l) => (
        <li key={l.agent} style={{ padding: "8px 0", display: "grid", gap: 2 }}>
          <span>
            <b style={{ color: "var(--ink)", fontWeight: 500 }}>{l.name}</b> <span className="lx-note">{l.text}</span>
          </span>
          {l.tone === "attention" && (
            <Link href={l.href} className="lx-note" style={{ color: "var(--ox)" }}>
              Open →
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
