/**
 * Element catalog for Mage Craft (GDD §8). Used by the pre-match menu and,
 * later, by combat systems. Numeric combat defs still live in `config.ts`
 * until the elemental projectile pipeline lands.
 */

export type ElementId =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'poison'
  | 'stone'
  | 'arcane'
  | 'wind'
  | 'holy'
  | 'sonic';

export interface ElementInfo {
  id: ElementId;
  /** Short display name. */
  name: string;
  /** One-line role for the picker / how-to. */
  role: string;
  /** Accent color for chips and UI hints (hex without #). */
  color: number;
  /** Whether this element is selectable in the Alpha offline menu. */
  selectable: boolean;
}

/**
 * Full catalog. The 7 offensive elements are selectable in the Alpha menu; the
 * two support attacks are not — they come attached to the Cleric and the Bard.
 */
export const ELEMENTS: ReadonlyArray<ElementInfo> = [
  {
    id: 'fire',
    name: 'Fire',
    role: 'Baseline pressure — solid damage, light knockback.',
    color: 0xe85d04,
    selectable: true,
  },
  {
    id: 'ice',
    name: 'Ice',
    role: 'Soft control — lower damage, slows the target.',
    color: 0x4cc9f0,
    selectable: true,
  },
  {
    id: 'lightning',
    name: 'Lightning',
    role: 'Poke — faster bolt, flatter arc, less knockback.',
    color: 0xffd60a,
    selectable: true,
  },
  {
    id: 'poison',
    name: 'Poison',
    role: 'Zone denial — leaves a damaging puddle on the ground.',
    color: 0x80b918,
    selectable: true,
  },
  {
    id: 'stone',
    name: 'Stone',
    role: 'Heavy hit — slow, high damage, can interrupt a charge.',
    color: 0x8d99ae,
    selectable: true,
  },
  {
    id: 'arcane',
    name: 'Arcane',
    role: 'Flex — medium damage with a small impact blast.',
    color: 0x9b5de5,
    selectable: true,
  },
  {
    id: 'wind',
    name: 'Wind',
    role: 'Utility — low damage, strong shove.',
    color: 0xa8dadc,
    selectable: true,
  },
  {
    id: 'holy',
    name: 'Holy',
    role: 'Cleric only — weak lance of light with a small blast.',
    color: 0xffc93c,
    selectable: false,
  },
  {
    id: 'sonic',
    name: 'Sonic',
    role: 'Bard only — weak wave that shoves and nags with a short slow.',
    color: 0xf72585,
    selectable: false,
  },
] as const;

export const DEFAULT_ELEMENT: ElementId = 'fire';

export const SELECTABLE_ELEMENTS: ReadonlyArray<ElementInfo> = ELEMENTS.filter((e) => e.selectable);

export function isElementId(value: unknown): value is ElementId {
  return typeof value === 'string' && ELEMENTS.some((e) => e.id === value);
}

export function getElement(id: ElementId): ElementInfo {
  const found = ELEMENTS.find((e) => e.id === id);
  if (!found) return ELEMENTS[0];
  return found;
}

export function toCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
