# Stage 4 — LOOK GATE (Kevin judges)

Phase 1's function gates are green (Stages 0–3). This package is the
**look/feel proof**, gathered 2026-10-27 on the VM rig (real bridge +
llama.cpp Gemma 3 1B lane — no mocks, no fixtures, no hand-driven
entity state anywhere). Per Kevin's law, function-green is not done:
what follows is a gap list first and credits second.

## The headline

The room itself is faithfully floor-oc — same engine, same art, same
palette, and the signature moment works live: in the video, Judge
leaves his cubicle, walks the hallway to Musky's doorway, waits out
the review, walks back, and the verdict lands in the quest log.
**But the room is presented smaller and is easier to lose than in
floor-oc**: the Vokrew shell gives the canvas 546 px of height where
floor-oc gives it 761 px, the run card covers the room for the whole
run unless you close it, and at phone width the room collapses into a
138 px-wide strip. Three HIGH gaps, three MEDIUM, two LOW, one rig
note. Details with evidence below.

## Deliverables in this folder

| File | What it is |
|---|---|
| `vokrew-floor-run.mp4` | One complete real run, 159.5 s (run `44b91e03`, verdict APPROVED). Phone spec verified by ffprobe: H.264 High, level 3.1, 1152×720, yuv420p, 24 fps, AAC-LC 24 kHz mono (silent — the capture has no audio), faststart (moov at byte 36). 2,302,526 bytes. |
| `side-by-side-idle.png` | floor-oc (left) vs Vokrew Floor (right), idle, both 1440×900 |
| `side-by-side-midrun.png` | floor-oc settled room (left — see G-8 for why it isn't mid-run) vs Vokrew mid-run, reviewer at the doorway (right) |
| `side-by-side-focus.png` | Focus view on one agent, both versions |
| `flooroc-*.png` / `vokrew-*.png` | The individual frames the composites are built from |
| `phone-locked.png` / `phone-idle.png` / `phone-midrun.png` | Galaxy S26 viewport pass, 412×915 CSS px @ DPR 2.6 |
| `results.json` / `run-state-log.json` / `frames.json` | Desktop capture results, the entity-state corroboration log, screencast frame timings |
| `phone-results.json` | Phone audits, frame times, page weight |
| `attempt1..4-*.json`, `attempt2-card-occludes-room.jpg` | The failed/occluded attempts, preserved — see "How this evidence was made" |

### Watching the video

Video t≈2 s the run is submitted from the Floor form → Scout plans
at his desk (phase planner, ~2–97 s) → Musky works (~97–123 s) →
Judge walks to Musky's doorway (arrives t≈128.7 s, state-log proven:
his cell equals the executor doorstep cell {23,46} in 25 consecutive
logged entries) → verdict APPROVED lands in the quest tracker and
quest log at t≈153.4 s, toast "Run finished: RUN-44B9 · APPROVED ·
STAMPED" → Judge walks back to his own cubicle (home t≈156.5 s).
Every moment is corroborated by `run-state-log.json` (entity cells +
modes polled from the page) and the bridge record in `results.json`
(stamps: planner 96,074 ms · executor 25,710 ms · reviewer 30,929 ms;
crossFamily=false, labeled "same family" in the UI as designed).
One framing disclosure: Musky's focus panel — opened by the harness
for the focus capture — stays open on the right side of the frame
during the video. The walk is unobstructed; the panel is also real
product behavior (see G-7).

## Side-by-side comparison

**Composition.** floor-oc *is* the window: its shell chrome is two
thin bars and the room takes everything else. The Vokrew Floor is a
panel inside another app — VOKREW header, tab pills, a full-width
run-form row, then the room. The room's internal composition (zones,
roster column, quest tracker, sector map) is identical because it is
literally the same engine and layout code.

**Density.** Same world, same furniture, same clutter. Two honest
caveats: floor-oc's reference ran its scrubbed example data (2 agents,
1 unassigned task) against Vokrew's 3-agent rig crew, so head-count
density is data, not rendering; and floor-oc's bottom action bar
(Task/Agent/Convene/Org/Studio/Tools) and Walk/POV button exist in
the reference and are cut in Vokrew by spec §4 design — the Vokrew
frame is emptier at the bottom edge because of it.

**Palette.** Identical. Same static layer, same zone tints, same
sprite palettes. The only new color in the Vokrew frame is the
shell's own lime accent (active tab, Run button) above the room.

**Character readability.** Numbers in the ruling on question (b)
below. Short version: at overview, Vokrew renders the world at 72%
of floor-oc's scale; at focus zoom both are legible.

**Motion feel.** Same engine, same speeds, same A* hallway routes,
same fountain. In the video the review walk reads as a small purple
figure crossing a dark room — the *event* is unmistakable if you're
watching for it, easy to miss if you're not, because at overview
scale the figure is ~12 px tall (G-2). floor-oc's motion feel could
not be re-captured for this gate — see G-8; Kevin's own verdict on
floor-oc ("Oh its walking and that fountain is fully animated")
stands as its reference.

**Top bar.** floor-oc: PHASE chip, crew count, RUNS, **TOKENS 0/1M**,
CREW LV, Walk, clock. Vokrew: LIVE chip, crew count, RUNS,
**⚡ CALLS TODAY**, clock. The Vokrew bar is sparser by design, and
its one substitution is the more honest metric — the bridge counts
lane calls, not tokens, and the spec (GAP-3) forbade faking a token
meter. Credit where due.

## Gap list

### G-1 — HIGH — The run card covers the room for the entire run
Submitting a run from the Floor form auto-opens the run card, which
occludes the room until manually closed. The room's whole reason to
exist is watching a run happen; the default flow hides it for exactly
that duration. Evidence: attempt 2 recorded a complete, successful
run whose every frame shows the card instead of the room
(`attempt2-card-occludes-room.jpg`); on the phone the same thing
happens (`phone-midrun.png` — the status line narrates "Judge is
reviewing at Musky's doorway…" over a screen showing only the card).
The shipped video exists because the harness closed the card via its
own Close button, as a user could — but a first-time user will never
see the walk.

### G-2 — HIGH — Overview scale regression vs floor-oc (−28%)
At 1440×900 the Vokrew canvas is 1166×546; floor-oc's is 1188×761.
The binding constraint is height, and height is eaten by the shell
above the room. World scale: **0.2566 (Vokrew) vs 0.3577 (floor-oc)**.
Characters render ~11.8 px tall vs ~16.5 px; the room gets 70% of
the pixels floor-oc gets. Everything in the room is equally sharp —
just smaller, all the time, in the version whose job is to be looked
at.

### G-3 — HIGH — Phone: the room collapses into a strip
At 412×915 the Floor panel keeps its desktop two-column layout: the
roster takes ~55% and the world canvas is squeezed into a
**138 CSS px-wide** strip down the right side, rendering the whole
2560×2000 world as an unreadable miniature. The in-room quest
tracker is positioned for the desktop layout and overflows the
viewport (its elements end at x=548–561 in a 412 px viewport), and
the in-room clock is clipped (right=434). 5 elements overflow at
idle/locked, 10 after a run. What *does* work beautifully at this
size: the shell, the run form, the crew picker, and the roster cards
— you can run your crew from the phone with no trouble. You just
can't watch them. (`phone-idle.png`, audits in `phone-results.json`.)

### G-4 — MEDIUM — Floor screen page weight is 19% over the spec ceiling
Spec §6 budget: ≤160 KB. Measured raw: **194,861 B** — floor.js
133,303 + floor-adapter.js 35,671 + floor.css 25,887. The adapter is
3.5× its ~10 KB spec estimate. Gzip transfer is 55.7 KB total, and
the files are lazy-loaded (the pair/chat path doesn't pay for them),
so real-world cost is modest — but the spec's own number is missed,
on the record.

### G-5 — MEDIUM — The room's bottom is below the fold at 1440×900
The Vokrew page is taller than the viewport: in `vokrew-idle.png`
the Yard, the bottom of the Workshop, and the rig footer are cut off
and require scrolling. floor-oc fits its entire room UI inside
900 px. Combined with G-2, the room is both smaller and partially
off-screen at the reference viewport.

### G-6 — MEDIUM — Phone frame times sag under run load (indicative only)
rAF probe at the S26 viewport, emulated on this VM's GPU-less
Chromium: idle avg 50.9 fps but p95 33.4 ms / p99 83.3 ms / max
266.6 ms; during a run avg **36.9 fps**, p95 66.7 ms, 32% of frames
over 33 ms. An S26's real GPU/CPU is far stronger than this VM, so
treat these as a floor, not a measurement of Kevin's phone — but the
shape (fine idle, sagging mid-run) matches the spec §7 risk-3 worry,
and the spec's reduced-motion fallback stays an open Kevin decision
after a real-device look.

### G-7 — LOW — Focus panel never gets out of the way
Once an agent is selected, the focus panel stays open over the room
indefinitely — including across a whole run (it is open throughout
the shipped video). floor-oc behaves the same way, so this is parity,
not regression; it's listed because on the smaller Vokrew canvas the
panel covers a proportionally larger share of the world (the whole
Skyloft).

### G-8 — LOW — Reference-capture limits (about this evidence, not the product)
floor-oc ran its vendor example data because its real `data.json` is
deliberately not committed. Its example task is unassigned and its
Ollama brain doesn't exist on this VM, so floor-oc could not execute
a run here; a 240 s ambient watch also produced no break-walk (no
entity moved >60 world px). The mid-run pair's left side is therefore
floor-oc's settled room (with its focus panel still open from the
focus capture — the same G-7 behavior), and floor-oc's motion
reference remains Kevin's prior first-hand approval. Separately,
floor-oc's own page logged two HTTP 502s during its capture — its rig
panel polling `/api/ollama/*` against a nonexistent Ollama. The
Vokrew page produced **zero console errors in every capture**
(desktop, video, phone; classification in `results.json` /
`phone-results.json`).

### G-9 — INFO — Rig note: the 120 s lane timeout vs a 2-vCPU VM
The bridge's lane timeout is a fixed 120 s (`providers.js`). On this
VM the 1B planner stage measured 54 s (Stage 3), 69 s (phone pass),
76 s (Stage 2) — and 96–125 s while a full-size screencast was
recording. Three of the five video attempts died at ~120 s with zero
stamps; the shipped take used a reduced-size screencast (planner:
96 s). This is a property of the *test rig*, not the product —
Hagan's PC ran 3 concurrent Vokrew runs without a crash, and real
lanes answer in seconds — but anyone re-running this gate on small
hardware should keep the capture light, and a very slow local lane
plus a long planner stage can genuinely hit this timeout in the
field. All five attempts are preserved (`attempt1..4-*.json`,
attempt 5 = `results.json`).

## Carried question (a) — Should the Run tab be folded into the Floor screen?

Spec §6 Stage 3 said it should ("the old Run tab folds into the
Floor screen's run form + run card"); Stage 3 shipped with the tab
retained. **Recommendation: fold it — remove the Run tab.** Evidence:

- The tab is a full duplicate: its form + blocking `?wait=1` result
  rendering shows the same Plan / Work / Review / Stamps the Floor
  run card renders — and the card additionally opens from the quest
  log, survives reload reattach (Stage 3 gate §3), and sits next to
  the room the run is animating. The tab's one historical reason to
  exist — Stage 2 needed a compat surface for the blocking endpoint
  before the run registry landed — is gone.
- Two run surfaces means two places for run UX to drift, and a user
  has to guess which one is canonical. The Floor screen is the home
  (Stage 3); the tab is a leftover door into the same room.
- One verification is owed before the fold: in attempt 2's recording
  the card's Plan/Work sections showed "…" placeholders mid-run even
  after those stages had stamped. Confirm the settled card renders
  the full stage text at readable width (the tab's one genuine
  advantage is its wide reading layout); if it truncates, widen the
  card or give it an expanded state as part of the fold — don't keep
  a whole tab for one text block.
- Unrelated but adjacent: G-1 should be decided first or together —
  if the card stops auto-opening over the room, the case for the tab
  gets weaker still.

## Carried question (b) — How readable are characters and nameplates at default zoom?

Measured from the live camera state at 1440×900 overview (engine
draws the character ~46 world px tall; nameplate text is 9 world px):

| | floor-oc | Vokrew Floor |
|---|---|---|
| Canvas | 1188×761 | 1166×546 |
| Overview scale | 0.3577 | 0.2566 |
| Character on screen | ~16.5 px | **~11.8 px** |
| Nameplate text on screen | ~3.2 px | **~2.3 px** |
| Focus scale | 0.8048 | 0.7200 (the engine's focus floor) |
| Character at focus | ~37 px | ~33 px |
| Nameplate at focus | ~7.2 px | ~6.5 px |

Verdict: at default overview, **nameplates are not readable in
either version** — 2–3 px text is texture, not type. That was already
true of the floor-oc Kevin approved: overview is for motion, color,
and shape; reading happens at focus zoom, where both versions are
legible (Vokrew ~10% under floor-oc, character ~33 px, nameplate
~6.5 px and readable in `side-by-side-focus.png`). What changed is
degree: Vokrew's characters are 28% smaller at overview, small
enough that following *which* agent is working comes from the roster
highlight and status line, not the sprite. If the room is ever meant
to be *read* at overview — names over heads while a run plays — the
lever is G-2/G-5 (give the room floor-oc's height), not the engine:
the same 9 world px nameplate at floor-oc's scale is still only
3.2 px.

## How this evidence was made (integrity notes)

- Real Chromium under `xvfb-run`; floor-oc ran against its own
  unmodified server booted from the Four Hands clone source on this
  VM; the Vokrew page ran against the real bridge + llama.cpp rig
  from Stages 2–3. This VM's Chromium blocks direct navigation to
  127.0.0.1 (LNA), so both pages were loaded through the Stages 1–3
  CDP Fetch-interception mechanism against the untouched servers.
  The bridge was never modified; no bridge or feature code was
  changed in this stage.
- The shipped video is the fifth capture attempt. Attempts 1 and 3:
  runs failed at the bridge's 120 s lane timeout (G-9). Attempt 2:
  run succeeded but the run card occluded the room (G-1) — that
  recording is preserved as stills/metadata, not shipped as the
  video. Attempt 4: failed at 120 s despite a smaller task. Attempt
  5: reduced-size screencast, run `44b91e03`, APPROVED, complete.
- Two harness interventions, both disclosed: (1) a one-line warm-up
  chat through the bridge before recording, so the cold model load
  isn't part of the run — the recorded run itself is untouched;
  (2) closing the auto-opened run card via its own Close button and
  scrolling the room into view before the run — the exact clicks a
  user who wants to watch the room would make. No entity state was
  ever written by the harness; all motion traces to bridge phases
  and stamps.
- Zero console errors in every Vokrew capture. The only errors seen
  anywhere were floor-oc's two Ollama-poll 502s (G-8).

*Gate output ends here. The verdict — ship, or send it back — is
Kevin's.*
