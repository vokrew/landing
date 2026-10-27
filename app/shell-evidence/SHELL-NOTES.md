# Empty-Floor Shell — notes (KC, 2026-10-27)

Kevin's order: a visitor should SEE the empty Floor — the shell of
what they will fill — without being forced into the local-bridge
lane on load; setup becomes a clickable tab that expands when
they're ready to fulfill it.

## What changed (presentation only — `app/` only)

- **The forced door is retired.** Stage 3 raised the pairing card
  as a full-screen overlay on every unpaired load. Now an unpaired
  page lands on the Floor itself: `showConnect()` with no message
  collapses the card instead of raising it. The card still expands
  (a) when the visitor clicks the setup tab, or (b) when app.js
  raises it WITH a message the user must act on (invalid pairing,
  bridge died mid-session — same surfacing as before).
- **The shell is labeled.** A banner over the room (visible only in
  `body.shell-mode`, a class app.js derives from "no pairing token
  held"): "This is your floor. It starts empty." — plus the plain
  statement that nothing here is simulated. The **Set up your
  floor →** button in the banner is the setup tab
  (`aria-expanded`/`aria-controls` wired); the card gained a ✕
  close that collapses back to the shell, losing nothing.
- **The pairing flow is untouched.** Same card, same fields, same
  `POST /pair` + 6-digit code, same how-it-works text. Only its
  presentation changed: invited, not forced.
- **Shell chrome honesty.** In shell mode the run form, conductor
  form + hint, and the quest-tracker HUD are hidden — none of them
  could do anything honest without a crew. The health watch is
  token-guarded on every branch, so a silent probe can never force
  the card open over a shell visitor (previously impossible anyway:
  the door was simply always up).
- One string: the roster's empty line now reads "No crew yet."

## What the shell shows — and what stays empty

Shows: the complete room (all zones, every desk, sector map,
viewbar — pan/zoom/view-switch all live; the harness switched to
the Foundry and back), the OFFLINE chip, ambient scene lighting.
Stays empty, by the honesty law: no agents (adapter state verified
0/0/0 — agents/tasks/runs), roster "No crew yet.", quest log
"No runs yet.", budget pill "—" (never a number), status pill
"not connected", rig foot "bridge offline", floor status
"offline". Cubicle lamps sit at the engine's unowned spill (0.12);
status-keyed pools (0.38–1.0) exist only for real seated owners,
exactly as the AAA lighting code has always computed them.

## Verification — `shell-capture.mjs`, 34/34 assertions

- **Desktop shell** (fresh profile, no bridge anywhere): shell
  landing, banner/tab visible, honest empties, hidden forms,
  canvas renders (1166×725, >40 distinct colors sampled), Foundry
  view-switch answers, tab expands + ✕ collapses, zero console
  errors (zero transport noise — an unpaired page makes no bridge
  calls at all).
- **Phone shell** (412×915, S26 emulation): same landing, zero
  horizontal overflow, zero console errors.
- **Paired regression** (real rig — bridge + llama.cpp Gemma 3 1B,
  isolated home, CPU pinning as the AAA pass): bridge UP but page
  unpaired → still the shell. Pair through the EXPANDED tab →
  shell mode exits, banner gone, forms back → rig crew seats →
  conductor call-out → exactly one hold (badge/sidebar/noticeboard
  agree) → approve → run `8b0e09fd-804b-47f8-8f3d-d0040ac86048`
  settles done/APPROVED in 69 s → reviewer on the executor's
  doorstep in 11 state-log entries → verdict row in the transcript
  ("verdict APPROVED · same family review · ⚡ 3 calls" — the
  honesty labels intact) → zero console errors.

## Honest gaps

- The card's ✕ sits at the top of a long scrolling card; a visitor
  deep in the how-it-works text must scroll up to find it. (The old
  door had no close at all, so this is strictly better — a sticky
  close would be the polish step.)
- The shell room is the AAA mood: dim, lamplit, empty. That reads
  as atmosphere in the captures, but it is Kevin's look call, same
  as the veil was.
- Chat/Budget/Crew tabs in shell mode still surface the setup card
  via the existing guarded-call path when clicked (they need the
  bridge; the message says so). The Floor — the shell itself — is
  indefinitely explorable; the data tabs never pretended otherwise.
