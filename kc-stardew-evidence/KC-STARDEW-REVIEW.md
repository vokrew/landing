# KC Stardew Room Pass — Review

**Branch:** `kc/stardew-room-pass` (from `ds/aaa-floor` @ 40018e5, DeepSeek's preserved build)
**Scope:** punch items 1 + 2 + the full item-3 world pass, in `ds-app/` only. Items 4 (motion) and 5 (visitor shell) are DeepSeek's lanes — not touched. Nothing merged, nothing deployed, AM21 untouched, $0 spent.
**Gate:** the same real rig DeepSeek faced — real registry bridge (`multi-brain-router-app/app`, :17717) + llama.cpp Gemma 3 1B lane (:18080), isolated `VOKREW_HOME`, file:// launcher → his `dev-server.js`. Harness: `kc-gate.mjs` (adapted from his `aaa-gate.mjs`), clip: `kc-clip.mjs`.

## Item 1 — Run-tab hint honesty ✅

**Root cause:** `#runHint` was a dead string — static HTML ("No run in flight.") referenced nowhere in `app.js`, while the pill is driven by `setBusy()`/`setStatus()` and the rail by floor phases. Three UI surfaces, and the hint wasn't wired to any of them.

**Fix (`app.js`):** a new `renderRunHint()` derives the line from the same state the pill uses — `app.running` / `app.phase` / `app.served` — and is called from `setBusy()`, from `handlePhase()` (so the stage/served count advance live), and from `setOffline()`. No second state store was introduced.

- running → `Run in flight — planner stage · 0/3 stages reported by the bridge.` (stage name and count track the bridge's phase events; "settling" renders as "settling")
- paired + idle → `No run in flight.`
- offline → `No run in flight — pair a bridge to send a task.`

**Gate evidence:** mid-run probe with pill `RUNNING` → hint `"Run in flight — planner stage · 0/3 stages reported by the bridge."` on desktop *and* phone (capture `04-phone-midrun.png` shows pill, hint and WORKING rail agreeing in one frame). After settle → `"No run in flight."`.

## Item 2 — Typesetter residue ✅

**Root cause:** `inlineMarkdown` was a single regex pass; a matched `**…**` span was emitted as a `<strong>` containing *plain text*, so a code span inside bold kept its literal backticks (4 in his settled card).

**Fix (`app.js`):** replaced the single pass with a small recursive descent, `appendInline()`: at every level, **code spans tokenize first** (contents literal, never re-parsed), then `**bold**` (inner text recurses), then links (same attrs as before), then `*italic*` (recurses). Unbalanced delimiters stay literal text. Block structure in `markdownNode` untouched.

**Gate evidence, two layers:**
- Deterministic probe through the page's own `__vokrew.renderMarkdown`: `**Type \`pwd\` and press Enter.**` → STRONG containing CODE("pwd"), **0 backticks**; structure probe OL=1/LI=2/STRONG/EM/P all present; literal-code probe (`` `a ** b` ``) stays one CODE, no STRONG.
- On the real settled card: **0 backticks with 3 CODE elements** (final gate run); in the 19:57 run the bridge plan genuinely contained the nested pattern (`planHasNestedCode=true`) and the card still rendered **0 backticks / 8 CODE elements**. Capture `05-phone-settled.png` shows the plan's bold lead-ins with code chips throughout.

## Item 3 — The room pass ✅ (look gate is Kevin's)

**Constraint honored:** drawing code only. Grid, `SEATS`, `DOORSTEPS`, blocked cells (`DESKS` row 3, `GLASS` row 4 x13–17, furniture), `findPath`, all exports and `adapter.js` are byte-identical — his adapter/geometry suite passes **22/22**, and the gate re-proved the reviewer doorstep at {12,4} implicitly via live runs. The office is now a village:

- **Three distinct home spots** replace the identical desks (`drawDesk` → `drawHome`): Scout's cream cottage (terracotta roof, drafting table with chart/scrolls/quill, flower bed + watering can), Musky's stone-and-timber cottage (slate roof, chimney, workbench with planks/hammer/horseshoe, barrel), Judge's lavender cottage (violet roof, reading table with book stack/open book/teapot, climbing vine + hanging lantern). Each has a door on a different side, a lit window with flower box, and a role-coloured doorstep mat. Chairs became cushioned stools in role colours.
- **The Green:** stone fountain with falling water at the plaza's heart, a great oak with apples and a rope swing, a striped-awning market stall with produce crates, picnic table with checked cloth, benches, flower beds along both walls, lantern posts, and the notice board (his whiteboard) moved off the wall to stand free on the Green — the roofs needed the wall.
- **The trellis** stands exactly where the glass partition stood (same blocked cells, same reviewer detour) — wooden lattice under green with violet/amber blooms.
- **Zones renamed and re-paletted warm:** THE GREEN / THE LANE / THE TERRACE / THE SMITHY / THE MEADOW; minimap is a village map (label + green/brown zone colours). Walls are warm stone with ivy; the outer ring is a tree-line canopy; the water cooler is a rain barrel with a bucket.
- **Terrace:** day-sky windows (sun, clouds, green hills, a far farmhouse), bunting, hanging planters; sofa/cat/record console kept and warmed. **Smithy:** a glowing forge with anvil and hay bale joins the bench/pegboard. **Meadow:** a pond with lily pads and a frog, flower patches, string lights kept.
- **Brightness (measured, same probe both sides):** room-canvas mean Rec.709 luma at paired idle — **his build 0.2053 → this build 0.4237 (+106%)**. The vignette was cut from 0.50 to 0.12 max alpha and the grain halved to pay for it honestly, not just by palette.
- **Honesty contract kept:** every animation still maps to bridge state — the working seat's *window* now also flares (in `drawDynamic`, gated on `phase === "working"`), walking is still real phase transitions, the doorstep review is unchanged. Ambient window breathing is lamplight, not activity. Nameplates untouched and readable at 412px; zero horizontal phone overflow (412/412).

## Gate results — final clean run (19/19 PASS, zero console errors)

Runs: **run 1 `d74f8f9f-ea9d-4820-bdf3-22497cbeb222`** — done, APPROVED · **run 2 `a9785b5e-f126-4c02-ac72-51dced59d92a`** — done, APPROVED (phone, mid-run reload).

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

Process honesty: the build never failed a gate check. My *harness* failed three times on its own bugs (wrong pill element id, unauthenticated `/runs` polling, wrong settle field — the record uses `state: "done"` and a top-level `verdict`), each fixed against the contract in his `aaa-gate.mjs` and re-run. Two build bugs were caught and fixed during development (a function swallowed by a splice; a palette-keying error) — both found by the probe rig before the final gate, which ran against the exact committed tree.

## Evidence — `~/workspace/deepseek-review/kc-stardew-evidence/` (also committed in-repo)

- `before-01-idle.png` — his build, paired idle (luminance 0.2053)
- `01-desktop-idle.png` · `02-desktop-midrun.png` · `03-desktop-settled.png`
- `04-phone-midrun.png` · `05-phone-settled.png` (the settled run card, modal)
- `clip-live-run.mp4` — 28.7s live-run recording (86 frames, ~3 fps headless screencast)
- `results-before.json` · `results-after.json` · `gate-before.log` · `gate-after.log` · `clip.log`

## Honest self-critique vs the Stardew / Animal Crossing refs

Where this still falls short of the bar — function gates ≠ look gates, and Kevin's eye is the real one:

1. **Texture authorship.** The refs carry authored per-pixel texture everywhere; my grounds are procedural — speckles, hash-placed blades, gradient water. It reads *warm and composed*, not *hand-textured*. The plaza and terrace dirt are still the flattest surfaces.
2. **The homes are flat fronts.** No side walls, no roof thickness or overhang shadow; Stardew's buildings have mass. The gables help, but a second pass should add eaves shadow and a stone foundation course.
3. **The oak is blobby.** Layered circles read "tree" at room scale, but AC's canopy is sculpted — more silhouette variety and a visible branch structure would close the gap. The swing is subtle to the point of shy.
4. **Water is a gradient ellipse.** No shoreline foam, no inlet/outlet, no reflections of the stall/oak. AC's pond edge work is a whole craft I only gestured at with a stone rim.
5. **Some interiors are his compositions re-tinted, not re-composed** — the Terrace sofa/record console and Smithy pegboard are DeepSeek's drawings warmed up. They sit comfortably in the village, but they're not mine in the way the square is.
6. **Windows are small.** The working flare lands, but at room scale the lit windows are modest; bigger cottage windows (or a second window per home) would sell "lived-in" harder.
7. **The clip is ~3 fps** — a headless-screencast limit, not the page (which animates at rAF). Motion in the recording reads steppier than the live page; judge motion from the captures + a live look if it matters.
8. Nameplates still overlay the trellis during the review walk — his design, kept deliberately; it briefly hides the blooms the detour walks past.

What I believe *does* meet the refs' spirit: the palette (warm, saturated, daylight), the hand-placed density of the square, per-seat character you can tell apart at a glance, and a room that is unambiguously a *place* now — you could give directions in it ("meet by the fountain", "Judge's cottage, the lavender one").

## Landing

Committed on `kc/stardew-room-pass` (code + evidence) and pushed. **Not merged to main, not deployed.** DeepSeek's items 4–5 are untouched lanes; `ds-app/README.md` is his file and was not edited — this review is the documentation for the pass.
