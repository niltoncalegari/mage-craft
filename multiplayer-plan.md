> # ⚠️ DOCUMENTO HISTÓRICO — NÃO EDITAR
>
> Planejou o online do produto **anterior** (brawl de controle direto, salas NxN,
> input a ~60 Hz). O transporte, o lobby e a sim autoritativa que ele descreve
> **continuam válidos e em uso** — o que caducou é o modelo de jogo em cima deles.
>
> Documento vigente: **`GDD.md`**. Em particular, a §13 dele mapeia o que deste
> plano sobrevive (tudo, menos `InputMsg`).

# Mage Craft — Online Multiplayer Plan (server-authoritative, NxN team rooms)

> An architecture + effort estimate for making Mage Craft playable **online**,
> while keeping the existing **single-player vs AI** mode. This is a planning
> document — no implementation is described here. Effort is sized in relative
> complexity (S / M / L / XL), not time.
>
> **Status note (v2):** this plan has been revised to match the decisions in
> the active implementation plan
> (`.cursor/plans/servidor_go_de_salas_por_time_cd40255d.plan.md`) and
> `GDD.md` §7/§10/§14. Two things changed since v1 of this document:
> 1. **Game mode** — the target is no longer "1v1 only": rooms support
>    **team sizes from 1x1 up to 6x6**, with a pre-match lobby where each
>    mage picks **one element** from the full 7-element catalog, unique per
>    team. 1v1 is just the `teamSize = 1` case.
> 2. **Server stack** — the authoritative server is being built as an
>    **independent Go module** (`server/`) that **reimplements** the
>    simulation, not a Node.js server sharing TypeScript code with the
>    client. Section "The big enabler" below (100%-Three-free, headless-on-
>    Node sim) is kept for historical/conceptual context but **no longer
>    describes the actual implementation path** — see "Stack pivot: Go" below.
>
> This document remains the **conceptual reference** for netcode model
> (server-authoritative snapshots), POV-relative colors, and the client-side
> integration work that still lies ahead; it is **not** the server
> implementation plan (that lives in the Go-specific plan file above).

## Goal & decisions
- Keep **Single Player vs AI** exactly as today (client-only, unchanged sim).
- Add **online play** organized as **team rooms**, size **1x1 to 6x6**
  (configurable at room creation) — not a hardcoded 1v1 duel.
- Pre-match **lobby**: players join a room, pick a team, then pick **1
  element** from the 7-element catalog (`fire, ice, lightning, poison, stone,
  arcane, wind`); the server enforces **no duplicate element within the same
  team** (opposing teams may repeat freely). Host can fill empty slots with
  **bots** that auto-pick a free element in their team.
- **Server component + WebSocket** for communication, now implemented in
  **Go** (see stack pivot below), not Node.
- **POV-relative colors:** each player always sees *themselves*/their team as
  **blue** (allied) and opposing team(s) as **red** (enemy). Team→color is a
  client-side presentation mapping, not a simulation fact — this holds
  regardless of team size.

## Stack pivot: Go server instead of shared-TS Node server
The original version of this plan assumed a **Node.js** server that directly
reused the client's TypeScript simulation (`core/`, `game/`, `systems/`,
`physics/`, `ecs/`, `utils/`) via an npm-workspaces monorepo (`client` /
`server` / `shared`). That assumption is **no longer the plan**.

- The authoritative server is now an **independent Go module** (`server/`,
  package `mage-craft/server`), using `github.com/gorilla/websocket`.
- It **reimplements** the simulation surface from scratch in Go — there is no
  direct code reuse between TypeScript and Go. What *is* reused is the
  **design intent and numeric baseline**: `internal/game/elements.go` and
  `config.go` port the shape of `ProjectileDef`/`SNOWBALL`/`THROW`/`DAMAGE`/
  `PLAYER`/`RESPAWN` from `src/game/config.ts` as a starting point for tuning,
  and the bot AI in `internal/bot` ports the *spirit* of the utility-scoring
  in `src/systems/AISystem.ts` (attack nearest in range, retreat on low HP,
  advance/chase, wander) as new Go code, not a transliteration.
- **Why the pivot:** avoids taking on a shared TS/Node monorepo build
  (workstream A in v1 of this plan) and its toolchain risk, and lets the
  server be developed test-first in Go with its own idiomatic concurrency
  model (goroutine-per-room loop, mutex-protected room map) instead of
  retrofitting ownership semantics into code written for a single local
  player. The trade-off is that the Go sim and the TS client sim are two
  separate implementations that must be kept in numeric/behavioral parity by
  hand (see Risks).
- **What this means for "The big enabler" section below:** the fact that the
  TS sim is 100% Three-free and could theoretically run headless on Node is
  still true and still valuable for **local dev/testing parity checks**, but
  it is **not** the path being taken for the production authoritative
  server. Kept below for context only.

## The big enabler (historical context, not the current server path)
The client simulation is **100% Three.js-free** — zero `three` imports in
`core/`, `game/`, `systems/`, `physics/`, `ecs/`, `utils/` (only `render/` and
`ui/` touch Three/Preact). The loop is a **deterministic fixed-timestep** sim
(`core/GameLoop.ts`) with a **seeded PRNG** (`utils/Random.ts`, mulberry32) and
server-allocatable ids (`ecs/Entity.ts` `IdAllocator`). Renderers already observe
**plain data** and interpolate. This is why a Node-hosted shared-sim approach
was originally attractive — but per the stack pivot above, the actual
authoritative server reimplements the sim in Go instead.

## Recommended netcode model: server-authoritative snapshots
- **Server (Go, per-room goroutine)** runs the authoritative `World.Step` +
  bot AI at **60 Hz** per room; owns RNG, ids, lives/round state. Receives
  **input commands** from each connected client, applies them to that
  client's mage, and broadcasts **world snapshots** (~20–30 Hz) to every
  client in the room (all teams, any size 1x1–6x6).
- **Client** has two modes:
  - *Single Player:* runs the TS sim locally, unchanged, vs local AI.
  - *Online:* does **not** run sim systems; sends local input commands; applies
    incoming snapshots into a render-only `World` and interpolates between
    them. (This client-side integration with the Go protocol is a **future
    phase**, not yet started — see Workstreams.)
- **Alternative considered — deterministic lockstep** (send only inputs, all
  peers simulate): rejected for the same reasons as v1 of this plan
  (cross-platform floating-point determinism hazards, input-delay/rollback
  complexity) — reinforced by the fact that simulation now lives in Go on
  the server, and clients only render, so lockstep is not needed. **Chosen:
  server-authoritative, unchanged.**

## Room / lobby & team selection (new in v2, drives netcode shape)
This is the part of the plan most changed from v1, because the product
target moved from "1v1 duel" to "NxN team room" (GDD §7 "Sala pré-jogo e
times", §10.2). It directly affects protocol and server state:

- **Room state machine:** `Lobby → Starting → InProgress → Ended`. In
  `Lobby`, players join/leave, pick team, pick element, add/remove bots.
  `start_match` is only valid once every slot (human or bot) across all
  teams is filled and has a valid element.
- **Capacity:** a room's capacity is `2 × teamSize` (`teamSize` 1–6, chosen
  at room creation) — this generalizes what used to be a hardcoded 2-player
  room.
- **Element uniqueness is per-team, not per-room:** the server validates
  `CanSelectElement(team, element)`; opposing teams may pick the same
  element independently. This has no equivalent in v1 of this plan (which
  only had two players total, so the concept of "team-scoped" uniqueness
  didn't exist).
- **Bots fill empty slots** on request, auto-selecting a free element in
  their team — bots are participants in the *room protocol*, not just an
  offline-mode concept.
- Disconnect during lobby frees the slot + element back up; disconnect
  during `InProgress` still needs a policy decision (forfeit vs. short
  bot-takeover window — carried over as an open item from v1, now scoped
  per-team rather than per-player).
- Wire protocol is Go-native JSON messages (see the Go plan's §4), not the
  TS-oriented message shapes sketched in v1 of this document.

## POV-relative colors (explicit requirement, unchanged by team-size)
- The sim identifies units by a stable **team id** (0..N teams, in practice
  0/1 for now) + **ownership** (which connection, or which bot). Colors are
  **not** decided by the sim/server.
- Each client is told which team it belongs to; renderers map **my team →
  blue (allied)**, **other team(s) → red (enemy)**, regardless of whether the
  room is 1x1 or 6x6. Centralized today in `TEAM_COLORS` and read in a few
  renderers/HUD — this remains contained client-side work (workstream F).

## Workstreams & effort

### A. Go server module scaffolding — M
- `server/` Go module, `internal/ws` (upgrade, hub, per-connection
  read/write), `internal/protocol` (JSON message (de)serialization),
  `cmd/mageserver/main.go`. Replaces v1's "shared-code / build restructure"
  workstream — there is no client/server code-sharing step anymore, so this
  is simpler (no monorepo, no cross-target TS build) but still net-new
  infra.

### B. Room / lobby (`internal/room`) — L
- `RoomManager` (create room by `teamSize`, generate `roomId`, in-memory
  map + mutex); `Room` state machine (`Lobby/Starting/InProgress/Ended`);
  slot/team/element assignment; `CanSelectElement` uniqueness rule;
  `AddBot`/`RemoveBot`. This is new scope that didn't exist in v1 (which had
  no lobby beyond "matchmake 2 players").

### C. Go simulation core (`internal/game`) — L
- `elements.go` (7-element `ElementDef` table), `config.go` (60 Hz tick,
  radii, HP, charge/windup/recovery/cooldown, respawn immunity — ported
  numerically from `src/game/config.ts` as a starting baseline, **not**
  shared code), `entities.go`/`simulation.go` (`Mage`, `Projectile`,
  `Puddle`, `World.Step`: movement, charge/release, projectile flight,
  circle-circle collision, damage/knockback/slow/interrupt, puddle tick,
  lives/respawn, round end). Replaces v1's workstream C ("team/ownership
  refactor of existing TS systems") — since this is a **fresh Go
  implementation** rather than a refactor of tested TS code, the "must keep
  120 tests green while refactoring" risk from v1 doesn't apply here, but a
  **new** risk appears: keeping this Go sim in behavioral/numeric parity
  with the TS client sim (see Risks).
- **v1 scope note:** arena is an **open rectangle, no obstacles/cover/LoS**
  in this Go sim — GDD §9's obstacle/cover system is not ported yet. This is
  an explicit, tracked simplification, not an oversight.

### D. Bot AI in Go (`internal/bot`) — M
- Utility-scoring decision loop (~4 Hz) per bot: attack nearest in range,
  retreat on low HP, advance/chase, wander — same spirit as
  `src/systems/AISystem.ts`'s `scoreActions`, reimplemented as new Go code
  (no cover/LoS terms, matching C's v1 scope cut). Difficulty
  easy/normal/hard reuses the same multiplier philosophy as `AI_TUNING`.
  This did not exist as a discrete workstream in v1 (bots were purely a
  client-side/offline concept there); now bots are first-class room
  participants driven server-side.

### E. Client networking layer — L (not yet started)
- `NetworkClient` (WebSocket, speaking the Go server's protocol) + a
  **snapshot-fed render world** with an interpolation buffer (adapt the
  renderer's `alpha` interpolation to interpolate between snapshots, ~100 ms
  delay to smooth jitter). Send local input; render N teammates + M
  opponents generically, not just "me vs one opponent."
- **Phase 2 (separate, +L):** client-side **prediction + reconciliation**
  for the local mage, lag-compensated hit checks. v1 can ship
  interpolation-only.
- Unchanged in spirit from v1's workstream D, but the protocol it speaks is
  now the Go server's, and the UI must handle **teams of arbitrary size**,
  not a fixed 2-player layout.

### F. POV-relative rendering — S–M
- Thread "my team id" to `PlayerRenderer`, HUD, Nav/Aim indicators, and the
  result screen so colors/labels stay relative to the local player,
  generalized to **N players per team** instead of exactly one opponent.
  Same scope/size as v1's workstream E.

### G. Mode switch + lobby UI (client) — M/L
- Menu: **Single Player** vs **Play Online**. Online flow now needs
  **room creation (pick team size) → team/element pre-game lobby UI
  (mirrors the server's `room_state` broadcasts) → add bots → ready/start →
  in-game → disconnect/result → rematch**, not just "waiting for opponent."
  This is larger than v1's workstream F because the lobby is a first-class,
  team/element-aware screen instead of a simple matchmaking spinner.

### H. Match lifecycle & edge cases — M
- No live pause online (pause = SP-only); disconnect handling generalized to
  **N-player teams** (a team isn't necessarily eliminated by one
  disconnect, unlike the old 1v1 case where a disconnect = auto-loss);
  authoritative round end (team wiped = loses); server-side result.
  (Global leaderboard/matchmaking-by-rating remains **future**, unchanged
  from v1.)

### I. Testing & validation — M
- **Go-side (new, TDD):** unit tests per package (`room`: element
  uniqueness, bot fill, state transitions; `game`: `World.Step` smoke test,
  e.g. a `fire` projectile hits and applies damage; `bot`: decision scoring).
  Seams are fixed before writing each slice (`Room.SelectElement`,
  `Room.AddBot`, `World.Step`, protocol handlers) per the active plan's TDD
  approach.
- **Client-side (carried over from v1):** keep the 120 existing TS tests
  green — no ownership refactor risk anymore since the client sim is
  untouched by this pivot, but tests should still cover the future
  networking layer (E) once it's built: serialization, snapshot
  interpolation, and a **client-vs-Go-server integration test** once E
  exists (harness TBD; not a headless-Node-vs-Node test anymore).

## Suggested phased roadmap (critical path, revised)
1. **Phase 0 — Go server foundations (in progress):** A (Go scaffolding) +
   B (room/lobby state machine + team/element selection) + C (`World.Step`
   core sim, no obstacles) + D (bot AI in Go) + I (Go unit tests, TDD). This
   is the scope of the active plan
   (`.cursor/plans/servidor_go_de_salas_por_time_cd40255d.plan.md`).
   Nothing client-visible yet; de-risks the server/lobby/sim/bots first,
   independent of any client integration.
2. **Phase 1 — Client integration (not started):** E (client net + snapshot
   interp, speaking the Go protocol) + F (POV colors, N-per-team) + G
   (online lobby UI: room creation, team/element selection screen, bots) +
   H (basic lifecycle) + I (client integration tests). Ship: a real online
   room (1x1 first, then larger teams), smooth opponents, local input has
   RTT latency.
3. **Phase 2 — Feel & robustness:** client prediction + reconciliation, lag
   compensation, reconnection / mid-round bot-takeover for disconnects,
   disconnect UX polish — same as v1, now generalized to N-player teams.
4. **Phase 3 — Ops/future (optional):** obstacles/cover/LoS in the Go sim
   (parity with GDD §9, currently cut from v1 scope); server
   hosting/containerization & room scaling; server-side global
   leaderboard/accounts/rating-based matchmaking; spectators.

## Overall sizing
Still a large, multi-phase project, but the shape of the cost shifted with
the Go pivot: **Phase 0 (Go server: room/lobby/sim/bots) is now a
self-contained, testable slice with no client dependency**, which is a
smaller-risk starting point than v1's "ownership refactor of live TS
systems without breaking 120 tests." The dominant remaining costs are the
**Go simulation itself (C)**, the **room/lobby protocol (B)**, and — once
Phase 0 lands — the **client networking/interpolation layer (E)**, which is
now unstarted work rather than an adaptation of existing renderer code.

## Risks & mitigations
- **Two simulations, one game feel** → the Go server sim and the TS client
  (offline/AI) sim are now independent implementations of "the same" combat
  math. Mitigation: treat `src/game/config.ts` numeric baselines as the
  source of truth ported into `internal/game/config.go`/`elements.go`, and
  add cross-checked test fixtures (same inputs → same qualitative outcome)
  as both sides evolve, rather than assuming parity by construction.
- **Obstacles/cover/LoS gap** → the Go sim v1 has no obstacles (open
  rectangle arena), while GDD §9 and the client's existing cover/LoS system
  assume them. Mitigation: explicitly tracked as Phase 3/future scope, not
  silently dropped — revisit before online play is positioned as a full
  parity replacement for the SP experience.
- **Team-size scaling (1x1 → 6x6)** → snapshot size, room UI, and
  disconnect/round-end logic all need to generalize past "exactly 2
  players." Mitigation: design room/protocol data structures (slot lists,
  per-team arrays) for arbitrary `teamSize` from the start (already the
  approach in the active Go plan) instead of hardcoding 2.
- **Latency feel** → ship interpolation-only first (Phase 1); add
  prediction in Phase 2. Unchanged from v1.
- **Determinism** → still sidestepped by server-authoritative Go sim (no
  lockstep). Unchanged from v1.
- **Toolchain** → simplified vs. v1: no shared TS/Node monorepo build to
  validate; Go + `gorilla/websocket` is a smaller, more conventional stack
  risk. New toolchain item: keeping `server/`'s `go.mod` and CI (if any)
  separate from the client's npm/Vite tooling.
- **Bandwidth** → world is still small per room, but now scales with
  `teamSize` (up to 12 mages + projectiles + puddles at 6x6); full snapshots
  at 20–30 Hz should remain cheap at this scale, but should be re-checked at
  6x6 before assuming it's "free" the way a 2-player room was in v1.

## Out of scope / future
Client integration with the Go protocol (Phase 1, not started), obstacles/
cover/LoS in the Go simulation (v1 arena has none), persistence/accounts and
matchmaking by rating (room joining stays manual: room code + team/element
pick), global/online leaderboard, >6x6 team sizes, spectators, anti-cheat
hardening, and production hosting/scaling.
