# Phase 2 Stage 4 — LOOK GATE (Kevin judges)

Phase 2's function gates are green (Stages 0–3). This package is the
**look/feel proof**, gathered 2026-10-27 on the VM rig (real bridge +
llama.cpp Gemma 3 1B lane — no mocks, no fixtures, no hand-driven
entity state anywhere). Per Kevin's law, function-green is not done:
what follows is a gap list first and credits second.

## The headline

The whole Phase 2 loop works in one filmed session, end to end:
pair → type a named call-out → the hold appears in the office
(sidebar card + noticeboard + badge) → Approve → Scout plans, Musky
works, Judge walks to Musky's doorway → the verdict lands in the
conductor transcript → Judge's dossier shows the run in its history.
Phase 1's three HIGH gaps are closed and re-measured here (scale
parity inside the 5% band; the phone room is a real viewport with
zero overflow; the run card docks as a strip instead of covering the
run). **What remains is one HIGH item, and it is the flip side of
that strip fix**: the moment a run settles, the card auto-expands
back over the room — 38% of the canvas, centered on the crew — and
the executor is not clickable until the card is closed (the Stage 1
finding, re-measured on this build, probe-proven). Two MEDIUMs
(raw markdown in the card; the strip's 2.49% sliver, still awaiting
your ruling), two LOWs, one rig note. Details with evidence below.

## Deliverables in this folder

| File | What it is |
|---|---|
| `vokrew-conductor-session.mp4` | One complete real conductor session, 97.75 s (run `397ee72e`, verdict APPROVED). Phone spec verified by ffprobe (`ffprobe-video.txt`): H.264 High, level 3.1, 1152×720, **yuv420p**, 24 fps, AAC-LC 24 kHz mono (silent — the capture has no audio), video track timescale 12288, faststart (moov at byte 36). 2,095,012 bytes. |
| `side-by-side-idle.png` | floor-oc (left) vs Vokrew Floor (right), idle, house frame |
| `side-by-side-dossier.png` | floor-oc focus view (left) vs Judge's dossier after the run (right) |
| `side-by-side-hold.png` | floor-oc idle (left — it has **no holds surface**; labeled in frame) vs hold pending (right) |
| `side-by-side-transcript.png` | floor-oc idle (left — **no conductor surface**; labeled) vs settled, verdict in the transcript (right) |
| `flooroc-*.png` / `vokrew-*.png` | The individual frames the composites are built from (idle, hold-pending, midrun, settled, dossier) |
| `phone-room.png` / `phone-hold-pending.png` / `phone-conductor.png` / `phone-dossier.png` | Galaxy S26 viewport pass, 412×915 CSS px @ DPR 2.6 — the same session shape as desktop, run `c0c50dd6`, APPROVED |
| `results.json` / `run-state-log.json` / `frames.json` / `frames-concat.txt` | Desktop capture results (take 4 + take 1's floor-oc part), entity-state corroboration log, screencast frame timings (frames themselves live in the take's /tmp dir; regenerable from the harness) |
| `phone-results.json` | Phone audits (zero overflow at every beat), phases, final record |
| `results-take1..4.json` / `takes.json` | Every video take on the record — see G-6 |
| `stage4-capture.mjs` / `stage4-phone.mjs` / `build-package.py` | The harnesses + the composite/encode builder that made all of it |

### Watching the video

t≈0–2 s the locked room → the pair form is typed and the door drops
→ the rig crew (Scout / Musky / Judge) seats → t≈11 s the call-out
is typed into the conductor ("Scout, write a one-line bash command
that prints the word hello, then explain it in one short
sentence") → the hold lands: transcript HELD row, hold cards in the
sidebar **and** on the office noticeboard, top-bar badge 1 →
t≈14.3 s Approve is clicked on the card and the run fires
(RUN-397E) → Scout plans at his desk (stamp 33.2 s) → Musky works
(stamp 15.9 s) → Judge walks the hallway and stands on Musky's
doorstep cell {23,46} (t≈69.0 s; state-log proven in 16 consecutive
logged entries) → verdict APPROVED lands at t≈84.4 s (reviewer
stamp 21.3 s) in the conductor transcript and the run card → the
card is closed via its own Close button, Judge is clicked in the
room, and his dossier opens on the focus camera with the run in its
history. The budget story in frame is exact: ⚡ CALLS TODAY goes
0 → 3, one per served stamp, and every surface labels the review
"same family" (single-family rig; `crossFamily=false` on the
record). Two framing disclosures: the filmed task is deliberately
small (see G-6 — the open-ended canonical call-out cannot beat this
rig's lane timeout), and the screencast's source rate on this VM is
~4 fps (391 frames / 97.1 s), resampled to 24 fps with real
timings preserved — motion reads steppier than the page does on
real hardware.

## Side-by-side comparison

**Scale (Phase 1's G-2, re-measured).** floor-oc overview scale
0.35767, canvas 1188×761. Vokrew overview scale **0.34075**, canvas
1166×725 — height at 95.3% of the reference, scale 4.7% under,
inside the 5% parity band Stage 0 set. Characters ~15.7 px vs
~16.5 px; nameplates ~3.1 px vs ~3.2 px (texture, not type, in both
— reading still happens at focus zoom, where the dossier shot sits).

**Composition.** The room itself is unchanged floor-oc. What Phase 2
adds around it: the conductor column under the quest log (HELD /
FIRED / VERDICT rows read as a clean session log), the noticeboard
card pinned to the room's top-right while a hold pends, the HOLDS
chip in the top bar, and the docked run strip at the room's bottom
edge during a run. None of it invents state — every element traces
to a bridge record, a stamp, or a held instruction.

**The new surfaces against the reference.** floor-oc has no
conductor, no holds, no noticeboard, no dossier — the hold and
transcript composites pair against its idle room and say so in the
frame. The dossier's honest reference is floor-oc's focus view:
same focus camera, and Vokrew's panel adds identity / today /
history from the bridge where floor-oc shows its own agent card.

**Phone.** The Phase 1 collapse is gone: the room takes a real
viewport share, the conductor and hold card sit below it with
full-width touch targets, the dossier becomes a near-full-screen
sheet whose HISTORY row fits the page scroll. Zero horizontal
overflow at all four beats (`phone-results.json` audits), zero
console errors, and the phone session's run settled in 29 s on the
same lane.

## Gap list

### G-1 — HIGH — On settle, the run card covers the room and swallows the executor's click (Stage 1 finding, re-measured)

Stage 0 fixed the *during-run* occlusion (the strip, G-2 below).
The *post-run* state is unchanged from Stage 1's finding: the card
auto-expands on settle to 680×472 px over the canvas — an overlap
of **320,641 px², ≈38% of the room** — centered on the crew. Probe
on this build, in the settled layout, before anything is touched:
`document.elementFromPoint` at Musky's canvas click point returns
**`floorCardBody`** (chain: floorCardBody → floorRunCard → stage).
He cannot be clicked until the card is closed via its own Close
button — which is exactly the extra click the filmed dossier beat
has to make. This is the one gap I would call **blocking-grade**:
Phase 2's core loop is "watch the run, then click the agent," and
the default settled state breaks the second half until the user
dismisses a card they didn't open. Fix shape is a product call
(dock the expanded card beside the room, narrow it, or let it
auto-collapse after a beat) — Kevin's pick. Evidence:
`vokrew-settled.png`, `results.json` → `gaps.cardOcclusion` /
`gaps.settledCard`.

### G-2 — MEDIUM — The docked strip overlays 2.49% of the room during runs (Stage 0 deviation, still unruled)

Measured live again this gate, identical number: the strip is
34 px tall, docked inside the stage over the room's bottom edge,
overlap **21,080 px² = 2.49% of the canvas**; the expanded body
overlaps 0 px, as gated. In frame (`vokrew-midrun.png`, and
throughout the video) it reads as a clean HUD bar — "RUN-397E ·
Judge is reviewing · ⚡ 2 calls served" — and its text is truth
(phase + served calls == the bridge record). The cost is a sliver
of the room's bottom edge (the yard line) for the run's duration.
This is the deviation flagged at Stage 0: zero overlap would mean
moving the strip below the stage and giving back the G-2 height
parity. It remains **your ruling to accept or send back**; my
assessment is it earns its pixels, but it is not mine to accept.

### G-3 — MEDIUM — Lane markdown renders literally in the run card

The settled card shows the plan and work as raw text: `**Open your
terminal:**`, ` ```bash ` fences, and all (`vokrew-settled.png`).
The transcript and dossier don't have this problem — they render
short structured fields. The card is the surface a user actually
reads the crew's output in, and most lanes answer in markdown, so
most real runs will show raw syntax there. A plain-text treatment
is honest, but it reads unfinished next to the rest of the room.

### G-4 — LOW — On desktop, the dossier's HISTORY sits below the panel's visible area

The dossier panel at the 813 house frame shows NOW / STATUS /
INSTRUCTIONS / IDENTITY / TODAY; the history rows — the section
that proves "this agent did this run" — need a scroll inside the
panel (probe-verified present and correct: RUN-397E, reviewer,
21,300 ms, verdict APPROVED, same-family label). On the phone the
sheet shows HISTORY within the page scroll (`phone-dossier.png`).
Not wrong, just one scroll away from the headline the panel exists
for. Evidence: `vokrew-dossier.png`, `results.json` →
`video.dossier`.

### G-5 — LOW — The noticeboard overlays the room's top-right while a hold pends

By design — holds live in the office — and it clears the moment
the hold is approved, edited away, or dismissed. While it pends it
covers part of the Skyloft cubicles on desktop and the room's top
strip on phone (`phone-hold-pending.png`). Listed because it is
the third surface (with G-1's card and G-2's strip) that borrows
room pixels; each is defensible alone, together they are a
direction worth a conscious yes.

### G-6 — INFO — Rig note: filming this room on a 2-vCPU VM vs the 120 s lane timeout

Four takes, all on the record (`takes.json`): takes 1–2 lost the
planner stage at exactly 120 s (the bridge's lane timeout) with
llama.cpp sharing both vCPUs with Chromium's renderer + the
screencast; take 3 (planner served at 95 s) lost the *executor* —
with the open-ended canonical call-out ("draft the release
checklist and tag the open issues"), its output cannot generate
inside 120 s on a 1B lane on this box. Take 4 is the shipped
video: same session shape, the deliberately small filmed task (the
Phase 1 precedent), plus one rig-scheduling change — llama-server
pinned to its own vCPU (`taskset`, `-t 1`), Chrome + bridge on the
other. **The page is never hidden during filming** — the Stage 3
evaluator accommodation is not used here — and nothing about the
product, bridge, or crew config changed. Also on the record: the
lane was warmed by one small completion sent *directly* to
llama-server before pairing, so the bridge ledger counts only the
filmed session's own calls; and the phone pass needed no takes
policy (same lane, lighter viewport — its run settled in 29 s).
None of this is product behavior: Hagan's PC ran 3 concurrent
Vokrew runs without a crash, and real lanes answer in seconds. It
is what anyone re-running this gate on small hardware will hit.

## Reference-capture limits (about this evidence, not the product)

floor-oc ran its vendor example data (its real `data.json` is
deliberately not committed) and has no Ollama on this VM, so it
cannot execute a run here; its idle and focus frames are the
reference, as in Phase 1. The Vokrew page produced **zero console
errors in every capture** (desktop video session and phone pass;
classification in `results.json` / `phone-results.json`).

## How this evidence was made (integrity notes)

- Real Chromium under `xvfb-run`; floor-oc against its own
  unmodified server booted from the Four Hands clone source; the
  Vokrew page against the real bridge + llama.cpp rig used by
  Stages 0–3 (isolated VOKREW_HOME, rig crew Scout/Musky/Judge on
  the single `local-gemma` lane). Both pages loaded through the
  established CDP Fetch-interception mechanism (this VM's Chromium
  blocks 127.0.0.1 navigation — LNA); the Vokrew page itself loads
  over file://. No bridge, page, or feature code was changed in
  this stage — the only edits after take 1 were harness-side
  (process cleanup, screencast weight, CPU pinning, the filmed
  task's size), each disclosed above and in the harness header.
- Every interaction in the video is the page's own: pairing typed
  into the page form, the call-out typed into the conductor input,
  Approve clicked on the hold card, the run card closed via its
  own Close button, Judge clicked with a real mouse event at his
  canvas position. On the phone pass, the dossier was opened via
  the engine's `selectAgent` debug hook (the Stage 1 phone
  precedent — canvas tap targeting at 412 px is the flaky path;
  the desktop pass proves the real click).
- The settled and hold stills were framed with the page scrolled
  so the conductor is in view — the framing a user has right after
  typing; the mid-run and dossier stills are unscrolled.

*Gate output ends here. The verdict — ship, or send it back — is
Kevin's. Merge and push happen only on his word (the Phase 1
precedent).*
