/**
 * Headless AI-vs-AI behaviour report (GDD §14's harness, pointed at the *Brain*
 * rather than at balance).
 *
 * `sim/agency.test.ts` answers "who won". This answers "what did they actually
 * do all match" — which action each squad spent its time in, how deep it ever
 * pushed, and how many Tower bolts it stood in front of. Those are the numbers
 * that say whether the AI has a plan or is just trading shots in midfield.
 *
 * **The program sweep that used to live here is gone**, not broken. It measured
 * one authored program against another, and v1.3 retired both — a mage spends
 * its own kit, so there is no program to compare. What replaces it is the kit
 * balance sweep of the plan's Fase 3 (`scripts/kit-report.mts`), which asks the
 * question the pivot actually made askable: does swapping a mage change how the
 * match goes. Until that lands, `sim/agency.test.ts` is the only thing holding
 * a floor under the player's choices.
 *
 *   npx tsx scripts/ai-report.mts [seeds...]
 */
import { Brain, type Difficulty } from '../sim/bot/Brain';
import { defaultSquad } from '../sim/cards';
import { SIM_DT } from '../sim/config';
import { TEAM_A, TEAM_B, type Team } from '../sim/entities';
import { Rng } from '../sim/rng';
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

  const stats: Record<Team, TeamStats> = { [TEAM_A]: emptyStats(), [TEAM_B]: emptyStats() };
  const seenProjectiles = new Set<string>();
  const wasAlive = new Map<string, boolean>();
  for (const m of world.mages.values()) wasAlive.set(m.id, true);

  let ticks = 0;
  while (!world.roundOver && ticks < MAX_TICKS) {
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
