import type { PillTone } from "@/lib/ui/tones";

export type { PillTone };

/** The one status pill. A page picks a tone from the meaning table in `src/lib/ui/tones.ts`, never a colour. */
export function Pill({ tone = "mute", wrap, num, title, className, children, ...rest }: { tone?: PillTone; wrap?: boolean; num?: boolean; title?: string; className?: string; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLSpanElement>, "className" | "title" | "children"> & { [key: `data-${string}`]: string | boolean | undefined }) {
  const cls = `lx-pill lx-pill-${tone}${wrap ? " lx-pill-wrap" : ""}${num ? " lx-pill-num" : ""}${className ? ` ${className}` : ""}`;
  return (
    <span className={cls} title={title} {...rest}>
      {children}
    </span>
  );
}
