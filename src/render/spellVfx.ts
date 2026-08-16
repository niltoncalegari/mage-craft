/**
 * What a card looks like when it lands (GDD §17).
 *
 * Split out of {@link ParticleRenderer} because the descriptor stopped being
 * the particle renderer's private business: the shake rig reads `trauma` off
 * the same row, and `spellVfx.test.ts` reads the whole table to hold it against
 * the catalog. One table, three readers.
 *
 * **The idle pivot changed what this table is for.** While the player cast by
 * hand, the cast beat confirmed *his click* — the click had already told him
 * which card and where, and the VFX only had to agree. Nobody clicks now. The
 * only two things on screen connecting a rule he wrote to a thing that happened
 * are this beat and the HUD's trace panel, so every cast has to answer three
 * questions at once: **which card fell, where, and whose it was.** The white
 * core flash answers the third. `shape` exists because recolouring one burst
 * seven ways answers the first with a palette nobody has memorised.
 */

/**
 * The primitive a cast is drawn with.
 *
 * Deliberately small, and deliberately incomplete. A shape earns its place in
 * the same commit as the first card that needs it, because a shape with no card
 * is a spawn method no eye has ever checked — and the one thing this repo has
 * learned about VFX (see the element pass that gave every projectile its own
 * solid) is that the difference between shapes is only worth anything once
 * someone has watched two of them land side by side.
 */
export type SpellShape =
  /** Ground disc, two shockwave rings, motes over the area. Most cards. */
  | 'burst'
  /** `burst` plus a hemisphere snapping over what it protected — Escudo Arcano. */
  | 'dome'
  /** Something arrived from above (or erupted from below): a vertical shaft. */
  | 'column'
  /** An area was switched *on* rather than hit: rims turning, rim-hugging motes. */
  | 'torus';

export interface SpellVfx {
  /** Which beat to draw. See {@link SpellShape}. */
  shape: SpellShape;
  /** Shockwave rings and the brighter accents. */
  ring: number;
  /** Flat ground disc marking the affected radius. */
  zone: number;
  motes: readonly number[];
  moteCount: number;
  /** +1 for a buff (motes lift), -1 for a curse (motes press down). */
  direction: 1 | -1;
  /**
   * `column` only: how many separate impacts fall, and over how many seconds
   * they are spread.
   *
   * The first cut of this shape drew a single narrow shaft down the middle of
   * the zone, which was wrong about the only card that uses it. Chuva de
   * Meteoros is a *shower* — the name says so, and so does the hazard, which
   * ticks 18 damage across a radius of five. One shaft showed a pinprick where
   * the card covers a disc, and showed one arrival where the card has three.
   *
   * `impactWindow` is held against the card's own `duration` by
   * `spellVfx.test.ts`: meteors still falling after the hazard has expired are
   * the same species of lie as a telegraph the simulation never honours.
   */
  impacts?: number;
  impactWindow?: number;
  /**
   * The ground hazard this card leaves, for the cards whose `apply` list puts a
   * puddle down.
   *
   * `PuddleRenderer` used to paint every puddle in Praga's poison green with no
   * way to say otherwise, which was right while Praga was the only card that
   * left one. Chuva de Meteoros leaves one too and inherited it — a crater of
   * burning rock drawn as a pool of poison, for the second and a half that
   * outlives the cast beat.
   *
   * Absent for a card that leaves nothing, and held that way by a test: a
   * palette on a card with no hazard is a value nothing reads, which is how a
   * table starts lying about what it controls. The puddle an *element* leaves
   * (the Alchemist's flask) carries no card at all and keeps the green default,
   * because for that one the default is correct.
   */
  hazard?: {
    /** The wide fill, the darker pool inside it, and the bright rim. */
    readonly base: number;
    readonly core: number;
    readonly rim: number;
  };
  /**
   * Ground warning before the impact, in seconds; absent or 0 for a card that
   * lands the moment it is cast.
   *
   * **This number is one half of a contract.** The other half is the `delay` on
   * the card's `apply` rule in `balance.json`. A card that lands two seconds
   * after it is cast and warns for one is a card whose damage comes out of
   * nowhere, and neither number is visible from where the other is edited — so
   * `spellVfx.test.ts` asserts they are equal in both directions. No Tier 1
   * card is delayed, which makes that assertion vacuous in one direction today
   * and exactly the point: it is a trap set for the Tier 2 cards (Erupção
   * Vulcânica, Chuva de Meteoros) that bring the `delayed` rider with them.
   *
   * **Declared, not yet drawn.** `ParticleRenderer` does not read this field —
   * there is nothing in the simulation to warn about, so a warning built now
   * would be a beat nobody has ever seen fire, in the one part of the codebase
   * whose bugs are only findable by looking. The commit that adds the `delayed`
   * rider owns the drawing, and the second assertion in the test file is what
   * stops anything from setting a telegraph before then and getting silence.
   */
  telegraph?: number;
  /**
   * Screenshake trauma, 0..1, added on cast. See {@link ShakeRig}.
   *
   * Conservative on purpose, and mostly absent. In a game you play, shake is
   * how a hit earns its weight; in a game you *watch*, the camera is the
   * instrument the next rule is read through, and a camera that jumps hides the
   * cluster the player is trying to see his program react to. So only the
   * cards that are supposed to feel like an event carry any at all.
   */
  trauma?: number;
}

/**
 * Per-card look. The three cards added by the Tier 1 pass carry the deck colour
 * they were given in the builder; the four that predate deck colours keep the
 * palettes they shipped with, which do not all match (Maldição is black in the
 * builder and blue on the field). Re-tinting them to agree would be a visible
 * change to a look that is fine, made for a tidiness nobody can see — the
 * builder names the colour in words right next to the swatch.
 */
export const SPELL_VFX: Readonly<Record<string, SpellVfx>> = {
  blessing: {
    shape: 'burst',
    ring: 0xffe9a8,
    zone: 0xffb703,
    motes: [0xfff3c4, 0xffd166, 0xffb703],
    moteCount: 26,
    direction: 1,
  },
  slow_curse: {
    shape: 'burst',
    ring: 0xcaf0f8,
    zone: 0x4361ee,
    motes: [0xcaf0f8, 0x8ecae6, 0x4895ef],
    moteCount: 22,
    direction: -1,
  },
  arcane_shield: {
    shape: 'dome',
    ring: 0xe0fbfc,
    zone: 0x4cc9f0,
    motes: [0xe0fbfc, 0x7dd3fc, 0x9b5de5],
    moteCount: 20,
    direction: 1,
  },
  plague: {
    shape: 'burst',
    ring: 0xb6e84a,
    zone: 0x4f772d,
    motes: [0xb6e84a, 0x80b918, 0x2f6b1a],
    moteCount: 26,
    direction: 1,
    // The three values `PuddleRenderer` used to hardcode, moved here verbatim
    // so Praga's pool comes out exactly as it always has.
    hazard: { base: 0x6fd15a, core: 0x2f6b1a, rim: 0xb6e84a },
  },
  /*
   * Read against Praga, which is the card it is most likely to be confused
   * with: both are green, both are thrown at a crowd. Praga boils *up* out of
   * a bright toxic puddle; the swamp is duller, browner, and its motes press
   * *down*, because what it does is hold people still.
   */
  sticky_swamp: {
    shape: 'burst',
    ring: 0xa8c66c,
    zone: 0x3d5321,
    motes: [0xa8c66c, 0x6b8f3a, 0x4a3b1f],
    moteCount: 22,
    direction: -1,
  },
  /*
   * The only card that catches *both* squads, so it cannot read as a thing
   * thrown at one of them. The torus says an area was energised rather than
   * struck — which is also literally what it does: everyone inside takes more
   * damage and casts faster.
   */
  /*
   * The third green card, and the reason it is not a third green burst. Praga
   * and the swamp are already two bursts separated by palette alone, which is
   * the failure mode this type's docblock names outright — a third would make
   * "which green landed?" a question about remembering hex codes.
   *
   * The torus is also the truer statement. Roots do not detonate; a patch of
   * ground *becomes* grabby and stays that way, which is the same "switched on
   * rather than struck" the shape was cut for. Read against Campo de
   * Sobrecarga, the other torus: colour separates them, and direction says the
   * rest — that one energises what it catches and lifts, this one closes on it
   * and presses down.
   */
  entangling_roots: {
    shape: 'torus',
    ring: 0x9c7a3f,
    zone: 0x2d4a1e,
    motes: [0x8f6b3a, 0x4a7c2f, 0x243d19],
    moteCount: 20,
    direction: -1,
  },
  overload_field: {
    shape: 'torus',
    ring: 0xffd166,
    zone: 0xe2563c,
    motes: [0xfff3c4, 0xff8c42, 0xe2563c],
    moteCount: 24,
    direction: 1,
  },
  /*
   * The heaviest thing in the Tier 1 deck — five mana, an 18-damage tick every
   * half second over a radius of five — and the one cast that is allowed to
   * move the camera.
   */
  meteor_shower: {
    shape: 'column',
    ring: 0xffb703,
    zone: 0xd00000,
    motes: [0xffe066, 0xff6a2e, 0x9d0208],
    moteCount: 28,
    direction: -1,
    /*
     * Seven, over a second: the card's hazard lasts 1.5s and ticks three
     * times, so the rain has to outlast the first tick and stop before the
     * last. Seven rather than three, because the impacts a player counts are
     * not the ticks a player takes — a shower reads as weather, not as a
     * countdown.
     */
    impacts: 7,
    impactWindow: 1,
    /*
     * Scorched ground rather than a pool: a dull ember-red fill over a near
     * black burn, rimmed in the same amber the cast rings use. It has to read
     * as *hot* next to Praga's toxic green, since the two are the only ground
     * hazards in the deck and a player has to tell them apart at a glance.
     */
    hazard: { base: 0xe8632a, core: 0x5c1704, rim: 0xffb703 },
    trauma: 0.35,
  },
};

/**
 * An unknown card still gets a cast beat rather than nothing at all.
 *
 * Worth keeping even though every card in the catalog has a row today: the
 * Tier 2/3 cards land one commit at a time, and a card that is briefly
 * invisible on the field is a card whose rule looks broken in the trace panel.
 * `spellVfx.test.ts` is what stops this from becoming the silent default — a
 * new card must either bring its own row or be named in that test's allowlist.
 */
export const DEFAULT_SPELL_VFX: SpellVfx = {
  shape: 'burst',
  ring: 0xe6d1ff,
  zone: 0x9b5de5,
  motes: [0xe6d1ff, 0x9b5de5, 0x6a2fb0],
  moteCount: 18,
  direction: 1,
};

export function spellVfxFor(spellId: string): SpellVfx {
  return SPELL_VFX[spellId] ?? DEFAULT_SPELL_VFX;
}
