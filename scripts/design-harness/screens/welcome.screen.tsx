import { WelcomeDealView } from "@/components/onboarding/WelcomeDeal";
import { welcomeCards } from "@/lib/onboarding/welcome-deal";
import { resetState } from "../fixtures";
import { state } from "../state";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

const noop = () => {};
const prepare = () => {
  resetState();
  state.pathname = "/dashboard/";
};
const cards = welcomeCards(["07:00", "14:00"]);
const draw = (index: number) => (
  <OwnerShell>
    <div style={{ minHeight: 600 }} />
    <WelcomeDealView cards={cards} index={index} onNext={noop} onBack={noop} onSkip={noop} />
  </OwnerShell>
);

// The board (Welcome) shows the four cards side by side; she sees one at a time, so each build screen is one card. The
// design crop is that card's column on the board (card + its two moves).
const COL_W = 314;
const crop = (i: number): [number, number, number, number] => [Math.round(70 + i * 328.5), 190, COL_W, 480];

export const screens: Screen[] = cards.flatMap((c, i) => [
  {
    id: `welcome-${i + 1}`,
    title: `Welcome deal, card ${i + 1} (${c.id})`,
    designBoard: "Welcome",
    viewport: "desktop" as const,
    designCrop: crop(i),
    pathname: "/dashboard/",
    prepare,
    render: () => draw(i),
    note: "Real WelcomeDealView over the owner shell. Card text differs from the board on purpose (moves, deal times, first steps).",
  },
  {
    id: `welcome-${i + 1}-phone`,
    title: `Welcome deal, card ${i + 1}, phone`,
    designBoard: "Welcome",
    viewport: "phone" as const,
    designCrop: crop(i),
    pathname: "/dashboard/",
    prepare,
    render: () => draw(i),
    note: "No phone board for the welcome deal; the design side is the desktop card.",
  },
]);
