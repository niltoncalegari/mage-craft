# Mage Craft

A siege between two squads of four mages. You do not steer them: you pick the
four bodies, set how hard each one plays, and watch the fight you built.

**Three.js + TypeScript + Vite** on the client, Preact for the UI, with a
simulation that has no idea a renderer exists — the same `sim/` runs the
browser, the authoritative server and the headless balance sweeps.

Product / design source of truth: [`GDD.md`](./GDD.md). The v1.3 pivot that
retired decks and rule programs is written up in
[`treinador-plan.md`](./treinador-plan.md).

## Quick start

```bash
npm install
npm run dev          # client on http://localhost:5173
npm run dev:server   # authoritative match server
```

Tests need **Node 22**; vitest crashes on older runtimes.

## How a match works

- **Four mages a side**, permanent for the match, respawning on death. All
  three roles are required and duplicates are illegal (`sim/squad.ts`).
- **Each mage carries its own kit** of two or three abilities and spends them
  itself. There is no hand, no deck, no mana bar and no rule program — every
  one of those was removed in v1.3.
- **A skill fires** when its cooldown is up, its `when` condition holds, its
  target selector resolves and the target is in range (`sim/abilityPolicy.ts`,
  `sim/bot/kit.ts`). All of that is data in `public/data/balance.json`.
- **The one dial the player turns before a match** is each mage's stance:
  `hold`, `normal` or `aggressive`. It is a throttle, not a switch — a held kit
  still spends about four fifths of what a normal one does.

## Scripts

```bash
npm run build
npm run typecheck
npm run lint
npm test             # Node 22
npm run report:ai    # headless Brain behaviour: action mix, push depth, objectives
npm run report:kit   # headless kit balance sweep (GDD §14, plano §5)
```

`npm run report:kit -- --seeds 10 --pool 10` plays a round robin over legal
quartets and reports win rate per mage and casts per skill. Ceilings there are
reported, never asserted: the floors that must not regress live in
`sim/agency.test.ts` and `sim/kitUsage.test.ts` and run in CI.

## Layout

One-way data flow: **simulation → snapshot → renderer**. Game logic never
imports Three.js, and the renderer never decides anything.

```
sim/         The whole game. Deterministic, headless, no DOM, no sockets.
             World, entities, spells, abilities, kits, bot Brain, protocol.
server/      Authoritative match server: sessions, matchmaking, rooms.
api/         Accounts, loadouts, match history, ranking (Express + Mongo).
src/
  app/       Screens, loadout store, match history (Preact)
  net/       Snapshot sync, local session, online match, API client
  core/      Game loop, orchestrator, event bus
  engine/    Renderer, camera, input, audio, assets, settings
  render/    Arena, mage, projectile, particle and VFX renderers
  ui/        Match HUD, squad panel, menus, debug overlay
  physics/   Collision, spatial hash, line-of-sight, pathfinding
  dev/       Firing ranges — every projectile, and every kit, side by side
public/data/ balance.json — every combat number in the game
public/maps/ Arena definitions
scripts/     Headless reports
```
