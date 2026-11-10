import ReviewPage from "@/app/dashboard/review/page";
import { state } from "../state";
import { resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

const review = (view?: "sheet") =>
  async function renderReview() {
    const page = await ReviewPage({ searchParams: Promise.resolve(view ? { view } : {}) });
    return <OwnerShell>{page}</OwnerShell>;
  };
const prepare = () => {
  resetState();
  state.pathname = "/dashboard/review/";
};

export const screens: Screen[] = [
  {
    id: "review-board",
    title: "Weekly review, Board",
    designBoard: "ReviewBoard",
    viewport: "desktop",
    pathname: "/dashboard/review/",
    prepare,
    render: review(),
    note: "Real ReviewPage (async) with loadReview mocked. The 'Since Feb 2026' filter applies to the sample rows.",
  },
  {
    id: "review-sheet",
    title: "Weekly review, Sheet",
    designBoard: "ReviewSheet",
    viewport: "desktop",
    pathname: "/dashboard/review/",
    prepare,
    render: review("sheet"),
  },
];
