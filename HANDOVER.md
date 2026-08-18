# Handover — 2026-08-18 (Claude Code — v1.3 Treinador, Fases 0, 1 e 2 completas)

Branch **`feat/trainer-kits`** (de `main` `2487898`). Seis commits, suíte verde
em todos. Plano de execução:
`~/.claude/plans/use-o-handover-md-para-snazzy-mitten.md`.

## What changed this session

- `4a1f90c` **Fase 2 — o resto, num corte só.** É o único commit desta sessão, e
  tinha que ser: `Session` e `LocalSession` perderam o `Caster` juntos, senão
  practice e online divergiriam por um deploy.
  - **`sim/World.ts`**: saem `mana`, `manaAccum`, `manaFlow`, `castCooldown`,
    `manaOf`, `spendMana`, `grantMana`, `attuneMana`, `manaRateOf`, `updateMana`,
    `castCooldownOf`, `squadPetrified`. `CastRejection` perde
    `not_enough_mana`/`squad_petrified`/`on_cooldown`. `castSpell` vira porta de
    **efeito** (`@internal`) — só `match_over`/`unknown_card`/`out_of_bounds`.
  - **`initSquad(team, roster, stances?)`** e **`World.onAbilityCast`** são as
    duas costuras novas. O callback existe porque a magia sai do kit lá dentro do
    `Brain.step`: quem está acima do sim não consegue ver acontecer.
  - **Protocolo**: `set_loadout` leva `squad` + `stances`; `SnapshotMsg` perde
    `mana`/`hand`/`next`; `firedRule` → `firedAbility { mageId, spellId, at }`;
    `MageSnapshotDTO` ganha `cd?: number[]` (omitido com kit cheio);
    `CastStatDTO` ganha `rosterId?` **ao lado** de `cardId`.
  - **`rosterOwnerOf(spellId)`** novo em `cards.ts` — bem definido porque os kits
    são disjuntos e cobrem o catálogo, o que `kits.test.ts` já fixa.
  - **Apagados**: `Tactician`, `Commander`, `DeckBuilder`, `StrategyBuilder`,
    `screens/strategy/**`.
  - **API**: `loadoutProfileSchema` ganha `stances: Map`; `deck`/`strategy` viram
    **opcionais** (documentos antigos continuam legíveis); `parseRules` → 
    `parseStances`; `cardUsageSchema` ganha `rosterId?`.

## Key decisions (and why)

- **`hold` não é mute — é acelerador.** O plano previa "≈ 0 casts"; medido, é
  ~4/5 do volume de `normal` (2696 contra 3382 em n=20). `HOLD_GUARD` abre com
  core sob pressão, corpo ferido ou intruso, e isso acontece em qualquer partida
  indo mal. A linha de base zero morreu junto com o programa vazio.
- **`castSpell` sobrevive** em vez de morrer: os testes de efeito e as dev range
  sessions só queriam a metade "aplica o efeito". Cortou ~70 edições de risco.
- **`rosterId` derivado do catálogo, não de `castsByMage`.** Kits disjuntos ⇒ a
  pergunta "de quem é esta magia" tem uma resposta só, sem segunda tabela.
- **`cardId` continua sendo a chave** de `MatchLog.cards` — trocar não migraria o
  histórico, esconderia.
- **Duas fugas do plano, ambas forçadas** (registradas na mensagem do commit):
  os dois builders saem agora, não na Fase 5, porque sem as abas do `HomeScreen`
  viram UI inalcançável que não compila contra o loadout v3; e `ai-report.mts`
  perde as Seções B/C de vez, porque comparavam programa contra programa.

## Plan / todo status

- **Done:** Fases 0, 1 e 2 inteiras. `npx tsc --noEmit`, `npx eslint sim
  server/src src`, `npm test` (803 testes, 68 arquivos), `npm test` da `api/`
  (51), `npm run build` e `npm run dev:server` — todos limpos.
- **Pending:** Fases 3, 4 e 5. **O PR único ainda não foi aberto.**

## Known issues / risks

- **Nada chama `saveStances` ainda.** O fio inteiro (localStorage → wire →
  `initSquad`) está pronto e testado, mas o seletor de postura é trabalho da
  Fase 4 no `SquadBuilder`. Na prática toda postura é `normal` hoje, e o passo 3
  da verificação ponta a ponta do plano ("pôr tudo em `hold`") não dá para fazer
  pela UI — só por teste.
- **Dívida de balance, medida e não asserida:** esquadrão balanceado *perde*
  3-17 para um all-tank (`stone_golem` ×2, `ice_sentinel` ×2), 55 estruturas
  contra 17, n=20. Durabilidade está subprecificada. É da Fase 3 (§5, tetos de
  55% por mago); está fixada num comentário em `sim/agency.test.ts`.
- **A flaky de `App.test.ts` parece ter ido embora.** `plays both queued seats`
  era ~1 run em 3 por desenho (dois programas disputando um cooldown global);
  reescrito para contar casts no mundo, deu 8/8 limpos. Sob a taxa antiga isso
  tem ~4% de chance de ser sorte — evidência boa, não prova. Se voltar a falhar,
  o desenho mudou e vale investigar em vez de re-rodar.
- `MANA_MAX`/`MANA_START`/`SUDDEN_DEATH_MANA_MULTIPLIER` continuam em
  `config.ts` e `balance.json`. `MANA_MAX` ainda é lido (é o range do vocabulário
  `mana`, inerte até a Fase 5); os outros dois estão órfãos. Saem na Fase 5.
- O kind `'mana'` do `NumericConditionKind` continua no vocabulário e **retorna
  0** — todo `mana >= N` lê falso. Proposital: programas salvos ainda fazem
  parse até a Fase 5 apagar o leitor.

## Next steps

1. **Abrir o PR único** com os seis commits (`main` ← `feat/trainer-kits`).
2. **Fase 3** — `scripts/kit-report.mts`, voltas A e B da §5, tetos de 55% por
   mago. Começar pela dívida do all-tank acima.
3. **Fase 4** — `SquadBuilder` mostra kit + postura (**e chama `saveStances`**);
   carga por skill no `SquadPanel` a partir de `SquadMemberView.cooldowns`, que
   já chega pelo fio; telegraph; pós-partida por mago via `MageStat.casts`.
4. **Fase 5** — apagar `Deck.ts`, `strategy*.ts`, `strategyPresets.ts`, o kind
   `'mana'` e as constantes órfãs de `config.ts`/`balance.json`; `SpellRange`
   cicla kit por mago; reescrever `GDD.md` e `README.md`.

**Antes de cada fase:** `git status` e `git log` no worktree principal — o outro
agente commita nesta mesma branch. Stage por path explícito, nunca `git add -A`.
Verificar com `npx tsc --noEmit`, `npx eslint sim server/src src`, `npm test`
(Node 22 obrigatório), e `npm test` dentro de `api/`.
