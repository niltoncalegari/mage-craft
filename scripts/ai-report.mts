/**
 * Headless AI-vs-AI behaviour report (GDD §14's harness, pointed at the *Brain*
 * rather than at balance).
 *
 * `sim/agency.test.ts` answers "who won". This answers "what did they actually
 * do all match" — which action each squad spent its time in, how deep it ever
 * pushed, and how many Tower bolts it stood in front of. Those are the numbers
 * that say whether the AI has a plan or is just trading shots in midfield.
 *
 *   npx tsx scripts/ai-report.mts [seeds...]
 */
import { Brain, type Difficulty } from '../sim/bot/Brain';
import { Commander } from '../sim/bot/Commander';
import { Tactician } from '../sim/bot/Tactician';
import { defaultSquad } from '../sim/cards';
import { SIM_DT } from '../sim/config';
import { Deck, defaultDeck } from '../sim/Deck';
import { TEAM_A, TEAM_B, type Team } from '../sim/entities';
import { Rng } from '../sim/rng';
import { defaultStrategy, emptyStrategy, type Strategy } from '../sim/strategy';
import { flatProgram, naiveProgram, responsiveProgram } from '../sim/strategyPresets';
import { World } from '../sim/World';

const SEEDS = process.argv.slice(2).map(Number).filter(Number.isFinite);
const seeds = SEEDS.length > 0 ? SEEDS : [1, 3, 7, 11, 13, 23, 29, 47, 77, 91, 101, 2024];
const MAX_TICKS = 60 * 250;

interface TeamStats {
  actions: Map<string, number>;
  /** Sum over ticks of the deepest living mage's push into enemy ground. */
  depthSum: number;
  depthTicks: number;
  maxDepth: number;
  /** Tower bolts this team's own Towers fired (i.e. damage the *enemy* ate). */
  towerShots: number;
  deaths: number;
  structuresTaken: number;
}

function emptyStats(): TeamStats {
  return {
    actions: new Map(),
    depthSum: 0,
    depthTicks: 0,
    maxDepth: -Infinity,
    towerShots: 0,
    deaths: 0,
    structuresTaken: 0,
  };
}

function runMatch(seed: number) {
  const rng = new Rng(seed);
  const world = new World();
  world.initSquad(TEAM_A, defaultSquad());
  world.initSquad(TEAM_B, defaultSquad());

  const brain = new Brain(rng);
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  const commanders: Record<Team, { c: Commander; d: Deck }> = {
    [TEAM_A]: { c: new Commander(new Rng(seed), 'normal'), d: new Deck(defaultDeck(), new Rng(seed + 1)) },
    [TEAM_B]: { c: new Commander(new Rng(seed + 5), 'normal'), d: new Deck(defaultDeck(), new Rng(seed + 6)) },
  };

  const stats: Record<Team, TeamStats> = { [TEAM_A]: emptyStats(), [TEAM_B]: emptyStats() };
  const seenProjectiles = new Set<string>();
  const wasAlive = new Map<string, boolean>();
  for (const m of world.mages.values()) wasAlive.set(m.id, true);

  let ticks = 0;
  while (!world.roundOver && ticks < MAX_TICKS) {
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const side = commanders[team];
      const intent = side.c.step(world, team, side.d, SIM_DT);
      if (!intent) continue;
      if (world.castSpell(team, intent.cardId, intent.position).ok) side.d.play(intent.cardId);
    }

    brain.step(world, units, SIM_DT);
    world.step(SIM_DT);
    ticks++;

    // Which action is each squad living in?
    for (const [id, st] of brain.states) {
      const m = world.mage(id);
      if (!m?.alive) continue;
      const a = stats[m.team].actions;
      a.set(st.last.action, (a.get(st.last.action) ?? 0) + 1);
    }

    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const forward = team === TEAM_A ? 1 : -1;
      let deepest = -Infinity;
      for (const m of world.mages.values()) {
        if (m.team !== team || !m.alive) continue;
        deepest = Math.max(deepest, m.position.x * forward);
      }
      if (deepest > -Infinity) {
        stats[team].depthSum += deepest;
        stats[team].depthTicks++;
        stats[team].maxDepth = Math.max(stats[team].maxDepth, deepest);
      }
    }

    for (const p of world.projectiles.values()) {
      if (seenProjectiles.has(p.id)) continue;
      seenProjectiles.add(p.id);
      if (p.ownerId.startsWith('tower-')) stats[p.team].towerShots++;
    }

    for (const m of world.mages.values()) {
      if (wasAlive.get(m.id) && !m.alive) stats[m.team].deaths++;
      wasAlive.set(m.id, m.alive);
    }
  }

  stats[TEAM_A].structuresTaken = world.structuresDestroyedBy(TEAM_A);
  stats[TEAM_B].structuresTaken = world.structuresDestroyedBy(TEAM_B);

  // How much of a Tower the squad actually managed to remove — the number that
  // separates "walked to the objective" from "broke the objective".
  const worst: Record<Team, number> = { [TEAM_A]: 0, [TEAM_B]: 0 };
  for (const s of world.structures.values()) {
    if (s.kind !== 'tower') continue;
    const attacker: Team = s.team === TEAM_A ? TEAM_B : TEAM_A;
    worst[attacker] = Math.max(worst[attacker], 1 - s.health / s.maxHealth);
  }

  return { winner: world.winner, ticks, elapsed: world.elapsed, stats, worst };
}

const totals: Record<Team, TeamStats> = { [TEAM_A]: emptyStats(), [TEAM_B]: emptyStats() };
let wins = { a: 0, b: 0, draw: 0 };

for (const seed of seeds) {
  const r = runMatch(seed);
  if (r.winner === TEAM_A) wins.a++;
  else if (r.winner === TEAM_B) wins.b++;
  else wins.draw++;

  for (const team of [TEAM_A, TEAM_B] as Team[]) {
    const s = r.stats[team];
    const t = totals[team];
    for (const [k, v] of s.actions) t.actions.set(k, (t.actions.get(k) ?? 0) + v);
    t.depthSum += s.depthSum;
    t.depthTicks += s.depthTicks;
    t.maxDepth = Math.max(t.maxDepth, s.maxDepth);
    t.towerShots += s.towerShots;
    t.deaths += s.deaths;
    t.structuresTaken += s.structuresTaken;
  }

  console.log(
    `seed ${String(seed).padStart(5)} · ${r.elapsed.toFixed(0).padStart(3)}s · ` +
      `winner ${r.winner === null ? 'draw' : r.winner === TEAM_A ? 'A' : 'B'} · ` +
      `structures A${r.stats[TEAM_A].structuresTaken}-B${r.stats[TEAM_B].structuresTaken} · ` +
      `maxdepth A${r.stats[TEAM_A].maxDepth.toFixed(1)}/B${r.stats[TEAM_B].maxDepth.toFixed(1)} · ` +
      `towerShots A${r.stats[TEAM_A].towerShots}/B${r.stats[TEAM_B].towerShots} · ` +
      `best tower dmg A${(r.worst[TEAM_A] * 100).toFixed(0)}%/B${(r.worst[TEAM_B] * 100).toFixed(0)}%`,
  );
}

console.log(`\n=== ${seeds.length} matches ===`);
console.log(`A ${wins.a} · B ${wins.b} · draws ${wins.draw}  (draw rate ${((wins.draw / seeds.length) * 100).toFixed(0)}%)`);

for (const team of [TEAM_A, TEAM_B] as Team[]) {
  const t = totals[team];
  const total = [...t.actions.values()].reduce((a, b) => a + b, 0) || 1;
  const mix = [...t.actions.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} ${((v / total) * 100).toFixed(1)}%`)
    .join(' · ');
  console.log(`\nteam ${team === TEAM_A ? 'A' : 'B'}`);
  console.log(`  action mix: ${mix}`);
  console.log(`  avg push depth: ${(t.depthSum / Math.max(1, t.depthTicks)).toFixed(2)} (max ${t.maxDepth.toFixed(1)})`);
  console.log(`  own towers fired: ${t.towerShots} bolts (${(t.towerShots * 10).toLocaleString()} dmg offered to the enemy)`);
  console.log(`  deaths: ${t.deaths} · structures taken: ${t.structuresTaken}`);
}

/* ---- Program against program ------------------------------------------------ */

/**
 * The second half of the report, and the one the idle pivot made necessary.
 *
 * Everything above measures the `Brain` — how the mages fight, which is the
 * same on both sides by construction. Since the pivot the *player's* half of
 * the game is the program they authored, so the balance question moved: not
 * "does this card win" but "does a better program win". `agency.test.ts`
 * asserts a floor under that; this reports where the number actually sits,
 * which is what a floor cannot tell you.
 *
 * The draw rate is the GDD §14 health metric. Two good programs drawing half
 * the time is the failure mode that reads to a player as "my decisions do not
 * matter" — the same symptom as an agency failure, by a different cause.
 */
interface Program {
  readonly name: string;
  readonly strategy: Strategy;
}

const PROGRAMS: readonly Program[] = [
  { name: 'padrão', strategy: defaultStrategy(defaultDeck()) },
  { name: 'responsiva', strategy: responsiveProgram() },
  { name: 'plana', strategy: flatProgram() },
  { name: 'ingênua', strategy: naiveProgram() },
  { name: 'vazia', strategy: emptyStrategy() },
];

interface Record_ {
  wins: number;
  losses: number;
  draws: number;
  casts: number;
}

function emptyRecord(): Record_ {
  return { wins: 0, losses: 0, draws: 0, casts: 0 };
}

function runStrategyMatch(seed: number, byTeam: Record<Team, Strategy>) {
  const rng = new Rng(seed);
  const world = new World();
  world.initSquad(TEAM_A, defaultSquad());
  world.initSquad(TEAM_B, defaultSquad());

  const brain = new Brain(rng);
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  // Built once per match: the Tactician owns the evaluation countdown, so one
  // rebuilt per tick would restart it every tick and never decide anything.
  const casters: Record<Team, Tactician> = {
    [TEAM_A]: new Tactician(byTeam[TEAM_A]),
    [TEAM_B]: new Tactician(byTeam[TEAM_B]),
  };
  const decks: Record<Team, Deck> = {
    [TEAM_A]: new Deck(defaultDeck(), new Rng(seed + 1)),
    [TEAM_B]: new Deck(defaultDeck(), new Rng(seed + 6)),
  };
  const casts: Record<Team, number> = { [TEAM_A]: 0, [TEAM_B]: 0 };

  let ticks = 0;
  while (!world.roundOver && ticks < MAX_TICKS) {
    for (const team of [TEAM_A, TEAM_B] as Team[]) {
      const intent = casters[team].step(world, team, decks[team], SIM_DT, brain.planner.planFor(team));
      if (!intent) continue;
      if (!world.castSpell(team, intent.cardId, intent.position).ok) continue;
      decks[team].play(intent.cardId);
      casts[team]++;
    }

    brain.step(world, units, SIM_DT);
    world.step(SIM_DT);
    ticks++;
  }

  return { winner: world.winner, elapsed: world.elapsed, casts };
}

console.log(`\n\n=== strategy sweep · ${PROGRAMS.length} programs · ${seeds.length} seeds per pairing ===`);

const records = new Map<string, Record_>(PROGRAMS.map((p) => [p.name, emptyRecord()]));
let sweepMatches = 0;
let sweepDraws = 0;

for (let i = 0; i < PROGRAMS.length; i++) {
  for (let j = i + 1; j < PROGRAMS.length; j++) {
    const left = PROGRAMS[i];
    const right = PROGRAMS[j];
    let leftWins = 0;
    let rightWins = 0;
    let draws = 0;

    for (const [k, seed] of seeds.entries()) {
      // Alternate sides: team A and team B do not face a symmetric map, so a
      // fixed assignment would report the map's bias as the program's.
      const leftOnA = k % 2 === 0;
      const r = runStrategyMatch(seed, {
        [TEAM_A]: leftOnA ? left.strategy : right.strategy,
        [TEAM_B]: leftOnA ? right.strategy : left.strategy,
      });

      const leftTeam: Team = leftOnA ? TEAM_A : TEAM_B;
      records.get(left.name)!.casts += r.casts[leftTeam];
      records.get(right.name)!.casts += r.casts[leftOnA ? TEAM_B : TEAM_A];

      sweepMatches++;
      if (r.winner === null) {
        draws++;
        sweepDraws++;
        records.get(left.name)!.draws++;
        records.get(right.name)!.draws++;
      } else if (r.winner === leftTeam) {
        leftWins++;
        records.get(left.name)!.wins++;
        records.get(right.name)!.losses++;
      } else {
        rightWins++;
        records.get(right.name)!.wins++;
        records.get(left.name)!.losses++;
      }
    }

    const decided = leftWins + rightWins;
    const rate = decided > 0 ? ((leftWins / decided) * 100).toFixed(0) + '%' : '—';
    console.log(
      `  ${left.name.padEnd(11)} vs ${right.name.padEnd(11)} · ` +
        `${String(leftWins).padStart(2)}-${String(rightWins).padStart(2)}-${String(draws).padStart(2)} (W-L-D) · ` +
        `${left.name} takes ${rate} of decided`,
    );
  }
}

console.log(`\n  ${'program'.padEnd(11)} ${'W'.padStart(3)} ${'L'.padStart(3)} ${'D'.padStart(3)}   win% of decided   casts`);
for (const p of PROGRAMS) {
  const r = records.get(p.name)!;
  const decided = r.wins + r.losses;
  const rate = decided > 0 ? ((r.wins / decided) * 100).toFixed(0) + '%' : '—';
  console.log(
    `  ${p.name.padEnd(11)} ${String(r.wins).padStart(3)} ${String(r.losses).padStart(3)} ${String(r.draws).padStart(3)}   ` +
      `${rate.padStart(15)}   ${String(r.casts).padStart(5)}`,
  );
}

// GDD §14's health metric. It was the open problem number one — a draw was once
// the *default* result — and the idle pivot took it to zero. Printed every run
// because zero is now a regression guard rather than a target.
console.log(
  `\n  draw rate ${((sweepDraws / sweepMatches) * 100).toFixed(0)}% ` +
    `(${sweepDraws}/${sweepMatches}) — GDD §14's health metric; 0% is the bar it now has to hold`,
);
