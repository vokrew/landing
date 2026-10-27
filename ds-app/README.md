# The Floor — Vokrew's web face

A zero-dependency web page that pairs with a local `vokrew serve` bridge and
turns that bridge's crew into a room. The room is not a mock-up: every agent,
lane, model, verdict, stamp, latency, failover and call count on screen came
from the bridge, or the page says the bridge did not report it.

Open it through **`http://localhost:<port>/`** — the bridge's CORS allows
`localhost` origins, not `127.0.0.1`.

```sh
node web/dev-server.js            # http://localhost:7789/
# or any static server pointed at this directory
```

Paste the bridge URL and the 6-digit code printed by `vokrew serve`. The
token is stored in `localStorage`; nothing is sent anywhere else.

## What is on the page

| Tab | What it shows |
| --- | --- |
| **Floor** | The live room: planner at the foundry desk, executor in the workshop, reviewer in the skyloft. Conduct one instruction and all three work in order; when the reviewer's stage starts, Glass walks out of the skyloft, down the hall, and checks the work at the executor's doorway. The panel on the right shows the real party (name · role · lane · model), the quest log, and the conduct transcript. |
| **Chat** | Chat on the bridge's `chat` surface, with the reviewer on demand. A side rail carries the review switch, the chat ledger and the turn's path; the empty state offers example prompts that only fill the composer. |
| **Run** | One task through the full chain, with the run card inline. A chain rail shows the three seated roles and their live state; suggested tasks only fill the textarea. |
| **Budget** | The live ledger (`GET /budget`), per lane, with caps. Summary cards and a lane table share the same glass-and-amber language as the room. |
| **Crew** | Crew presets (`GET /crews`) and the seats they produce, as role cards with the same avatars and palette as the Floor. |

The header budget pill reads `⚡ CALLS TODAY <used> / <cap>`, summed from the
bridge's own ledger. When no lane has a cap it shows `—` instead of inventing
one.

The room is a hand-drawn canvas stage (1296 × 792): foundry desks and commons,
a hall runner, skyloft lounge, workshop bench, and a yard. Characters are
layered semi-top-down sprites with role props, idle/work/review poses, A* walks
and speech bubbles. The minimap and focus panel are page chrome, not part of
the canvas.

### Visual finish

One night-studio language runs across every tab: deep slate glass, a thin lit
bezel, amber as the action colour, one accent per role, and monospaced
micro-labels. The Floor is the hero; Chat and Run use a main surface plus a
narrow side rail, while Budget and Crew use full-width ledgers and seat cards
built from the same surface, chip and avatar primitives.

- **Legibility first.** Canvas nameplates widen for long names and drop a row
  when two agents share a doorway. The roster, quest log and run card carry the
  same reported name, lane and model.
- **Motion with intent.** Tabs fade in, cards rise in sequence, chat turns
  enter from below, buttons lift a pixel, and the crew's walks and review poses
  are unchanged. `prefers-reduced-motion` turns all of it off.
- **Markdown, not punctuation.** Model output in the run card, conduct
  transcript and chat replies is parsed into headings, lists, quotes, code and
  emphasis by a DOM-only renderer. Every model string becomes a text node, so
  raw HTML is escaped rather than injected. `**Plan:**` reads as a heading.
- **Phone width.** At 390 px the topbar stacks, page heads become vertical,
  side rails move below the main surface, and the Run split becomes a block so
  the form and chain print/scroll cleanly. The room stays an overview; the
  Party rail carries the readable names and states.

## The run contract this bridge actually has

`vokrew serve` keeps an **in-memory run registry** and every JSON response is
enveloped:

```jsonc
// success
{ "ok": true, /* payload */ }
// failure
{ "ok": false, "error": "..." }
```

| Call | Response |
| --- | --- |
| `POST /run` | `202 { ok: true, runId: "<uuid>" }` |
| `POST /run?wait=1` | synchronous `200` with the pre-registry flat fields (`verdict`, `plan`/`work`/`review`, `crossFamily`, stamps) |
| `GET /runs/:id` | `200 { ok: true, run: <record> }`; unknown id → `404 { ok: false, error: "no such run: …" }` |
| `GET /runs?limit=N` | `{ ok: true, runs: [<summary>] }`, newest first |

A run record carries `id`, `state` (`"running"` \| `"done"` \| `"failed"`),
`phase` (`"planner"` \| `"executor"` \| `"reviewer"` \| `null`), `verdict`,
`crossFamily`, `stamps[]`, and `plan` / `work` / `review` / `stampLines`.
The registry is in memory, so a bridge restart forgets every run.

The adapter uses that record as the authority while following a run:

1. `POST /run` → on `202`, store the bridge `runId` on the journal entry
   immediately (before settle), then poll `GET /runs/:id`.
2. Advance the room one stage per reported phase or stamp — `source:
   "run-record"` — and stop budget-polling from guessing ahead once a record
   is being followed.
3. On settle, build the record from `body.run`; the quest log, run card and
   character bubbles all read the same stamps.

For an **older synchronous bridge** (no registry, `POST /run` returns `200`),
the adapter falls back to the page-side phase tracker: read the served-call
total from `GET /budget` before the run, poll while `/run` is in flight, and
advance one stage per **served** call. Failed and capped attempts never
increment the ledger, so they never advance the room.

## Reattach, and what “lost” means

The journal keeps the page-local `id` plus the bridge `runId`. After a reload,
each pending entry is rechecked with `GET /runs/:id`:

- **record found** → adopt it, resume phase tracking from the record, mark the
  entry `reattached: true`. Nothing is marked lost.
- **404 / `ok:false`** → the registry no longer has it: `run lost — page
  reloaded mid-run` (`RUN_LOST_RELOAD`). A live follow that loses its record
  while the bridge is still reachable reports `RUN_LOST`; a bridge with no
  registry at all reports `RUN_LOST_NO_STATE`.
- **network drop** → `run lost — bridge unreachable` or `run lost — bridge
  restarted`, depending on whether `/health` comes back.

A reattached run keeps the same `runId`, its phase resumes, and its verdict and
stamps are asserted equal to `GET /runs/:id` — the page never fabricates a
resume.

## Honesty rules (enforced in code)

- **No bridge changes.** All bridge-JSON → room-state translation lives in
  `adapter.js`. If the bridge does not report a name, lane, model, latency,
  verdict or count, the page says so (`no stamp yet`, `Unnamed planner`,
  `not reported`).
- **Same-family is said out loud.** `crossFamily:false` renders “same family”
  in the completion line and in the run card; it never claims “cross-family”.
- **Unpaired / unreachable** is a dark, empty room with `ROOM LOCKED · OFFLINE`
  and a connect action — never a demo crew.
- **Lost runs stay lost.** A bridge restart or a run evicted from the registry
  marks the journal entry `run lost — …`; only a 404 is treated as gone.
- **Failovers name the lane that served.** `dead-lane failed → served on
  pc-lfm` appears in the character's bubble, the run card and the stamp line.
- **A crew switch clears the previous crew's transcript, room banner and
  bubbles**, so old stamps are never left under new nameplates (the quest log
  keeps the run, labelled with the crew that actually ran it).

## Architecture

```
web/
  adapter.js    bridge client, envelope + registry contract, pure translation
  floor.js      canvas room: grid, A* paths, seats, walks, props, bubbles
  app.js        page wiring: pairing, tabs, conduct, journal, reattach, cards,
                DOM-only markdown renderer
  index.html    shell
  styles.css    night-studio visual system, layout, responsive rules
  dev-server.js zero-dependency static server (port 7789)
  test/
    adapter.test.mjs       unit + geometry tests
    contract.test.mjs      real-bridge (202/registry) integration tests
    browser.test.mjs       12-stage end-to-end browser test
    test-bridge.mjs        spawns a real createBridge with its own home
    production-smoke.mjs   read-only smoke + phone evidence vs. the live bridge
    cdp.mjs                minimal Chromium DevTools driver
    evidence/              generated PNG evidence (git-ignored)
```

## Tests

```sh
node --test web/test/adapter.test.mjs     # 22 unit/geometry tests
node --test web/test/contract.test.mjs    # 4 real-bridge contract tests
node --test test/run-registry.test.js     # registry 202/GET semantics
node --test web/test/browser.test.mjs     # 12-stage real-browser test
node web/test/production-smoke.mjs        # read-only smoke vs. the live bridge
```

`contract.test.mjs` spawns a real bridge and asserts the wire contract directly:
live submit → `202` → follow the `runId` to settle and match `GET /runs/:id`;
a fresh client adopts the same run after a reload; only a `404` is “lost”; and
`GET /runs` lists the run it was asked about.

The browser test needs real local lanes (`pc-lfm`, `pc-gemma`) at
`http://127.0.0.1:8080/v1` (llama-swap). It starts a real bridge with
`createBridge` on a temp home and its own ledger, pairs through the UI, runs a
real chain, and asserts state (not pixels):

1. unpaired → locked overlay, OFFLINE, zero seated characters;
2. pair through the modal → lands on the Floor, three named agents on the
   reported seats;
3. a live conduct run: planner and executor visibly work; at the reviewer
   stage the reviewer's grid cell **equals** the executor's doorstep
   `{x:12,y:4}` and its walk crosses the row-5 detour;
4. budget pill increases by exactly the served stages (+3), while the failed
   lane stays at 0;
5. three stamped conduct parts with reported latencies and a verdict;
6. the run card: task, Plan/Work/Review, full stamp lines, `dead-lane failed
   → served on pc-lfm`; model markdown renders as formatted DOM and raw HTML
   is escaped;
7. the failover bubble names the serving lane;
8. clicking a character opens the focus panel with stage, lane, model, calls
   today and stamps;
9. switching to the `relief` crew re-seats Moss/Anvil/Quill and clears the old
   transcript and room banner;
10. reload mid-run → the same `runId` is adopted from `GET /runs/:id`, phase
    tracking resumes, the record lands `done` with `reattached: true`, and its
    verdict/stamps equal the wire record (nothing is marked lost);
11. the bridge restarts mid-run → the run card says `run lost — bridge
    restarted`, never a fake resume;
12. zero console errors / uncaught exceptions.

Evidence PNGs (`web/test/evidence/`, git-ignored, regenerated by the tests):

| File | Shows |
| --- | --- |
| `01-locked-offline.png` | unpaired room: locked, empty, OFFLINE |
| `02-paired-crew-seated.png` | default crew seated, budget 0 / — |
| `03-reviewer-at-executor-doorway.png` | reviewer walking, 2/3 served, live quest row |
| `04-run-card.png` | run card with all three parts and full stamps |
| `05-focus-panel.png` | Rivet's focus panel: lane, model, calls today, stamp |
| `06-crew-relief.png` | relief crew seated, previous transcript cleared |
| `07-reattached-after-reload.png` | adopted run after reload: same runId, verdict, stamps |
| `08-live-production-bridge.png` | the real bridge on :7717, example crew, ledger 9 / — |
| `09-nameless-crew-honesty.png` | a crew with no names says “Unnamed …” |
| `10-bridge-restart-lost.png` | lost card after the bridge was restarted mid-run |
| `11-phone-floor.png` | 390 px layout: floor, party and quest log |
| `12-phone-run.png` | 390 px layout: task form and chain rail |
| `13-phone-chat.png` | 390 px layout: chat empty state, review and surface rails |
| `14-phone-budget.png` | 390 px layout: summary cards and lane ledger |
| `15-phone-crew.png` | 390 px layout: crew seat cards |
| `16-desk-run.png` | desktop Run: task form and chain rail |
| `17-desk-chat.png` | desktop Chat: empty state and review/surface rails |
| `18-desk-budget.png` | desktop Budget: summary cards and lane ledger |
| `19-desk-crew.png` | desktop Crew: seat cards with the active crew |

The browser suite takes roughly 3–6 minutes depending on the local lanes, and
uses ports 7790 (page) and 7791 (bridge). Screenshots are printed, not
`Page.captureScreenshot`: this desktop session exports `GDK_SCALE=2`, which
double-exposes CDP raster captures. The driver deletes the GDK scale variables
and renders through `Page.printToPDF` → `pdftoppm`, with animations finished
and the page scrolled to the top first because Chromium restarts CSS animations
from `t=0` in the print layout and prints sticky headers at a scrolled offset.
The phone evidence is captured at a true 390 px layout via CDP device metrics
(Chromium enforces a 500 px minimum window width), with a 1200 px paper for
most tabs and 1600 px for the taller Run page.

`production-smoke.mjs` is read-only: it pairs with the real bridge on
`127.0.0.1:7717`, checks the budget pill against the ledger and the nameless
crew rendering, never runs a model, and writes the desktop console and 390 px
phone evidence.

## Judgment calls

- **Run history is the page's journal.** The bridge's registry is in memory and
  its summaries are not a durable audit trail, so the quest log keeps the
  browser's record of bridge responses (`localStorage`, 40 entries), labelled
  as such.
- **Phases come from the bridge, not guesses.** While a run record exists, its
  `phase` and `stamps` drive the room. Only a synchronous-200 bridge falls back
  to served-call counting; either way the room never invents a stage the wire
  did not report.
- **A nameless crew stays nameless.** The production `default` crew has empty
  role definitions; the room shows `Unnamed planner` rather than “Nova”.
- **Raw model text is shown verbatim.** Tiny local planners sometimes echo
  the prompt or add ` thinking`; the card shows what the bridge returned
  instead of cleaning it up.
- **Modal part text is capped at 250 px with an inner scroll** so one verbose
  plan cannot push the stamps off the card. The full text is in the record.
