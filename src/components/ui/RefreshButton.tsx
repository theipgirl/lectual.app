"use client";

import { useRouter } from "next/navigation";
import { REFRESH } from "@/lib/ui/words";

/** The one Refresh control, drawn next to a failed read. */
export function RefreshButton({ label = REFRESH }: { label?: string }) {
  const router = useRouter();
  return (
    <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => router.refresh()}>
      {label}
    </button>
  );
}
