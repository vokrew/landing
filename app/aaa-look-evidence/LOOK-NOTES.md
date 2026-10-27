# AAA LOOK PASS — LOOK NOTES (KC, 2026-10-27)

Branch `kc/aaa-look-pass` from `phase2-stage4-look-gate` @ d93e81d.
Code commit `82101b0` (+ a phone-chrome fix in the evidence commit).
Kevin's order: "I want to see what you can do muse i know you can
change this." Judged against the Stage 4 captures of the base commit
and the painterly bar. **Kevin's eye is the final gate — this file is
my honest self-assessment, not the verdict.**

## What changed

**1. The room has real light now (floor.js, `drawLighting`).**
A half-scale shade plate is cut each frame with radial holes at
every light source, laid over the world as a veil, then warm/cool
glow is screened on top:
- One lamp pool per cubicle desk, and its strength is the desk
  owner's REAL bridge status — running = full warm pool, ready =
  medium, idle = ember, empty desk = faint spill. Light is state,
  never decoration faked ahead of the data.
- CEO office pendant pool, conference pool (bright only while a
  meeting is actually active), the hearth (subtle flicker), the rig
  and the skyloft in cool blue, the workshop warm, the yard under a
  moon wash with three path lamps.
- The layer sits over the world and its people, under the speech
  bubbles, so talk stays readable.

**2. Surfaces have grain (floor.js, procedural — zero assets).**
Every floor plate in every zone flows through `drawFloorPattern`,
which now lays alternating plank bands plus a seeded speckle-grain
tile; cubicle and conference rugs get a woven-pile dot grid. Seeded
(mulberry32), so the world is identical on every load. The hub was
off, so no FLUX plates — procedural carried the whole pass and
never blocked it.

**3. World type is legible at working zoom (floor.js).**
Name tags, cubicle signs, the office door plate and speech bubbles
previously used fixed world-unit fonts — ~4 screen px in overview,
unreadable. They now hold a constant SCREEN size against the camera
(name tags target ~10.5 screen px, clamped so focus view doesn't
balloon). Compare before/after idle: "Scout / Musky / Judge" are
smudges before, readable names after.

**4. G-3 fixed: the run card renders markdown (floor-adapter.js).**
Plan/Work/Review are now `.md` panes filled by a small page-side
renderer (`mdToHtml`/`setMd`): headings, bold/italic, inline code,
fenced code blocks, lists, quotes, rules. Escape-first — lane text
is HTML-escaped before any transform, so model output cannot inject
markup. Stamps stay a raw `<pre>`: they are the ledger, not prose.
Proven three ways: node unit tests (injection cases included), an
in-page probe during the filmed run (panes are DIV.md, stamps PRE),
and the settled stills — the 1B lane's real plan/work output
(numbered list, **Command:**, `echo "hello"` code chip) renders
formatted on desktop and phone. The raw record carried markdown;
no literal `**` survived into pane text.

**5. Motion feel (floor.js).** Walk tweens now ease with smoothstep
instead of gliding at constant speed — same endpoints, same sim
clock, so positions and honesty are unchanged; steps start and
settle like steps.

**6. Chrome finished to match.** Minimap dots carry status halos
and the viewport is a lit window, not a bare outline; the sector
map sits in a deeper glass well. The run card's panes, verdict and
section headings are finished in the room's palette (amber rules).
Shell views (Chat/Budget/Crew/tabs) share one tightened type
hierarchy, and the page backdrop carries the room's lit-world
washes instead of a flat void. One pre-existing wart fixed in
passing: at phone width the centered sector tag ghosted behind
the quest tracker (visible in Stage 4's own phone captures) — the
tag now yields at ≤720px; desktop untouched, verified in the
re-run phone set.

## Verification (real rig, no mocks)

Same harness recipe as Phase 2 Stage 4, adapted (`aaa-capture.mjs`,
`aaa-phone.mjs` in this folder): real bridge from
`multi-brain-router-app/app`, llama.cpp Gemma 3 1B lane, isolated
VOKREW_HOME, file:// page + Fetch interception, CPU-pinned rig.

- Desktop take 1: **COMPLETE, 22/22 assertions** (results.json).
  One full conductor session on camera: pair → named call-out →
  hold (badge + noticeboard agree) → approve → run 80944ae1 settles
  **done / APPROVED** in 54s → reviewer on the executor's doorstep
  cell in 12 state-log entries → dossier shows the run in Judge's
  history. Zero console errors.
- Phone pass (412×915, S26 emulation): **COMPLETE** — the same
  session at phone size (run 08E5… APPROVED), zero horizontal
  overflow at every beat, dossier panel inside the viewport, zero
  console errors. Re-run after the zonetag fix; evidence matches
  the shipped CSS.
- Strip behavior did not regress: mid-run still shows only the
  docked strip ("RUN-8094 · Judge is reviewing · ⚡ 2 calls
  served"); the settled card auto-expands exactly as Stage 0/4
  ruled (that remains gap G-1, a standing item — not reopened
  here).
- Video: `aaa-conductor-session.mp4`, 106.6s of the filmed
  session. ffprobe (ffprobe-video.txt): H.264 **High, level 31,
  yuv420p, 24 fps, time_base 1/12288**, AAC **LC 24000 Hz mono**,
  moov before mdat (faststart) — Kevin's phone spec exactly.
- Luminance numbers are in luminance-stats.json, including the
  honest read: the veil lowers the frame's mean; the pools are
  local and are judged in the stills, not in a global statistic.

## Honest gaps — what is still short of the bar

1. **Overview darkness is a judgment call.** The lit look trades
   the old flat brightness for mood: empty halls fall off quite
   dark at overview zoom. I judge it intentional and premium (lit
   work areas, dark circulation — like a real office at night),
   but it is ONE constant away from brighter (`drawLighting`'s
   veil alpha, 0.52) if Kevin wants it lifted. This is the first
   thing I'd tune to his eye.
2. **The characters are still the engine's ~46px sprites.** The
   lighting and type now outclass the little guys themselves;
   giving the crew real portrait-grade figures is an asset job
   (FLUX lane when the hub returns, or a sprite rework), not a
   code-side pass. Biggest remaining distance to "AAA" lives here.
3. **Grain is subtle at overview** — it reads at focus zoom and in
   the floor's sheen, but at full-room zoom the plank banding does
   most of the work. Deliberate (grain that shouts at overview
   reads as noise), noted for honesty.
4. **No sound.** The room is still silent; a premium slice
   eventually wants an ambience bed and UI ticks. Out of this
   pass's scope (and the video's silent AAC track is the phone
   spec's placeholder, same as Stage 4).
5. **Conductor transcript + Chat tab still show lane text raw.**
   G-3 named the run card; I kept the fix scoped there rather
   than re-render surfaces the Stage 2/3 gates compare as text.
   The same renderer drops in cleanly when Kevin says go.
6. **fps on real phones is unmeasured here** (VM emulation only,
   same caveat as Stage 4's G-6). The lighting plate is half-scale
   and ~25 gradients a frame by design, but Kevin's phone is the
   only honest meter.

## Files in this folder

- `side-by-side-{idle,midrun,settled}.png` — before | after pairs
  (before = Stage 4 captures of the base commit, copied in as
  `before-*.png`).
- `after-*.png` — the filmed session's beats; `after-phone-*.png`
  — the phone set.
- `aaa-conductor-session.mp4` + `ffprobe-video.txt`.
- `results.json` / `results-take1.json` / `phone-results.json` /
  `takes.json` / `run-state-log.json` — the gate records.
- `aaa-capture.mjs` / `aaa-phone.mjs` / `build-package.py` — the
  harness, adapted from Stage 4's with the G-3 probes added;
  `capture-take1.log` / `phone-output.txt` — raw run logs.
