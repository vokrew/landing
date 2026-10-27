# HUD overlap fix + ambient-light floor — FIX NOTES (KC, 2026-10-27)

Branch `kc/hud-overlap-fix` from origin/main @ 4c43844 (AAA pass + shell).
Two of Kevin's live reports from the deployed site, one branch, one gate.

## Fix 1 — sector map vs room-tab strip (Kevin, 12:55)

**Cause (measured, not guessed).** Two independently docked absolute
elements in the stage's bottom-right corner whose hand-tuned offsets
no longer summed. The sector map (`#minimapWrap`) is anchored
`bottom:72px` and is **216px tall** (fixed 220×172 canvas shown at
216 CSS px ≈ 169px + header + legend + padding), so its top edge
sits at **288px** from the stage bottom. The tab strip's (`#viewbar`)
chrome override parked it at **`bottom:272px`** — its bottom edge
16px *inside* the panel. Rendered measurement, every sector, every
mode: **clearance −15.8px, overlap 3,657.6 px²** — the tabs lay
across the map's top edge and SECTOR MAP header, exactly as reported.

**Fix.** `#viewbar` desktop dock 272px → **300px** (= 72 + 216 + 12px
of air; the coupling is commented at the rule — if the map's height
ever changes, the dock moves with it). After: **clearance +12.2px,
overlap 0**, in shell, paired idle, and mid-run, across all five
sectors (Overview/Foundry/Skyloft/Workshop/Yard — zone label, active
tab, and click-through verified per sector).

**Same disease, phone width (found by the gate, in scope).** At
≤720px there is no minimap, but mid-run the docked run strip
(`bottom:12`, spans 12..46, z-30) sat directly on the tab strip
(`bottom:12`, z-20): **overlap 10,541.6 px², no tab clickable
through its center (hitOk 00000)**. The phone bottom chrome now
stacks in three clear rows — run strip 12..46, hint pill 54..82
(unchanged), tab strip docked at **bottom:90px** — and the
noticeboard's phone `max-height` was re-clearanced 76 → 136px to
preserve the clearance it was designed with against the strip's new
dock. The Stage 0 strip itself (position, 34px dock, ruled sliver)
is untouched. After: overlap 0, hitOk 11111, including with a hold
pending (noticeboard vs tabs measured clean at phone width too).

## Fix 2 — ambient-light floor (Kevin, 12:59/13:02: "the floor reads COMPLETELY BLACK")

**Cause.** The AAA shade plate was filled `rgba(5,9,17,.92)` and laid
over the world at the 0.45 veil: an unlit point kept only ~59% of the
world's (already dark) pixels, and in shell/idle states the only
cuts in the plate are the lamps — an empty desk's spill was 0.12, so
desks sat at ~63% transmission in near-uniform dark. Our rig's
software rendering flatters it; on Kevin's real monitor it read black.

**Fix (floor.js `drawLighting` / `lightSources`).**
- Plate fill .92 → **.84**, plus a **uniform destination-out ambient
  cut of 0.46** across the whole plate before the per-light cuts.
  Multiplicative: far-field plate alpha .92 → **.45** (world
  transmission .59 → **.80**); lamp pools keep their contrast and
  stay warm accents on top of the base.
- Unowned-desk spill 0.12 → **0.22** (state ladder intact:
  empty .22 < idle .38 < ready .55 < running 1.0).
- The veil (0.45, Kevin's "a touch brighter" setting) and run-state
  lighting behavior are otherwise untouched.

**Measurable gate** (mean Rec.709 luminance of the room canvas,
sampled in-page; floors set at BEFORE × 1.10 per state — the phone
floor is lower because the portrait canvas carries an out-of-world
void band the lighting cannot reach):

| state | before | floor | after |
|---|---|---|---|
| shell, desktop | 0.0702 | 0.0772 | **0.0807** |
| shell, phone | 0.0587 | 0.0646 | **0.0663** |
| paired idle, desktop | 0.0710 | 0.0781 | **0.0816** |

Dark-field regional check (desktop crop over the foundry cubicle
field): 0.0914 → **0.1087** (+19%). Eyeball: every zone and every
OPEN DESK sign reads without squinting in the after captures; the
room keeps its lamplit mood — pools are still pools, nothing is
uniformly bright.

## Verification — `hud-capture.mjs` (real rig, no mocks)

BEFORE: 55 assertions, **14 misses** (the two overlaps above, in every
mode/sector they apply to). AFTER: **58/58**.

- Desktop shell + paired idle: map/tabs geometry clean in all five
  sectors; noticeboard (hold pending) clear of both.
- Paired desktop regression: pair via the expanded setup tab → rig
  crew → conductor call-out → hold → approve → run
  `6dcc28fd-58cf-47b9-8bb0-0e043482ab07` settled **done/APPROVED**
  (3 stamps, same-family) → reviewer on the executor's doorstep in 7
  state-log entries → verdict row in the transcript.
- Phone paired: pair at 412px → hold created + noticeboard geometry
  clean → dismissed → run fired via bridge API
  `efec6974-ed78-40b8-be3a-304a22d2a96a` picked up live by the page,
  strip/tabs/hint measured clean mid-run, settled **done/APPROVED**.
- Zero console errors in every part; zero horizontal overflow on phone.

Process note: the first after-run's process was reaped mid-Part-Q by
the runtime (captures through the desktop regression survived; the
in-memory results did not). The gate was re-run detached end-to-end —
`after-run.log` is that complete run; no assertion was carried over
from the killed attempt.

## Files

- `app/floor.css` — viewbar desktop dock 272→300px; phone dock
  12→90px; noticeboard phone max-height clearance 76→136px.
- `app/floor.js` — shade plate fill + ambient cut; unowned spill.
- Evidence here: `hud-capture.mjs`, `results-before.json`,
  `results-after.json`, `after-run.log`, before/after captures
  (shell desktop + Foundry sector, phone shell, paired idle /
  mid-run / settled, phone paired mid-run).
