import type { PillTone } from "@/lib/ui/tones";

export type { PillTone };

/** The one status pill. A page picks a tone from the meaning table in `src/lib/ui/tones.ts`, never a colour. */
export function Pill({ tone = "mute", wrap, num, title, children }: { tone?: PillTone; wrap?: boolean; num?: boolean; title?: string; children: React.ReactNode }) {
  const cls = `lx-pill lx-pill-${tone}${wrap ? " lx-pill-wrap" : ""}${num ? " lx-pill-num" : ""}`;
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}
