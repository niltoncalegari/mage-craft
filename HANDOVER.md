# Handover — 2026-08-18 (Claude Code — v1.3 Treinador, plano completo)

Branch **`feat/trainer-kits`** (de `main` `2487898`). Catorze commits, suíte
verde em todos. **As cinco fases do plano estão fechadas.** O PR único ainda não
foi aberto.

Plano de execução: `~/.claude/plans/use-o-handover-md-para-snazzy-mitten.md`;
produto em `treinador-plan.md`.

## What changed this session

- `f0afdca` **O instrumento de medição estava errado.** Detalhado abaixo — é o
  achado que invalidou números que o handover anterior afirmava.
- `f0236a6` A varredura em volume: volta A fechada, volta B passagem 1 falsificada.
- `0de04fe` Handover intermediário.
- `65c35cc` **Fase 4** — kit e postura no `SquadBuilder`, carga por skill no
  `SquadPanel`, pós-partida por mago.
- `223235b` **Fase 5** — enterro do `Deck.ts`, `strategy*.ts`, do kind `mana` e
  das constantes órfãs; `SpellRange` cicla por kit; `GDD.md` e `README.md`
  reescritos.
- `04ddd77` Varredura final do GDD.
- `8cdbf93` **Volta B passagem 2** — `dark_tribute` de 10 para 4.

## Key decisions (and why)

- **O harness alternava assento por índice de seed, e isso não cancela nada.**
  Cada seed jogava uma vez, do assento que sua posição na lista desse — o que só
  cancelaria o viés do mapa se as seeds fossem intercambiáveis. Dois controles:
  espelho com esquadrões idênticos deu **8-4 para o rótulo da esquerda**, e o
  mesmo confronto nas duas ordens de argumento discordou de si mesmo (8-4 contra
  11-1). Agora cada seed é jogada **nos dois assentos**, em `agency.test.ts` e no
  sweep. Espelho depois: 5-5.
- **O all-tank não era dívida de balance.** `validateSquad` rejeita aquele
  esquadrão duas vezes (corpo duplicado, sem damage nem support) e o servidor
  roda o check antes da partida. Ninguém pode montá-lo. O sweep agora pergunta a
  legalidade à própria função em vez de reimplementá-la.
- **O sampler do pool decidia o resultado.** Espaçamento uniforme sobre a lista
  de quartetos (que sai em ordem de catálogo) dava ao `alchemist` **uma**
  aparição. Com cobertura equilibrada os números viraram de cabeça para baixo —
  ver tabela abaixo. O relatório agora imprime quartetos-por-mago.
- **Tetos são relatados, nunca asseridos.** Piso em CI (`agency.test.ts`,
  `kitUsage.test.ts`), volume no script.
- **Telegraph não foi tocado** — já estava ligado ponta a ponta desde a Fase 1/2
  e contract-tested contra o `delay` do sim. Verificar bateu reescrever.

## Plan / todo status

- **Done:** Fases 0, 1, 2, 3, 4 e 5.
  - O critério da Fase 3 no plano é *"os tetos da §5.1 têm número no relatório,
    mesmo que feio. Feio afina; ausente não."* Os números existem. **Estão
    feios** — ver abaixo.
- **Pending:** **abrir o PR único** (`main` ← `feat/trainer-kits`), e a afinação
  de balance, que é trabalho contínuo e não porta de fase.

## Números atuais (900 partidas, 10 de 60 quartetos legais, seeds 3..66)

| Mago | Win% | n (sides) |
| --- | --- | --- |
| pyromancer | 73.2% | 720 |
| stormcaller | 68.5% | 720 |
| ice_sentinel | 57.4% | 900 |
| cleric | 57.4% | 900 |
| stone_golem | 52.1% | 1080 |
| arcane_archer | 43.5% | 720 |
| arcane_bard | 42.6% | 900 |
| alchemist | 23.6% | 720 |
| wind_dervish | 21.7% | 540 |

Oito de nove fora da banda 45-55%; **51 pontos** entre o melhor e o pior. Taxa
de empate 0%. A desigualdade mora no papel de **dano** — os dois suportes ficam
a 15 pontos um do outro e os dois tanks a 5.

Postura (n=40): `normal` × `hold` 33-7; `aggressive` × `hold` 37-3;
`aggressive` × `normal` 22-18. `hold` gasta 78% dos casts do `normal`.

## Known issues / risks

- **Duas passagens da volta B feitas; não repetir nenhuma das duas.**
  1. ❌ **Cooldown em kit de 2 slots.** Hipótese: bard e archer perdem por
     throughput (gastam ~22 casts/side contra 26-38). Cortar `bond_of_pain`
     14→9 e `paranoia` 11→7 subiu o throughput **36%** e moveu o bard de 31.9%
     para 32.1%. Revertido. **Frequência não é o gargalo.**
  2. ⚠️ **Magnitude de `dark_tribute` 10→4.** Moveu o `alchemist` de 20.3% para
     23.6% (170 vitórias contra 146, n=720). **Mantido**, mas é melhora parcial:
     3.3 pontos contra vão de 25, com ~1.5 ponto de ruído binomial nesse n.
- **Os dois piores são `wind_dervish` (21.7%) e `alchemist` (23.6%).** O
  `wind_dervish` nunca foi investigado — é o alvo óbvio da próxima passagem, e o
  de menor amostra (540 sides, aparece em 3 dos 10 quartetos).
- **O pool é 10 de 60 quartetos legais.** O completo custa ~12 h a 10 seeds;
  subir `--pool` é quadrático em pairings. Uma corrida de pool leva ~20 min
  sozinha e ~1 h competindo com a suíte.
- **`sim/kits.test.ts` não acopla custo a cooldown** (só exige `cooldown > 0`),
  então a tabela custo→cooldown que a Fase 0 semeou já está quebrada de
  propósito em `dark_tribute`. Isso é a volta B funcionando, não drift.
- A suíte caiu de 808 para **746 testes em 66 arquivos** — é a Fase 5 apagando
  `Deck.test.ts`, `strategy.test.ts`, `strategyPresets.test.ts` e encolhendo
  `strategyText.test.ts`. Não é regressão.

## Next steps

1. **Abrir o PR único** (`main` ← `feat/trainer-kits`).
2. **Volta B passagem 3** — `wind_dervish`. Re-baselinar não é necessário: o
   baseline atual é `8cdbf93`. Um dial, e **não cooldown**.
3. Balance contínuo até os tetos da §5.1.

**Antes de cada sessão:** `git status` e `git log` no worktree principal — o
outro agente commita nesta mesma branch. Stage por path explícito, nunca
`git add -A`. Verificar com `npx tsc --noEmit`, `npx eslint sim server/src src`,
`npm test` (Node 22 obrigatório), `npm run build`, e `npm test` dentro de `api/`.
