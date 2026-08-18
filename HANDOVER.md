# Handover — 2026-08-17 (Claude Code — v1.3 Treinador, Fases 0, 1 e 2-início)

Branch **`feat/trainer-kits`** (de `main` `2487898`). Cinco commits, suíte verde
em todos. Plano de execução:
`~/.claude/plans/use-o-handover-md-para-snazzy-mitten.md`.

## What changed this session

- `ea4c43e` **Fase 0 — contrato** (sessão anterior).
- `7949d09` **Fase 1a — sim, aditivo** (sessão anterior).
- `f5ad5a4` **Docs** — Q6/Q7/Q8 fechadas em `treinador-plan.md` §1.
- `7764bea` **Fase 1b — o kit dispara.** Novo [`sim/bot/kit.ts`](sim/bot/kit.ts):
  `chooseAbility(mage, facts, self)` puro, **zero `Rng`**, escolhe a skill pronta
  mais cara cujo `when` vale e cujo alvo está no alcance. `HOLD_GUARD` (Core
  baixo **ou** `self_health` baixo **ou** `intruder`) exigido só em `hold`;
  `aggressive` ignora `minTargets`. `Brain.step` passa nos kits a cada
  `ABILITY_EVAL_INTERVAL = 0.25 s` (acumulador de `dt`), lendo os fatos dos
  **dois** times antes de qualquer cast. O avaliador (`holds`) e `StrategyFacts`
  saíram de `strategy.ts` para [`abilityPolicy.ts`](sim/abilityPolicy.ts), que
  `strategy.ts` reexporta; `holds` ganhou o overlay `MageFacts` — é assim que
  `self_health` chega numa policy. `recordCast` ganhou `mageId` →
  `castsByMage` + `MageStat.casts`. Novos `sim/bot/kit.test.ts` (11) e
  `sim/abilityCooldown.test.ts` (10, cobrindo a recarga que a Fase 1a deixou sem
  teste). `kits.test.ts` ganhou a guarda de `minTargets` em seletor não-cluster.
- `4f137cf` **Fase 2 (1/n) — riders re-apontados.** `attune` → `attuneCharge`
  (time), `tribute` → `refundCharge` (o **corpo** que lançou).
  `SpellRiderContext` ganhou `casterId`, passado pela fila de aplicação atrasada;
  é nulo pela porta `castSpell`, e aí o tributo simplesmente não acontece.

## Key decisions (and why)

- **`chooseAbility` não recebe `now`** (o plano previa): as cargas decaem no
  corpo, então não há relógio para consultar.
- **`AbilityIntent.position`, não `at`** — `at` é o *seletor* em todo o resto do
  vocabulário (`StrategyDecision`).
- **`hold` é `normal` + `HOLD_GUARD`**, não um caminho paralelo: a escada
  hold → normal → aggressive só é legível se cada degrau afrouxa o anterior.
- **Fatos dos dois times lidos antes de qualquer cast** — construir preguiçoso
  daria ao time que roda depois uma visão do campo que o primeiro já mudou,
  vantagem decidida por ordem de id.
- **`castsByMage` ao lado de `castsBySpell`, não no lugar** — `MatchLog.cards`
  guarda a forma por time desde antes do pivot.
- **`Commander`/`Tactician` morrem na Fase 2, não na 5.** São os únicos leitores
  não-teste de `w.manaOf`, e a Fase 2 tira os dois de `Session`/`LocalSession` —
  mantê-los vivos exigiria uma barra de mana falsa só para eles. `Deck.ts`
  **fica** (o `DeckBuilder` ainda usa, e ele só sai na Fase 5).

## Plan / todo status

- **Done:** Fase 0; Fase 1 inteira (1a + 1b + os dois arquivos de teste que
  faltavam); Fase 2 — riders.
- **Pending:** o resto da Fase 2, em **um corte só** (ver abaixo).

## Known issues / risks

- `server/src/App.test.ts` → `plays both queued seats` é flaky ~1 em 3 **por
  desenho** (2 de 6 aqui). Re-rodar antes de investigar. A Fase 2 reescreve.
- Seções B/C de `scripts/ai-report.mts` agora medem o modelo velho por cima dos
  kits disparando — quebradas de propósito até a Fase 3. Seção A segue válida
  (12 partidas, 6–6).
- A mana ainda existe no `World` e ninguém de dentro dos riders a usa.

## Next steps

**O corte que falta da Fase 2** — tem que ser um commit só, senão practice e
online divergem:

1. `sim/World.ts`: saem `mana`, `manaAccum`, `manaFlow`, `castCooldown`,
   `manaOf`, `spendMana`, `grantMana`, `attuneMana`, `manaRateOf`, `updateMana`,
   `castCooldownOf`, `squadPetrified`; `CastRejection` perde `not_enough_mana`,
   `squad_petrified` e `on_cooldown`. `castSpell` fica como porta de efeito sem
   economia.
2. `sim/strategyFacts.ts` para de ler `manaOf`; `StrategyFacts.mana` sai (o
   `NumericConditionKind` `'mana'` fica até a Fase 5, inerte).
3. **Apagar** `sim/bot/Tactician.ts`, `sim/bot/Tactician.test.ts`,
   `sim/bot/Commander.ts`. Reescrever `sim/agency.test.ts` no eixo
   composição+postura e o harness de `sim/matchStats.test.ts` (hoje usa
   `Commander` + `Deck`). Ajustar `sim/siege.test.ts` (10 refs de mana).
4. `sim/protocol.ts` + `sim/snapshot.ts` conforme a tabela da Fase 2 do plano
   (`stances`, `cd[]`, `firedAbility`, sem `hand`/`mana`; `CastStatDTO.rosterId`).
5. `server/src/{Session,App,Matchmaker}.ts` + os 6 testes de mão/programa.
6. `src/net/{LocalSession,SnapshotSync,NetworkClient,SiegeMatchReporter}.ts`,
   `src/app/loadout.ts` v3, `App.tsx`, `PracticeScreen`, `HomeScreen`,
   `src/ui/MatchHUD.tsx` (mínimo: esconder barra de mão/mana, trocar o trace).
7. `api/src/models/{User,MatchLog}.ts`, `api/src/routes/loadout.ts`,
   `src/net/ApiClient.ts`.

Depois: PR único com todos os commits.

**Antes de cada fase:** `git status` e `git log` no worktree principal — o outro
agente commita nesta mesma branch. Stage por path explícito, nunca `git add -A`.
Verificar com `npx tsc --noEmit`, `npx eslint sim server/src src`, `npm test`
(Node 22 obrigatório).
