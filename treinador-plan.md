# Plano — v1.3 Treinador

**Status:** plano — **não implementado**. `GDD.md` (v1.2) continua vigente até este
documento virar spec.
**Origem:** grill de produto (2026-08-16/17). Nenhuma linha de sim foi mexida
para isto.
**Zona:** o grosso vive em `sim/**` (coordenar) + UI de loadout/HUD (`src/**`).
Arquivo novo de propósito: não reescreve o GDD enquanto o modelo antigo ainda
roda.

> Este plano descreve o próximo pivot de produto. A v1.2 é idle de **programa**
> (`SE → carta`). A v1.3 é idle de **treinador**: o jogador monta o esquadrão,
> cada mago traz um kit de habilidades, a IA do mago dispara, e a habilidade
> some com o corpo. O jogo continua 100% idle na partida.

---

## 0. Por que agora

Três sintomas da v1.2 apontam para o mesmo lugar:

1. **Cartas genéricas.** A medição da §10 do GDD deu `responsiva` 6–6 contra
   `plana`: conjurar importa, conjurar na hora certa ainda não. O próprio GDD
   diz que isso é design de carta, não de vocabulário de regra.
2. **Três eixos que não se falam.** Esquadrão × baralho × programa. Qualquer
   carta funciona com qualquer time, então composição não paga e o catálogo
   precisa ser balanceado contra todos os times — o que empurra ainda mais
   para o genérico.
3. **A estética de carta ficou leftover.** Veio do Clash Royale (mão, ciclo,
   duas cores). No idle o jogador não clica a mão; o HUD ainda a mostra para
   responder “por que a Praga não saiu?”. É complexidade sem o verbo que a
   justificava.

A v1.3 não “cola carta no mago” como atalho de balance. Ela troca a fantasia:
o jogador deixa de ser o conjuror fora da arena e passa a ser o treinador de
quatro especialistas.

---

## 1. Grill — decisões travadas

Perguntas 1–5 foram respondidas. A 6–8 tinham default recomendado; a 9 entrou
depois (kits com mais de uma skill, cabendo no catálogo que já existe).

| # | Pergunta | Resposta | Efeito |
| --- | --- | --- | --- |
| 1 | Quem é o jogador? | **Treinador** | Some o conjuror. O mago *é* o kit. |
| 2 | Mago morto, a magia some? | **Sim** | Morte fica cara. Composição passa a valer. |
| 3 | Mão / ciclo / 2 cores? | **Leftover do CR** | Deck, mão e regra de cor saem. |
| 4 | Quem dispara a habilidade? | **IA do mago (`Brain`)** | O programa `SE → carta` perde o emprego. |
| 5 | Qual meta assusta mais? | **Um time só** (B) | Kits de 1 skill 1:1 *produzem* B. Por isso a 9 existe. |
| 6 | Depois de perder, edita o quê além do time? | *Não respondida.* Default deste plano: **postura por mago** (§3.4) | Sem isso o loop curto morre. |
| 7 | Mana de time continua? | *Não respondida.* Default deste plano: **cooldown por habilidade**, custo antigo vira duração de carga (§3.3) | Combina com a 2. |
| 8 | Kit fixo ou o jogador escolhe? | *Não respondida.* Default deste plano: **kit fixo na v1.3.0**; escolha 2-de-3 só se a 5 (meta B) aparecer na medição | UI mínima primeiro. |
| 9 | Uma skill por mago? | **Não — o catálogo atual dá 2 ou 3 por mago** | 9 magos × ~2.8 ≈ as 25 cartas. Sem inventar sistema novo. |
| 10 | Como não deixar o kit desbalanceado? | **Varredura IA-vs-IA**, a mesma família do `ai-report` (§5). A IA não “aprende” pesos; ela **joga** e o JSON muda | Sem isso, cooldown e `when` são chute. Sem o `Brain` gastar o kit, a varredura mente. |

Se 6, 7 ou 8 forem revertidas, anotar aqui antes de implementar. A 9 é
direção de catálogo, não número sagrado: um mago pode ter 2, outro 3; o que
não volta é “um ult e o resto é auto-ataque”.

---

## 2. O modelo

```text
Antes da partida o jogador escolhe 4 magos (mín. 1 de cada papel) e, se a
postura existir, regula o gatilho de cada um (segurar / normal / agressivo);
cada mago entra com o ataque de elemento que já tem + um kit de 2–3
habilidades tiradas do catálogo de feitiços atual;
durante a partida ninguém clica: o Brain anda, cobre, atira e agora também
dispara habilidade quando a política casa e a carga está pronta;
mago morto = aquelas habilidades fora do jogo até o respawn;
o jogador lê no mago (carga, telegraph, pós-partida) o que o kit fez, e
edita o esquadrão — e a postura — para a próxima.
```

**Promessa:** *“Troquei o Alquimista pelo Dervixe. A briga mudou porque o kit
mudou — e porque o Alquimista morto não joga mais Praga.”*

**O que não muda:** 1v1, 3 min + morte súbita, esquadrão permanente com
respawn, objetivo estrutural, idle na partida, sem ordem tática, sem mira.

**O que muda:** o verbo primário deixa de ser Programar e passa a ser
**Montar** (esquadrão +, se houver, postura). Skill expression vive na
composição e no kit que cada corpo carrega, não num editor de 12 regras.

---

## 3. Regras do kit

### 3.1 Fonte: o catálogo que já existe

Não há um segundo sistema de “ults”. Cada habilidade **é** um `SpellId` de
`sim/spells.ts` / `public/data/balance.json`. O applier (`target` + `apply` +
`spellRiders`) permanece. O que muda é **quem tem permissão de gastar** e
**de onde o `Brain` mira**.

Contagem hoje (fonte: `ALL_SPELLS`, não o texto da §9 do GDD, que ficou para
trás): **25 feitiços, 9 magos**.

| Arranjo | Contas |
| --- | --- |
| 7 magos × 3 + 2 magos × 2 | 25, catálogo inteiro, zero leftover |
| 9 magos × 2 + 7 skills de reserva | mais folga, meta mais raso |
| 9 magos × 1 | **fora.** É a resposta B da pergunta 5 |

Default: **7×3 + 2×2**, kits disjuntos (a mesma skill não vive em dois magos).
Disjunto é o que faz “trocar o Clérigo pelo Bardo” trocar o vocabulário da
partida, não só um stat.

### 3.2 Mapeamento de direção (não é balance)

Atribuição pela fantasia do mago, não pela cor da carta. Cores deixam de ser
regra de construção; podem continuar como tint no VFX.

| Mago | Papel | Kit proposto | Por quê |
| --- | --- | --- | --- |
| Golem de Pedra | Tank | Escudo Arcano, Vínculo de Solidariedade, Chamado à Batalha | Aguenta, reparte dano, devolve presença |
| Sentinela de Gelo | Tank | Pântano Pegajoso, Petrificar, Maldição da Lentidão | Tank de controle |
| Piromante | Dano | Erupção Vulcânica, Chuva de Meteoros, Frenesi Sanguinário | Burst + amplificar o próprio fogo |
| Condutor de Raio | Dano | Fúria do Trovão, Campo de Sobrecarga, Fluxo de Mana | Controle duro + economia |
| Arqueiro Arcano | Dano | Marca do Carrasco, Clarão Nulo | (*2 skills*) marcação e dispel; splash já está no auto-ataque |
| Alquimista | Dano | Praga, Raízes Entrelaçadas, Tributo Obscuro | Zona + root + sacrifício |
| Dervixe do Vento | Dano | Dobra Espacial, Vórtice Gravitacional, Fenda de Cristal | Deslocamento e terreno |
| Clérigo | Suporte | Bênção de Ímpeto, Solo Consagrado, Brisa Rejuvenescedora | Sustentar |
| Bardo Arcano | Suporte | Vínculo da Dor, Paranoia | (*2 skills*) sabotagem; a aura de conjuração já é o passivo |

Isso é um **primeiro corte** para não começar o pivot com um catálogo vazio.
Antes da Fase 1, uma passagem humana pode trocar par (mago, skill) sem mudar
o modelo. O que o modelo exige:

- Nenhuma skill em dois magos.
- Todo mago tem ≥ 2, salvo os dois de 2 no arranjo 7×3+2×2.
- Cada kit tem **papéis internos diferentes** (não três maldições de área
  iguais). O Clérigo não leva três curas; o Piromante não leva três danos
  puros. A medição da v1.2 já mostrou que “tudo é AoE genérico” mata a
  situação.

### 3.3 Economia: carga no corpo, não mão

Default da pergunta 7:

- Some o baralho, a mão, o ciclo, `MAX_COLORS` / `MAX_COPIES` / `MIN_DISTINCT`.
- Some o cooldown global de 0.75 s *por time* como único relógio de magia.
- Cada habilidade tem **cooldown próprio**, derivado do `cost` atual (2 →
  curto, 5 → longo). O número vive no `balance.json`; a fórmula de conversão
  é um dial, não código especial.
- Mago morto ou em respawn: as cargas daquele mago não andam e não disparam.
- Um mago não gasta duas skills no mesmo quadro — GCD curto **por mago**, não
  por time. Quatro magos podem disparar no mesmo segundo. Isso é o oposto do
  modelo CR, e é o ponto: o time inteiro é o orçamento, não uma fila de 4.

Mana de time fica **desligada** neste default. Se a Fase 3 mostrar dump de
skills (todo mundo estoura o kit no primeiro aglomerado), religar mana como
teto compartilhado é um dial — não o desenho de abertura.

### 3.4 Gatilho: o `Brain`, com postura (default da pergunta 6)

O `Tactician` (programa do jogador) e o `Commander` (heurística do bot) hoje
escolhem carta *por time*. Na v1.3 a decisão desce para o mago.

Cada skill no `balance.json` ganha uma **política de disparo** (dado, não
`switch` no `World`):

- `when` — um recorte pequeno do vocabulário que `strategyFacts` já calcula
  (aliado ferido, aglomerado inimigo, intruso, estrutura sob ataque, self HP
  baixo). Sem editor recursivo.
- `at` — um seletor, também já existente. A origem da área é o ponto do
  seletor, **desde que o mago esteja vivo**; alcance máximo a partir do mago
  (skill que pede `enemy_cluster` a 30 m não sai).
- `selfGcd` / `cooldown` — ver §3.3.

O `Brain` pontua as skills prontas do próprio mago e dispara a de maior
utilidade que passa no `when`. **Zero `Rng` no gatilho** — a regra de ouro da
v1.2 sobrevive: editar o loadout não pode embaralhar como os magos *andam*.
O `Rng` do servidor continua no `Brain` de movimento/esquiva e em mais
nenhum caster.

**Postura** (3 valores, por mago, default `normal`):

| Postura | Efeito |
| --- | --- |
| `hold` | Só dispara se o `when` for estrutural ou self-HP crítico. Kit quase parado. |
| `normal` | A política do `balance.json` como está. |
| `aggressive` | Ignora a guarda de “esperar o bom momento”; dispara no primeiro `when` verdadeiro. |

Isso é o que o jogador edita depois de “o Piromante ultou atrasado” — sem
voltar a um IDE de 12 regras. Se na implementação a postura parecer
cosmética, cair para kit-só e medir (pergunta 5).

### 3.5 O que o mago já faz não entra no kit

Ataque elemental (`onHit`), cura do Clérigo, aura do Bardo, papel
(`ROLE_BEHAVIOR`) **continuam passivos / auto-ataque**. O kit é o que *antes*
era carta: efeito de área caro, com carga, com telegraph.

---

## 4. Agência (a §10 precisa nascer de novo)

A linha de base da v1.2 era estrutural: `emptyStrategy()` conjura **zero**
vezes. Sem programa, isso some.

Nova linha de base, representável:

| Estado | O que é | O que o teste afirma |
| --- | --- | --- |
| **Vazio** | Esquadrão padrão, todas as posturas em `hold` | Habilidades ≈ 0 (só auto-ataque / passivo) |
| **Padrão** | Esquadrão padrão, posturas `normal` | O `Brain` gasta o kit |
| **Autoral** | Esquadrão diferente do default (e/ou posturas) | Ganha do vazio; e, se a 5 importar, dois esquadrões distintos não empatam perto de 50% no mesmo mapa |

O harness (`sim/agency.test.ts`, `scripts/ai-report.mts`) **não se apaga**.
Troca o eixo: composição (+ postura) no lugar de programa. Critérios de
saída da Fase 3:

1. Autoral vs vazio: gap visível (a §10 pedia ~80% das decididas; o número
   exato se mede, não se chuta).
2. Dois esquadrões diferentes, mesma postura: deixam de empatar perto de 50%.
3. `hold` vs `aggressive` no *mesmo* esquadrão: se der 50%, a pergunta 6
   estava errada e a postura sai.

O risco da pergunta 5 (um time só) aparece aqui, não no feeling. Se um único
quarteto dominar a varredura, a válvula é a pergunta 8: o jogador passa a
escolher 2 skills de um pool de 3 daquele mago — segundo eixo, ainda sem
carta.

Os números desta seção **não se chutam**. Saem do loop da §5.

---

## 5. Loop de balance — a IA mede, o JSON muda

Não é treino de rede. O `Brain` é heurística (`sim/bot/Brain.ts`),
determinística no gatilho da skill (regra de ouro da v1.2). “Treinar a IA”
aqui significa duas voltas acopladas, nesta ordem, sobre o harness que já
existe (`scripts/ai-report.mts`, `sim/agency.test.ts`, `sim/matchStats.ts`):

```text
1. Política   o Brain passa a gastar o kit (when / at / postura)
2. Medição    milhares de partidas headless, esquadrão × esquadrão
3. Leitura    win% por mago, uso por skill, dump, hold vs aggressive
4. Ajuste     um dial em balance.json (cooldown, magnitude, when — um por vez)
5. De novo    até os tetos abaixo, ou até a medição dizer que o modelo é o limite
```

A volta 1 sem a 2 deixa skill forte que ninguém lança parecer fraca. A volta
2 sem a 1 é o bug que o GDD §14 já registrou: `ai-report` rodando sobre
`defaultDeck()` **não mede carta nova**. O mesmo vale para kit: se o mago
não dispara Erupção, nerfar Erupção é teatro.

Rodar o `ai-report` **hoje**, no modelo v1.2, serve de linha de base do
`Brain` de movimento (mix de ações, empate, profundidade). **Não** balanceia
kit. Kit só entra na Fase 3, depois da Fase 1.

### 5.1 O que a varredura tem que reportar

O relatório atual responde “quem ganhou” e “que ação o mago viveu”
(`advance` / `attack` / …). Na v1.3 ele precisa, por seed, com lados
alternados (o mapa não é simétrico — o harness já faz isso):

| Corte | Pergunta | Sinal de problema |
| --- | --- | --- |
| Espelho | Mesmo esquadrão nos dois lados | Win% longe de 50% = viés de mapa, não de kit |
| Padrão vs vazio (`hold`) | A §4 | Sem gap = agência morta |
| Leave-one-out | Default × default com **um** mago trocado | Trocar não move o resultado = composição cosmética |
| Todos-contra-todos | Quarteto legal × quarteto legal | Um time > ~55% do pool = meta da pergunta 5 |
| Por mago | Em quantas partidas o mago esteve no vencedor | Um mago > ~55% ou < ~45% no pool |
| Por skill | Casts, e win% das partidas em que ela saiu ≥ 1 vez | Skill a 0 casts = política cega; skill a 80% quando sai = número |
| Dump | Casts no primeiro minuto vs no resto | Kit inteiro no primeiro aglomerado = cooldown / `when` frouxos |
| Postura | `hold` × `aggressive` no mesmo quarteto | 50% = pergunta 6 era ruído |

Herdar o critério de saúde da §14 do GDD, agora no mago e na skill:

- Nenhum mago acima de **~55%** de vitória contra o pool.
- Nenhuma skill a **100/0** no recorte em que ela é gasta.
- Taxa de empate continua **critério de regressão** (a v1.2 zerou; não
  reabrir).
- Skill com 0 casts na varredura não se nerfa: conserta-se o `when`.

`sim/matchStats.ts` já devolve `casts` por `SpellId` e `kills`/`deaths` por
mago. O que falta é o *sweep* chamar isso por composição, não só por
programa.

### 5.2 As duas voltas, sem misturar o dial

**Volta A — a IA consegue gastar.** Primeiro objetivo: toda skill do catálogo
aparece na varredura um número de vezes da ordem das outras do mesmo custo.
Se Petrificar nunca sai, o `when` está errado (ou o alcance), não o
`duration`. Mexer em dano aqui é o erro clássico da v1.1 (dificuldade
invertida porque o bot *gastava menos*).

**Volta B — o número.** Só com uso não-zero: um dial por passagem
(cooldown **ou** magnitude **ou** raio **ou** `when`). Re-rodar o mesmo
conjunto de seeds. Se o win% do mago não andou, o dial era o errado — não
empilhar três mudanças e adivinhar qual funcionou.

Humano aceita o diff do `balance.json`. Um script que *sugere* “+0.5 s no
cooldown de Meteoros” a partir do desvio é bem-vindo **depois** que a volta
A está estável; um otimizador que reescreve 25 skills sozinho overfita o
`Brain` e fabrica o meta da pergunta 5. Fora da v1.3.0.

### 5.3 Tamanho da amostra

120 partidas bastaram para a §10 dizer “responsiva = plana”. Não bastam para
25 skills × 9 magos. Ordem de grandeza da Fase 3:

- Espelho + padrão vs vazio: dezenas de seeds (barato, regressão de CI).
- Leave-one-out dos 9 magos no default: centenas.
- Todos-contra-todos de quartetos legais: milhares, **fora** do `npm test`.
  Vive no `ai-report` (ou sucessor `scripts/kit-report.mts`), com seed list
  fixa para o mesmo comando ser reproduzível.

CI guarda o piso (agência, empate, “toda skill castou ≥ N vezes neste
conjunto pequeno”). O teto de 55% é relatório, não assert, até o volume
existir — senão um flake de 12 seeds vira nerf.

### 5.4 O que não fazer

- Balancear kit no `Commander` / `Tactician` atuais. Eles jogam *por time*,
  não por mago. O número que sair descreve o modelo velho.
- Treinar rede, fitness genético, ou “a IA edita o JSON sozinha” na primeira
  passagem.
- Afirmar que um mago está fraco porque o `Brain` ainda não sabe largar
  Torre (dívida da §11 do GDD). Skill de siege espera a política de
  estrutura, ou a varredura culpa o kit pelo `Brain`.

---

## 6. UI

Ganho real, e é requisito, não polimento.

**Some**

- Aba Deck (`src/app/screens/DeckBuilder.tsx`).
- Aba Strategy e o IDE (`src/app/screens/strategy/**`, `StrategyBuilder`).
- Mão de 4 + preview da próxima no `MatchHUD`.
- `firedRule` na forma “Regra 3 · Praga → aglomerado”.
- Validação de cor / cópias / cartas distintas na UI.

**Fica e cresce**

- `SquadBuilder` vira **a** tela de loadout. Cada card de mago mostra o kit
  (2–3 nomes + cooldown). Postura, se existir, é um controle de 3 estados no
  slot, não uma segunda aba.
- `SquadPanel` na partida: além de HP/status, **carga de cada skill** no chip
  do mago. Mago morto = skills apagadas, não “em cooldown em algum lugar”.

**Entra**

- Telegraph no chão quando o `Brain` decide soltar (o VFX de carta já existe
  por `SpellId` — reusa `src/render/spellVfx.ts` / `src/engine/spellSfx.ts`).
- Pós-partida: por mago, skills usadas e (se der) o que elas mataram /
  salvaram. Atribuição no corpo. Sem isso o idle é screensaver — a §17 do
  GDD continua valendo, só muda o sujeito da frase.

A mão hoje existe para responder “por que ainda não jogou a Praga?”. Sem
baralho, essa pergunta vira “por que o Alquimista ainda não soltou Praga?” e
a resposta tem que estar **no mago**.

---

## 7. O que morre no código, o que sobrevive

### Sobrevive (não reescrever)

- `sim/World.ts` applier de feitiço, `sim/spellRiders.ts`, `sim/effects.ts`.
- Catálogo em `public/data/balance.json` (`spells.*`) — ganha dono e cooldown,
  não um formato novo.
- `sim/cards.ts` / roster / papéis / elementos / `Brain` de movimento.
- Arena, estruturas, respawn, matchmaking, snapshots, VFX/SFX por `SpellId`.
- `CastMsg` continua `@deprecated` (idle).

### Morre (depois que o novo caminho está verde)

- `sim/Deck.ts` (mão, ciclo, regras de construção).
- `sim/strategy.ts` + `strategyFacts.ts` como *programa do jogador*. O vocabulário
  de fatos pode ser extraído para o `Brain` — o editor e o `Tactician` não.
- `sim/bot/Tactician.ts` e, no assento de bot, o `Commander` como caster de
  time. Os dois lados passam a ser o mesmo `Brain`. Isso é simplificação: hoje
  humano e bot *não* jogam o mesmo jogo de magia.
- Abas e persistência `deck` / `strategy` no loadout (com migração: loadout v2
  → v3 descarta baralho/programa, mantém squad).

### Fio (`sim/protocol.ts`)

| Campo | Destino |
| --- | --- |
| `SetLoadoutMsg.deck` / `strategy` | Deprecar; aceitar `stances?: Record<RosterId, Posture>` |
| `SnapshotMsg.hand` / `next` | Sair |
| `SnapshotMsg.mana` | Sair se a §3.3 ficar de pé |
| `SnapshotMsg.firedRule` | Virar `firedAbility?: { mageId, spellId, at }` (POV do destinatário) |
| `MageSnapshotDTO` | Ganhar carga por skill do kit (ids estáveis) |

Servidor (`server/src/**`) e `api/` (schema de loadout) acompanham na mesma
fase que o fio — senão practice e online divergem.

---

## 8. Fases

Não misturar. Cada fase termina com teste, não com “a UI já parece o produto”.

### Fase 0 — Contrato (este doc + dado)

- Travas da §1 revisadas (6/7/8).
- Tabela da §3.2 confirmada ou substituída *no papel*.
- `balance.json`: cada `RosterId` aponta para `abilities: SpellId[]` (2 ou 3)
  e cada spell ganha `cooldown` + `when` + `at`. Ainda ninguém dispara.

**Pronto quando:** um teste de catálogo afirma: kits disjuntos, todo mago ≥ 2,
todo `SpellId` tem dono, `when`/`at` são valores do vocabulário já existente.

### Fase 1 — Sim: o mago gasta o próprio kit

- `World.castSpell` passa a exigir o mago vivo dono daquela skill (ou uma
  função nova com a mesma applier).
- `Brain` escolhe entre skills prontas; GCD por mago.
- Morte / respawn corta o kit.
- Sem UI nova ainda. Headless.

**Pronto quando:** testes de sim — mago morto não lança; mago A não lança a
skill de B; dois magos do mesmo time podem lançar no mesmo segundo; o gatilho
é determinístico (mesmo seed, mesmo log de casts).

### Fase 2 — Loadout e fio

- Loadout v3: `squad` + `stances`. Drop de `deck`/`strategy`.
- `set_loadout` / API / matchmaker.
- Snapshot: cargas no mago, `firedAbility`, sem mão.

**Pronto quando:** practice e uma sala online disparam o mesmo kit a partir do
mesmo loadout. `validateDeck` / `validateStrategy` saem do caminho quente.

### Fase 3 — A IA joga, o JSON afina (§5)

Isto **é** o balance do kit. Não é um extra depois do ship.

1. Reescrever o sweep: esquadrão × esquadrão, lados alternados, `matchStats`
   por mago e por skill. CI fica com o piso (agência, empate, “kit foi
   gasto”). Volume grande fica no script.
2. **Volta A.** Toda skill com casts da ordem das pares. Ajustar `when` /
   alcance / postura, não dano.
3. **Volta B.** Um dial por passagem em `balance.json` até os tetos da §5.1
   (mago ≲ 55% do pool, skill não 100/0, dump visível).
4. Só então decidir pergunta 8 (2-de-3) e religar mana — com número, não com
   feeling.

**Pronto quando:** os três critérios da §4 **e** os tetos da §5.1 têm número
no relatório, mesmo que feio. Feio afina; ausente não.

### Fase 4 — UI e atribuição

- SquadBuilder mostra kit (+ postura).
- HUD: some a mão; carga no `SquadPanel`; telegraph reusa VFX.
- Pós-partida por mago.

**Pronto quando:** uma partida muda de composição e o jogador consegue dizer,
olhando o HUD, *qual mago* fez o quê, sem abrir o JSON.

### Fase 5 — Enterrar o leftover

- Remover `DeckBuilder`, `StrategyBuilder`, `Tactician` do boot.
- GDD.md v1.3: reescrever §1, §2, §7, §9, §10, §13, §17. Este plano vira
  histórico, no mesmo espírito de `design.md`.

---

## 9. Fora de escopo (v1.3)

- Jogador conjurar durante a partida.
- Habilidade que *exige* o mago no ponto (origem = pés, área = só em volta).
  O seletor continua existindo; o mago é **permissão + alcance**, não o
  centro obrigatório. Idle não posiciona.
- Inventar 25 habilidades novas. O catálogo é o estoque.
- Gacha, nível de carta, 5v5, invocação.
- Escolha 2-de-3 (pergunta 8) — só se a Fase 3 mostrar meta de um time só.
- Religar mana de time — só se a Fase 3 mostrar dump.
- Otimizador que reescreve `balance.json` sozinho (genético, rede, auto-nerf
  em loop). A IA **mede**; o humano aceita o dial.

---

## 10. Riscos

| Risco | Por que é real | Mitigação |
| --- | --- | --- |
| Meta de 4 magos | 9 peças, 1 de cada papel, espaço pequeno. Pergunta 5. | Kits de 2–3 (já); medir; só então 2-de-3. |
| Screensaver | Sem rastro de regra, a partida não atribui. | Carga no mago + `firedAbility` + pós-partida. Fase 4 não é polimento. |
| `Brain` vira o jogador | “Melhor momento” não é editável. | Postura; política no JSON; zero RNG no gatilho. |
| Magos encravados em Torre | Dívida já escrita no GDD §11. Skill de siege (Chamado, Meteoros) pode piorar. | Não abrir skill de estrutura na Fase 1 sem o `Brain` já saber largar Torre. |
| Pivot pela metade | Practice no modelo novo, online no velho. | Fase 2 fecha fio + API + matchmaker juntos. `sim/**` é zona compartilhada. |
| Medir o modelo velho | `ai-report` hoje joga carta por time (`Commander`/`Tactician`) | Kit só entra no sweep depois da Fase 1. |
| Nerf cego | Skill a 0 casts parece fraca | Volta A antes da B (§5.2). |

---

## 11. Relação com o GDD v1.2

Até a Fase 5, se o código e este plano discordarem, **o código (v1.2) ganha**.
Este arquivo é intenção.

Quando a Fase 5 fechar, o GDD herda:

- Verbo primário: Montar (treinador), não Programar.
- As três montagens viram uma (esquadrão + postura).
- Catálogo §9: magos *com* kit, não magos *e* cartas.
- §10 / §14 reescritas no eixo da §4 (agência) e da §5 (varredura por mago/skill).
- Non-goal novo: baralho, mão, ciclo, programa de 12 regras.

---

## 12. Próximo passo concreto

Não é código de kit, e **não é rodar o `ai-report` atual achando que isso
afina magia de mago** — ele mede programa e `defaultDeck()`.

1. Fechar 6 / 7 / 8 com um “sim, o default serve” ou um veto, e passar a
   tabela da §3.2.
2. Fase 0: `balance.json` + teste de catálogo (kits disjuntos, `when`/`at`).
3. Fase 1: o `Brain` dispara. Sem isso a §5 mente.
4. Fase 3: o loop da §5 (política → medição → um dial → de novo).

Opcional, em paralelo, sem misturar com kit: uma corrida do
`npx tsx scripts/ai-report.mts` hoje, só para ter a linha de base do
*movimento* (mix de ações, empate). Guardar o output ao lado deste plano;
não usá-lo para nerfar `spells.*`.
