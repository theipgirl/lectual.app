import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Reports") };

/**
 * There is no bare "Reports" section — each rail parent (Communication,
 * Intake, Active matters, IP.OS) opens its own report view. This exists only
 * so /dashboard/reports/ itself lands somewhere real instead of 404ing.
 */
export default function ReportsIndex() {
  redirect("/dashboard/reports/communication/");
}
