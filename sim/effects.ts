/**
 * Status effects (GDD §9).
 *
 * Every temporary thing that can be true of a mage — slowed, hasted, burning,
 * shielded, vulnerable, stunned — used to be its own pair of fields on `Mage`
 * plus its own copy-pasted decay block in `World.updateMage`, its own stacking
 * rule invented at the call site, and its own boolean on the wire. Six of them
 * fit; the seventh did not, and the GDD called the generic replacement the
 * first thing v1.1 owed.
 *
 * The shape of the answer: a mage carries a list, the catalog in
 * `balance.json` says how two applications of the same kind combine, and the
 * rest of the sim asks derived questions ("how fast does this mage move?")
 * instead of reading timers.
 *
 * Determinism: the list is only ever mutated through `applyEffect` /
 * `tickEffects`, which keep it sorted by `EFFECT_ORDER`. Two worlds that
 * applied the same effects in the same ticks therefore iterate them in the same
 * order regardless of arrival order, and nothing here draws from `Rng`.
 */

import { BALANCE, type StackingRule } from './balance';

/**
 * Float slack for every timer comparison here. A duration is a sum of 1/60s,
 * which is not exactly representable, so both expiry and DoT cadence have to
 * treat "a hair under" as "reached" or they drift apart by a whole tick.
 */
const EPSILON = 1e-6;

export type EffectKind =
  /** Move speed down by `magnitude` (0.35 = 35% slower). */
  | 'slow'
  /** Move speed up by `magnitude`. */
  | 'haste'
  /** Charge rate down by `magnitude`. */
  | 'cast_slow'
  /** Charge rate up by `magnitude`. */
  | 'cast_haste'
  /** Damage over time; `tickDamage` per `tickInterval`, scaled by `stacks`. */
  | 'burn'
  /** Damage taken up by `magnitude` (0.25 = +25%). */
  | 'vulnerable'
  /** A pool of absorption drained before health; `magnitude` is what is left. */
  | 'shield'
  /** Rooted. Mirrored onto `Mage.stunTimer`, which is what actually roots. */
  | 'stun'
  /**
   * Held in place, but not silenced: move speed is pinned to the floor while
   * casting and shooting carry on. `magnitude` is unused — a root is a root.
   */
  | 'root'
  /** Healing over time; `tickHeal` per `tickInterval`. The DoT run backwards. */
  | 'regen';

/**
 * Iteration and wire order. Fixed so the effect list is canonical: a mage
 * slowed-then-burned and one burned-then-slowed serialise identically.
 */
export const EFFECT_ORDER: readonly EffectKind[] = [
  'stun',
  'root',
  'slow',
  'haste',
  'cast_slow',
  'cast_haste',
  'burn',
  'regen',
  'vulnerable',
  'shield',
];

export function isEffectKind(value: string): value is EffectKind {
  return (EFFECT_ORDER as readonly string[]).includes(value);
}

export interface ActiveEffect {
  readonly kind: EffectKind;
  /** Meaning depends on the kind; see the union above. */
  magnitude: number;
  /** Seconds left. Snapped to exactly 0 on expiry so `> 0` never sees float dust. */
  remaining: number;
  /** Only `stack_intensity` kinds go above 1. */
  stacks: number;
  /** DoT bookkeeping; 0 for everything that is not a DoT. */
  tickInterval: number;
  tickTimer: number;
  tickDamage: number;
  /** HoT bookkeeping; 0 for everything that is not a HoT. */
  tickHeal: number;
  /** Who to credit for a DoT kill; `null` when nobody can be. */
  sourceId: string | null;
}

/** What to apply. The caller fills in whatever the effect kind actually uses. */
export interface EffectSpec {
  kind: EffectKind;
  magnitude?: number;
  duration?: number;
  tickInterval?: number;
  tickDamage?: number;
  tickHeal?: number;
  sourceId?: string | null;
}

/** Anything that can carry effects. `Mage` satisfies this. */
export interface EffectCarrier {
  effects: ActiveEffect[];
}

function ruleFor(kind: EffectKind): { stacking: StackingRule; maxStacks: number; maxMagnitude: number } {
  const r = BALANCE.effects[kind];
  return {
    stacking: r?.stacking ?? 'refresh_strongest',
    maxStacks: r?.maxStacks ?? 1,
    maxMagnitude: r?.maxMagnitude ?? Number.POSITIVE_INFINITY,
  };
}

function orderOf(kind: EffectKind): number {
  return EFFECT_ORDER.indexOf(kind);
}

/** The running effect of this kind, or undefined. */
export function effectOf(carrier: EffectCarrier, kind: EffectKind): ActiveEffect | undefined {
  return carrier.effects.find((e) => e.kind === kind);
}

export function hasEffect(carrier: EffectCarrier, kind: EffectKind): boolean {
  return effectOf(carrier, kind) !== undefined;
}

/** Magnitude of the running effect of this kind, or 0. Stacks are *not* folded in. */
export function magnitudeOf(carrier: EffectCarrier, kind: EffectKind): number {
  return effectOf(carrier, kind)?.magnitude ?? 0;
}

/**
 * Applies `spec`, combining with anything of the same kind by that kind's
 * stacking rule (`balance.json`, `effects` block):
 *
 * - `refresh_strongest` — the stronger magnitude and the longer remaining time
 *   both win, independently. A weak graze can extend a strong slow but never
 *   dilutes it, which is what stops a Bard's 0.15 undoing a Sentinel's 0.35.
 * - `stack_intensity` — one more stack (to `maxStacks`) and the full duration
 *   back. Intensity comes from `stacks`, not from `magnitude`.
 * - `pool` — keep the bigger pool. Two shields do not add up (GDD §9).
 */
export function applyEffect(carrier: EffectCarrier, spec: EffectSpec): ActiveEffect {
  const rule = ruleFor(spec.kind);
  const magnitude = Math.min(spec.magnitude ?? 0, rule.maxMagnitude);
  const duration = spec.duration ?? 0;
  const existing = effectOf(carrier, spec.kind);

  if (existing) {
    switch (rule.stacking) {
      case 'stack_intensity':
        existing.stacks = Math.min(existing.stacks + 1, rule.maxStacks);
        existing.remaining = Math.max(existing.remaining, duration);
        existing.magnitude = Math.max(existing.magnitude, magnitude);
        break;
      case 'pool':
        existing.magnitude = Math.max(existing.magnitude, magnitude);
        existing.remaining = Math.max(existing.remaining, duration);
        break;
      case 'refresh_strongest':
      default:
        existing.magnitude = Math.max(existing.magnitude, magnitude);
        existing.remaining = Math.max(existing.remaining, duration);
        break;
    }
    // A refreshed DoT keeps its cadence rather than restarting it, so holding a
    // target in fire does not push the next tick further away every hit.
    if (spec.tickInterval !== undefined) existing.tickInterval = spec.tickInterval;
    if (spec.tickDamage !== undefined) existing.tickDamage = spec.tickDamage;
    if (spec.tickHeal !== undefined) existing.tickHeal = spec.tickHeal;
    if (spec.sourceId !== undefined) existing.sourceId = spec.sourceId;
    return existing;
  }

  const effect: ActiveEffect = {
    kind: spec.kind,
    magnitude,
    remaining: duration,
    stacks: 1,
    tickInterval: spec.tickInterval ?? 0,
    tickTimer: 0,
    tickDamage: spec.tickDamage ?? 0,
    tickHeal: spec.tickHeal ?? 0,
    sourceId: spec.sourceId ?? null,
  };

  // Insertion sort into EFFECT_ORDER: the list is at most eight entries, and
  // keeping it canonical is what makes the wire form and iteration stable.
  const at = carrier.effects.findIndex((e) => orderOf(e.kind) > orderOf(effect.kind));
  if (at === -1) carrier.effects.push(effect);
  else carrier.effects.splice(at, 0, effect);
  return effect;
}

export function removeEffect(carrier: EffectCarrier, kind: EffectKind): void {
  const at = carrier.effects.findIndex((e) => e.kind === kind);
  if (at !== -1) carrier.effects.splice(at, 1);
}

export function clearEffects(carrier: EffectCarrier): void {
  carrier.effects.length = 0;
}

/**
 * What a periodic effect wants to do this tick. The world turns it into actual
 * damage or actual healing.
 *
 * Two channels rather than one signed number. Damage runs a gauntlet healing
 * has no business in — the vulnerability multiplier, the shield pool, hit-stun,
 * kill credit — and a negative `damage` would have to mean the right thing at
 * every one of those, or quietly mean the wrong one. Exactly one of the two is
 * ever non-zero.
 */
export interface EffectTick {
  readonly kind: EffectKind;
  readonly damage: number;
  readonly heal: number;
  readonly sourceId: string | null;
}

/**
 * Advances every effect by `dt`, expiring what ran out and collecting the DoT
 * ticks that came due. Returns null rather than an empty array in the common
 * case, since this runs for every mage every tick.
 */
export function tickEffects(carrier: EffectCarrier, dt: number): EffectTick[] | null {
  if (carrier.effects.length === 0) return null;

  let due: EffectTick[] | null = null;

  for (let i = carrier.effects.length - 1; i >= 0; i--) {
    const e = carrier.effects[i];

    if (e.tickInterval > 0 && (e.tickDamage > 0 || e.tickHeal > 0)) {
      e.tickTimer += dt;
      // The epsilon is load-bearing, not defensive. A 4s burn ticking every
      // 0.5s must deal exactly 8 ticks; without it the eighth comes due on the
      // same tick the effect expires, and 30 accumulations of 1/60 land a
      // fraction *under* 0.5, so the last tick was silently dropped.
      while (e.tickTimer >= e.tickInterval - EPSILON) {
        e.tickTimer -= e.tickInterval;
        due ??= [];
        due.push({
          kind: e.kind,
          damage: e.tickDamage * e.stacks,
          heal: e.tickHeal * e.stacks,
          sourceId: e.sourceId,
        });
      }
    }

    e.remaining -= dt;
    // Snap rather than let float dust keep an expired effect nominally alive;
    // the rest of the sim tests `remaining > 0`.
    if (e.remaining <= EPSILON) carrier.effects.splice(i, 1);
  }

  // Collected back-to-front; hand them back in list order so damage credit and
  // any future ordering-sensitive logic stay deterministic.
  return due ? due.reverse() : null;
}

/* ---- Derived stats --------------------------------------------------------- */
/*
 * The rest of the sim asks these instead of reading timers, so adding an effect
 * that touches movement or casting does not mean finding every site that
 * multiplies a speed.
 */

/**
 * Multiplier on base move speed. Floored at 0.1 so no stack of slows can ever
 * root a mage outright — rooting is what `root` and `stun` are for, and both
 * are visible.
 *
 * `root` returns that floor rather than multiplying into it: the floor guards a
 * *product*, so a hasted target would otherwise walk out of the deepest slow in
 * the catalog at a quarter speed. A root that haste can argue with is not a
 * root.
 */
export function moveSpeedMultiplier(carrier: EffectCarrier): number {
  if (hasEffect(carrier, 'root')) return 0.1;
  const slow = magnitudeOf(carrier, 'slow');
  const haste = magnitudeOf(carrier, 'haste');
  return Math.max(0.1, 1 - slow) * (1 + haste);
}

/**
 * Multiplier on charge rate. `auraBonus` is the support aura, which is not an
 * effect (it is recomputed from proximity every tick) but combines the same
 * way: the stronger of aura and cast buff wins rather than the two adding.
 */
export function chargeRateMultiplier(carrier: EffectCarrier, auraBonus = 0): number {
  const boost = Math.max(auraBonus, magnitudeOf(carrier, 'cast_haste'));
  const drag = magnitudeOf(carrier, 'cast_slow');
  return (1 + boost) * Math.max(0.25, 1 - drag);
}

/** Multiplier on incoming damage — arcane's contribution to a focus-fire team. */
export function damageTakenMultiplier(carrier: EffectCarrier): number {
  return 1 + magnitudeOf(carrier, 'vulnerable');
}

/** Damage left after the shield pool ate what it could; drains the pool. */
export function absorbWithShield(carrier: EffectCarrier, amount: number): number {
  const shield = effectOf(carrier, 'shield');
  if (!shield || shield.magnitude <= 0) return amount;
  const absorbed = Math.min(shield.magnitude, amount);
  shield.magnitude -= absorbed;
  if (shield.magnitude <= 0) removeEffect(carrier, 'shield');
  return amount - absorbed;
}
