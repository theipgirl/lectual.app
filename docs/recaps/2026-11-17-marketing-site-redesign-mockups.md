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

## Round three (Nov 17 to 25): comments, and a mockup modeled on demi.ai

- **Comments on the mockups, handled in their threads.** Gate: the queue window now grows from
  smaller to full size as you scroll (the comment was pinned to the whole page, so that target
  was a guess). Overnight: the top-bar button is now "Log in"; "Apply for private beta" stays in
  the hero and the closing section.
- **Taylor (Nov 25): "make a new mockup. I want a clone of this site", https://www.demi.ai/ .**
  Built **"Lectual Horizon"**: https://claude.ai/artifact/1X2fXmvjbUpDJdHnrqwMPg . It follows that
  site's structure, layout and motion section for section, and uses none of its name, logo, orb
  character, wording, photos, customer quotes, prices or code. The translation: light tight serif
  headline with a "Draft ready" pill and a self-drawing check ("Agents draft. An attorney
  approves"); a tabbed workspace window (Approvals, Leads, Proposals) on a band of sky; a pinned
  dark "What makes Lectual different?" with three points and a changing window; a text marquee
  of the five connections in place of customer logos; "A legal CRM remembers. Lectual acts.";
  a sideways snap carousel of the six real features; a circle of sky that grows to fill the
  screen in place of their orb; the four rules as cards in place of testimonials; "Watch one
  night in the queue", a looping 20-second animation in place of their film; five trust badges
  with no certification names; three model cards in place of pricing (no prices); six questions
  answered from existing copy; a sky closing band and a giant wordmark footer.
- **Choices made in it (Taylor can overrule):** every queue on the page uses work the product
  does overnight today (inquiry scored, follow-up email and proposal drafted from a recorded
  consult, consult prep, stalled-lead follow-up, morning brief, a legal question routed to an
  attorney) and no office action, patent or copyright-deposit drafting; the nav button is
  "Log in"; a short logo loader is kept; type is Newsreader (light, tight) with Geist.
- **How it was made:** the reference was screenshotted across its full scroll; one builder agent
  worked from a written section-by-section brief; the orchestrator reviewed the screenshots,
  published a first pass, sent six fixes back (queue rows, the Approved button, the night
  panel's overlaps, an empty stretch after the circle, card padding, small text) and republished.
- **Not checked:** Safari and Firefox, real touch scrolling, keyboard order through the two
  pinned sections, a failed animation-library load, and behaviour inside the artifact viewer.
  A few lines are new wording: "A legal CRM remembers. Lectual acts.", the three "different"
  titles, the short lists on the model cards, and the sub-labels on the connection chips.

## Round four (Nov 25): Taylor's 18 comments on Horizon

Taylor left 18 comments on Horizon and said: "resolve all the comments remember you are creative
director use subs to complete". Same link: https://claude.ai/artifact/1X2fXmvjbUpDJdHnrqwMPg .

- **How it was run.** One agent first split the page into section files with a shared script kit
  (no visual change, checked pixel by pixel). Five builders then worked in parallel, each owning
  different section files in its own copy; the orchestrator merged them, reviewed a full walk of
  the page, and sent an independent reviewer through it (four screen sizes, scroll back up, nav
  jumps, every interaction, keyboard, reduced motion, no JavaScript, copy rules). The reviewer
  found two blockers and seven major issues; each went back to the builder who owned the section,
  and the page was merged, re-checked and republished.
- **Top of the page.** Overnight's nav (full width, condensing to the dark pill; "Log in"; a
  Menu button on phones). "Draft ready" pill removed from the headline; check mark spacing
  fixed. Hero sky is a soft sweep with no hard edge and scrubs forward through the time-lapse on
  scroll. The hero's product window stays pinned and becomes the window of "What makes Lectual
  different?", whose three points are now: "Built for IP practice, not adapted to it", "From the
  consult to the signed letter, in one line", "An attorney is the only send button".
- **Overnight scene.** The pinned "While the firm sleeps." clock scene from Overnight is added
  after the differentiators, with rows for work the product does today. The moving text strip
  and the looping night panel are removed.
- **Features.** A pinned sideways scroll of the six cards with a calm snap; all six demos are
  interactive (copy a link, flip the QR tile, open a consult's drafts, pick a package and sign,
  move a matter between columns, ask Copilot, edit and approve a draft).
- **Voice.** Sources flow along hairlines through the circle of sky into a draft; the circle
  opens into the full sky; the five connection chips carry logos fetched from each company's own
  site (Outlook from Microsoft's Office CDN, Zoom, Fathom, Lawmatics, LawPay); the line is now
  "Your accounts, your data, your approval."; the sky dissolves forward into the next section.
- **Deadlines.** The rules cards are replaced by "Every deadline, on the matter it belongs to.":
  a docket timeline for an example matter (HALYARD) that draws on scroll, six deadline cards
  whose reference periods are word for word from `src/lib/matters/deadline-rules.ts`, the small
  print "Reference periods only. The date on the Office's own notice controls, and an attorney
  confirms every deadline. Lectual tracks deadlines; it does not give legal advice.", a morning
  brief card and a three-column board.
- **Trust** is Overnight's section. **The three model cards are removed**; the slot is kept for
  pricing later.
- **Three comments needed interpreting** (each pinned to a pinned or whole-page element):
  "remove for now" was read as the moving text strip, "remove since we added it up above" as the
  looping night panel, "make this section about uspto deadlines" as the rules cards.
- **Corrections made during review.** HARBORLINE was shown both as a registered mark nearing its
  Section 8 date and as an application answering an Office Action; the docket now uses HALYARD.
  The Section 8 line reads "due in 41 days" everywhere. Two phrases beyond the six approved
  periods ("Years 5 to 6", "Window opens in year 5"), which came from the orchestrator's own
  first brief, were removed. A class-name clash between two builders' sections had stretched
  the Intake demo's switch; a pinned wrapper had made the hero's Apply button unclickable.
- **Not checked:** Safari and Firefox, real trackpad and touch scrolling, a screen reader, and
  the page inside the artifact viewer. Three of the features builder's interaction test sizes
  (1280, 1024, reduced motion) were not re-run after a test-only fix.
- **Comment threads.** The 18 Horizon threads were not sent to Claude from the comment panel, so
  they cannot be replied to or resolved from the session; Taylor resolves them on the page.
  Three older threads were resolved (Log in on Overnight; the growing window and the motion
  graphic on Gate). The unreadable Gate comment is still open.

## Round five (Nov 25, afternoon): ten more comments on Horizon

Taylor left ten new comments and said "ok resolve new comments". Same link. Five builders in
parallel again (four resumed, one new for the sky options), merged and reviewed by the
orchestrator; two merge bugs were sent back and fixed before publishing.

- **Nav:** the five links are tabs with a highlight pill that slides to the section on screen.
- **Differentiators list:** one hairline per boundary, the progress fill runs along it, equal
  20px spacing above and below every item.
- **Product window:** restyled after the real workspace (top bar with a "Your firm" slot, search
  and initials; dark ink rail with Today, Approvals, Weekly review, Proposals, then More), in the
  page's neutral ink rather than the app's oxblood. New default **Home** tab: "Good morning.",
  "Three things are ready for you.", three prepared items arriving, the first draft writing
  itself with Review and Approve & send, an "Ask Copilot…" row, and a Today side column.
- **Hero background:** a "Sky" switcher (shown only while the hero is on screen) with four
  options: 1 the time-lapse regraded and sharpened, 2 a procedural cloud sunset (the default),
  3 a soft colour-field sky, 4 a single horizon line. The builder's pick for a law-firm audience
  is 4, with 2 as the more emotional alternative. Frame rate on a real graphics card was not
  measured.
- **Overnight scene:** the queue is now the approval deck. Cards stack overnight (five approval
  cards; the inquiry and the routed legal question stay as rows), the top card opens in the
  morning, "Yes" with the five-second hold and Undo, the card lifts away, the next card comes up
  as "1 of 4", then "Draft is in Outlook. Nothing is sent until someone presses Send."
- **Statement:** "A legal CRM remembers." small; "Lectual acts." at up to 150px with a drawn
  underline; new line "Lectual does the admin, so your time goes to the legal work only you can
  do."
- **Firm brain:** the voice section is now "Every draft starts from your firm brain." with four
  sources (Consult notes, Templates, Approved language, House rules) flowing into a circle
  captioned "Firm brain".
- **"Background doubled":** pinned to the whole page; fixed where it was found, in the full-sky
  states of the firm brain section (two time-lapse frames cross-fading read as a double
  exposure; it now holds one frame). The closing band and footer were checked and are one sky.
- **Footer:** giant wordmark left, the menu to its right on the wordmark's baseline, a hairline,
  then the legal lines left and the copyright right. "Agents" is now "Assistants".
- **Chip labels:** the small mono labels on the connection chips are now the text face.
- **Left alone:** "add other connectors like gmail, sharepoint, drive, claude chat gpt", which
  Taylor had marked resolved. Gmail mail connections exist in the product; nothing was found
  for SharePoint, Drive, Claude or ChatGPT.
- **Merge bugs fixed before publishing:** the firm brain section's draft card made the page
  scroll sideways at 1280 and 1024 wide; the Sky switcher covered the footer's legal line.
- **Not checked:** the independent reviewer's full pass was not repeated for this round; Safari,
  Firefox, a real phone and a real trackpad are still untested; shader speed on real hardware.

## Round six (Nov 25, evening): four decisions and seven more comments on Horizon

Taylor answered the four open questions (sky 1, neutral window, doubled background fixed,
"yes and the others" on connectors), left seven new comments, and asked in chat for a blur at
the top of the screen with a slow release. Same link. Five builders in parallel, merged and
reviewed by the orchestrator. Nothing needed sending back this round.

- **Sky:** option 1 (the regraded time-lapse) is the only hero sky. The switcher, the other
  three options and the saved choice are removed.
- **Lede:** "The agentic IP OS for solo and boutique trademark, patent, and copyright firms."
- **Nav ("like the names of the tabs remove the extra border"):** tab names kept; the tab
  group has no ring and the highlight is a plain fill, so the only outline is the pill's own.
- **"Make this glass":** the hero window's top bar is frosted glass with the sky showing
  through; the window body and rail stay solid. As the page darkens during the pinned scroll
  the bar gets whiter so its text stays readable (measured 5.6:1 or better).
- **Overnight window ("make sure this looks like the one above"):** rebuilt with the hero
  window's top bar, dark rail (Approvals current), radii, shadows, pills and buttons. Its glass
  bar is brighter than the hero's because it sits on a night sky.
- **Workspace heading ("should go on the left of the slider"):** from 1180px wide the heading,
  the six tabs, a "1 of 6" counter and previous/next buttons sit in a fixed left column and the
  cards slide to its right. Below 1180px the heading sits above, left-aligned.
- **Intake card ("should also show the intake form"):** the card now shows the public form
  (firm name slot, name, email, consent tick, Continue, then a choice question) with the QR,
  link and scored-assessment switch beside it. Continue and the choices work; nothing is
  submitted.
- **Connectors:** Gmail, SharePoint, Google Drive, Claude and ChatGPT chips added with each
  company's own logo (ten chips in all), and the "What does it connect to?" answer lists all
  ten. SharePoint, Google Drive and ChatGPT connections were not found in the product, and
  Gmail is mail only; this is the owner's call for the mockup and is on the to-do before go-live.
- **Top blur with slow release:** a progressive frost under the nav (strongest at the top
  edge, no visible end line). Off at the very top of the page and over the overnight scene,
  soft over the other sky scenes, on over the reading sections. Comes on in 0.6s, lets go in
  1.1s.
- **Checks:** no sideways scroll at 1440, 1280, 1024 and 390 wide; hero button clickable; no
  console errors; every frame of a desktop and phone walk-through reviewed.
- **Not checked:** Safari and Firefox (the glass and the blur depend on backdrop-filter), a
  real phone, a real trackpad, the cost of five blurred layers on real hardware, a screen
  reader.

## Round seven (Nov 25, night): six more comments on Horizon

Six new comments, "ok resolve new comments". Same link. Four builders in parallel (top of
page, overnight, workspace, connections); the orchestrator made the one-line shared change for
the deadlines windows' dots, merged and reviewed. Nothing needed sending back.

- **Workspace ("change this back to the last slider that went full width at the bottom and
  remove the side arrows"):** the earlier layout is back: heading on top, tabs above the
  cards, full-width cards, the progress line under them. The left column, the "1 of 6" counter
  and the previous/next arrows are gone. The intake form from the last round is kept.
- **Hero sky ("add more sky from the other side over here"):** sky now also comes in from the
  left edge and the top-left corner, at lower strength than the right, with a clear patch of
  paper kept behind the headline and lede (measured 11:1 or better for the headline). Desktop
  only; on the phone the sky still comes from below.
- **Window dots ("the colors of the close, open, minimize tabs"):** red, yellow, green on
  every window: hero, the small differentiator windows, overnight, and the two deadlines
  windows.
- **"Apply for private beta" to the nav bar, "Log in" just text:** the nav's one filled pill
  is now "Apply for private beta"; "Log in" is a plain text link before it. The hero button is
  removed; the lede is a little larger. On the phone the bar shows a short "Apply" pill and
  "Log in" is the first row of the Menu.
- **"Remove outer pill" (on the tab group):** the five tabs have no container shape in any
  state, only the sliding highlight. The dark nav bar that appears on scroll is kept (the
  comment was pinned to the tab group).
- **Connector tiles ("come forward from background... just use the icon but when you hover it
  shows the name"):** ten icon-only tiles that start small and blurred near the horizon and
  travel forward to their places as the section scrolls in. The name shows on hover, keyboard
  focus or tap, and is read by screen readers. Phone, reduced motion and no-JavaScript show a
  grid with the names as captions.
- **Checks:** no sideways scroll at 1440, 1280, 1024 and 390 wide; nav Apply pill clickable;
  no console errors; every frame of a desktop and phone walk-through reviewed.
- **Not checked:** Safari and Firefox, a real phone, a real trackpad, hover on a real mouse
  (the tiles drift, so the label can move a few pixels under a resting cursor), a screen reader.

## Round eight (Nov 25, late): the statement moves up

One comment sent to Claude from the page, on the statement section: "move this above what
makes lectual different in dark mode". Same link. One builder (top of page), merged and
reviewed by the orchestrator; a reply was posted in the comment thread.

- "A legal CRM remembers. Lectual acts." and its sentence now play on the dark ground between
  the hero and "What makes Lectual different?". In the pinned scroll the sky goes dark, the
  window steps back, the statement fills in cream and holds, then lifts away as the heading,
  list and window come in. The pin is longer (540% of a screen, was 360%) so the
  differentiators kept their pace. On a phone it is a plain dark block.
- Its old place between the overnight scene and the workspace section is closed; about 270px
  of plain paper is left there on desktop.
- Checks: no sideways scroll at 1440, 1280, 1024 and 390 wide; no console errors; the three
  lines measure 10.7:1 or better at 1440. Not checked: Safari, a real phone, contrast at other
  widths. The sky's frame timing was not retuned for the longer pin.

## Go-live (Nov 25): Horizon is lectual.app/firms/

Taylor: "go ahead and make this live on lectual.app". Done the same day, in `theipgirl/lectual`
(the repo that serves lectual.app), on `main` at `bbf413a`. Decision recorded in that repo's
`brain/decisions.md` as 2026-11-25-01.

- **How it is built:** the approved page is served as one standalone HTML document by a route
  handler at `/firms/`, assembled from `src/marketing/horizon/parts/*.html` by
  `scripts/build-horizon.mjs`. It stays in the Next.js app (not Astro) but outside the React
  tree, so its styles and scroll scripts cannot affect the rest of the site. Sky frames, the
  animation library and the logos are files under `public/marketing/horizon/`; nothing loads
  from another site except Google Fonts.
- **Live-site changes to the approved page:** real title and sharing tags; "Log in" goes to
  `/sign-in/`; the closing "Apply for private beta" button opens the same email link the old
  page used; footer links point at real sections and pages; five "Mockup" leftovers removed.
  No other copy changed.
- **Who did what:** a builder ported it and ran build, lint, tests and a screen-by-screen
  comparison with the approved page (no visible differences). An independent reviewer read the
  change: no blockers, two fixes made (a stricter test that the page loads nothing from other
  sites; the founder front door's link no longer downloads the page three times). The
  orchestrator checked two Vercel previews, fast-forwarded `main`, and checked production.
- **Checked on production:** `/firms/` returns the page on desktop and phone widths with no
  errors and no sideways scroll; `/firms` redirects to `/firms/`; `/` still redirects to
  `/pathset/`; sign-in, the blog, the sky images and scripts load; the nav's Apply button
  scrolls to the closing section; the front door's firm link loads the page once.
- **Taylor's call at go-live:** show all ten connections as they are, with no "coming soon"
  labels (asked and answered in the session).
- **Left for Taylor (reviewer's wording points, not changed):** "a licensed attorney approves"
  is stated as an absolute though the product lets a non-attorney admin approve and routes some
  follow-ups to any staff member; the page shows engagement-letter signing, which needs
  migration 0106 on production.
- **Not checked:** Safari, Firefox, a real phone; a signed-in firm member being redirected to
  the dashboard (same code as the old page, not exercised); whether analytics is counting visits.
- **Roll back, if ever needed:** in Vercel, promote the previous `main` deployment
  (commit `80f87cf`), or revert the three commits on `main`.

## After go-live (Nov 26): logo and font match lectual.app; the statement moves again

Taylor, on the live page: "the logo and font should be the same as on lecual.app", then "the
Lectual acts part should be tween what makes lectual different and while the firm sleeps".
Both shipped to `lectual.app/firms/` the same day (`theipgirl/lectual` `main` at `ff43d6a`;
decision 2026-11-26-01 in its `brain/decisions.md`).

- **Logo and headlines:** lectual.app's front page sets "Lectual" and its headlines in
  Instrument Serif; the firms page used Newsreader. The wordmark and every headline are now
  Instrument Serif (the nav wordmark copies the front page's rule exactly). Body text (Geist)
  and small labels (Geist Mono) already matched. Because the new face is about a quarter
  narrower, headline sizes went up roughly 10% and letter spacing was loosened so nothing reads
  smaller; a few headlines break differently (none ends on a single word).
- **Statement:** "A legal CRM remembers. Lectual acts." now plays after the three
  differentiators and before the overnight scene, still dark. The hero hands straight into
  "What makes Lectual different?" again.
- **Fix found in review:** stopping the scroll mid hand-off showed two window screens on top of
  each other. Window views now switch at a set point with a short fade, so one view shows at a time.
- **Who did what:** one builder made the change and the fix; the orchestrator reviewed desktop
  and phone walk-throughs, checked the Vercel preview, fast-forwarded `main`, and checked production.
- **Checked on production:** the page loads Instrument Serif, Geist and Geist Mono and no
  Newsreader; no errors or sideways scroll on desktop and phone widths; the three sections
  appear in the new order.
- **Not checked:** Safari, Firefox, a real phone; the feel of the 220ms window switch in a real
  browser. The mockup artifact was not updated and is now behind the live page.

## Round nine (Nov 26 to 27): sign-in screens, the beta application form, a phone pass, the pitch deck, the share card

Taylor's asks, in her words: "we need to have the login look like [a reference screenshot]", "we need a solution for the
apply for beta", "can we look at mobile and optimize it better, I think it could be more dynamic", "we also need to update
the pitch deck to match this", then "can you fix the social share also" (for `lectual.app/firms/` only) and, on the sign-in
screens, "make the button the lectual color not the burgundy".

**Live now**
- **Share card for `lectual.app/firms/`** (lectual `main` at `cbe0223`, Nov 27). The link preview used a portrait photo of
  sky with no words. It is now a 1200x630 card: the sunset sky, the "Lectual" wordmark, "Agents draft. An attorney approves."
  and the one-line description. The page description was trimmed from 166 to 155 characters ("Assistants draft every step;"
  became "Assistants draft;") so previews do not cut it off. Checked on the live site as Facebook's, X's and LinkedIn's
  scrapers. The first production build failed on a Google font download inside Vercel's build (nothing in the change); a
  rebuild of the same commit went through. Platforms cache old cards, so an already-shared link needs a re-scrape.
- **Pitch deck v2** was restyled in place on Nov 26 (Instrument Serif, Geist, Geist Mono; the site's paper, ink and sky; no
  blue; the "not a law firm" line on every slide). Taylor looked at it and said "the pitch deck is fine". A restart cut the
  builder off before it re-checked its last three small fixes on screen; they are published.

**Built and on preview links, not live** (lectual branch `claude/peaceful-darwin-14ov7e`; workspace branch of the same name)
- **Phone pass on `/firms/`.** Under 900px wide every section now has its own moment: the hero's product views are a swipe
  strip; the three differentiators play in one held window; the overnight scene is a running clock with cards landing on a
  stack and a Yes the visitor can tap; the six workspace cards are a swipe carousel whose demos play when a card is current;
  the firm-brain sources feed the circle and the ten connections come forward out of the sky; the deadline timeline draws
  itself; trust cards swipe. Desktop is unchanged (pixel-compared per section). No scroll-jacking and no pinned sections on
  phones. Checked only in phone emulation (iPhone 14, Pixel 7, 360 and 430 wide, 768 tablet).
- **Apply for private beta is a form** in the closing section: name, work email, firm, size, practice areas, an optional
  "What do you use today?", a consent tick, and the line "Lectual is software, not a law firm. Applying does not create an
  attorney-client relationship." It posts to `/firms/apply/`, which saves the application (lectual migration 0120,
  `beta_application`: service role only, no policies) and emails a notice to info@lectual.app from noreply@lectual.app
  through a send-only Resend key stored on the Vercel project. A test application on the preview was saved in lectual-dev
  and the notice was delivered. The "book a 20-minute intro call" step after sending stays hidden until a Lectual booking
  link is set (`BETA_APPLY_CALL_URL`). "Log in" now opens the firm workspace; Contact is info@lectual.app.
- **Sign-in screens**, both in the reference's two-column layout: wordmark top left, a centred form under a round sky
  porthole, a large rounded sky panel on the right with four product lines. Buttons are Lectual's ink (#1B1815), not
  burgundy. `app.lectual.app/sign-in/` keeps the email link and the 6-digit code; `lectual.app/sign-in/` also stops showing
  raw `?error=` text and uses fixed sentences. No Google or Microsoft buttons: that kind of sign-in does not exist yet.

**What still needs Taylor before it goes live:** her look at the previews on a real phone; her OK to apply migration 0120 to
lectual-prod (the form answers "try again later" in production without it); her OK to ship the workspace sign-in from the
workspace repo's `main`.

**Found, not fixed (her call was `/firms/` only):** `/`, `/pathset/` and its pages have a title and description but no share
image at all, and `/sign-in/` shares the old description "The IP decision engine that qualifies founders…".

**Not verified here:** Safari, Firefox, a real iPhone or Android phone, a screen reader, the link-sent and firm-branded
sign-in states against a real database (drawn from the components), the deck in the Slides viewer after the last fixes.

## Round nine goes live (Nov 27, evening)

Taylor: "yes apply the migration and push it all live".
- **lectual migration 0120 (`beta_application`) is on lectual-prod** (one `apply_migration`, no hang). Checked after: RLS on, no
  policies, nothing granted to anon or authenticated, recorded in `schema_migrations`.
- **lectual `main` is at `73aa13d`**: the phone pass on `/firms/`, the application form and its endpoint, the new
  `lectual.app/sign-in/`, and the share card. **lectual.app (workspace) `main` is at `24d1a60`**: the new
  `app.lectual.app/sign-in/` and `/auth/confirm/`, merged with that repo's newest main first (822 tests in the sign-in,
  wording and view suites pass, lint has no errors). Both production builds finished.
- **Checked on the live sites** (Chromium, desktop 1440 and an emulated iPhone 14): `/firms/` and both sign-in screens
  load with no errors and no sideways scroll; "Log in" goes to `app.lectual.app`; an empty application shows the six
  field messages and sends nothing; one test application ("Live Check LLP (test, please ignore)",
  beta-live-check@example.com) was saved in production and its notice was delivered to info@lectual.app. That test row
  is still in the production table.
- **Still not checked:** a real phone, Safari, Firefox, a screen reader, a real sign-in email through the new screens.

## Recommendation on Astro (settled at go-live: the page stayed in the Next.js app)

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
