/**
 * Volta A of the kit balance loop (plano v1.3 §5.2, Fase 3).
 *
 * Before any number in `balance.json` can be trusted, the policy has to be able
 * to spend the catalog. A skill that never fires reads as weak in every sweep
 * that follows, and nerfing it — or buffing what beat it — is measuring the
 * `when` clause and calling it damage. So this is the floor that runs in CI:
 * **every skill in the catalog is spent at least once**, over a seed set small
 * enough to sit in `npm test`.
 *
 * It is deliberately a coverage floor and not a balance assertion. The ~55%
 * per-mage ceiling of §5.1 needs thousands of matches and lives in
 * `scripts/kit-report.mts`; asserting it off twelve seeds would let a flake
 * write a nerf. What belongs here is the property that, once broken, silently
 * invalidates everything the script reports.
 *
 * When this goes red the fix is the skill's `when` / `range` / `at` — never its
 * damage (§5.2: "Mexer em dano aqui é o erro clássico da v1.1").
 */

import { describe, expect, it } from 'vitest';
import { Brain, type Difficulty } from './bot/Brain';
import { ALL_ROSTER, rosterFor, type RosterId } from './cards';
import { SIM_DT } from './config';
import { TEAM_A, TEAM_B, type Team } from './entities';
import { Rng } from './rng';
import { ALL_SPELLS, type SpellId } from './spells';
import { validateSquad } from './squad';
import { World } from './World';

/**
 * Three quartets that between them field all nine mages, and that a player
 * could actually build.
 *
 * Legality is the point, not a nicety. A sliding window over the catalog covers
 * the roster in fewer lines, but half its quartets double a body or skip a role
 * — squads `validateSquad` rejects and the server refuses to start. A skill
 * that only ever fires in one of those is still a silent skill in every match
 * anyone plays, and this floor would report it green.
 */
function coveringSquads(): RosterId[][] {
  return [
    ['stone_golem', 'pyromancer', 'stormcaller', 'cleric'],
    ['ice_sentinel', 'arcane_archer', 'alchemist', 'arcane_bard'],
    ['ice_sentinel', 'stone_golem', 'wind_dervish', 'cleric'],
  ];
}

const SEEDS = [3, 17, 41];

function runMatch(seed: number, a: readonly RosterId[], b: readonly RosterId[]): Map<SpellId, number> {
  const world = new World();
  world.initSquad(TEAM_A, a);
  world.initSquad(TEAM_B, b);

  const brain = new Brain(new Rng(seed));
  const units = new Map<string, Difficulty>();
  for (const id of world.mages.keys()) units.set(id, 'normal');

  let ticks = 0;
  while (!world.roundOver && ticks < 60 * 250) {
    brain.step(world, units, SIM_DT);
    world.step(SIM_DT);
    ticks++;
  }

  const casts = new Map<SpellId, number>();
  for (const team of [TEAM_A, TEAM_B] as Team[]) {
    for (const [spellId, n] of world.castsBySpell.get(team) ?? []) {
      casts.set(spellId, (casts.get(spellId) ?? 0) + n);
    }
  }
  return casts;
}

describe('kit usage — the policy can spend the whole catalog', () => {
  it('casts every skill at least once across the covering sweep', { timeout: 900_000 }, () => {
    const squads = coveringSquads();
    const total = new Map<SpellId, number>();

    for (let i = 0; i < squads.length; i++) {
      for (let j = i + 1; j < squads.length; j++) {
        for (const seed of SEEDS) {
          // Both seats: spawn geometry decides which kits ever get in range of
          // anything, so a quartet measured from one side is half measured.
          for (const leftOnA of [true, false]) {
            const left = leftOnA ? squads[i] : squads[j];
            const right = leftOnA ? squads[j] : squads[i];
            for (const [spellId, n] of runMatch(seed, left, right)) {
              total.set(spellId, (total.get(spellId) ?? 0) + n);
            }
          }
        }
      }
    }

    const silent = ALL_SPELLS.filter((id) => (total.get(id) ?? 0) === 0);
    expect(silent).toEqual([]);
  });

  /*
   * The floor above only means something if the sweep really does put every kit
   * on the field in a squad the game would accept. Both halves of that are
   * asserted here rather than trusted, because either one rotting turns the
   * test above green for the wrong reason.
   */
  it('fields every roster, in quartets the construction rule accepts', () => {
    const squads = coveringSquads();
    for (const squad of squads) expect([squad, validateSquad(squad)]).toEqual([squad, { ok: true }]);

    const fielded = new Set(squads.flat());
    expect(ALL_ROSTER.filter((r) => !fielded.has(r))).toEqual([]);
    for (const r of ALL_ROSTER) expect(rosterFor(r)?.abilities.length).toBeGreaterThan(0);
  });
});
