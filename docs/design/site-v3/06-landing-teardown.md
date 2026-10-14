# Site v3 brief 06: landing-page teardown and the hero sizzle (NORMAN)

Issue #1289. Written 2026-10-14. One-off brief; nothing is scheduled. James said "I like the
landing page for betteranalyst", asked for Ramp, Attio, Loom and Retool to be reviewed too, and
wants a 20-second sizzle (an animated walkthrough) in the hero. This brief takes those five pages
apart and turns what they do into a format for our hero. It builds on DRAPER's positioning
(`03-draper-positioning.md`) and my three homepage directions (`04-norman-homepage-directions.md`).

**Method.** Each homepage was loaded in Playwright Chromium (1.62) at 1440x900 and 390x844 on
2026-10-14, left to settle, and screenshotted: first view, full page (capped at 12,000px) and
one shot per viewport height while scrolling. A script recorded `<video>` elements (source,
poster, autoplay, muted, loop, controls, duration), canvases, h1 to h3 text, nav items and the
buttons above the fold. Moving heroes were captured at fixed intervals. Demo videos were stepped
through in installed Chrome, which plays H.264, and saved as contact sheets. Cookie banners were
refused where a "Reject" button existed (Attio, Loom); Ramp and Retool showed none. Firecrawl was
not used. Everything below was seen on these pages on that date; these sites change often.
Screenshot paths are listed at the end. They sit in the session scratchpad and are not committed.

---

## 1. BetterAnalyst in depth

BetterAnalyst (formerly Formula Bot) sells an all-in-one AI analytics app to individuals and
small businesses. The page is long: 13,735px on desktop and 23,087px on a phone.

### 1.1 The hero

Shots: `betteranalyst-desktop-hero-t00.png` to `-t25.png`, `betteranalyst-mobile-viewport.png`.

**Structure, top to bottom, centred:**

1. A rebrand announcement bar ("Formula Bot is now Better Analyst... Learn what changed").
2. A floating dark-navy pill nav, detached from the top edge: Product, Connectors, Pricing, a
   dark-mode toggle, Book a demo, Log in, and Try free (a filled button).
3. An eyebrow in tracked capitals: "THE ALL-IN-ONE ANALYTICS APP".
4. The h1 on two lines: "All your analytics work," in navy, then "in one place." in the accent
   periwinkle.
5. One subhead sentence of about 25 words.
6. One primary pill button, "Start analyzing for free", with the microcopy "Join 1M+ users. No
   credit card required." under it.
7. A live input labelled "TRY A REAL QUESTION" ("Ask a question about your data"). Beside it:
   "Your question carries into your free workspace". Under it are three suggestion chips
   ("Analyze this month's sales" and two others).
8. A quiet line for the second buyer: "Evaluating Better Analyst for your team? Book a
   personalized demo".
9. Two line-drawn mascots (a smiling spreadsheet and bar chart, and a pie chart with a speech
   bubble) flank the h1.

**The hero itself does not move.** The five timed captures at 0, 5, 10, 15, 20 and 25 seconds are
identical apart from a sparkle on the mascots. There is no `<video>`, canvas or Lottie in the
first view. The motion James remembers is the product showcase directly under the hero. Its top
edge shows at the fold on a 900px screen, so it reads as part of the hero.

### 1.2 The sizzle: the product showcase under the hero

Shots: `betteranalyst-demo-t00.png` to `-t20.png`, `betteranalyst-demo-after-play.png`,
`ba-dataviz-contact-sheet.png`, `betteranalyst-s01.png`.

**How it is built:**

- **Tabs.** A row of seven pill tabs: Data Visualization, Data Preparation, Data Science,
  Dashboards, Data Flows, Presentations, Enrich. The active tab gets a white card and a shadow.
  The tabs are buttons with `aria-pressed`.
- **The frame.** Under the tabs is a large product frame, about 1,215px wide, showing a full-size
  still of the real app: the navy left rail, a chat thread, a generated chart or table, and the
  right-hand Workspace panel listing uploads, charts and outputs.
- **A play button.** A dark circular play button sits in the middle of every still.
- **Rotation on its own.** Logged from `aria-pressed` over 75 seconds, the tabs advance every
  8.0 seconds with about a 1-second crossfade. Seven tabs make a cycle of about 56 seconds, and
  the first tab gets about 5 seconds after load. The stills do not move between changes.
- **Click to play.** Clicking play swaps the still for an MP4 of that tab. It plays muted with
  native controls and does not loop. There is no captions track. The still is the video's
  `poster`.
- **Seven recorded demos.** Each tab has its own still (`home-*-v2.png`) and its own video
  (`home-*-demo.mp4`). The videos weigh 1.8 to 6.6 MB each and are only fetched on click. The
  Data Visualization video runs 35.7 seconds and Data Science 25.8 seconds.

**What the Data Visualization demo does, scene by scene** (contact sheet, 3-second steps):

| Time | Scene |
|---|---|
| 0-3s | A modal over the home screen: "Add / manage data". The cursor picks a census CSV from the uploaded files. |
| 3-6s | The home screen ("Good Afternoon, Better. Let's start analyzing."). The prompt is typed live: "visualize total population for...". |
| 6-9s | The chat view, with the status lines "Preparing chart" and "Writing code". |
| 9-13s | The answer: a horizontal bar chart, "Top 10 DMAs by Total Population", with a chart-settings panel. The cursor switches it to a vertical bar chart. |
| 13-18s | The subtitle is edited in the settings, the chart becomes a lollipop chart, and a brand-kit palette dropdown opens. |
| 18-25s | The camera zooms in on the restyled chart (dark ground, lime stems), then on the summary sentence the app wrote under it. |
| 25-28s | A follow-up prompt is typed: "show me a sankey chart of the population of those markets and how they're distributed across the age ranges". |
| 28-34s | "Preparing DMA age-range flows" and "Executing code", then a finished Sankey chart, "Population Flow from Top 10 DMAs to Age Ranges". |

The grammar is a real screen recording of the real app with a visible cursor. The prompts are
typed in real time, the camera zooms on the result, and there is no voice-over and no burnt-in
caption. Each video tells one job from input to output: data in, question asked, answer shown,
answer refined, a second question asked.

### 1.3 Typography, colour and density

**Display type.**

- Outfit, a geometric sans, carries the headings. The h1 is 72px, weight 600, line height 0.98,
  tracked -3.6px (-0.05em). On a phone it is 48px with the same ratios.
- h2s are 48px, weight 700, tracked -0.025em.
- The tight tracking and near-solid line height make headlines read as blocks. Most of the
  premium feel comes from this.

**Text type.** Body copy is set in Aptos with a system fallback, in grey-blue. Monospace is used
for the code panels and the pipeline panel.

**Colour.**

- Ink is deep navy, `#07163D`.
- The page ground is a cool off-white, `#F7F8FC`, with a faint grid-paper texture behind the
  hero.
- One accent, periwinkle `#4F62F2`, is used for the primary button (with a tinted shadow of the
  same colour), for eyebrows, for the second line of the h1, and for icons.
- Navy also fills the nav pill, the Data Flows "pipeline" panel, the custom-plan band and the
  closing band. One accent and one ink colour hold the whole page together.

**Shape.** The primary button is a 56px pill (fully rounded) with 36px side padding and 16px
bold text. Cards have 1px hairline borders, about 16px radii and almost no shadow.

**Density.** The hero is airy: a single column about 720px wide and lots of space. Below it the
page is dense: a 13-card feature grid, a four-card dashboard-theme strip and a long pricing
table. Eyebrows ("REPLACE THE FRAGMENTED STACK", "SECURITY FIRST", "QUESTIONS BEFORE YOU START")
label every section, so a scanner can follow it.

### 1.4 Page structure, section by section

Shots: `betteranalyst-s00.png` to `-s15.png`.

| # | Section | What it does |
|---|---|---|
| 1 | Hero | Promise, one button, live "try a real question" input, demo link for teams |
| 2 | Product showcase | Seven auto-rotating tabs over real product stills; each plays a recorded demo |
| 3 | "One app for the whole analytics workflow" | Before and after diagram. Left, "The fragmented stack": source, tool and people icons joined by tangled dashed wires. Right, "Together in Better Analyst": connectors flow into one logo, then out to eight verbs (Connect, Analyze, Dashboards ...) |
| 4 | "One app for the entire analytics workflow" | A 13-card feature grid, each with a small flat-colour illustration or a coded mini-UI (a code panel, a spreadsheet, a Slack screenshot) |
| 5 | "Start on your own. Keep using it as you grow." | Three audience cards (individuals, small businesses, growing teams) with the mascots, and a text-link CTA |
| 6 | "Build beautiful dashboards in seconds with AI" | Four dashboard themes as thumbnails (Executive, Terminal, Glass, Editorial) and "Learn More" |
| 7 | "Data privacy and security" | Three cards: no training on your data, encryption, row-level security |
| 8 | Connectors | "Connect the tools your business already uses" |
| 9 | "Turn repeat reports into a reliable pipeline." | Three check-marked claims, then a navy panel drawn as a four-step pipeline: 01 Fresh sources, 02 Repeatable transform, 03 Schedule ("Every Monday 07:30 EDT, ACTIVE"), 04 Monitored delivery ("2,418 rows, Delivered") |
| 10 | Testimonials | Three five-star quotes with name and title, no photos or logos |
| 11 | Pricing | Monthly or annual toggle, three tiers with first-month strikethrough prices, a "Best for power users and teams" badge, then a navy custom-plan band and "Cancel anytime. Secure payments powered by Stripe." |
| 12 | FAQ | "The details that matter": seven questions, including "How accurate is AI data analysis?" |
| 13 | Comparison | "Still deciding? Do your own comparison." |
| 14 | Closing band | Navy: "Start analyzing your data in 30 seconds." The button and the mascot line-up repeat |
| 15 | Footer | A long SEO link footer ("AI Chart Maker", "PDF to Excel Converter" and more) |

### 1.5 Proof devices

- A user count under the button ("Join 1M+ users").
- Risk reversal: "No credit card required", "Free forever plan included", "Cancel anytime",
  "Secure payments powered by Stripe".
- Real product stills and real recordings, not mock-ups.
- Code transparency: "See the exact code generated for every request".
- A security section and an accuracy question in the FAQ.
- Testimonials and public pricing.
- The page shows no customer logos.

### 1.6 CTAs

- **The primary action is the same everywhere:** "Start analyzing for free" (hero), "Try free"
  (nav), the text link after the audience cards, and "Analyze your data free" (closing band).
  All go to signup.
- **The secondary path is quiet and always text:** "Book a personalized demo" (hero), "Book a
  demo" (nav), "Book a live demo" (custom-plan band).
- **Section CTAs** ("Explore Data Flows", "Learn More") lead deeper and do not compete with the
  primary action.
- **The hero input is a second door with no form:** a question typed there carries into the free
  workspace after signup.

### 1.7 How it shows the product

1. **Real screens, large.** The showcase frame is near full width, so the viewer reads actual
   UI, not an illustration of it.
2. **Jobs, not features.** Each tab is a job (prepare, visualize, model, present). Each video
   goes from data in to answer out.
3. **The input in the hero.** The visitor starts using the product's main gesture (asking a
   question) before signing up.
4. **Coded mini-UIs in cards.** The code panels, the spreadsheet card and the pipeline panel are
   drawn in HTML and CSS in the brand colours, not screenshots. They read cleanly at any size.

### 1.8 What makes it feel premium and credible

- One typeface for display, set big and tight, and one accent colour used with discipline.
- A calm hero with one action, and a dense body for people who scroll.
- Real product output with real-looking data (coffee sales, census DMAs), never lorem ipsum.
- The pipeline panel turns an abstract promise ("reliable") into an operating record (schedule,
  status, row count, "Delivered").
- Explicit trust answers (security, accuracy, refunds) in plain question form.

Two things work against it:

- **The mascots** are friendly but read consumer or edtech. They suit a $10-a-month tool, not a
  pricing committee.
- **An orphaned word on mobile.** At 390px the h1 breaks as "All your analytics / work, / in one
  place." The single word "work," sits on its own line, which our heading rule forbids
  (`text-wrap: balance`).

### 1.9 Borrow, adapt, leave

**Borrow:**

- **The hero skeleton.** Eyebrow, then a two-line h1 with the second line in a second colour,
  one sentence, one pill button with a microcopy line under it, a live input in the hero, and a
  text link for the second buyer. In our terms:
  - The eyebrow is "THE BANK FEE INDEX".
  - The h1 is DRAPER's promise B, with "with a source for every figure." as the second line, in
    navy-700 or brick.
  - The button is "See where your fees stand".
  - The microcopy carries live proof: `inst` and `fresh`.
  - The input is the institution search with suggestion chips (see section 4).
  - The second-buyer line is "Prefer one document? Competitive Fee Position Report, from
    `REPORT_PRICE_INLINE`."
- **Display type set tight.** Geist at 600, about 72px on desktop and 44-48px on a phone, line
  height about 1.0, tracking about -0.04em. h2s at about 44-48px. This is the biggest single
  change in perceived quality available to us.
- **One accent, used with discipline.** Our accent is brick, and the brief already caps it at
  two uses per view. BetterAnalyst shows that one accent colour is enough.
- **A sizzle frame under the promise, with chapter tabs.** Our chapters are DRAPER's layers:
  Every fee, Every market, One workspace, plus a Reports chapter. `/subscribe/showcase.tsx`
  already has the mechanism: `CYCLE_MS = 7000`, a progress bar, the rotation stops once a reader
  picks a chapter, and a reduced-motion hook.
- **The before and after diagram.** "The fragmented stack" maps cleanly onto our problem. Today a
  fee owner stitches together a national survey, call-report peer ratios, a consultant and
  hand-copied competitor PDFs. In Fee Insight, one source is read from each institution's own
  schedule and then rolled into five markets.
- **The navy "operating record" panel.** Our version shows provenance as a pipeline: Schedule
  read, then Fee recorded with page and date, then Checked against source, then Published. It
  would carry live counts from `COVERAGE_LABELS` fields and no agent names (DRAPER §5).
- **Questions in the FAQ that buyers worry about.** Our version: "Where does each figure come
  from?", "How current is it?", "What if my market is thin?" and "Do you recommend prices?"
  ("No").
- **Public pricing near the end, plus a closing band** in navy that repeats the primary action.

**Leave:**

- **Mascots and cute illustration.** They suit a cheap consumer tool, not people who set bank
  fees. Our visual is the data itself (box plots, fee rows, source lines).
- **Proof we do not have:**
  - user counts ("1M+"), testimonials, star ratings
  - strikethrough promo prices
  - "Book a demo" (no booking links)
  - AI claims ("in seconds with AI")
- **The 13-card feature grid.** It is a list, not an argument (`copy-frameworks.md`, "Feature-Heavy
  Page"). We have three pillars and should stop there.
- **The SEO link-farm footer and the rebrand bar.**
- **Periwinkle and grid paper.** Parchment is our ground, and navy and brick are our colours.

---

## 2. Ramp, Attio, Loom, Retool

### Ramp (ramp.com)

Shots: `ramp-desktop-viewport.png`, `ramp-mobile-viewport.png`, `ramp-s00` to `-s15`,
`ramp-hero-contact-sheet.png`.

- **Hero.** Left-aligned and stark.
  - A live ticker eyebrow: "US corporate payments processed by Ramp: 0.92969...%" (the digits
    roll).
  - The h1, "Time is money. Save both.", in Lausanne at 64px weight 400, black on white.
  - One subline, then an email field fused to a lime "Get started for free" button. The lime
    also fills "See a demo" in the nav.
- **Motion and video.**
  - A 13.0-second WebM under the hero, about 1,310px wide. It autoplays muted and loops, with no
    controls, no poster and `preload="metadata"`. It weighs 1.9 MB.
  - A separate portrait encode (`homepage-hero-mobile-423.webm`) is served on phones.
  - Scenes: a Ramp card alone, then receipt, policy and approval cards fan out around it, then an
    invoice, then a PO matched to the invoice, then three full product windows (Reporting,
    Forecast, a card transaction with an approval suggestion), each with a phone "Bills" screen
    and the card overlapping.
  - A sticky strip under the fold counts live: "AGENTS AT WORK TODAY: agent interactions,
    expenses reviewed, invoices processed...".
- **Product-in-hero technique.** Stylised real UI. The screens are real Ramp layouts, but cleaned
  up, floated as cards on a dotted ground and animated as a designed edit, not a cursor
  recording.
- **Section order:**
  1. hero video
  2. live agent counters
  3. "Join 70,000 ... growing 3.2x faster" with a logo grid and a case-study tile ("$1M+ saved
     on global spend")
  4. a product grid in five cards, each with a canvas mini-animation
  5. "See recommendations for your business"
  6. "Systems that never spoke"
  7. AI and agent sections
  8. scale, access, global spend
  9. "We've got the receipts" (testimonials)
  10. the h1 repeated as the close
- **CTA pattern.** Email capture in the hero. "See a demo" is the visible secondary in the nav,
  and "Switch in days, not months" and "View Demo" appear on the platform section.
- **Proof.** Live counters, customer count, growth multiple, logos and dollar case studies. It
  is the heaviest proof of the five, and none of it is available to us.

### Attio (attio.com)

Shots: `attio-desktop-viewport.png`, `attio-s00` to `-s19`, `attio-hero-contact-sheet.png`,
`attio-hero-frame-*.png`.

- **Hero.**
  - Centred. A pill link above the h1 ("GTM lessons from Elena Verna and more").
  - The h1, "Welcome to agentic revenue.", in Inter Display at 64px weight 600, tracked
    -0.02em.
  - A two-line grey subhead.
  - Two small buttons side by side: "Talk to sales" (outlined) and "Start for free" (filled near
    black).
  - Tiempos Text (a serif) and JetBrains Mono appear further down as accent faces.
- **Motion and video.** No video and no canvas in the hero. The product window is built from page
  elements and plays as a coded sequence, captured every 3 seconds:

  | Time | What the window shows |
  |---|---|
  | 0-3s | Loading |
  | 3s | "Good morning, Alex" with the prompt "How do I win my deal with GreenLeaf?" |
  | 6-9s | The answer streams in ("Key opportunity signals...", then a numbered list) |
  | 12-15s | The Companies table, with the AI columns "ICP Fit" and "Estimated ARR" filling cell by cell |
  | 18-21s | A workflow canvas, then a run history |

  Around the main window float satellite windows that change in step: a terminal agent ("Fill in
  missing firmographic data... 213 companies were missing firmographic data"), a Slack-style
  thread, and a call recording with transcript. One beat lasts about 3 seconds, and the full
  sequence about 20 seconds.
- **Product-in-hero technique.** Coded UI with plausible but fictional data (Basepoint, Alex,
  GreenLeaf, real company names in the table). Text stays sharp at any size and the frame matches
  the page's light theme. It is the closest existing model for a 20-second coded sizzle.
- **Section order:**
  1. hero with the coded product
  2. a logo grid on a pale periwinkle wash
  3. "The intelligent system that never sleeps"
  4. a sticky left-rail tab section with five jobs (Build pipeline, Convert leads, Run sales
     motions, Forecast revenue, Retain and expand), each with a large UI panel
  5. "Live from day one"
  6. "Universal Context"
  7. signals
  8. integrations
  9. "SDK. API. MCP."
  10. scale and security
  11. "Trusted by 30,000+ customers"
  12. a changelog ("Better as you grow")
  13. the closing CTA
- **CTA pattern.** Two equal buttons in the hero; the primary is self-serve and the secondary is
  sales.
- **Proof.** Logos, a customer count, a changelog showing the product is alive, and developer
  depth.

### Loom (loom.com)

Shots: `loom-desktop-viewport.png`, `loom-s00` to `-s14`.

- **Hero.**
  - Centred. The h1, "One video is worth a thousand words", in Charlie Display at 63px weight
    700.
  - A two-line subhead.
  - "Get Loom for free" (filled blue) and "Install Chrome Extension" (pale).
  - A rounded full-width video frame starts at the fold.
- **Motion and video.**
  - The hero is Loom's own embed player (`loom.com/embed/...`, with owner, share, title and top
    bar hidden). Inside it, a 5-second muted preview loops on its own. Clicking plays the
    60-second main video with sound and a captions track.
  - A speed badge burned into the frame ("1.2x, 1 min, 50 sec") demonstrates a product feature
    inside the video.
  - Further down, 10-second muted autoplay loops of camera bubbles sit over stylised UI (a
    calendar with "0:16" recording controls). One is a 20-second "hero-bubb" loop. All load with
    `preload="metadata"`.
- **Product-in-hero technique.** The product is video, so the demo is the product itself: a
  person talking, in the real player. The UI elsewhere is stylised: soft colour blocks with a
  live camera bubble.
- **Section order:**
  1. hero video
  2. "Millions of people across 400,000 companies" with a CTA
  3. the Mac app
  4. "The easiest screen recorder"
  5. "So much more than a screen recorder" (edit, share, engage)
  6. security
  7. use cases by role (Sales, Engineering, Support, Design)
  8. features
  9. blog
  10. enterprise
- **CTA pattern.** One free signup repeated, with an install path as the secondary and "Contact
  Sales" in the nav.
- **Proof.** Scale ("400,000 companies"), Atlassian parentage in the logo, role use cases.

### Retool (retool.com)

Shots: `retool-desktop-viewport.png`, `retool-mobile-viewport.png`, `retool-s00` to `-s10`,
`retool-hero-contact-sheet.png`.

- **Hero.**
  - Dark. A rounded full-bleed panel.
  - The h1, "Secure your vibe-coded apps", in Saans at 72px weight 300, warm off-white on near
    black.
  - A "NEW" pill line.
  - A working prompt box ("Create a vendor onboarding tracker that pulls vendor status from our
    @PostgreSQL database..."), with "Starter prompts", "Import code" and "Build with AI agents"
    under it.
  - A pause button bottom-left and a "See what's new. Watch the film" pill at the bottom centre.
- **Motion and video.** The background is a 32.2-second MP4 loop, muted, with no controls and a
  poster. It weighs 4.8 MB with `preload="auto"` on desktop. The `autoplay` attribute is off and
  playback is started by script. On a phone the video has no source and `preload="none"`, so
  only the poster shows.

  The loop is shot like a film:
  - tilted, shallow-focus close-ups of dashboards
  - prompts being typed ("Build a benefits dashboard from this spreadsheet...")
  - a CSV dragged in
  - charts rendering
  - "Import React code"
  - an MCP and terminal scene

  The text over it is the readable layer, and the video is mood. A separate full "film" sits
  behind the pill.
- **Product-in-hero technique.** Cinematic B-roll of real UI behind an interactive prompt, so the
  visitor can act in the hero. Product UI shows clearly later: "Build powerful apps from
  anywhere" is a sticky section with real app-builder screens.
- **Section order:**
  1. hero
  2. a logo strip (Databricks, Reckitt, Gong, Burger King)
  3. "Apps that mean business", an app gallery marquee in two rows
  4. three sticky feature panels (build, connect to production data, govern)
  5. "Start today"

  It is the shortest page of the five, 9,724px.
- **CTA pattern.** "Start for free" (filled) and "Book a demo" (outlined) in the nav. The prompt
  box is the hero action.
- **Proof.** Enterprise logos and an app gallery.

---

## 3. Cross-site patterns for a hero sizzle

| | BetterAnalyst | Ramp | Attio | Loom | Retool |
|---|---|---|---|---|---|
| Where the motion sits | Directly under the hero, top edge at the fold | Directly under the hero | In the hero, under the CTAs | In the hero frame, at the fold | Behind the hero text |
| Medium | Still poster plus click-to-play MP4 per tab | Looping WebM | Coded HTML and CSS sequence | Embedded own player | Looping MP4 B-roll |
| Length | 26-36s per demo; 8s per tab in rotation | 13s | about 20s, about 3s per beat | 5s preview, 60s main | 32s |
| Autoplay / muted / loop | Rotation auto; video on click only, muted, no loop | Yes / yes / yes | Plays as page code, loops | Preview yes / yes / yes | Started by script / yes / yes |
| Controls | Native controls after play | None | None seen | Full player | Pause button, plus a separate film |
| Captions | None | n/a (no speech) | n/a (text is live) | Captions track on main video | None |
| Poster | The tab's still is the poster | None | n/a | Player thumbnail | Yes; phone shows poster only |
| How UI is shown | Real screen recording with cursor and zooms | Stylised real UI, floating cards | Coded UI, fictional data | Real product (video) plus stylised UI | Cinematic close-ups of real UI |
| Load cost | Poster image first; 1.8-6.6 MB MP4 only on click | 1.9 MB, metadata preload, separate mobile file | No video bytes | Iframe player | 4.8 MB desktop; none on phone |

**Patterns:**

1. **Short and silent wins the hero.** Every in-hero motion is muted and needs no sound to make
   sense. The pieces that loop on their own run 13 to 32 seconds, and Attio's beats are about
   3 seconds. Anything longer (BetterAnalyst's 26-36s demos, Loom's 60s video, Retool's film)
   sits behind a click.
2. **The words are never inside the video.** On all five, the h1 and CTA are live HTML above or
   over the motion. The motion supports the promise and never carries it. Captions are rare
   because the in-hero loops have no speech.
3. **Three ways to show the product,** in order of credibility for a skeptical buyer:
   - **real screen recording** with a cursor (BetterAnalyst): the most believable, but the
     heaviest, and it dates as soon as the UI changes
   - **stylised real UI** (Ramp, Attio): believable and on-brand, lighter, and editable when
     coded
   - **cinematic B-roll** (Retool): sets a mood and explains little
4. **Chapters give the viewer control.** BetterAnalyst uses tabs, Attio a sticky left rail, and
   Ramp a grid of cards, so a viewer can jump to the part they care about. Loops with no
   chapters (Ramp, Retool) leave the viewer to wait.
5. **Load discipline:**
   - a poster or still first, with video bytes deferred (BetterAnalyst on click, Retool on phone)
   - `preload="metadata"` (Ramp, Loom)
   - a separate small mobile encode (Ramp)
   - none at all (Attio)

   Nobody autoplays a multi-megabyte video on a phone in the first view.
6. **Accessibility is uneven.** Retool gives a pause button, and Loom gives captions on the real
   video. BetterAnalyst's page carries reduced-motion CSS rules (nine found), but its tab rotation
   and Ramp's loop have no visible pause. WCAG 2.2.2 asks for a way to pause anything that moves
   for more than 5 seconds; we should meet it.

---

## 4. Recommendations for Fee Insight

### 4.1 Format: a coded React sequence, not a video file

Build the 20-second sizzle as a coded component in the page (Attio's technique), using
BetterAnalyst's frame and chapter tabs. Keep a recorded video only as an optional "Watch the
1-minute tour" behind a click, later, once Hamilton screens are approved for public use.

Reasons:

1. **Our numbers must be live and sourced.** The standing rule is never to type a count by hand,
   and every figure on the page names its live field. A video freezes the medians, institution
   counts and dates at the moment of recording, and they go stale within weeks. A coded sequence
   renders the same `getPublicNationalIndex()`, `getPublicSnapshot()` and readiness fields the
   rest of the page uses, so the sizzle is always current and always true.
2. **It is our components, not a picture of them.** The sequence is built from the real
   `FeeRange` box plot, fee row, source line and Hamilton frame, so it matches the product. It
   follows the theme tokens and dark mode, and it stays sharp on any screen. A video of
   switched-off Hamilton screens needs approvals we do not have (`[NEED]` in 03 §2 and 04
   Direction C).
3. **Load speed.** A coded sequence is tens of kilobytes of markup and CSS, with no video bytes,
   no poster to decode and no layout shift. A 20-second 1080p loop is about 2-5 MB judging by
   Ramp and Retool, which hurts LCP on the phones bank staff use between meetings.
4. **Accessibility and SEO.** Text inside the sequence is real text. With reduced motion turned
   on, the component shows the composed final frame. A pause and replay control and chapter
   buttons meet WCAG 2.2.2. `/subscribe/showcase.tsx` already has every one of these behaviours
   (`CYCLE_MS`, `useReducedMotion`, rotation that stops once a reader picks a chapter, a progress
   bar), so this is an extension, not new machinery. No animation library is installed, and none
   is needed: CSS transitions and a small timeline state machine are enough.
5. **Editing.** Changing a scene is a code change reviewed in a PR with a Vercel preview, not a
   re-shoot.

What we give up: a coded sequence cannot show a real cursor moving through the real app with
BetterAnalyst's "this is literally the product" authenticity. We recover most of it by using the
real components with live data, and by linking a recorded tour later.

### 4.2 The 20-second storyboard

It follows Direction A (search-first) and DRAPER's three layers, with one fee followed from
source to board. Each chapter is a tab under the frame, and the tabs double as navigation.

| Time | Chapter tab | Scene | Live field | Brick |
|---|---|---|---|---|
| 0-3s | (intro) | The search box types an institution name; the result row appears | Institution from an approved example `[NEED: James picks one, from a market that passes readiness]` | none |
| 3-7s | Every fee | That institution's overdraft fee row, with its source line (document, page, date) underlined in turn | The institution's `published_fee_catalog` row and source | the source underline (1) |
| 7-12s | Every market | The fee's dot drops into five stacked `FeeRange` rows (your market, state, Fed district, peer group, nation), one row every 1s. A thin layer shows "thin", not a median | Layer medians and IQRs; `MIN_INSTITUTIONS_FOR_MEDIAN` | the subject dot (2) |
| 12-16s | One workspace | The Hamilton frame (tabs This month, My fees, Try a price, Reports). In Try a price, an amount slides and the position marker moves against the market range | Same rows; no revenue figure shown unless it is the buyer's own | dot |
| 16-20s | Reports | A board brief page assembles: headline figure, the box plot, and a footnote citing the source | Same rows | dot |
| 20s | (end) | Holds 2s on the composed brief, then loops | | |

**Playback rules:**

- **Autoplay** muted only when the frame is in view (IntersectionObserver), and start from the
  first frame.
- **Loops:** at most three, then rest on the end frame with a "Replay" button.
- **Pause:** a visible pause and play button in the frame's corner.
- **Chapters:** clicking a tab jumps to that chapter and stops the automatic run, as
  `/subscribe` does.
- **Reduced motion:** show the end frame, with the chapter tabs as plain tabs.
- **Phones:** the same scenes stacked in a portrait frame (Ramp ships a separate mobile cut for
  this reason). The rows are drawn bigger and fewer at once, never scaled-down desktop UI.
- **Server render:** the composed end frame, so there is no layout shift and the page still
  reads with JavaScript off.

**Copy rules inside the frame.**

- Use DRAPER's vocabulary: "published fee schedule", "your market" and "inside the range". Never
  "AI", "recommend", "real-time" or agent names.
- Never write a number in the sizzle by hand.
- Show no institution's name in a public aggregate context unless James approves it.

### 4.3 The homepage, in BetterAnalyst's shape with our content

1. **Hero** on parchment, centred, single column.
   - The eyebrow "THE BANK FEE INDEX".
   - The h1 in Geist 600, about 72px, tracked tight: "Know where your fees stand in your
     market," / "with a source for every figure."
   - One sentence. One navy pill button, "See where your fees stand", which submits the
     institution search. The search sits in the hero as BetterAnalyst's "try a real question"
     does, labelled "Your bank or credit union".
   - Microcopy under it: `inst` and `fresh`.
   - Chips under the search, each a real working link: "Overdraft fees by state", "Read the
     national report", "See Hamilton plans".
   - The consumer line from Direction A as a quiet text link.
2. **The sizzle frame** directly under the hero, its top edge visible at the fold, with chapter
   tabs (4.2).
3. **The before and after diagram.** "Today: a national survey, call-report ratios and a
   consultant" against "Fee Insight: every institution's own schedule, read and placed in five
   markets."
4. **Three pillars** (Every fee, Every market, One workspace), each one paragraph and one live
   visual. No card grid.
5. **The provenance record** in a navy panel: schedule read, fee recorded, checked against
   source, published, with live counts.
6. **Pricing** from `PRO_TIERS`, and the report from `REPORT_PRICE_INLINE`.
7. **FAQ** with the buyer's objections.
8. **Navy closing band** that repeats the promise and the search.

### 4.4 Measure

- Hero search submits per session.
- Chapter-tab clicks: which chapters people choose.
- Sizzle completion: the share of in-view sessions that reach the 16-20s Reports chapter, from a
  `trackEvent` at each chapter start.
- `subscription_gate_viewed`.

**Test idea:** sizzle frame against a static composed frame (the server render) as the control,
with hero search submits as the primary metric. The coded component makes this test cheap.

### 4.5 Dependencies

- `[NEED]` an approved example institution, from a market that passes readiness.
- `[NEED]` James's approval of a Hamilton frame drawn from real components with live data, for
  public use.
- A build issue for the sizzle component, which extends `src/app/subscribe/showcase.tsx`'s cycle
  and reduced-motion logic into a shared component.

---

## Screenshots saved (session scratchpad, not committed)

Base directory: `/private/tmp/claude-501/-Users-jgmbp-Desktop-FeeInsight--claude-worktrees-design-system-github-branding-669807/2ea870d8-37e0-4f60-988d-66d7e66454ce/scratchpad/teardown/shots/`

- **BetterAnalyst:**
  - `betteranalyst-desktop-viewport.png`, `betteranalyst-desktop-full.png`,
    `betteranalyst-mobile-viewport.png`, `betteranalyst-mobile-full.png`
  - hero over time: `betteranalyst-desktop-hero-t00.png`, `-t05`, `-t10`, `-t15`, `-t20`, `-t25`
  - showcase rotation: `betteranalyst-demo-t00.png`, `-t04`, `-t08`, `-t12`, `-t16`, `-t20`,
    `betteranalyst-demo-after-play.png`
  - demo video frames: `ba-dataviz-frame-*.png`, `ba-dataviz-contact-sheet.png`
  - page by viewport: `betteranalyst-s00.png` to `betteranalyst-s15.png`
- **Ramp:**
  - `ramp-desktop-viewport.png`, `ramp-desktop-full.png`, `ramp-mobile-viewport.png`,
    `ramp-mobile-full.png`
  - `ramp-s00.png` to `ramp-s15.png`
  - `ramp-hero-frame-*.png`, `ramp-hero-contact-sheet.png`
- **Attio:**
  - `attio-desktop-viewport.png`, `attio-desktop-full.png`, `attio-mobile-viewport.png`,
    `attio-mobile-full.png`
  - `attio-s00.png` to `attio-s19.png`
  - `attio-hero-frame-00s.png` to `-21s.png`, `attio-hero-contact-sheet.png`
- **Loom:**
  - `loom-desktop-viewport.png`, `loom-desktop-full.png`, `loom-mobile-viewport.png`,
    `loom-mobile-full.png`
  - `loom-s00.png` to `loom-s14.png`
- **Retool:**
  - `retool-desktop-viewport.png`, `retool-desktop-full.png`, `retool-mobile-viewport.png`,
    `retool-mobile-full.png`
  - `retool-s00.png` to `retool-s10.png`
  - `retool-hero-frame-*.png`, `retool-hero-contact-sheet.png`

The capture scripts (`capture.js`, `scroll.js`, `timed.js`, `frames.js`, `sheet.js` and the
`ba-*.js` probes) and the raw `results.json` are in the parent `teardown/` directory.
