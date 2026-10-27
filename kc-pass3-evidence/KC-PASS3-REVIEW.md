# KC Pass 3 — Review

**Branch:** `kc/stardew-room-pass` (on top of `22d17e2`, the building-feel pass; from `ds/aaa-floor` @ 40018e5)
**Code commit:** `2f84dfc` · **Evidence commit:** `21d594a` (+ this review)
**Scope:** Kevin's look ruling on the building pass — "One more pass." The composition, the village, and the cutaway architecture are approved territory and were not redesigned; this pass attacks the standing look gaps both prior reviews named, in the brief's priority order. Drawing code only, in `ds-app/floor.js` (+306/−56). Items 4 (motion) and 5 (visitor shell) remain DeepSeek's lanes — not touched. Nothing merged, nothing deployed, AM21 untouched, $0 spent.
**Gate:** the same real rig — real registry bridge (:17717) + llama.cpp Gemma 3 1B lane (:18080), `kc-gate.mjs`, **fresh Chrome profile (`/tmp/kc-gate-profile` cleared) and fresh `VOKREW_HOME`**, before and after runs, the after run against the exact committed tree.

## What changed, by priority

### 1. Texture authorship — speckle replaced with shaped marks
- **Grass is drawn, not scattered.** A new `tuft()` helper draws four-blade fans; the Green and the Meadow now grow tufts (deterministic hash placement, two tones) instead of 1–3px hash dots and the Meadow's 420 speckle rects. Clover dots and the sun fleck survive — they were shaped already.
- **Worn-path edging.** The Green's dirt path tiles gained a pebble edge and grass creeping in at the corners; the plaza flags gained a lit top bevel per stone and an occasional worn chip.
- **Wood has grain.** Terrace floor planks: two wavy grain strokes and an occasional knot per tile. Cottage plank slabs: a grain stroke per course plus a pale cut face at each plank end. Worktables: grain along the boards.
- **Stone has bevels.** Smithy flags and the executor's cottage flags each catch a 1px light along the top edge.
- **Textiles are woven.** The Terrace rug has bands, warp lines and an inset border; the Smithy straw mat has an over-under grid under its dashed edge.

### 2. Roof volume
Two-tone slopes meeting at the ridge (west slope sunlit, east a breath darker) over the existing shingle courses, a bargeboard trim line inside both slopes, **a far-slope sliver behind the ridge on the door side** with its own lit edge, and **eave returns** — small roof blocks wrapping both front corners. The approved silhouettes stand; the shell is no longer a stencil.

### 3. Pond shoreline
A wet-sand band inside the stone rim, a **scalloped foam edge** (dashed light stroke) where water meets it, faint reflections smeared on the surface inside a water clip (the stall's awning red to the north-west, the oak's green to the south), sparkle ticks, and **three stepping stones wading into the shallows** on the west shore. Lily pads and the frog kept.

### 4. Oak canopy
Ten uneven lobes replace the eight uniform blobs, drawn over a **shadow underpass** (offset dark pass) so the canopy has a top and an underside; underside shade arcs pool where it hangs over the grass; two new branches climb into the shoulders. The swing's seat is wider, with rope knots, a top highlight and **its own ground shadow**.

### 5. Cottage windows — real ones, at last
**Found in this pass:** the framed window was being drawn at `winCx = (cx ∓ 0.68) * TILE` — the tile offset multiplied *after* the pixel centre, which put the frame, glass and flower box ~4,400px off-canvas. The only window the village has ever shown is the lamplight/flare glow disc at `HOME_WINDOWS`. The formula is corrected (window centred opposite the door, on the 2.62 line the glow uses) and the window rebuilt modestly larger: 25.4×22.4 frame, mullions, a stone sill, and a wider flower box with five blooms. **No second window** — on every facade the remaining wall is spoken for (door, mid post, role dressing: barrel, vine, flower bed); a second frame would collide, so the one real window carries it. `HOME_WINDOWS` and all phase logic are byte-untouched — the flare and the ambient breathing are exactly as gated in passes 1–2, and no new light signal exists: the framed glass is a constant lit interior, like the lantern by the reviewer's door.

### 6. Trellis corner
The trellis cells did not move. In front of the reviewer's house (x > 15.7 tiles) the foliage now stays up in the lattice (clamped clear of the foundation band), blooms lift with it, and the foliage's ground shade stops at the property line and thins — the foundation course reads through, and the lattice reads as a fence standing in front of the house.

### 7. Cottage depth, drawing only
Foundation course 10 → **13px** with a double-lit arris; cut front stubs 13 → **16px**; the ground shadow re-seated under the taller course. Anything deeper needs the layout (the seat row is the room's south wall), which stays frozen — stated, not smuggled.

## Gate results — final run, exact committed tree (19/19 PASS, zero console errors)

Runs: **run 1 `cca9bfe0-1c76-4971-b068-874bd45b5f21`** — done, APPROVED · **run 2 `7742a8e4-639a-4c95-b98d-58abacfb553f`** — done, APPROVED (phone, mid-run reload).

| Check | Verdict |
|---|---|
| Page boots offline / pairs via UI / token stored | PASS |
| Typesetter: nested code-in-bold, structure, literal safety | PASS ×3 |
| Item 1 mid-run hint == pill (desktop + phone), idle text after settle | PASS ×3 |
| (e) Page verdict == bridge record; stamps name local-gemma · gemma-local on all 3 stages | PASS ×2 |
| (g) "same family" labeled, no cross-family claim | PASS |
| Item 2 settled card: 0 backticks (both runs) | PASS ×2 |
| Budget pill == GET /budget coding total (3 calls) | PASS |
| (i) Mid-run reload reattaches, journal state done, modal verdict APPROVED, never "run lost" | PASS |
| Phone overflow 412px | PASS (412 ≤ 412) |
| Console errors, whole session | **0** |
| Adapter/geometry suite (`adapter.test.mjs`) | **22/22** |
| Luminance, paired idle, same probe: baseline (22d17e2) **0.4221** → this build **0.4210** | −0.26%, immaterial |

Geometry is byte-identical: the diff touches only the header comment and drawing code inside `createFloor` (grounds, `drawHome`, `drawCommons`, `drawGlass`, `drawYard`) plus one new drawing helper (`tuft`). `SEATS`, `DOORSTEPS`, `DESKS`, `GLASS`, `FURNITURE`, `buildGrid`, `findPath`, `HOME_WINDOWS`, and `adapter.js` are untouched.

## Evidence — `~/workspace/deepseek-review/kc-pass3-evidence/` (also committed in-repo)

- `before-01-idle.png` — the building pass (22d17e2), paired idle (luminance 0.4221)
- `01-desktop-idle.png` · `02-desktop-midrun.png` · `03-desktop-settled.png`
- `04-phone-midrun.png` · `05-phone-settled.png`
- `crop-cottages.png` · `crop-terrace.png` · `crop-smithy.png` · `crop-oak.png` · `crop-pond.png`
- `clip-live-run.mp4` — 19.7s live-run recording (59 frames, ~3 fps headless screencast)
- `results-before.json` · `results-after.json` · `gate-before.log` · `gate-after.log` · `clip.log`

## Honest self-critique vs the refs

Kevin's eye is the judge; here is what I see before he has to find it:

1. **The windows are the win.** The facades finally have framed, flower-boxed windows that read at full-room zoom, and the interiors feel inhabited rather than wallpapered. This closes the oldest cosmetic debt in the build — including one nobody knew was a bug.
2. **The roofs improved in degree.** The two-tone split and the far-slope sliver read in the crops, but at full-room zoom the sliver is a whisper and the gables still sit in one plane facing the viewer. Stardew's roofs have a visible top plane you could stand on; ours is still a decorated front. True roof planes need the facade drawn in a different projection — a composition change, outside this pass's charter.
3. **The oak is better and still round.** Shoulders, an underside, branches that reach somewhere — but the silhouette remains a friendly green cloud. AC's canopies are sculpted with bites and asymmetry; mine is a tidier blob. The swing, though, finally sits in the scene (shadow, knots, width).
4. **The pond's shoreline reads; its reflections barely do.** Foam edge, wet band and wading stones are visible in the crop; the red/green reflection smears are so faint they may as well be a rumour. I kept them faint deliberately — a loud reflection would lie about the light — but Kevin should know they're a gesture, not a feature.
5. **The trellis is softened, not solved.** The foundation line is clear of growth now and the shade stops at the property line, but the lattice still stands directly in front of the reviewer's west corner, because row 4 is where it lives. It reads "garden fence in front of the house" — plausible, intentional-looking, and still the tightest squeeze in the village.
6. **Texture is authored in strokes, not pixels.** Tufts, grain and bevels are drawn marks with intent, and the surfaces are calmer for it — but they are still procedural marks placed by hash, not hand-set tiles. The Terrace rug's weave is the quietest of the changes; at capture contrast it whispers. The remaining distance to the refs lives here and in the cottage rooms' depth (~1.7 tiles, layout-capped, unchanged).
7. **The clip is ~3 fps** (headless screencast limit), same caveat as both prior passes — the live page animates at rAF; judge motion live if it matters.

What I believe meets the ruling: every surface Kevin named as procedural now carries drawn, deliberate marks; the roofs have planes and returns; the pond has a shoreline; the oak has an underside; the trellis respects the foundation; and each cottage has a real window with flowers under it. The village was a place after pass 1 and a building after pass 2 — after pass 3 it is a place that looks *kept*.

## Landing

Committed on `kc/stardew-room-pass` (code `2f84dfc`, evidence `21d594a`, this review) and pushed. **Not merged to main, not deployed.** DeepSeek's items 4–5 untouched; `ds-app/README.md` is his file and was not edited — this review is the documentation for the pass.
