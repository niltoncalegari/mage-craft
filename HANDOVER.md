# Handover — 2026-08-17 (Claude Code — v1.3 Treinador, Fases 0 e 1a)

Branch **`feat/trainer-kits`** (de `main` `2487898`). Dois commits, suíte verde
nos dois (802/802 no último). Plano de execução:
`~/.claude/plans/use-o-handover-md-para-snazzy-mitten.md`.

## What changed this session

- `ea4c43e` **Fase 0 — contrato.** `public/data/balance.json`: cada `RosterId`
  ganhou `abilities` (kits da §3.2, conferidos contra `ALL_SPELLS`) e cada
  spell ganhou `cooldown` / `range` / `at` / `minTargets` / `when`; `sim.abilityGcd`
  e `sim.suddenDeathCooldownMultiplier`. Novo [`sim/abilityPolicy.ts`](sim/abilityPolicy.ts)
  (vocabulário do `when`/`at`, `Stance`, `AbilityPolicy`, validação eager) —
  [`sim/strategy.ts`](sim/strategy.ts) agora **reexporta** dele. Novo
  [`sim/kits.test.ts`](sim/kits.test.ts) (11 asserções de catálogo).
- `7949d09` **Fase 1a — sim, aditivo.** `Mage` ganhou `abilities`,
  `abilityCooldowns`, `abilityGcd`, `stance`. `World.castAbility(mageId, spellId, pos)`
  + `abilityCooldownOf` + `attuneCharge` / `refundCharge` + decay dentro de
  `updateMage`. Novo [`sim/castAbility.test.ts`](sim/castAbility.test.ts) (14 testes).
- [`treinador-plan.md`](treinador-plan.md) §1: Q6/Q7/Q8 e os dois buracos de
  mana marcados como fechados (ainda **não commitado**).

## Key decisions (and why)

- **Q7 = cooldown por skill, sem mana de time.** Q6 = **postura entra na v1.3.0**.
  Q8 = **kit fixo**. Confirmados com o usuário.
- **`mana_flow` / `dark_tribute` não saem do kit** — os riders `attune`/`tribute`
  passam a mexer na recarga (`attuneCharge` / `refundCharge`). Mesma alavanca,
  recurso novo; VFX/SFX/telegraph e a tabela §3.2 ficam intactos.
- **Morte súbita** vira `SUDDEN_DEATH_COOLDOWN_MULTIPLIER` (= 2).
- **`castSpell(team, …)` sobrevive** como porta de *efeito*, sem economia. Evita
  reescrever os ~81 call sites de teste que testam efeito, não permissão. Só os
  testes de economia/petrify mudam.
- **Petrify vira por mago** (`mage_petrified`); `squadPetrified` era artefato da
  barra de time.
- **Uma union, dois leitores:** `mana` é só do programa, `self_health` é só das
  habilidades — barrado nos dois sentidos em `abilityPolicy.ts`.
- **Fase 1 partida em 1a/1b** para todo commit ficar verde: a mana só pode sair
  no mesmo corte que o fio e os dois loops de sessão.

## Plan / todo status

- **Done:** Fase 0 inteira; Fase 1a (estado no mago + `castAbility` + recarga).
- **Pending:** Fase 1b (Brain dispara) e Fase 2 (fio/loadout/servidor/API).

## Known issues / risks

- `attuneCharge` / `refundCharge` existem mas **ninguém chama** — os riders
  `attune`/`tribute` ainda mexem em mana. Re-apontar no mesmo commit que remove a mana.
- `treinador-plan.md` tem edição **não commitada** na árvore.
- Nada dispara habilidade ainda: `Commander`/`Tactician` seguem jogando carta.
- `server/src/App.test.ts` → `plays both queued seats` é flaky ~1 em 3, por desenho.

## Next steps

1. **Fase 1b** — `sim/bot/kit.ts`: `chooseAbility(mage, facts, self)` puro, **zero
   `Rng`**. Precisa de `self_health` como overlay sobre `buildFacts`
   ([`sim/strategyFacts.ts:40`](sim/strategyFacts.ts#L40), hoje só por time) e da
   guarda de postura (`hold` = `HOLD_GUARD`; `normal` = `minTargets`; `aggressive`
   ignora `minTargets`). `Brain.step` ([`sim/bot/Brain.ts:381`](sim/bot/Brain.ts#L381))
   monta os fatos **uma vez por time** a cada `ABILITY_EVAL_INTERVAL = 0.25 s`
   (acumulador de `dt`) e chama `w.castAbility` por mago vivo. Teste primeiro.
2. **Fase 2, um corte só** — tirar mana do `World`, re-apontar os riders, e no
   **mesmo commit**: `protocol`/`snapshot` (`stances`, `cd[]`, `firedAbility`,
   sem `hand`/`mana`), `Session` + `LocalSession` (somem `Deck`/`Caster`/`stepCasters`),
   `loadout.ts` v3, `api/**` (`deck`/`strategy` opcionais, `stances` novo,
   `MatchLog.cards` ganha `rosterId` — **não** trocar a chave, o histórico do Mongo
   depende dela).
3. Um PR único no fim, com os quatro commits (0 / 1a+1b / 2 / docs).

**Antes de cada fase:** `git status` e `git log` no worktree principal — o outro
agente commita nesta mesma branch. Stage por path explícito, nunca `git add -A`.
Verificar com `npx tsc --noEmit`, `npx eslint sim server/src src`, `npm test`.
