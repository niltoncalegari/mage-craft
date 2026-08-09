/**
 * The client's read-only view of the sim's status effects (GDD §9).
 *
 * The sim owns `sim/effects.ts`; this is only what a renderer needs to ask —
 * "is this mage burning, and how badly?" — without importing the simulation.
 * Effects arrive on the snapshot as a list, so a renderer that reads them can
 * show a new effect the day it appears in `balance.json`.
 */

import type { Player } from './types';

/** Mirrors `EffectKind` in `sim/effects.ts`; kept as strings, since the wire is. */
export type FxKind =
  | 'slow'
  | 'haste'
  | 'cast_slow'
  | 'cast_haste'
  | 'burn'
  | 'vulnerable'
  | 'shield'
  | 'stun';

export interface MageFx {
  readonly kind: string;
  /** How many applications deep; 1 for everything that does not stack. */
  readonly stacks: number;
}

export function hasFx(player: Player, kind: FxKind): boolean {
  return player.fx?.some((f) => f.kind === kind) ?? false;
}

/** Stack count, or 0 when the effect is not running — the intensity dial for VFX. */
export function fxStacks(player: Player, kind: FxKind): number {
  return player.fx?.find((f) => f.kind === kind)?.stacks ?? 0;
}
