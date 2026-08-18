/**
 * The kit balance sweep (plano v1.3 §5, Fase 3).
 *
 * `scripts/ai-report.mts` answers "what did the Brain *do*" and keeps answering
 * it — that file is about movement, depth and objectives, and the pivot did not
 * touch any of them. This one answers the question the pivot made askable:
 * **does which mages you bring change how the match goes, and is any of them
 * carrying the match.**
 *
 * It exists because the program sweep it replaces measured one authored program
 * against another, and v1.3 retired both. A mage now spends its own kit, so the
 * unit of comparison is a squad, and the unit of blame is a body and a skill.
 *
 * **Volta B, passagem 1 — recorded here because a falsified dial is a result,
 * and the next reader will otherwise try it again.** `arcane_bard` sits at
 * 31.9% against the pool (n=1080 sides) and `arcane_archer` at 40.6% (n=540);
 * they are the only two mages carrying a two-skill kit, and they spend ~22
 * casts a side where three-skill kits spend 26-38. Every skill in the game runs
 * near its cooldown ceiling (`paranoia` goes off 11.8 times in a 150s match
 * against a ceiling of ~13), so cooldown is the dial that binds. Cutting the
 * bard's two — `bond_of_pain` 14→9, `paranoia` 11→7 — raised its throughput 36%
 * (`paranoia` 12757→16972 casts, `bond_of_pain` 10974→15482) and moved its win
 * rate from **31.9% to 32.1%**: three matches in 1080. Reverted. Throughput is
 * not what holds a two-skill kit back, and the next pass should reach for
 * magnitude or for the body, not for frequency.
 *
 * Two rules from §5.2 are baked into how the output reads:
 *
 * - **A skill with zero casts is never a balance finding.** It is a `when` /
 *   `range` / `at` finding. The report says so in place rather than printing a
 *   0% win rate that invites a buff.
 * - **The ~55% ceilings are reported, never asserted.** CI holds the floor
 *   (`sim/agency.test.ts`, `sim/kitUsage.test.ts`); a ceiling read off a dozen
 *   seeds would let a flake write a nerf. Volume lives here, out of `npm test`.
 *
 *   npx tsx scripts/kit-report.mts [--seeds N] [--only a,b,c] [--pool N]
 *
 * Sections: mirror, stance, matchup, loo, pool. Default runs all of them.
 */
import { Brain, type Difficulty } from '../sim/bot/Brain';
import type { Stance } from '../sim/abilityPolicy';
import { ALL_ROSTER, defaultSquad, rosterFor, rosterOwnerOf, type RosterId } from '../sim/cards';
import { SIM_DT } from '../sim/config';
import { TEAM_A, TEAM_B, type Team } from '../sim/entities';
import { Rng } from '../sim/rng';
import { validateSquad } from '../sim/squad';
import { ALL_SPELLS, spellFor, type SpellId } from '../sim/spells';
import { World } from '../sim/World';

/* ---- CLI -------------------------------------------------------------------- */

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const SEED_COUNT = flag('seeds', 12);
const POOL_SIZE = flag('pool', 10);
const onlyArg = process.argv.indexOf('--only');
const ONLY: string[] | null =
  onlyArg >= 0 ? (process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean) : null;
const runs = (section: string) => ONLY === null || ONLY.includes(section);

/**
 * A fixed ladder rather than 1..N: consecutive seeds start the Rng in adjacent
 * states, and the same command has to be reproducible across sessions for a
 * dial change to be readable against the run before it.
 */
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => i * 7 + 3);

/* ---- One match -------------------------------------------------------------- */

interface Side {
  readonly squad: readonly RosterId[];
  readonly stance: Stance;
}

const side = (squad: readonly RosterId[], stance: Stance = 'normal'): Side => ({ squad, stance });

interface MatchResult {
  winner: Team | null;
  elapsed: number;
  structuresLost: Record<Team, number>;
  /** Casts by the mage that spent them, tagged with when in the match they went off. */
  casts: { spellId: SpellId; team: Team; rosterId: RosterId | null; at: number }[];
}

function stancesOf(s: Side): Partial<Record<RosterId, Stance>> {
  return Object.fromEntries(s.squad.map((r) => [r, s.stance]));
}

function runMatch(seed: number, a: Side, b: Side): MatchResult {
  const world = new World();
  world.initSquad(TEAM_A, a.squad, stancesOf(a));
  world.initSquad(TEAM_B, b.squad, stancesOf(b));

  const casts: MatchResult['casts'] = [];
  world.onAbilityCast = (mageId, team, spellId) => {
    casts.push({ spellId, team, rosterId: world.mage(mageId)?.rosterId ?? null, at: world.elapsed });
  };

  const brain = new Brain(new Rng(seed));
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  let ticks = 0;
  while (!world.roundOver && ticks < 60 * 250) {
    brain.step(world, units, SIM_DT);
    world.step(SIM_DT);
    ticks++;
  }

  return {
    winner: world.winner,
    elapsed: world.elapsed,
    structuresLost: {
      [TEAM_A]: world.structuresDestroyedBy(TEAM_B),
      [TEAM_B]: world.structuresDestroyedBy(TEAM_A),
    },
    casts,
  };
}

/* ---- Tallies carried across every section ----------------------------------- */

interface SkillTally {
  casts: number;
  /** Matches this skill went off in at least once, and how many its side won. */
  matches: number;
  wins: number;
  /** §5.1's dump cut: was the kit emptied into the first cluster of the match? */
  earlyCasts: number;
}

const DUMP_WINDOW = 60;

const skillTally = new Map<SpellId, SkillTally>();
const mageTally = new Map<RosterId, { fielded: number; wins: number; draws: number }>();
let matchesPlayed = 0;
/** Matches that fed the cuts below — the same sample the draw rate is quoted over. */
let countedMatches = 0;
let draws = 0;

function tallyOf(id: SpellId): SkillTally {
  let t = skillTally.get(id);
  if (!t) skillTally.set(id, (t = { casts: 0, matches: 0, wins: 0, earlyCasts: 0 }));
  return t;
}

/**
 * Which section's matches are allowed into the two cuts at the bottom.
 *
 * The §5.1 ceiling is a statement about the *pool* — "in how many matches was
 * this mage on the winning side, against every legal quartet". Every other
 * section is a designed matchup: `loo` plays the default squad in all twenty
 * of its rows, `matchup` plays it against opponents the server would reject.
 * Folding those in would put the default squad's four bodies at the top of the
 * per-mage table by sample size alone, and call it a meta.
 *
 * So when the round robin runs, it is the only thing that counts. When it does
 * not, everything counts and the heading says so, because a cut off `--only
 * stance` is a sanity check, not a ceiling.
 */
const POOL_IS_THE_SAMPLE = runs('pool');
let inPool = false;

function record(r: MatchResult, a: Side, b: Side): void {
  matchesPlayed++;
  if (POOL_IS_THE_SAMPLE && !inPool) return;
  countedMatches++;
  if (r.winner === null) draws++;

  for (const [team, s] of [
    [TEAM_A, a],
    [TEAM_B, b],
  ] as const) {
    for (const rosterId of new Set(s.squad)) {
      const m = mageTally.get(rosterId) ?? { fielded: 0, wins: 0, draws: 0 };
      m.fielded++;
      if (r.winner === null) m.draws++;
      else if (r.winner === team) m.wins++;
      mageTally.set(rosterId, m);
    }
  }

  const firedBy = new Map<SpellId, Set<Team>>();
  for (const c of r.casts) {
    const t = tallyOf(c.spellId);
    t.casts++;
    if (c.at <= DUMP_WINDOW) t.earlyCasts++;
    let teams = firedBy.get(c.spellId);
    if (!teams) firedBy.set(c.spellId, (teams = new Set()));
    teams.add(c.team);
  }
  for (const [spellId, teams] of firedBy) {
    const t = tallyOf(spellId);
    for (const team of teams) {
      t.matches++;
      if (r.winner === team) t.wins++;
    }
  }
}

/**
 * Plays **every seed in both seats** and returns the left side's record.
 *
 * Not "alternating sides by seed index", which is what this function did first
 * and what reads as the same thing. It is not: alternating gives each seed one
 * arbitrary seat, so the map's bias only cancels if the seeds happen to be
 * exchangeable — and they are not. Measured, the mirror control (identical
 * squads through this exact path) came out **8-4 for the left label**, and the
 * same matchup run in the two argument orders disagreed with itself, 8-4
 * against 11-1. Every squad number read off that design was the spawn geometry
 * wearing a kit's name.
 *
 * Playing both seats of each seed makes the cancellation exact and pairs the
 * observations, which is also why a mirror through here is now 50% by
 * construction — the map-bias question moves to the `mirror` section, which is
 * the one place that deliberately does *not* swap seats.
 */
function headToHead(label: string, left: Side, right: Side): void {
  let leftWins = 0;
  let rightWins = 0;
  let drawn = 0;
  let leftLost = 0;
  let rightLost = 0;
  let leftCasts = 0;
  let rightCasts = 0;

  for (const seed of SEEDS) {
    for (const leftOnA of [true, false]) {
      const a = leftOnA ? left : right;
      const b = leftOnA ? right : left;
      const r = runMatch(seed, a, b);
      record(r, a, b);

      leftLost += r.structuresLost[leftOnA ? TEAM_A : TEAM_B];
      rightLost += r.structuresLost[leftOnA ? TEAM_B : TEAM_A];
      for (const c of r.casts) {
        if (c.team === (leftOnA ? TEAM_A : TEAM_B)) leftCasts++;
        else rightCasts++;
      }

      if (r.winner === null) drawn++;
      else if (r.winner === (leftOnA ? TEAM_A : TEAM_B)) leftWins++;
      else rightWins++;
    }
  }

  const games = SEEDS.length * 2;
  const decided = leftWins + rightWins;
  const rate = decided > 0 ? (leftWins / decided) * 100 : NaN;
  console.log(
    `  ${label.padEnd(40)} ${String(leftWins).padStart(3)}-${String(rightWins).padEnd(3)} ` +
      `${Number.isNaN(rate) ? ' n/a' : rate.toFixed(0).padStart(3)}%  ` +
      `draws ${drawn}  structures lost ${leftLost}/${rightLost}  ` +
      `casts ${leftCasts}/${rightCasts}  (n=${games})`,
  );
}

/* ---- Squad pool ------------------------------------------------------------- */

/**
 * Every quartet `validateSquad` accepts: four distinct mages, at least one of
 * each role. That is the same gate `server/src/App.ts` puts in front of a real
 * match, so the pool is exactly the set of squads a player can actually bring —
 * which is the only set a meta can form in.
 */
function legalQuartets(): RosterId[][] {
  const out: RosterId[][] = [];
  const n = ALL_ROSTER.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let l = k + 1; l < n; l++) {
          const q = [ALL_ROSTER[i], ALL_ROSTER[j], ALL_ROSTER[k], ALL_ROSTER[l]];
          // Asked of the rule the server enforces, never a second copy of it.
          if (validateSquad(q).ok) out.push(q);
        }
  return out;
}

/**
 * A subset of the legal quartets chosen to field every mage as evenly as it can.
 *
 * Even spacing through the list was the obvious first cut and it is a trap: the
 * quartets come out in catalog order, so a slice of ten gave `alchemist` a
 * single appearance against `cleric`'s six. Its 85% then read as a ceiling
 * breach when it was one quartet's record wearing a mage's name.
 *
 * Greedy on the rarest mage instead — repeatedly take the quartet that most
 * helps whoever is currently least fielded. Deterministic (ties fall to catalog
 * order), so the same `--pool N` is the same pool run to run, which is what
 * makes a dial's before and after comparable at all.
 */
function samplePool(all: RosterId[][], size: number): RosterId[][] {
  if (size >= all.length) return all;

  const seen = new Map<RosterId, number>(ALL_ROSTER.map((r) => [r, 0]));
  const remaining = [...all];
  const out: RosterId[][] = [];

  while (out.length < size && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (const [i, q] of remaining.entries()) {
      // Worth of a quartet = how much it helps the mages currently behind.
      const score = q.reduce((sum, r) => sum - (seen.get(r) ?? 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    for (const r of picked) seen.set(r, (seen.get(r) ?? 0) + 1);
    out.push(picked);
  }

  return out;
}

/* ---- Sections --------------------------------------------------------------- */

const started = Date.now();
console.log(`kit report · seeds ${SEEDS.length} · pool ${POOL_SIZE}\n`);

if (runs('mirror')) {
  /*
   * The one cut that must *not* alternate sides. Every other section swaps the
   * seats precisely so the map's bias cancels; here the map's bias is the whole
   * measurement, so the same squad plays A against itself on B and the raw
   * seat record is the answer. Far from 50% means the spawn geometry — not any
   * kit — is deciding matches, and every number below it inherits that.
   */
  console.log('— mirror (same squad both seats; far from 50% is map bias, not kit) —');
  let aWins = 0;
  let bWins = 0;
  let mirrorDraws = 0;
  for (const seed of SEEDS) {
    const a = side(defaultSquad());
    const b = side(defaultSquad());
    const r = runMatch(seed, a, b);
    record(r, a, b);
    if (r.winner === null) mirrorDraws++;
    else if (r.winner === TEAM_A) aWins++;
    else bWins++;
  }
  const decided = aWins + bWins;
  console.log(
    `  ${'seat A vs seat B'.padEnd(40)} ${String(aWins).padStart(3)}-${String(bWins).padEnd(3)} ` +
      `${decided > 0 ? ((aWins / decided) * 100).toFixed(0).padStart(3) : ' n/a'}%  ` +
      `draws ${mirrorDraws}  (n=${SEEDS.length})`,
  );
  console.log();
}

if (runs('stance')) {
  console.log('— stance (§5.1: 50% means posture was noise) —');
  const d = defaultSquad();
  headToHead('normal vs hold', side(d, 'normal'), side(d, 'hold'));
  headToHead('aggressive vs hold', side(d, 'aggressive'), side(d, 'hold'));
  headToHead('aggressive vs normal', side(d, 'aggressive'), side(d, 'normal'));
  console.log();
}

if (runs('matchup')) {
  /*
   * Both opponents here are squads `validateSquad` **rejects** — they double a
   * body and they skip a role, and the server checks that before a match. They
   * are degenerate baselines on purpose: "a squad with no way to hurt anything"
   * is the floor `sim/agency.test.ts` measures agency against, and it has to be
   * unbuildable to be a floor.
   *
   * That is also the correction this section exists to make. The all-tank
   * result was pinned as an open *balance* debt, and it is not one: no player
   * can field it, so it cannot be anyone's meta. What it measures is the sim
   * behind the role rule — durability plus `prefersStructures` plus a tank's
   * zero retreat threshold — and the role rule is what already prices it.
   */
  console.log('— named baselines (both ILLEGAL under `validateSquad`; floors, not comps) —');
  const d = defaultSquad();
  for (const [label, squad] of [
    ['balanced vs all-tank', ['stone_golem', 'stone_golem', 'ice_sentinel', 'ice_sentinel']],
    ['balanced vs no-damage', ['cleric', 'cleric', 'arcane_bard', 'arcane_bard']],
  ] as [string, RosterId[]][]) {
    const check = validateSquad(squad);
    console.log(`  (${label}: opponent rejected — ${check.ok ? 'legal?!' : check.reason})`);
    headToHead(label, side(d), side(squad));
  }
  console.log();
}

if (runs('loo')) {
  console.log('— leave-one-out (default with one slot swapped; ~50% means the slot is cosmetic) —');
  const d = defaultSquad();
  for (const [slot, held] of d.entries()) {
    const role = rosterFor(held)!.role;
    for (const alt of ALL_ROSTER) {
      if (alt === held || rosterFor(alt)!.role !== role) continue;
      const variant = d.map((r, i) => (i === slot ? alt : r));
      // Same-role substitution can still land on a body the squad already
      // holds, and `validateSquad` forbids duplicates. Reporting one would put
      // a win rate on a squad the server refuses to start.
      if (!validateSquad(variant).ok) continue;
      headToHead(`${held} → ${alt}`, side(variant), side(d));
    }
  }
  console.log();
}

if (runs('pool')) {
  const all = legalQuartets();
  const pool = samplePool(all, POOL_SIZE);
  console.log(
    `— round robin (${pool.length} of ${all.length} legal quartets, ` +
      `${(pool.length * (pool.length - 1)) / 2} pairings) —`,
  );
  // The per-mage cut below is worth exactly what this line says it is: a mage
  // in one quartet has that quartet's record, not its own.
  const appearances = new Map<RosterId, number>(ALL_ROSTER.map((r) => [r, 0]));
  for (const q of pool) for (const r of q) appearances.set(r, (appearances.get(r) ?? 0) + 1);
  console.log(
    `  quartets per mage: ${ALL_ROSTER.map((r) => `${r} ${appearances.get(r)}`).join(' · ')}`,
  );
  inPool = true;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (const seed of SEEDS) {
        // Both seats, for the same reason `headToHead` plays both.
        for (const leftOnA of [true, false]) {
          const a = side(leftOnA ? pool[i] : pool[j]);
          const b = side(leftOnA ? pool[j] : pool[i]);
          const r = runMatch(seed, a, b);
          record(r, a, b);
        }
      }
    }
  }
  inPool = false;
  console.log(`  played ${matchesPlayed} matches so far\n`);
}

/* ---- The two cuts every section feeds --------------------------------------- */

const sampleNote = POOL_IS_THE_SAMPLE
  ? 'round robin only'
  : 'every section — designed matchups, NOT a ceiling';
console.log(`— per mage (§5.1 ceiling ~55% / floor ~45%; sample: ${sampleNote}) —`);
const rate = (t: { wins: number; fielded: number; draws: number }) =>
  t.fielded - t.draws > 0 ? t.wins / (t.fielded - t.draws) : 0;
for (const [id, t] of [...mageTally.entries()].sort((x, y) => rate(y[1]) - rate(x[1]))) {
  const decided = t.fielded - t.draws;
  const pct = decided > 0 ? (t.wins / decided) * 100 : NaN;
  const flagged = decided >= 20 && (pct > 55 || pct < 45) ? '  ⚠' : '';
  console.log(
    `  ${id.padEnd(16)} ${Number.isNaN(pct) ? ' n/a' : pct.toFixed(1).padStart(5)}%  ` +
      `(${t.wins}/${decided} decided, ${t.draws} draws, fielded ${t.fielded})${flagged}`,
  );
}

/*
 * `matches` counts *sides*, not matches: a skill both squads spend is one match
 * that contributes a win and a loss, which is what makes 50% the neutral
 * reading. Anything near 100 or 0 is the §5.1 flag — but only once `casts` is
 * large enough that the skill is actually being spent.
 */
console.log(`\n— per skill (win% is over the sides that spent it; 0 casts is a \`when\`/range finding, never a number one) —`);
const rows = ALL_SPELLS.map((id) => {
  const t = skillTally.get(id) ?? { casts: 0, matches: 0, wins: 0, earlyCasts: 0 };
  return { id, cost: spellFor(id)?.cost ?? 0, owner: rosterOwnerOf(id) ?? '—', ...t };
}).sort((a, b) => a.cost - b.cost || b.casts - a.casts);

let lastCost = -1;
for (const r of rows) {
  if (r.cost !== lastCost) {
    lastCost = r.cost;
    console.log(`  cost ${r.cost}`);
  }
  const winPct = r.matches > 0 ? ((r.wins / r.matches) * 100).toFixed(0).padStart(3) + '%' : ' n/a';
  const dump = r.casts > 0 ? ((r.earlyCasts / r.casts) * 100).toFixed(0).padStart(3) + '%' : '  —';
  const note = r.casts === 0 ? '  ⚠ never cast — fix `when`/range, not damage' : '';
  console.log(
    `    ${r.id.padEnd(22)} ${String(r.casts).padStart(6)} casts  win ${winPct} of ${String(r.matches).padStart(4)} sides  ` +
      `first ${DUMP_WINDOW}s ${dump}  [${r.owner}]${note}`,
  );
}

console.log(
  `\n=== ${matchesPlayed} matches played · ${countedMatches} in the sample above · ` +
    `draws ${draws} (${((draws / Math.max(1, countedMatches)) * 100).toFixed(1)}% of the sample) · ` +
    `${((Date.now() - started) / 1000).toFixed(0)}s ===`,
);
