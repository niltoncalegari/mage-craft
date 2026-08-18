# Handover — 2026-08-18 (Claude Code — v1.3 Treinador, Fase 3 em curso)

Branch **`feat/trainer-kits`** (de `main` `2487898`). Dez commits, suíte verde
em todos. Plano de execução:
`~/.claude/plans/use-o-handover-md-para-snazzy-mitten.md`; produto em
`treinador-plan.md` §5.

## What changed this session

Duas coisas, e a primeira invalida números que este arquivo afirmava.

- `f0afdca` **O instrumento estava errado.** `headToHead` alternava assento
  *por índice de seed*: cada seed jogava uma vez, do assento que sua posição na
  lista desse. Isso parece cancelar a assimetria do mapa e não cancela — só
  cancelaria se as seeds fossem intercambiáveis. Dois controles: espelho
  (squads idênticos, mesmo caminho) deu **8-4 para o rótulo da esquerda**, e a
  mesma matchup nas duas ordens de argumento discordou de si mesma (8-4 contra
  11-1). Agora **cada seed é jogada nos dois assentos**, em `sim/agency.test.ts`
  e no sweep novo. Espelho depois: 5-5.
  - Novos: `scripts/kit-report.mts` (os cortes da §5.1) e `sim/kitUsage.test.ts`
    (piso de CI da volta A). `npm run report:kit`.
- `f0236a6` **A varredura em volume, e a primeira passagem da volta B.**

## Key decisions (and why)

- **O all-tank não é dívida de balance.** Este arquivo registrava "balanceado
  perde 3-17 para all-tank" como dívida aberta. `validateSquad` **rejeita**
  aquele squad duas vezes (corpo duplicado, e sem role de damage nem support), e
  `server/src/App.ts` roda esse check antes da partida. Ninguém pode montá-lo,
  logo não é meta de ninguém. Re-medido é pior (**4-36**, n=40) e continua não
  sendo dívida: mede o sim *debaixo* da regra de construção — tanks de 200-280
  HP contra 60-80, `prefersStructures`, `retreatHealthFraction: 0` — e a regra
  de roles é o preço já cobrado por isso. O comentário em `agency.test.ts` foi
  reescrito.
- **O sweep pergunta a legalidade à `validateSquad`**, em vez de reimplementá-la.
  Isso derrubou duas linhas de leave-one-out que duplicavam corpo em silêncio.
- **Tetos são relatados, nunca asseridos.** Piso em CI, volume no script — um
  flake de doze seeds não pode escrever um nerf.
- **Per-mage sai só do round robin.** Dobrar as seções desenhadas dentro poria
  os quatro corpos do squad default no topo por tamanho de amostra e chamaria
  isso de meta.

## Plan / todo status

- **Done:** Fases 0, 1, 2. Fase 3 §1 (o sweep) e **volta A inteira**.
- **Pending:** volta B (uma passagem feita e falsificada), Fases 4 e 5. **O PR
  único ainda não foi aberto.**

### Volta A — fechada

Nenhuma skill do catálogo é muda. Normalizado por side os volumes ficam dentro
de uma ordem de grandeza no mesmo tier de custo (cost 3: 10-16 casts/side;
cost 4: 6-15). `sim/kitUsage.test.ts` segura isso em CI, em **três quartetos
que a regra de construção aceita** — legalidade importa aqui: uma janela
deslizante sobre o catálogo é mais curta, mas metade dos quartetos dela é
immontável, e skill que só dispara ali é muda em toda partida real.

### Volta B — passagem 1, falsificada (não repetir)

`arcane_bard` 31.9% (n=1080 sides) e `arcane_archer` 40.6% (n=540) são os dois
únicos magos de **kit com 2 slots**, e gastam ~22 casts/side contra 26-38 dos
kits de 3. Toda skill roda quase saturada no cooldown (`paranoia` dispara 11.8×
num teto de ~13 em 150 s), então cooldown é o dial que morde. Hipótese: kit de
2 slots é curto de throughput.

Dial: `bond_of_pain` 14→9, `paranoia` 11→7. Throughput subiu **36%**
(`paranoia` 12757→16972, `bond_of_pain` 10974→15482). Win rate foi de **31.9%
para 32.1%** — três partidas em 1080.

**Revertido.** Frequência não é o que segura um kit de 2 slots. A próxima
passagem pega magnitude ou o corpo, não frequência.

## Números da varredura (900 partidas, 10 quartetos legais, seeds 3..66)

Por mago, contra o pool (teto ~55% / piso ~45% da §5.1):

| mago | win% | n (sides) |
| --- | --- | --- |
| alchemist | 85.0% | 180 ⚠ amostra fina |
| cleric | 68.1% | 1080 |
| stone_golem | 64.5% | 1080 |
| pyromancer | 58.8% | 900 |
| ice_sentinel | 49.1% | 1080 |
| stormcaller | 40.9% | 540 |
| arcane_archer | 40.6% | 540 |
| arcane_bard | 31.9% | 1080 |
| wind_dervish | 23.8% | 720 |

Sete de nove fora da banda 45-55%. Taxa de empate 0%.

Postura, n=40: `normal` × `hold` 33-7 (83%); `aggressive` × `hold` 37-3;
`aggressive` × `normal` 22-18 (55%). Escada monotônica. `hold` gasta 5209 casts
contra 6683 do `normal` — 78%, confirmando que é acelerador, não mute.

## Known issues / risks

- **O alvo mais valioso é o slot de support.** Há exatamente **dois** supports,
  todo quarteto legal precisa de ≥1, e eles estão 68.1% contra 31.9%. A escolha
  do slot está quase decidida — é o risco de meta da pergunta 5 do plano, e é
  o corte com melhor amostra que existe. Mesma forma, mais fraca, nos tanks
  (`stone_golem` 64.5% × `ice_sentinel` 49.3%).
- **`alchemist` 85% não é achado.** Vinha de um pool onde ele aparecia em **um**
  quarteto. O sampler agora é guloso na cobertura (3-6 aparições por mago) e o
  relatório imprime quartetos-por-mago — **mas a tabela acima foi medida com o
  sampler antigo**. Re-baselinar antes da próxima passagem da volta B.
- **O pool é 10 de 60 quartetos legais.** O completo custa ~12 h a 10 seeds.
  Subir `--pool` custa quadrático em pairings.
- **Nada chama `saveStances` ainda** (Fase 4). Toda postura é `normal` na
  prática; o passo 3 da verificação ponta a ponta só dá por teste.
- `MANA_MAX`/`MANA_START`/`SUDDEN_DEATH_MANA_MULTIPLIER` continuam em
  `config.ts` e `balance.json`; o kind `'mana'` continua no vocabulário e
  retorna 0. Saem na Fase 5.
- `auraChargeBonus` do `arcane_bard` **não** morreu com a mana — alimenta
  `chargeRateBonus`, que é a carga do ataque básico. Verificado; não é stat
  morto.

## Next steps

1. **Fase 3, volta B passagem 2** — re-baselinar com o sampler novo
   (`npm run report:kit -- --seeds 10 --pool 10 --only pool`), depois **um**
   dial: magnitude de `bond_of_pain`/`paranoia`, ou o corpo do `arcane_bard`
   (70 HP contra 95 do cleric). Não cooldown — já medido e falsificado.
2. **Abrir o PR único** (`main` ← `feat/trainer-kits`).
3. **Fase 4** — `SquadBuilder` com kit + postura (**e chamando `saveStances`**);
   carga por skill no `SquadPanel`; telegraph; pós-partida por mago.
4. **Fase 5** — apagar `Deck.ts`, `strategy*.ts`, `strategyPresets.ts`, o kind
   `'mana'` e as constantes órfãs; `SpellRange` cicla kit por mago; reescrever
   `GDD.md` e `README.md`.

**Antes de cada fase:** `git status` e `git log` no worktree principal — o outro
agente commita nesta mesma branch. Stage por path explícito, nunca `git add -A`.
Verificar com `npx tsc --noEmit`, `npx eslint sim server/src src`, `npm test`
(Node 22 obrigatório), e `npm test` dentro de `api/`.
