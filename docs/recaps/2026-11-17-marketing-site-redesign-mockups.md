# Session recap, 2026-11-17: marketing site redesign, three mockups

## What was asked

Redesign the Lectual site, starting from `lectual.app/firms/`. Taylor's words: it "looks a little
bit boring", the type is "kind of small", it should look like something firms would want to use,
with micro animations, scroll effects like pin scrolling, and a logo loader. Also: "maybe we use
Astro instead of Next.js". She asked to skip the questions and see mockups.

## What was found

- **Where the site lives.** `lectual.app/` and `/firms/` are served by `theipgirl/lectual`
  (`src/app/(marketing)/`), not by this repo. `/` is not a page: it redirects by host and sign-in
  (a firm's own domain to its assessment, a signed-in member to the dashboard, everyone else to
  the Pathset front door). The firms page is one 539-line page plus a 1,203-line stylesheet.
- **Two looks today.** The front door is a dusk-sky photo with Instrument Serif and Geist. The
  firms page is flat cream with Newsreader, Helvetica and IBM Plex Mono, body text around 14 to
  15px. Neither matches the workspace app.
- **A recorded decision covers this.** `lectual/brain/decisions.md` 2026-08-03-01 (binding) puts
  the marketing site on Newsreader / Helvetica / IBM Plex Mono and says "do not let a third system
  appear". Mockup B stays inside it. Mockups A and C change the typefaces, so choosing either
  needs a new decision entry.
- **The Lectual design system artifact** says there is no Lectual symbol mark: the logo is the
  word "Lectual" in the display serif. All three loaders are built from the wordmark only.

## What was produced

Three working, scrollable mockups of the firms page, each with a logo loader, larger type (body
19px or more on desktop, hero 122 to 136px), a pinned scroll section and micro-animations. Each
reuses the live page's copy, keeps the "not a law firm" footer line, and shows no price, customer
logo or testimonial. Private artifacts (only Taylor can open them until shared):

| | Name | Idea | Link |
|---|---|---|---|
| A | First light | The front door's dusk sky carried into the firms page. A pinned "While the firm sleeps." scene: a clock runs 11:15pm to 8:34am, queue rows arrive, the sky turns to day, an attorney approves. | https://claude.ai/artifact/7YunU3tNn613D93cxdd2VY |
| B | The docket | Paper and ink, very large Newsreader, set like a legal publication. A pinned Kestrel Foods matter file grows from intake to approval. | https://claude.ai/artifact/UZ2SsTDCBJtVnEYEc4fMQH |
| C | The gate | Dark ink opening, "Software drafts. An attorney approves." over a clickable approval queue. A sideways pinned walk through the five lifecycle stages. | https://claude.ai/artifact/EpMgu2jw9oewyXftK7TaS8 |

How they were made: one shared spec, three builder agents in parallel (one per direction), each
checking its own screenshots at 1440 and 390 wide; the orchestrator reviewed every mockup's
screenshots and file before publishing. Two review fixes: mockup B's matter file no longer borrows
another matter's draft and deadline, and its first screen now shows the lede and the button;
mockup A's closing button no longer says "we'll be in touch".

## Round two: Taylor's pick, the real sky, and the features question

Taylor: "i like the motion and nav bar of gate but i like the background and time change section
of first light", asked for a better sky "like the one we have for the home page", and asked
whether the page shows the right features.

- **Merged mockup "Lectual Overnight"**: https://claude.ai/artifact/3xGGg1wSviDdMgKmBvMXrY .
  First light's page and overnight clock scene, Gate's loader (the gate opens), condensing pill
  nav and motion, on the home page's real sky. The sky is 24 still frames taken from
  `lectual/public/pathset/door-timelapse.mp4` (sunset to the Milky Way), drawn on a canvas:
  sunset in the hero, darkening to the Milky Way as the clock runs to 4:26am, running back to
  the sunset frame as sunrise by 8:30am, then fading to paper for the approval. The footage is
  720 x 1280, so it is soft on a large monitor; a higher-resolution original would fix that.
- **Features audit.** The live page's approval-queue example shows an office action response
  drafted from firm precedent, a patent rejection with a claim chart and a copyright deposit. A
  search of both repos found deadline tracking for office actions, Statements of Use and
  renewals, but no drafting for any of those three. Built today and missing from the page:
  intake forms (link, QR code, scored assessment, source tags), consult recordings to follow-up
  email and proposal, the client proposal page with package choice and a signed engagement
  letter, the weekly review, the assistants (morning brief, consult prep, inbox summary, stage
  moves), Copilot, and the Outlook / Zoom / Fathom / Lawmatics / LawPay connections.
- **In the merged mockup** the sideways pinned section now walks through six real features
  (intake, consults, proposals, matters and deadlines, assistants and Copilot, approvals) with
  copy drafted from what is built. The overnight queue example was left as it was: whether to
  keep the office action / patent / copyright rows is Taylor's decision.
- **Comments on the Gate mockup (answered in the artifact threads):** "remove the dot" (large
  numbers now use the plain sans face, so the zero has no dot; the merged mockup follows the
  same rule); "can we add a motion graphic animation here" on the "Agents run whole matter
  workflows" section (added a looping graphic: a matter runs Intake, Draft, Docket, stops at the
  Attorney gate on "Awaiting approval", turns "Approved ✓", then reaches Sent); one comment was
  unreadable ("jown our firms we wojrws") and is waiting for Taylor to restate it.

## Recommendation on Astro (not decided)

Stay on Next.js for this redesign. The loader, pin scrolling and micro-animations are the same
GSAP code in either framework, and the mockups are plain HTML, CSS and GSAP, so they port to
either. Astro would mean a second project and deployment, and `lectual.app` would have to be split
between it and the Next app that also serves sign-in, Pathset, firm assessment domains and the
client proposal rewrites, with `/` deciding by sign-in and host. Astro becomes worth it if the
marketing site grows into a separate content site (many pages, a blog) on its own domain.

## Limits to know

- Checked with headless Chromium screenshots at desktop and phone width only. Not checked: Safari,
  trackpad feel of the pinned sections, keyboard order, reduced-motion and no-JavaScript renders
  (those follow from the code but were not loaded), and how the pinned sections behave inside the
  artifact viewer's frame.
- The mockups are not committed anywhere. They live in the three artifacts.
- Nothing in `theipgirl/lectual` was changed. Nothing was deployed.
- A few short connective lines in the mockups are new wording (for example "While the firm
  sleeps." and the per-stage sentences). They add no facts, but they are not Taylor's copy yet.
- The Obsidian vault could not be reached from this cloud session (no computer folder is shared).
