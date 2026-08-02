# Mage Craft

Arena mage duel: position, charge, and throw elemental projectiles. Built with
**Three.js + TypeScript + Vite** (Preact UI), with a simulation fully decoupled
from rendering.

Product / design source of truth: [`GDD.md`](./GDD.md).

> Current playable build still uses the SnowCraft combat loop (single fighter,
> charge-throw, lives, AI). Mage retheme, elemental catalog, PvP, Tauri, and
> Steam are planned in the GDD roadmap. Technical heritage:
> [`design.md`](./design.md), [`multiplayer-plan.md`](./multiplayer-plan.md).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

## Controls

| Action | Input |
| --- | --- |
| Move | `WASD`, or right-click a destination |
| Aim & throw | Hold left mouse to charge, release to throw |
| Pause | `Esc` or `P` |
| Debug overlay | `` ` `` (backtick); `1`–`6` for categories |

## Scripts

```bash
npm run build
npm run typecheck
npm run lint
npm run test
```

## Architecture

One-way data flow: **Simulation → Renderer → Three.js**. Game logic never
imports Three.js.

```
src/
  core/      Game loop, orchestrator, event bus, input commands
  ecs/       Entity/component/system contracts
  engine/    Renderer, camera, input, audio, assets, settings
  game/      Entity data, world, arena/map loading, config
  systems/   AI, movement, throwing, projectile, collision, damage, round
  physics/   Collision, spatial hash, line-of-sight, pathfinding
  render/    Arena/player/particle renderers
  ui/        HUD, menus, debug overlay (Preact)
  utils/     Vector2, math, RNG, object pool
public/maps/ Arena definitions (JSON)
```
