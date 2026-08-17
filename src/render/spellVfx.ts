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
  | 'torus'
  /**
   * Voxel roots shoving out of the soil across the disc, holding, then
   * withdrawing — the only shape whose body outlives the cast beat. See
   * {@link SpellVfx.persist}.
   */
  | 'roots'
  /** A bolt out of an open sky onto the spot, with a white flash under it. */
  | 'strike'
  /**
   * Everything in the disc pulled inward and put out — the only beat that
   * *converges*. See {@link SpellVfx.direction}, which this shape ignores:
   * a card that takes things away has no good news and no bad news to press.
   */
  | 'flash'
  /**
   * Jets of burning rock thrown *up* out of the ground, after a warning. The
   * mirror of `column`, which arrives from above — and the only shape that is
   * preceded by anything, since it is the only one whose card is late.
   */
  | 'pillars';

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
   * `column` and `pillars` only: how many separate impacts land, and over how
   * many seconds they are spread. One falls out of the sky and the other comes
   * up out of the floor; the distribution question is the same either way, and
   * so is {@link planColumnFall}, which answers it.
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
   * **Drawn since Erupção Vulcânica**, which is the card the trap was set for.
   * It is the life of the ground disc — the shared footprint every cast draws
   * becomes the warning rather than a second thing layered over it — plus a
   * ring pulsing at the same spot on a beat, so the wait reads as a count
   * rather than as a card that failed to go off.
   */
  telegraph?: number;
  /**
   * `roots` only: how long the growth stays on the field, in seconds.
   *
   * Every other beat here is an *arrival* — it happens, it fades, and what the
   * card did afterwards is carried by the status ring on the mage. Raízes
   * Entrelaçadas has no such ring to lean on: a rooted mage looks exactly like
   * a standing one, and the only thing on screen saying "this one cannot walk"
   * is the ground it is standing in. So this should be set to the card's own
   * `duration` from `balance.json` — roots that let go before the sim does are
   * a lie of the same species as a telegraph the sim never honours.
   */
  persist?: number;
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
  /*
   * A torus, and the name is the argument: consecrated *ground*. The card does
   * not arrive and leave, it switches a patch of field on for four seconds and
   * everything standing there is better off — which is the one sentence this
   * shape exists to say. Escudo Arcano next to it is a dome because a shield is
   * a thing around a body; this is a thing under one.
   *
   * The other torus in the catalog is Raízes Entrelaçadas, and direction is
   * what parts them: roots close and press down, this opens and lifts.
   */
  consecrated_ground: {
    shape: 'torus',
    ring: 0xffd97d,
    zone: 0xd9c68a,
    motes: [0xfff4d6, 0xffd97d, 0xd9a441],
    moteCount: 24,
    direction: 1,
  },
  /*
   * Vínculo da Dor's mirror, and it borrows that card's burst deliberately —
   * same tight shape, same waist-high thread on the bodies afterwards, lifting
   * where the black one falls. The two cards do the same thing to a squad
   * standing together and mean opposite things by it, and a player should be
   * able to see that without being told.
   *
   * Direction is the whole read here, so the palette stays inside white's own
   * warm gold rather than reaching for a second idea.
   */
  bond_of_solidarity: {
    shape: 'burst',
    ring: 0xfff4d6,
    zone: 0x8a6b2a,
    motes: [0xfff4d6, 0xffd97d, 0xd9a441],
    moteCount: 20,
    direction: 1,
  },
  /*
   * White's fourth, and the loudest thing white owns. The other three are
   * quiet by design — a triad, a dome snapping shut, a slow swell — because
   * what they do is protect. This one is an order being given over the spot
   * where a squad was wiped, and it is the only white card that should read as
   * a *demand*.
   *
   * A torus rather than a burst, and lifting, which puts it in Solo
   * Consagrado's family: both switch a patch of field on rather than throwing
   * something at it. The radius is five where that one is four, because this is
   * the card looking for bodies, and the widest disc in white is how it says so.
   */
  call_to_battle: {
    shape: 'torus',
    ring: 0xfff1c9,
    zone: 0xb08728,
    motes: [0xffffff, 0xffe08a, 0xd9a441],
    moteCount: 26,
    direction: 1,
  },
  /*
   * Blue's first card, in a colour the field has never shown — Maldição da
   * Lentidão is drawn blue but belongs to the black deck, so this is the first
   * time the palette and the deck agree.
   *
   * A dome, because what the card does is put a body inside something. Escudo
   * Arcano's dome protects what it covers and so, awkwardly and deliberately,
   * does this one: petrify makes its victim untouchable. Reading the same is
   * the honest outcome, and direction is what stops them being confused — the
   * shield lifts, the stone presses down and holds.
   */
  petrify: {
    shape: 'dome',
    ring: 0x9aa5b1,
    zone: 0x39404a,
    motes: [0xc7ced6, 0x7d8894, 0x4a525c],
    moteCount: 16,
    direction: -1,
  },
  /*
   * Blue's second card, and the only shape in the catalog that arrives from
   * *outside* the arena. Every other beat happens on the ground the cards are
   * played on; a strike comes down through the roof, which is what buys it the
   * right to be the loudest thing on screen for a tenth of a second.
   *
   * Read against Chuva de Meteoros, the other card that falls: that one is seven
   * bodies over a second, weather rather than an event. This is one arrival,
   * once — the difference between a bombardment and a verdict.
   */
  thunderstrike: {
    shape: 'strike',
    ring: 0x00f0ff,
    zone: 0x1b2a6b,
    motes: [0xffffff, 0x8ce8ff, 0xe0a0ff],
    moteCount: 18,
    direction: -1,
    // The one card besides the meteor allowed to move the camera, and less than
    // it: a bolt is sharp rather than heavy, and the shake should read as a
    // flinch, not as a landslide.
    trauma: 0.22,
  },
  /*
   * The one card whose *effect* needs no drawing at all, which is why it gets
   * no persistent body here. A vortex is three seconds of every mage in the
   * disc sliding toward one point — the field itself is the readout, and it is
   * a louder one than any ring could be. Compare Raízes Entrelaçadas, which had
   * to grow a whole persistent shape precisely because a rooted mage looks
   * identical to a standing one.
   *
   * So the beat only marks the place, and it marks it as a thing switched on:
   * a torus, pressed down, in a cold violet that reads as pressure rather than
   * as damage. Nothing here hurts anybody.
   */
  gravity_well: {
    shape: 'torus',
    ring: 0xc8b6ff,
    zone: 0x241a4a,
    motes: [0xe6dcff, 0x9b8cff, 0x4a3a8c],
    moteCount: 26,
    direction: -1,
  },
  /*
   * A dome, and the odd one out in that family: Escudo Arcano and Brisa
   * Rejuvenescedora put a shell over people who are already there, and this one
   * is the shell people arrive *inside*. Reading the same is fine and even
   * useful — all three are white-blue things that close over your own squad —
   * because what tells them apart is what happens next, and what happens next
   * here is four bodies appearing.
   *
   * The palette is the coldest in the catalog on purpose. This is the only card
   * that touches space rather than bodies, and it should not look like weather,
   * fire or growth.
   */
  spatial_fold: {
    shape: 'dome',
    ring: 0xbfe9ff,
    zone: 0x1b2a4a,
    motes: [0xffffff, 0x9fd6ff, 0x5f7ad6],
    moteCount: 20,
    direction: 1,
  },
  /*
   * The only card in the catalog that does nothing to anybody. It changes a
   * number the field cannot show, over twelve seconds nobody will connect to
   * this beat unless the beat says "this one is not about the fight".
   *
   * So it is a torus like Solo Consagrado — an area switched on rather than
   * struck — but the palette is the mana bar's own cyan rather than a spell
   * colour, and the motes lift and keep lifting. It should read as *supply*,
   * which is the one thing no other card in the deck is about.
   */
  mana_flow: {
    shape: 'torus',
    ring: 0x9df9ff,
    zone: 0x0b3d5c,
    motes: [0xe6ffff, 0x63d8f0, 0x2a7fa8],
    moteCount: 22,
    direction: 1,
  },
  /*
   * Blue's third, and the first card in the catalog whose beat has to say
   * something *negative* — not "you are hurt" or "you are held", but "what was
   * here is gone". Every other shape in the table is an arrival. This one is a
   * subtraction, so it is the only one that moves inward: motes off the rim,
   * pulled to the middle, put out.
   *
   * Near-white on a cold void, because it is also the one card that touches
   * both squads without favouring either — a colour that read as *blue*
   * strongly enough would say "the blue player did this to you", and half of
   * what this card does, it does to its own side.
   */
  null_flash: {
    shape: 'flash',
    ring: 0xf2fbff,
    zone: 0x141a2e,
    motes: [0xffffff, 0xcfe8ff, 0x8aa6c8],
    moteCount: 22,
    // Ignored by the shape, which converges; kept honest rather than absent
    // because the field is not optional and a lie here would outlive the shape.
    direction: -1,
  },
  /*
   * The card that would most like to be the `link` shape, and cannot be: the
   * honest drawing is a thread between two bodies, and `SpellCast` carries a
   * centre and a radius rather than two ends. Rather than invent a payload for
   * one card, the connection is carried on the mages themselves — a red thread
   * unspooling off every bound body (`effectVfx.ts`), which is the only thing
   * in that table that ever shows up on four bodies at once.
   *
   * So the cast beat only has to say *where the web was thrown*: a tight burst,
   * pressed down, in a red dark enough to be told apart from Frenesi
   * Sanguinário — the other card that paints a squad red, and means the
   * opposite by it.
   */
  bond_of_pain: {
    shape: 'burst',
    ring: 0xd62839,
    zone: 0x2a0308,
    motes: [0xd62839, 0x8b0d1f, 0x3d0a12],
    moteCount: 20,
    direction: -1,
  },
  /*
   * Black's second card, against a first (Maldição da Lentidão) that is drawn
   * blue for historical reasons — so this is the first time the deck's colour
   * reaches the field. Nearly black, with a bruised violet on it.
   *
   * A `flash` like Clarão Nulo, and the pairing is honest rather than lazy:
   * both are cards that *take something out of the disc*. The blue one takes
   * the effects, this one takes the blood. What separates them at a glance is
   * temperature — one is white on a cold void, this is violet on tar.
   */
  dark_tribute: {
    shape: 'flash',
    ring: 0x9d4edd,
    zone: 0x10060f,
    motes: [0xc77dff, 0x7b2cbf, 0x3c096c],
    moteCount: 18,
    direction: -1,
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
   * A dome, which makes it Escudo Arcano's sibling rather than Praga's — and
   * that is the right family. Both are cast over your own squad and both leave
   * something standing there afterwards; what separates them is colour, not
   * form. The alternative was a fourth green burst, which would have put it in
   * the same shape as the card that poisons a crowd.
   */
  rejuvenating_breeze: {
    shape: 'dome',
    ring: 0xcdefa0,
    zone: 0x7fc06a,
    motes: [0xeaffd0, 0xa8e06a, 0x6fb04a],
    moteCount: 22,
    direction: 1,
  },
  /*
   * The other green card with a body that outlives its cast, and the only card
   * in the catalog whose effect is a *thing standing there*. It reuses the
   * `roots` machinery for exactly that reason: voxels shoving up out of the
   * soil, holding for the card's duration, withdrawing when it ends — which is
   * a description of both cards, and here it is not a stand-in for an invisible
   * status but a picture of the actual wall.
   *
   * Pale blue-green and much brighter than the roots, because these two are the
   * green pair a player has to tell apart instantly: one is ground you can walk
   * out of slowly, the other is ground you cannot walk through at all.
   */
  crystal_rift: {
    shape: 'roots',
    ring: 0x9df0ff,
    zone: 0x123a3d,
    motes: [0xd6ffff, 0x6fe3d2, 0x2a7f76],
    moteCount: 22,
    direction: 1,
    // The card's own duration in balance.json. Held to it by spellVfx.test.ts.
    persist: 5,
  },
  /*
   * The card that earned the fifth shape, and it went through a torus first.
   *
   * The torus was the tidy answer — "an area was switched on" is true of a
   * patch of grabby ground — and it was wrong for one reason no amount of
   * palette fixes: this is the only card in the catalog whose *effect has no
   * tell on the body*. A slowed mage moves visibly slowly, a burning one sheds
   * embers, a shielded one wears a dome. A rooted mage looks exactly like a
   * mage standing still, which mages do constantly. So the beat is not allowed
   * to be an arrival that fades; the only thing on screen that can say "this
   * one cannot walk" is the ground it is standing in, and it has to still be
   * there two seconds later when the player looks over.
   *
   * Hence `roots`: voxel branches shoving out of the soil across the disc,
   * blood-red blooms opening along them, holding for the card's own duration
   * and then withdrawing toward the centre. Grown from the reference the user
   * built (`jardim_voxel_rapido`), cut down hard for a three-metre disc under a
   * squad — twelve branches instead of forty, nine steps instead of fifty, and
   * a knee-height ceiling so the cubes never hide the bodies the player is
   * watching to read his own program.
   */
  entangling_roots: {
    shape: 'roots',
    ring: 0xff0022,
    zone: 0x1a2b1a,
    motes: [0x8f6b3a, 0x4a7c2f, 0x243d19],
    moteCount: 20,
    direction: -1,
    // The card's own duration in balance.json. Held to it by spellVfx.test.ts.
    persist: 2,
  },
  /*
   * The quietest beat in the catalog, and on purpose. A mark is not an event —
   * nothing happens when it lands, which is exactly the card's bargain: you pay
   * three mana now for damage that only exists if the target is already dying.
   * A loud flash would promise a hit that did not occur.
   *
   * So: few motes, pressed down, no ground disc worth the name. It is the one
   * red card that should read as bookkeeping rather than as violence.
   */
  executioners_mark: {
    shape: 'burst',
    ring: 0xd62839,
    zone: 0x3d0a12,
    motes: [0xff8fa3, 0xd62839, 0x6a040f],
    moteCount: 14,
    direction: -1,
  },
  /*
   * A burst, and red's only one. The two reds it sits between are a torus that
   * switches an area on and a column that drops rocks on it; this is neither —
   * it is a thing that happens *to the squad standing here*, once, and then
   * they go and do something about it. Direction lifts, because for once the
   * red card is good news for whoever it caught.
   */
  blood_frenzy: {
    shape: 'burst',
    ring: 0xff5c5c,
    zone: 0x7a1020,
    motes: [0xffb3b3, 0xe63946, 0x8b0d1f],
    moteCount: 24,
    direction: 1,
  },
  /*
   * The mirror of Chuva de Meteoros, which is the card it has to be told apart
   * from at a glance: both are red, both are five mana, both scatter several
   * impacts over a disc. That one comes down through the roof and the reading
   * is *weather* — it is already happening when you notice it. This one comes
   * up out of the floor, and the floor tells you first.
   *
   * The warning is what the card is buying: a second and a bit in which the
   * disc is lit and nothing has happened yet is the only moment in this game
   * where a player watches the field knowing exactly what is about to occur
   * there. Everything else resolves the instant a rule fires.
   *
   * Five jets rather than seven, over a third of a second rather than a whole
   * one: an eruption is one event with several mouths, where a shower is many
   * events. Same arithmetic underneath (`planColumnFall`), different reading.
   */
  volcanic_eruption: {
    shape: 'pillars',
    ring: 0xff7a1f,
    zone: 0x8b1a06,
    motes: [0xffd166, 0xff6a2e, 0x7a0e02],
    moteCount: 24,
    direction: -1,
    impacts: 5,
    impactWindow: 0.35,
    /*
     * The card's own `delay` in balance.json, both directions asserted — and
     * the number is what it is because of the *sound*. A cast may not ring for
     * longer than the global cooldown (0.75s, `spellVfx.test.ts`), so a warning
     * of a second and a half would have had the rupture land in silence: the
     * swell would end, the screen would erupt, and nothing would be heard. A
     * card whose whole idea is "you can see this coming" cannot afford to be
     * the one card that arrives unannounced.
     */
    telegraph: 0.7,
    /*
     * The third card allowed to move the camera, and the first that shakes it
     * from *underneath*. The other two arrive from outside the arena, which was
     * the old line — this one redraws it as "a card whose weight is the point".
     * Between the two: heavier than a bolt, lighter than a sky full of rock.
     */
    trauma: 0.28,
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
