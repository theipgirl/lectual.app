import { notFound } from "next/navigation";

/**
 * Every /dashboard/... URL no real page claims: a mistyped link, an old
 * bookmark, a section that doesn't exist yet. Real routes always win over this
 * catch-all, so it only ever sees dead ends. It never explains what a firm
 * lacks (that would tell a caller which firms have it), and the 404 renders
 * inside the workspace chrome via ../not-found.tsx.
 */
export default function DashboardUnknownPath(): never {
  notFound();
}
