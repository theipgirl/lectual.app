# Design harness (not shipped, not a route)

Renders owner-view screens with the app's REAL components and fixed sample data, screenshots them, and puts each next to
its design board. Everything lives in `scripts/design-harness/`; `out/` is gitignored.

## Run

```
pnpm build                       # once, to get compiled CSS (.next/static/chunks/*.css and .next/static/media/*)
node scripts/design-harness/run.mjs [screenId ...]
```

No ids = every screen. The command is render + shoot + compare:

1. **render**: `vitest run -c scripts/design-harness/vitest.config.mts` (only `scripts/design-harness/**/*.render.tsx`; the root
   `pnpm test` never sees these files, checked with `vitest list`). Writes `out/<id>.html` (self-contained: every compiled CSS
   file is copied to `out/css/`, the next/font files to `out/media/`, plus the Google Fonts link) and `out/manifest.json`.
2. **shoot**: `shoot.mjs` serves `out/` and screenshots with Playwright at 1440x900 (desktop) or 375x812 (phone), full page,
   DPR 1, to `out/shots/<id>.png`. Google Fonts (and the font files) are fetched with curl and cached in `out/font-cache`,
   because Chromium in the sandbox does not use the proxy. The log line per screen says whether each of the three faces loaded.
3. **compare**: `python3 -I compare.py` writes, for each screen, `out/pairs/<id>.png` (design left, build right, labelled),
   `out/pairs-small/<id>.png` (that pair at <=800px wide) and `out/pairs-stack/<id>.png` (design above build, 800 wide, easier to
   read for desktop pages).

Env: `DESIGN_SHOTS` = folder of design board PNGs (default `$SCRATCH/shots/design`). Never open a full-size PNG: use `pairs-small`
or `pairs-stack`. Only look at the pair of the screen you changed.

Run a single step by hand: `HARNESS_SCREENS=deck-list pnpm exec vitest run -c scripts/design-harness/vitest.config.mts`,
`node scripts/design-harness/shoot.mjs deck-list`, `python3 -I scripts/design-harness/compare.py deck-list`. A partial render
merges into the existing manifest, so other screens keep their entries.

## How it renders async server pages

`renderToPipeableStream` (React 19 Fizz) awaits async server components, so the REAL async pages (`OwnerToday`, the deck page,
the weekly review page) render as they are. Their loaders are mocked in `setup.ts` (`vi.mock`), reading from `state.ts`; the
sample data is in `fixtures.ts` (invented names, clock frozen at Tue 10 Nov 2026 09:30 Eastern; the design says "Mon 10", an
unavoidable weekday difference if the year is kept so the review's "since Feb 2026" filter keeps the sample rows). A screen sets
what the loaders return in `prepare()`, either by editing the `state` object after `resetState()` or by changing `fixtures.ts`.
So **no presentational split is needed to get a screen into the harness**; split only if you want to.

`shell.tsx` (`OwnerShell`) draws the same header / Rail / content / MobileBar as `src/app/dashboard/layout.tsx` for the owner view
(`visibleNav` -> `drawnNav` -> `shellFor`, real `Rail`, `MobileBar`, `AccountMenu`, `FirmWordmark`, `BellPopover` with a sample
count). If the layout changes, mirror it there. `usePathname()` is mocked to `state.pathname` (set by `Screen.pathname`).

## Add a screen

Add (or extend) a `screens/<name>.screen.tsx` exporting `screens: Screen[]` (type in `registry.ts`):

```tsx
export const screens: Screen[] = [{
  id: "review-cards",              // file name for html / shot / pair
  title: "Weekly review, Cards",
  designBoard: "ReviewBoard",      // $DESIGN_SHOTS/<designBoard>.png
  viewport: "desktop",             // desktop 1440x900 | phone 375x812
  designCrop: [x, y, w, h],        // optional, see below
  pathname: "/dashboard/review/",
  prepare: () => { resetState(); state.pathname = "/dashboard/review/"; },
  render: async () => <OwnerShell>{await ReviewPage({ searchParams: Promise.resolve({ view: "cards" }) })}</OwnerShell>,
  transformHtml: (html) => html,   // optional string edit, e.g. to open a <details>
}];
```

A new loader the page reads needs a `vi.mock` in `setup.ts` and a field in `state.ts`. The file name must end in `.screen.tsx`
(`render.render.tsx` finds them) and must NOT end in `.render.tsx` or `.test.tsx`.

## Crops (design boards with several phones)

`designCrop: [x, y, w, h]` is in pixels of the full-size design PNG. The phone boards hold phones side by side; each phone frame
is 375 wide INCLUDING a 10px dark bezel (so the screen inside is 355 wide) and starts at y=61, 812 tall:

- `PhoneToday` (1000x960): phone 1 (`03 Simple Today`) x=40, phone 2 (`More opened`) x=475.
- `PhoneDeckA` (1700x960): phones at x=40, 455, 870, 1285 (pitch 415). A = 1 One-tap Yes, 2 Open to review, 3 Internal briefing, 4 The 5-second hold.
- `PhoneDeckB` (1700), `PhoneDeckC` (1285), `PhoneDeckD` (870), `PhoneItem` (1285), `PhoneP2` (870): same pitch, check with a downscale.

So phone n of a board: `[40 + 415 * (n - 1), 61, 375, 812]`. Find any other box by downscaling the board
(`python3 -I` + PIL, `resize` to <=800 wide) and multiplying coordinates back up. A scan of one pixel row for dark runs finds the bezels.

## Registered screens (before any redesign: CURRENT components)

| id | design board | real components |
|----|--------------|-----------------|
| today-desktop | Main | `OwnerToday` (async, loaders mocked) in `OwnerShell` |
| today-phone | PhoneToday (crop phone 1) | same, 375px: rail hides, `MobileBar` shows |
| deck-cards | DeckYes | deck `page.tsx` (async), `DeckFrame`, `ApprovalCard` |
| deck-cards-phone | PhoneDeckA (crop phone 1) | same, 375px |
| deck-list | SeeAll | deck page, view=list |
| deck-board | ApprovalsBoard | deck page, view=board |
| account-menu | AccountMenu | `AccountMenu` forced open by `transformHtml` |
| review-board | ReviewBoard | review `page.tsx` (async), board view |
| review-sheet | ReviewSheet | review page, `?view=sheet` |

## Known limits

- The page's own `<Link prefetch>`, server actions and `useActionState` are inert in static markup; hover/open/hold states
  (Yes hold toast, reject form, hand-off picker) are client state and are not drawn. To show one, a screen needs the component's
  initial state exposed as a prop (a small `src` change) or a `transformHtml` edit.
- Sample data differs from the boards' copy (names reuse the boards' invented ones where easy); texts that come from the
  data (queue headlines, deck order, week dots) will not match word for word.
- Dark mode is not rendered (Chromium is forced to light).
