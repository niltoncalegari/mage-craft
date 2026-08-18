/**
 * The kit contract (plano v1.3 §3.1–3.2) — what has to be true of
 * `balance.json` before a single mage is allowed to fire anything.
 *
 * This is the Fase 0 gate. The v1.3 pivot moves permission to spend a spell
 * from the team to the body carrying it, and every claim the design makes about
 * that ("trocar o Clérigo pelo Bardo troca o vocabulário da partida") rests on
 * properties of the *data*, not of the code that reads it: kits that do not
 * overlap, a catalog with no orphans, and a firing policy written in a
 * vocabulary the evaluator actually understands.
 *
 * A hand-authored JSON catalog gets these wrong silently. A spell with no owner
 * is a spell nobody ever casts, and the balance sweep of §5 would read that as
 * "weak" and nerf it — the exact failure the plan calls "nerf cego". So the
 * assertions here are deliberately about *coverage and disjointness* rather
 * than about any number being good.
 */

import { describe, expect, it } from 'vitest';
import { ALL_ROSTER, rosterFor, rosterOwnerOf, type RosterId } from './cards';
import { ALL_SPELLS, spellFor, type SpellId } from './spells';
import { ALL_TARGET_SELECTORS, abilityPolicyFor, isCondition } from './abilityPolicy';

const KITS = ALL_ROSTER.map((id) => ({ id, abilities: rosterFor(id)?.abilities ?? [] }));

describe('kits — every mage carries part of the catalog', () => {
  it('gives each mage two or three abilities', () => {
    for (const { id, abilities } of KITS) {
      expect(abilities.length, `${id} kit size`).toBeGreaterThanOrEqual(2);
      expect(abilities.length, `${id} kit size`).toBeLessThanOrEqual(3);
    }
  });

  it('names only real spells', () => {
    for (const { id, abilities } of KITS) {
      for (const spellId of abilities) {
        expect(spellFor(spellId), `${id} carries unknown spell ${spellId}`).toBeDefined();
      }
    }
  });

  /**
   * Disjointness is the whole design, not hygiene. A skill on two mages makes
   * swapping one of them a stat change; a skill on exactly one makes it a
   * change of vocabulary, which is what the pivot is buying.
   */
  it('never puts the same skill on two mages', () => {
    const owner = new Map<SpellId, RosterId>();
    for (const { id, abilities } of KITS) {
      for (const spellId of abilities) {
        const held = owner.get(spellId);
        expect(held, `${spellId} is on both ${held} and ${id}`).toBeUndefined();
        owner.set(spellId, id);
      }
    }
  });

  it('leaves no spell in the catalog without an owner', () => {
    const owned = new Set(KITS.flatMap((k) => k.abilities));
    const orphans = ALL_SPELLS.filter((id) => !owned.has(id));
    expect(orphans, 'spells no mage can cast').toEqual([]);
  });

  it('accounts for the whole catalog and nothing beyond it', () => {
    const owned = KITS.flatMap((k) => k.abilities);
    expect(owned).toHaveLength(ALL_SPELLS.length);
  });

  /**
   * §3.2's third construction rule: "cada kit tem papéis internos diferentes —
   * o Clérigo não leva três curas". The v1.2 measurement already showed that a
   * catalog where everything is generic AoE is a catalog that never asks for a
   * read, and a kit of three interchangeable skills reproduces that inside one
   * body.
   *
   * Measured on the *leading effect* rather than on `kind`/`target`, which are
   * far too coarse to say anything: Escudo Arcano, Vínculo de Solidariedade and
   * Chamado à Batalha are all `buff:allies` and are absorption, damage-sharing
   * and a resurrection — three different jobs by any reading that matters.
   */
  it('never gives a mage three abilities that do the same job', () => {
    for (const { id, abilities } of KITS) {
      if (abilities.length < 3) continue;
      const jobs = abilities.map((s) => spellFor(s)!.apply[0].effect);
      expect(new Set(jobs).size, `${id} kit is all ${jobs[0]}`).toBeGreaterThan(1);
    }
  });
});

describe('ability policy — the Brain has something to read', () => {
  it('gives every spell a charge time and a reach', () => {
    for (const id of ALL_SPELLS) {
      const policy = abilityPolicyFor(id);
      expect(policy, `${id} has no policy`).toBeDefined();
      expect(policy!.cooldown, `${id} cooldown`).toBeGreaterThan(0);
      expect(policy!.range, `${id} range`).toBeGreaterThan(0);
    }
  });

  it('aims every spell at a selector the facts resolve', () => {
    for (const id of ALL_SPELLS) {
      expect(ALL_TARGET_SELECTORS, `${id} at`).toContain(abilityPolicyFor(id)!.at);
    }
  });

  it('writes every trigger in the vocabulary the evaluator knows', () => {
    for (const id of ALL_SPELLS) {
      expect(isCondition(abilityPolicyFor(id)!.when), `${id} when`).toBe(true);
    }
  });

  /**
   * Mana is gone (§3.3), so a policy that still reads it would be a condition
   * that can never be true — a skill that silently never fires.
   */
  it('never guards a trigger on mana', () => {
    const mentionsMana = (c: unknown): boolean => {
      if (typeof c !== 'object' || c === null) return false;
      const node = c as { kind?: unknown; of?: unknown };
      if (node.kind === 'mana') return true;
      if (Array.isArray(node.of)) return node.of.some(mentionsMana);
      return mentionsMana(node.of);
    };
    for (const id of ALL_SPELLS) {
      expect(mentionsMana(abilityPolicyFor(id)!.when), `${id} reads mana`).toBe(false);
    }
  });

  /**
   * A `minTargets` above 1 is a promise that the selector can point at a crowd,
   * and only the two cluster selectors can — everything else resolves to one
   * body, one structure or one point. Asking two of a selector that can only
   * ever answer one is a skill that never fires on a `normal` mage, which the
   * balance sweep of §5 would read as "weak" and nerf further.
   */
  it('only asks for a crowd where a crowd can be pointed at', () => {
    for (const id of ALL_SPELLS) {
      const policy = abilityPolicyFor(id)!;
      if (policy.at === 'enemy_cluster' || policy.at === 'ally_cluster') continue;
      expect(policy.minTargets, `${id} wants ${policy.minTargets} at ${policy.at}`).toBe(1);
    }
  });

  /**
   * The siege debt (GDD §11): the Brain does not yet know to leave a Tower it
   * has latched onto, so a kit that aims at structures would have the balance
   * sweep blaming the skill for the movement AI. Structure selectors come back
   * once that debt is paid.
   */
  it('keeps v1.3.0 kits off structure selectors', () => {
    for (const id of ALL_SPELLS) {
      expect(['our_core', 'enemy_core'], `${id} aims at a structure`).not.toContain(
        abilityPolicyFor(id)!.at,
      );
    }
  });
});

describe('rosterOwnerOf — which body a spell belongs to', () => {
  /*
   * Well-defined only because the two tests above hold: kits are disjoint and
   * they cover the catalog, so "who carries this spell" has exactly one answer
   * for every spell. That is what lets the post-match tally credit a body from
   * a per-team count of spell ids, without a second table to keep in step.
   */
  it('names the one mage carrying each spell in the catalog', () => {
    for (const spellId of ALL_SPELLS) {
      const owner = rosterOwnerOf(spellId);
      expect(owner, spellId).toBeDefined();
      expect(rosterFor(owner!)!.abilities).toContain(spellId);
    }
  });

  it('has no answer for something that is not a spell', () => {
    expect(rosterOwnerOf('fireball_of_doom' as never)).toBeUndefined();
  });
});
