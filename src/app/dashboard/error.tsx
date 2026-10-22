"use client";

import { DashboardError } from "@/components/shell/DashboardError";

export default function DashboardErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DashboardError reset={reset} />;
}
