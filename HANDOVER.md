# Handover — 2026-08-03 (Claude — online↔practice parity: menus/audio/results, real map in both sims, aim fix, full AI port) — READ THIS FIRST

## Why this session happened
Continuation of the session below. User's request: "use a copy of what's in practice mode for the other modes when we create the room, with and without bots" — and when asked to scope it, chose **everything**: render pipeline (done previously), pre-match config flow, audio, menus/screens, and explicitly "principalmente jogabilidade e também IA." Mid-session they play-tested and reported three concrete defects, all reproduced and fixed: aim locking to screen centre, "where the hell is the map?", and "holding to shoot won't let me move + the AI is dumb compared to practice mode."

## What changed this session

### 1. Client: online matches now have the same audio, pause menu, and victory/defeat screen as practice mode (done, verified via `npm run typecheck && npm run lint && npm test && npm run build`)
- **`src/net/SnapshotSync.ts`**: now takes an `EventBus` (3rd constructor arg) and emits the same `GameEvents` the offline systems emit (`PlayerHit`, `PlayerDefeated`, `SnowballThrown`, `SnowballImpact`), inferred from snapshot deltas (health drop, alive→dead transition, projectile appear/disappear) since the wire protocol has no discrete event messages. Also gained `isMyTeam(wireTeam): boolean` so callers can turn a wire-team-number winner into a POV win/loss. This is what makes `AudioManager` — completely unmodified — work against online matches.
- **`src/ui/Menus.tsx`**: three small additive changes so the same class serves online matches, offline call site (`src/main.ts`) unaffected:
  - New 4th constructor arg `startVisible = true` — pass `false` to skip the "Start Duel" main screen (online matches are already in progress when this view mounts).
  - New optional `MenuActions.restartLabel` / `playAgainLabel` — override the pause screen's "Restart" and result screen's "Play Again" button text (online uses "Leave Match" / "Back to Lobby"; the underlying handler is the same `restart()` callback in both cases, same as offline).
  - New optional `RunResult.showScore` (default `true`) — hides the score/time/lives lines on the result screen for matches with no scoring concept (online).
- **`src/net/OnlineMatch.ts`**: now constructs `AudioManager` (unlocked on first pointerdown, muted state read from `Settings`, same as `src/main.ts`) and `Menus` (`startVisible: false`) exactly like `bootOfflineMatch` does. Escape/P toggles a local pause (blocks outgoing input + shows the pause overlay; does **not** pause the authoritative server sim — there's no such thing in a live multiplayer match). New `showRoundResult(winnerTeam: number)` public method — shows the victory/defeat screen; called by `App.tsx` when `round_end` arrives. Constructor opts gained `onLeaveMatch(reason: 'quit' | 'roundEnd'): void`, invoked by both the pause screen's "Leave Match" and the result screen's "Back to Lobby" (same underlying click path in `Menus`, differentiated by `this.roundEnded`).
- **`src/app/App.tsx`**: `onRoundEnd` no longer immediately disposes the match and jumps to the lobby — it calls `onlineMatchRef.current?.showRoundResult(msg.winnerTeam)` and waits for the player to dismiss it. This mattered because the Go server sends `room_state` (rematch lobby) **immediately** after `round_end` on the same call (`broadcast.go`'s `broadcastRoundEnd`) — the existing `onRoomState` handler used to see that and yank the match view away before the result screen could ever show. Fixed with a `metaRef.current.awaitingResultDismiss` guard: `onRoomState` skips its auto-navigate-to-lobby while a result screen is pending; the new `onLeaveMatch` callback (passed into `OnlineMatch`) does the actual `setScreen`/dispose once the player clicks through — `'roundEnd'` → `'lobby'` (room's already in rematch lobby state by then), `'quit'` (mid-match Leave Match) → `'rooms'` + refresh.
- Known deliberate scope cut: mid-match "Leave Match" has no real forfeit — there's no `leave`/`forfeit` message in the wire protocol (`src/net/protocol.ts`'s `ClientMsg`), and adding one means touching `server/internal/{room,match,protocol}`, explicitly Cursor's zone. Today it just stops rendering/sending input locally (bridge stays connected); the bot/opponent keeps fighting a stationary ghost until the round ends normally. Flagged, not fixed.
- Not done (lower priority, didn't block "principalmente jogabilidade e IA"): `DebugOverlay` and the FPS toggle UI aren't wired into online (FPS pill reads `Settings.showFps` but there's no in-match way to flip it, matching how offline's own pause screen also has no options tab — only the main menu does).

### 2. Aim was broken: the client sent a direction where the server wanted a point (fixed, verified live)
User reported "when I hold click to aim, it corresponds to something in the center of the screen, not the real mouse position." Real bug, and an exact-cause one: `MageInput.Aim` is a **world-space point** — `game/world.go` does `input.Aim.Sub(m.Position)` to derive the throw direction (the Go bot AI always passed `target.Position`, a point). `OnlineMatch.onPointer` was normalizing the cursor into a **unit direction vector** before sending it, so the server computed `unitVector - myPosition` and every shot aimed at roughly the world origin — the middle of the map. Fixed by sending the raw ground-plane raycast hit (`{ x: point.x, y: point.z }`). Verified live by patching `WebSocket.send` in a real match: aim values now span the arena (±17, ±11 on a 40×30 map) and track the cursor, instead of being length-1.

### 3. The real map is now in both simulations (user asked for the full port, not client-only decoration)
Online was a hardcoded bare `24×16` rectangle with zero obstacles (the documented v1 scope cut) while practice mode loads decorated `40×30`+ maps. User picked the full port over the cheap options, so both sides now play the same map:
- **New `server/internal/game/arena.go`**: an `Arena` (width/height/obstacles/spawns) parsed from the client's own map JSON schema, with the per-type footprints and blocking flags ported from `src/game/Obstacle.ts` (`TEMPLATES`) and heights from `config.ts`'s `OBSTACLE_HEIGHT`. Provides `Clamp`/`Contains`/`OutOfBounds`, `BlocksMovementAt`, `BlocksProjectileAt` (height-aware: shots arcing above an obstacle fly over it, mirroring `CollisionSystem.ts`), `HasLineOfSight` (sampled, mirrors `physics/LineOfSight.ts`) and `SpawnFor`.
- **Where the map lives**: Go's `go:embed` cannot reach outside its package directory, so the server has its own copy at `server/internal/game/maps/arena1.json`. `TestEmbeddedMapMatchesClientCopy` reads `../../../public/maps/arena1.json` and fails if the two ever drift — that guard is the whole reason the duplication is safe. **If you change the map, copy it to both places.**
- **`world.go`**: `World` gained an `Arena`; `NewWorld()` keeps its signature (loads the default map) so `internal/room` needed no change, and `NewWorldWithArena` exists for tests wanting a bare rectangle. Movement resolves against obstacles with axis-separated **sliding** (walking diagonally into a wall slides along it instead of sticking), projectiles are destroyed by blockers, spawns come from the map, and knockback respects obstacles too.
- **`src/net/OnlineMatch.ts`** fetches the same `public/maps/arena1.json` (cached module-level promise, exported as `loadOnlineMapData()`) and builds its `World`/`ArenaRenderer` from it via the existing `MapLoader`, sharing one `IdAllocator` exactly like `Game.init`. `App.tsx` awaits that before constructing the match.

### 4. Charging no longer roots you — and the bot AI is a real port of `AISystem.ts`, not a simplification
User: "when I hold to shoot it doesn't let me move, [unlike] the original" and "the AI is pretty dumb compared to practice mode." Both confirmed against the offline code and fixed:
- **Movement while charging/recovering**: offline gates movement on `canAcceptOrders` only, which is `alive && !(Hit || Frozen || Defeated)` — `PreparingThrow` and `Recovering` do **not** stop you. The Go sim had `if !m.Charging && m.State != MageRecovering` plus an early `return` during recovery, rooting you on both. Removed; only stun/freeze/death stop a mage now. Covered by `TestWorld_MageCanMoveWhileCharging` / `...WhileRecovering`.
- **Movement feel**: ported `PLAYER.acceleration` (40), `PLAYER.turnSpeed` (12 rad/s), `AIM.turnSpeed` (15) + `AIM.deadzoneRadius`, and mage-vs-mage separation at `PLAYER.spacing` (1.4). Mages now accelerate and turn instead of snapping, and aim rotates toward the cursor over time. New `Mage.Velocity` backs this (and feeds the AI's aim leading).
- **`server/internal/bot/ai.go` rewritten as a port of `AISystem.ts`**: the same five-action utility model (`retreat`/`takeCover`/`attack`/`advance`/`wander`) with the **same scoring weights and tie-break precedence**, the same easy/normal/hard `AI_TUNING` (aim error scale, decision-interval scale, throw willingness, dodge reliability, `seeksCover:false` for easy), reactive dodging held for `DODGE_DURATION`, cover seeking + peek spots (now possible because the arena has obstacles), squad focus-fire target selection (hurt/exposed/close weighting), aim leading via `AIM_LEAD_TIME` and target velocity, distance-scaled aim error, ally separation, and `ADVANCE_STOP_DISTANCE` so bots fight at range instead of walking into your face.
- **API change this forced**: the AI now needs per-bot state across ticks (decision timers, dodge timers), so the stateless `bot.Step(w, bots, rng)` became `bot.NewBrain(rng)` + `brain.Step(w, bots, dt)`. `match/session.go` owns a `Brain` created fresh per match. All map iteration that can pick a "best" candidate now goes through sorted-id helpers, because Go randomizes map order and an authoritative sim must be deterministic.
- Verified live: a hard bot now repositions to cover, holds range, and took the player 100→20 HP while manoeuvring, versus the old bot that walked in a straight line and planted itself.

## Verified how
Both suites green (`npm run typecheck && npm test && npm run build`, 124 tests; `go vet ./... && go test ./...`). Beyond that, driven in a real browser against a real `mageserver`: create-room-with-bots → ready → start → play → round end → result screen → rematch lobby, plus a two-human "without bots" room joined from a second isolated browser context. `WebSocket.send` was patched in-page to read the actual input frames, which is how the aim fix and "54/54 frames sent `charging:true` **and** a non-zero move together" were confirmed rather than assumed.

## Careful / not done
- **Ownership**: `AGENTS.md` assigns `server/internal/{game,bot,match}/**` to Cursor. This session changed all three (the user explicitly asked for the full map + AI port, which is impossible client-side). Coordinate before Cursor picks that slice back up.
- **The running Docker containers are stale.** Everything above is in the working tree only, nothing committed. `docker compose build client gameserver && docker compose up -d client gameserver` before testing through :8080, or you will be testing the old build — this exact confusion cost a previous session a lot of time.
- Mid-match "Leave Match" still has no real forfeit (no such wire message); the opponent fights a stationary ghost until the round ends.
- The server has no path planner. Bots use a short probe + sidestep (`steerTo`) rather than the client's `PathGrid`, so they can still scrape along a long wall instead of routing around it.
- Per-element combat tuning still lives only in the Go sim; the offline TS sim remains uniform/team-colored. The two simulations are still hand-synced by design — see the note in the older handover below.

## Files touched this session
`src/net/SnapshotSync.ts`, `src/ui/Menus.tsx`, `src/net/OnlineMatch.ts`, `src/app/App.tsx`, `server/internal/game/{arena.go (new), arena_test.go (new), world.go, world_test.go, entities.go, config.go, vector.go}`, `server/internal/game/maps/arena1.json (new)`, `server/internal/bot/{ai.go, ai_test.go}`, `server/internal/match/{session.go, session_test.go}`.

---



## Why this session happened
User reported that online duels dropped into what looked like a completely different, primitive game compared to practice mode. `OnlineMatch.ts` was (per the Cursor handover below) an intentional stopgap: a bare Three.js scene with capsule meshes, unrelated to the real practice-mode rendering pipeline. User wants online duels to look **and behave** exactly like practice mode.

## ⚠️ Read this before touching anything — unresolved as of end of session
Every fix below was verified by automated Playwright (headless Chromium, synthetic WebSocket/keyboard/mouse) — real WS traffic was captured and inspected to confirm each bug and each fix, not guessed. Despite that, **the user says it's still broken after the last round of fixes, with no new concrete symptom given yet.** Do not repeat the trial-and-error loop blind. Before writing any more code:

1. **Rule out browser cache first — prime suspect, not yet ruled out.** `nginx.conf` sets no `Cache-Control` on `index.html`. Vite hashes JS filenames so a truly fresh `index.html` fetch gets the new bundle, but if the browser cached the *old* `index.html`, it keeps referencing the old JS forever. Ask the user to hard-refresh (Cmd+Shift+R) or test in a fresh private window before assuming any fix didn't land. If that turns out to be it, add `add_header Cache-Control "no-cache";` for `/index.html` in `nginx.conf` (or an nginx `location = /index.html { ... }` block) and rebuild `client`.
2. **Confirm the running containers are actually current** before debugging further: `docker inspect mage-craft-client-1 --format '{{.Image}}'` and same for `mage-craft-gameserver-1`; compare against `docker images`. At the end of this session they were `2c88dc5378d9…` (client) and `e687c144a423…` (gameserver) — both freshly built from what's described below. If they differ, `docker compose build <service> && docker compose up -d <service>` first.
3. **Get an actual reproducible complaint** before changing code: exact steps, ideally a screen recording, or at minimum what was expected vs. what happened + browser console/network errors (F12 → Console/Network). "still broken" alone isn't actionable — three times this session a vague complaint was chased down to a *specific, real* bug (see below), each confirmed via live network capture, but a headless automated re-test after each fix showed it working — meaning either (a) it's #1/#2 above, (b) it's a UX/expectation mismatch not a bug, or (c) it's real but only triggers under conditions the automated tests aren't hitting (real mouse timing, specific element/bot difficulty, real network latency, etc.). Narrow it down before guessing again.

## What changed this session

### 1. Client: online match now renders through the real practice-mode pipeline (done, verified)
- `src/net/OnlineMatch.ts` rewritten internally — same public API (`constructor(container, net, opts)` / `applySnapshot` / `setSpectating` / `dispose`), so `src/app/App.tsx` needed **zero** changes — to build a real `World` and drive the actual `ArenaRenderer` / `PlayerRenderer` / `NavIndicatorRenderer` / `AimIndicatorRenderer` / `ParticleRenderer` / `PickupRenderer` / `HUD` / `Minimap` / `engine/Renderer` (the exact same classes `src/main.ts`'s `bootOfflineMatch` uses for practice mode), instead of its own bespoke perspective-camera/capsule-mesh scene.
- New `src/net/SnapshotSync.ts`: translates server `SnapshotMsg`s into that `World` — creates/updates/removes mages, projectiles and puddles by wire id; maps team → POV-relative `Team.Player`/`Team.Enemy` (learned from the first snapshot containing your own id); infers alive (`health > 0`, confirmed exact against the Go server), animation/state (hit-flash on health drop, charging, moving vs idle), and smooths position/rotation between the server's ~20Hz snapshots for 60fps rendering.
- New `src/render/PuddleRenderer.ts`: renders poison puddles (a mechanic with no offline precedent — plain translucent disc per puddle, no discrete events needed).
- Small additive changes, offline behavior unchanged: `src/game/types.ts` (`Player.lives?: number`, new `Puddle` type), `src/game/World.ts` (`readonly puddles: Puddle[]`), `src/ui/HUD.tsx` (optional 6th constructor param `getLocalId?: () => EntityId | null` so HUD can find "my own" mage instead of assuming exactly one `Team.Player` entity — offline's 5-arg call site is untouched and falls back to the old behavior).
- Also fixed in this same pass: `OnlineMatch`'s container had `this.container.style.position = 'relative'` unconditionally set inline, which clobbered the CSS module's `position: absolute; inset: 0` and collapsed the whole match viewport to a ~300px sliver instead of filling the screen. Now only sets it if the container is currently `static`.
- **Verification**: two real Playwright browser contexts (host + joiner) through the full create-room → join-by-code → ready → start-duel flow. Confirmed: real wizard model renders (not capsules), HUD/minimap match practice mode pixel-for-pixel in style, POV colors correctly mirrored per client (each player sees themself blue, opponent red), camera follows the local mage, full charge/aim-trajectory-preview/throw cycle renders correctly, zero console errors on either client. Solo/practice mode re-verified unaffected. `npm run typecheck && npm run lint && npm test && npm run build` all green (124 unit tests).

### 2. Go server: 3 real gameplay bugs found + fixed after user reported gameplay still felt broken (done, verified via live WS traffic + `go test`)
Found by proxying `window.WebSocket` in a real Playwright page to log every sent/received JSON frame during an actual match, not by guessing. All in `server/internal/game/`:

- **Movement permanently locked after your first throw** (`world.go`, `updateMage`). Once `RecoveryTimer` decayed to exactly `0`, the early-return block for recovery stopped firing — but `m.State` was left at `MageRecovering` forever, and the movement gate (`if !m.Charging && m.State != MageRecovering`) was the *only* code path that could ever clear it. Self-perpetuating deadlock: throw once, never move again (until you charge again, since the charging branch does reset state — this is why it wasn't caught immediately). Fixed: explicitly reset `m.State = MageIdle` the tick recovery ends, then fall through instead of returning.
- **Character never turns to face its walking direction.** `m.Facing` was only ever updated in the charging/aim-at-cursor branch; `moveMage()` never touched it, so the mage kept facing spawn direction (or last-aim direction) regardless of which way it walked. Fixed: `moveMage()` now sets `m.Facing = move.Normalized()` while actually moving. Bots get this for free (same input path).
- **Instant "teleport" knockback.** `dealDamage()` added the *full* knockback magnitude straight to `Position` in a single 1/60s tick — e.g. up to 8.5 world units instantly for wind (highest-knockback element). Practice mode's `src/systems/DamageSystem.ts` applies knockback as an initial velocity that decays exponentially over the hit-stun window (~0.29 world units of actual slide for a magnitude-3.5 hit, ~12/s damping). Ported the same model server-side: new `Mage.KnockbackVelocity Vec2` field, `KnockbackDamping = 12.0` / `KnockbackStopSpeed = 0.02` constants in `config.go` (numerically matching the client's `KNOCKBACK_DAMPING`/`STOP_SPEED`), integrated during the existing `StunTimer > 0` window in `updateMage`.
- One existing test, `TestWorld_ProjectileHitsEnemyAppliesDamageAndKnockback` in `world_test.go`, had its timing assumption updated (steps a few extra ticks after the hit lands) since it asserted on the old instant-jump behavior, which no longer exists by design.
- `go build ./...` and `go test ./...` (all packages) green. Rebuilt + restarted the `gameserver` container after this fix.

### 3. Known, real, NOT yet addressed — separate from both of the above
While investigating the "bots don't work like practice bots" complaint, found the Go bot AI (`server/internal/bot/ai.go`) is more capable than first assumed — it has real advance/retreat/attack logic with easy/normal/hard tuning, same spirit as `src/systems/AISystem.ts`. But two real, verified gaps remain if full parity is wanted:
- Go bot never dodges incoming projectiles (offline `AISystem.ts` has `AI.dodgeRadius` dodge behavior; `bot/ai.go` has none).
- Go bot doesn't reposition/strafe once already within `EngageRange` (9.0 units) — it just plants and throws from a stationary position. Whether offline is meaningfully more dynamic here wasn't fully compared side-by-side.
- The Go server's arena is a bare open rectangle, `ArenaWidth=24 × ArenaHeight=16`, **no obstacles/cover** — an explicit, documented v1 scope cut (`multiplayer-plan.md`), unlike practice mode's decorated `40×30` maps (e.g. `public/maps/arena1.json`) with trees/rocks/forts. This is why the online camera "feels different" from practice mode even though it's the exact same `Renderer`/`CameraController` class/code — it's framing a much smaller, emptier map, not a camera bug. Porting obstacles/cover/line-of-sight into the Go sim is a much bigger, separate undertaking, not attempted this session.
- Per-element combat tuning (damage/knockback/speed per element) is rich in the Go server (`elements.go`, 7 elements) but **not wired into the offline TS sim at all** — offline's `Player`/`Snowball` types have no `element` field; offline combat is uniform/team-colored only. The two simulations are explicitly NOT in full behavioral parity by design — `multiplayer-plan.md` calls this out as an ongoing, hand-maintained risk between the TS client sim and the Go server sim, not something either side gets "for free." Worth keeping in mind before assuming "just copy X" is a small change — the two implementations are separate Go/TypeScript codebases that must be kept in sync by hand.

## How to rebuild after further changes
```bash
# client (TypeScript/Vite) — from repo root:
npm run typecheck && npm run lint && npm test && npm run build
docker compose build client && docker compose up -d client

# gameserver (Go):
cd server && go build ./... && go test ./...
cd .. && docker compose build gameserver && docker compose up -d gameserver
```
Full stack: `docker compose ps` for status; `docker compose logs -f gameserver` / `client` to tail logs live while reproducing an issue. Nothing from this session has been committed to git yet — everything is in the working tree (`git status` / `git diff --stat`).

## Files touched this session
`server/internal/game/config.go`, `server/internal/game/entities.go`, `server/internal/game/world.go`, `server/internal/game/world_test.go`, `src/game/World.ts`, `src/game/types.ts`, `src/net/OnlineMatch.ts` (rewritten), `src/net/SnapshotSync.ts` (new), `src/render/PuddleRenderer.ts` (new), `src/ui/HUD.tsx`.

---

# Handover — 2026-08-02 (Cursor — join-as-spectator + bots no create)

## What changed this session
- **Protocolo**: `fillBots`/`botDifficulty` em `create_room`; `list_rooms` /
  `room_list`; `claim_slot`; `room_state` com `spectators`, `youRole`,
  `pendingClaimPlayerId`.
- **Room/Session**: `JoinAsSpectator`, `ClaimSlot`, `FillEmptyWithBots`,
  rematch após `round_end` (`ApplyClaims` + `ResetToLobby`) — não fica em
  `ended` permanente.
- **mageserver**: handlers + restart de `RunLoop` no rematch; auto-fill bots
  no `select_element` quando a sala foi criada com `fillBots`.
- **magesmoke** + integration test cobrem fillBots + spectator claim.
- **Cliente**: `src/net/{protocol,NetworkClient,lobbyBridge,OnlineMatch}.ts`;
  UI create com checkbox de bots; lista live; join mid-match como espectador;
  claim de bot; Start online com render de snapshots.

## Key decisions (and why)
- Join mid-match = **espectador** até o fim da rodada; claim só aplica no
  rematch (bot continua jogando). Mais simples e alinhado ao pedido do user.
- `round_end` → lobby de rematch (não sala morta), para o late joiner entrar.
- Ownership desta fatia: **Cursor** (ver `AGENTS.md`).

## Plan / todo status
- Done: protocolo, room/session/rematch, mageserver, magesmoke, NetworkClient,
  UI create/list/spectator/claim, OnlineMatch snapshots, AGENTS/HANDOVER.
- Pending polish: host explícito no server; interpolação de snapshots;
  POV-relative colors no OnlineMatch; forfeit/disconnect bot-takeover mid-round.

## Known issues / risks
- ~~OnlineMatch é render mínimo (capsules + projéteis), não o pipeline SP completo.~~ **Resolvido na sessão acima (2026-08-02, Claude).**
- `isHost` no client é “quem criou”; server ainda deixa qualquer um dar Start.
- Create/join com server offline cai no lobby local (demos / practice).
- Dois agentes: Claude deve coordenar antes de tocar `src/**` ou
  `server/internal/{room,match,protocol}` / `cmd/mageserver`.

## Next steps
1. Jogar manualmente: `go run ./cmd/mageserver` + Vite; create com bots →
   Start → 2º browser join live → claim → esperar round_end → Start rematch.
2. `go test ./...` no server (já verde na entrega).
3. Claude (se retomar UI): polish HUD/POV online em cima de `OnlineMatch` /
   NetworkClient sem reescrever o protocolo.
