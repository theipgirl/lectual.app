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
    id: "review-board-lanes",
    title: "Weekly review, Board (first lane and strips cut away to show the waiting cards)",
    designBoard: "ReviewBoard",
    viewport: "desktop",
    pathname: "/dashboard/review/",
    prepare,
    render: review(),
    transformHtml: (html) => html.replace(/<section class="lx-card rv-strip"[\s\S]*?<\/section>/g, "").replace(/<section class="lx-card rv-person"[\s\S]*?<\/section>/, ""),
  },
  {
    id: "review-board-phone",
    title: "Weekly review, Board (phone)",
    designBoard: "ReviewBoard",
    viewport: "phone",
    pathname: "/dashboard/review/",
    prepare,
    render: review(),
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

screens.push({
  id: "review-board-rest-open",
  title: "Weekly review, Board (USPTO / On track lists opened)",
  designBoard: "ReviewBoard",
  viewport: "desktop",
  pathname: "/dashboard/review/",
  prepare,
  render: review(),
  transformHtml: (html) =>
    html
      .replace(/<details class="lx-card lx-disclosure"/g, '<details open="" class="lx-card lx-disclosure"')
      .replace(/^/, "<style>.rv-kpis,.rv-strips,.rv-board{display:none}</style>"),
});

screens.push({
  id: "review-board-phone-lanes",
  title: "Weekly review, Board (phone, lanes)",
  designBoard: "ReviewBoard",
  viewport: "phone",
  pathname: "/dashboard/review/",
  prepare,
  render: review(),
  transformHtml: (html) => "<style>.rv-kpis,.rv-strips{display:none}</style>" + html,
});
