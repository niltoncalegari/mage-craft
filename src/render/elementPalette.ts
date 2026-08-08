import type { ElementId } from '../game/elements';

/**
 * The two colors that say "this is fire" (GDD §17). `core` is the body color of
 * the conjured thing; `glow` is what it emits and what reads at a distance.
 *
 * This lives apart from {@link ParticleRenderer}'s `ELEMENT_VFX` because the
 * element now has to be legible on the *mage* as well as on the spell it
 * throws — the hat band and staff gem in {@link PlayerRenderer} tint from the
 * same pair, so a fireball leaving a mage matches the mage it left. Duplicating
 * the hexes would let the two drift apart silently.
 *
 * Note these are not `ELEMENTS[].color` from `game/elements.ts`: those are UI
 * chip accents tuned to read on the menu's dark panels, which is a different
 * job than lighting a gem in the arena.
 */
export interface ElementTint {
  /** Body/albedo color. */
  readonly core: number;
  /** Emissive and additive-halo color. */
  readonly glow: number;
}

export const ELEMENT_TINT: Readonly<Record<ElementId, ElementTint>> = {
  fire: { core: 0xffb238, glow: 0xff5a1f },
  ice: { core: 0xd8f7ff, glow: 0x4cc9f0 },
  lightning: { core: 0xffffff, glow: 0xffe066 },
  poison: { core: 0xcdf27a, glow: 0x80b918 },
  stone: { core: 0xc7cdd6, glow: 0x8d99ae },
  arcane: { core: 0xe6d1ff, glow: 0x9b5de5 },
  wind: { core: 0xf3fbfb, glow: 0xa8dadc },
};

/**
 * Tint for a mage whose element is unknown — practice mode and the legacy
 * offline path never set one. Falls back to the caller's color (team color, in
 * practice) so an unelemented mage still looks deliberate rather than white.
 */
export function elementTint(element: ElementId | undefined, fallback: number): ElementTint {
  return element ? ELEMENT_TINT[element] : { core: fallback, glow: fallback };
}
