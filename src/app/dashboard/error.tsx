"use client";

import { DashboardError } from "@/components/shell/DashboardError";

// `unstable_retry` re-fetches and re-renders the page; `reset` only clears the boundary and never re-runs the server work.
export default function DashboardErrorBoundary({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <DashboardError retry={unstable_retry} />;
}
