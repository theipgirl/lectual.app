import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { DECK_TITLE } from "@/lib/ui/words";
import { DeckView } from "./deck-view";

export const metadata: Metadata = { title: pageTitle(DECK_TITLE) };

export default async function DeckPage({ searchParams }: { searchParams: Promise<{ view?: string | string[]; at?: string | string[]; deal?: string | string[]; list?: string | string[] }> }) {
  return DeckView({ searchParams });
}
