# Handover — 2026-08-04 (Claude — o jogo novo foi CONSTRUÍDO: estruturas, mana, cartas, fila 1v1) — READ THIS FIRST

## 🛑 Antes de qualquer coisa: NÃO DELETAR `sim/**` NEM `server/src/**`

Continua valendo, e agora com mais força: essas pastas **são o jogo novo**, não
legado. A única remoção do pivot foram as 7 linhas do `InputMsg`, já feita.

## O que esta sessão fez

Executou os passos 1–5 do `GDD.md` §13 e mais a fila de matchmaking que o usuário
pediu no meio da sessão. **A partida do modelo novo roda headless de ponta a
ponta.** O que falta para ser jogável por humano é a UI (§13, passo 6).

`npm run typecheck && npm run lint && npm test && npm run build` — verdes.
**262 testes** (eram 208), 0 erros de lint.

### Arquivos novos

| Arquivo | O que é |
| --- | --- |
| `sim/roles.ts` | Os 3 papéis (tank/dano/suporte) e o comportamento de cada um |
| `sim/cards.ts` | Catálogo de 9 cartas de unidade da GDD §9 |
| `sim/Deck.ts` | Baralho de 8, mão de 4, preview, ciclo, validação de construção |
| `sim/bot/Commander.ts` | **Bot que joga cartas** — agente distinto do `Brain` |
| `server/src/Matchmaker.ts` | Fila 1v1 com fallback para bot após 12 s |
| `public/maps/siege1.json` | Mapa com Núcleo + 2 Torres por lado |
| `sim/siege.test.ts` | Estruturas, mana, zona de invocação, suportes (23 testes) |
| `sim/agency.test.ts` | **O teste de agência da §10, rodando** |
| `sim/Deck.test.ts`, `server/src/Matchmaker.test.ts` | — |

### Mudanças principais

- **`sim/World.ts`** ganhou: estruturas vivas (Núcleo imune enquanto as Torres de pé), torres que atiram, mana por time com regeneração, `deploy()`/`summon()`/`canSummonAt()`, e a condição de vitória por estrutura + morte súbita. `checkRoundEnd` por eliminação **saiu** — ficar sem unidades agora é estado normal.
- **`sim/entities.ts`**: `Structure` novo; `Mage` ganhou `role`, `cardId`, `moveSpeed`, `maxHealth` por unidade e `chargeRateBonus`.
- **`sim/bot/Brain.ts`**: ação `siege` nova, alvo estrutural, avanço, e comportamento por papel. **O modelo de utilidade e as 3 dificuldades não foram tocados** — é extensão, como o GDD previu.
- **`sim/protocol.ts`**: `InputMsg` → `CastMsg`; snapshot ganhou `structures`, `mana`, `elapsed`, `suddenDeath`; `join_queue`/`leave_queue`/`queue_status`/`match_found` novos.
- **`server/src/Session.ts`**: decks por time, `submitCast`, comandantes de IA para assento vazio, e **todas** as unidades dirigidas pelo `Brain` (não só "os bots").
- **`server/src/Room.ts`**: `startMatch()` agora cria mundo **vazio** — jogador não tem avatar.

## 🔬 O que a medição revelou (a parte que importa)

O harness de simulação da §14 foi construído e **imediatamente encontrou coisas
que nenhuma leitura de código acharia**:

1. **Zero unidades entravam no mundo.** Todo deploy do bot era rejeitado como `blocked_position`: o `Commander` escolhia posição validando com `canDeployAt`, que só conhece a zona de invocação e não sabe de obstáculos nem de estruturas. Corrigido com um predicado único, `World.canSummonAt`.
2. **Bug de zona de invocação**: `Math.sign(0) === 0`, então a linha `y=0` não casava com nenhuma torre e o flanco era considerado quebrado desde o início — dava para invocar no meio do campo inimigo no segundo 1.
3. **Empate era o resultado padrão.** `hard` vs `easy` empatava **6/6** no timeout. Corrigido baixando estrutura de 1400/700 para 900/400 e dano de torre de 14 para 10.
4. **A dificuldade estava invertida**: `hard` perdia **0/6** para `easy`, porque guardava 3 de mana de reserva e invocava menos. Os dois lados são limitados por mana, não por cadência de decisão (30 casts contra 27 numa partida inteira) — a dificuldade foi movida para *responder a ameaça* e *escolher a carta certa*.

### Estado dos dois testes de agência

| Alegação | Estado |
| --- | --- |
| **AFK precisa perder** (risco #1 do pivot) | ✅ **Fechado.** AFK perde 5/5 seeds, em 93–136 s, perdendo 3 estruturas contra 0 |
| **Habilidade precisa separar** | ⚠️ **Aberto.** hard 2, easy 1, **3 empates**. Melhor que invertido, longe de resolvido |

O teste em `agency.test.ts` afirma hoje só o que é verdade: que a habilidade não
está *invertida*. Afirmar maioria seria um teste vermelho documentando um passe
de balance inacabado. **Empate entre dois jogadores bons é o problema aberto
número um do jogo.**

## Cuidado / não feito

- **Não há UI.** `OnlineMatch` renderiza snapshots e já tem `selectCard()`/`castCard()` + o raycast de chão ligado ao clique, mas **não existe mão de cartas, barra de mana nem relógio na tela**. `pumpInput` foi neutralizado de propósito (comentado no arquivo). Um humano ainda não consegue jogar pelo browser — só bots jogam.
- **Feitiços não existem.** Só as 9 unidades. Os 4 feitiços da §9 dependem do sistema genérico de status effects (§13, passo 7).
- **Seleção de elemento no lobby virou vestigial.** `Room` ainda exige elemento por slot; a sim ignora. Limpar quando a UI de lobby for refeita.
- **Números de balance mudaram e vão mudar de novo.** 900/400 e dano 10 são resultado de duas rodadas de medição com 6 seeds — não de milhares de partidas. Ver §14.
- Containers Docker desatualizados. Nada commitado.

## Próximos passos

1. **UI da partida** (§13 passo 6): mão de 4 cartas, barra de mana, preview da próxima, relógio, HP das estruturas. É o que falta para um humano jogar.
2. **UI da fila**: botão Batalhar + tela de espera consumindo `queue_status`/`match_found`.
3. Renderizar estruturas (`ArenaRenderer` não conhece Núcleo/Torre ainda) e consumir `structures` do snapshot no `SnapshotSync`.
4. Status effects genéricos + os 4 feitiços (§13 passo 7).
5. **Atacar a taxa de empate** com simulação em massa (§13 passo 8) — ver §14.

---

# Handover — 2026-08-04 (Claude — GDD reescrito: modelo Clash Royale fechado)

## 🛑 NÃO DELETAR `sim/**` NEM `server/src/**`

O pivot diz "o jogo não é mais de controle direto". O instinto errado ao ler isso
é apagar o modo online. **A única remoção real do pivot são as 7 linhas do
`InputMsg` em `sim/protocol.ts:29`.** Todo o resto — a sim compartilhada (2.873
linhas) e o servidor Node (2.038 linhas) — é a fundação do jogo novo, não legado.
Se você está começando esta sessão pensando em remoção em massa, você não leu
`GDD.md` §13.

## O que esta sessão fez

Fechou as decisões que o handover de baixo deixou bloqueando, e **reescreveu
`GDD.md` do zero** (0.1 → 1.0). Nenhuma linha de código de produção mudou.

### Decisões fechadas com o usuário

| Pergunta | Decisão |
| --- | --- |
| Real-time ou assíncrono? | **Real-time, modelo Clash Royale** (usuário citou o CR como referência direta) |
| Identidade dos magos | **Papel** (tank / dano / suporte), não elemento |
| Economia de recurso | **Mana que regenera + custo por cast** (elixir do CR) |

### A consequência mais importante: o risco #1 morreu

O handover de baixo cravava "agência" como o risco número um do idle puro. O
modelo Clash Royale resolve isso **por construção**: a agência não está em
comandar unidade (o que continua proibido — magos invocados são 100% IA), está em
*o que invocar, onde e quando*. Uma partida AFK vira derrota garantida em ~90 s.
`GDD.md` §10 transforma isso em teste executável de CI, aproveitando que a sim é
determinística e headless.

### Duas correções ao handover de baixo (reduzem custo estimado)

1. **`sim/elements.ts` NÃO precisa ser reescrito.** O handover assumiu que
   "elemento vira papel" significava jogar fora o catálogo. Não: aquele arquivo é
   o catálogo de *ataque* (dano/knockback/arco/poça, 7 conjuntos afinados e
   testados). Papel é propriedade da unidade; cada unidade tem um elemento fixo
   como ataque. Os dois coexistem sem combinação a balancear.
2. **Invocação em runtime já é suportada.** `World.addMage()` (`sim/World.ts:61`)
   cria mago a qualquer momento; só posiciona por slot de spawn. Falta apenas uma
   variante que aceite posição. Não é arquitetura nova.

Também confirmado: mapa é **dado puro** (`width`/`height`/`objects[]`/`spawns[]`),
então a arena de estruturas é um JSON novo, não código.

## Arquivos tocados

- **`GDD.md` — reescrito por inteiro** (~330 linhas). Contém: modelo e o que
  copiamos/não copiamos do CR (§3), estrutura de partida e vitória (§4), arena com
  Núcleo/Torres (§5), economia de mana (§6), baralho/mão/ciclo (§7), os 3 papéis
  (§8), catálogo de 13 cartas (§9), o teste de agência (§10), o que muda no
  `Brain` (§11), progressão sem poder pago (§12), **mapeamento técnico completo
  do que sobrevive/muda/é novo + ordem de implementação (§13)**, balance IA-vs-IA
  (§14), perguntas em aberto (§16).
- **`design.md` e `multiplayer-plan.md`** — banner de DOCUMENTO HISTÓRICO no topo,
  conteúdo intocado. O banner do multiplayer-plan deixa explícito que o
  transporte/lobby/sim que ele descreve **continuam em uso**; caducou só o modelo
  de jogo em cima deles.

## Verificado

`npm run typecheck` limpo, `npm test` **208/208 verdes** (28 arquivos). A
fundação descrita no GDD está de fato funcionando — não é design em cima de código
quebrado.

## Próximos passos (a ordem está em `GDD.md` §13)

1. `Structure` (Núcleo/Torre) na sim + vitória por estrutura — destrava todo o resto
2. Sistema de mana no servidor + `CastMsg` no protocolo
3. `addMageAt(position)` + validação de zona de invocação
4. Catálogo de cartas como dado, só unidades primeiro
5. Ajustes do `Brain` (§11: alvo estrutural, vetor de avanço, comportamento por papel)
6. UI: mão de 4 cartas, barra de mana, preview da próxima
7. Status effects genéricos + os 4 feitiços
8. Harness de simulação em massa — **antes** de discutir balance

## Cuidado / não feito

- **Nenhum código de produção foi escrito.** Só documentação.
- **`GDD.md` é zona de "coordenar antes de editar"** no `AGENTS.md`, e foi
  reescrito inteiro a pedido do usuário. Alinhar com o Cursor antes de ele pegar
  essa fatia.
- **Perguntas ainda abertas** (`GDD.md` §16): duas Torres ou uma; se 13 cartas
  bastam para o v1; legibilidade do papel Suporte; o que fazer com o practice mode
  congelado em `src/systems/**`, que agora descreve um jogo que não existe mais.
- Números da §9 são **direção de design, não balance**. Só viram balance depois do
  harness do passo 8.
- Containers Docker continuam desatualizados. Nada commitado — tudo na working tree.

---

# Handover — 2026-08-04 (Claude — PIVOT DE PRODUTO: brawl de controle direto → idle/auto-battler online)

> **Nenhuma linha de código foi escrita nesta sessão.** Foi uma sessão de decisão
> de produto. O que segue é o contrato para a próxima sessão começar a executar.
> A working tree continua exatamente como o handover de baixo deixou (servidor
> Node + `sim/` compartilhada, nada commitado).

## A decisão

O jogo deixa de ser um brawl de controle direto e passa a ser um **idle/auto-battler
online**: cada jogador invoca 2–3 magos que lutam sozinhos, comandados pela IA; o
jogador não move nem mira ninguém — ele gasta recurso lançando **habilidades, buffs
e maldições**.

Três escolhas fechadas com o usuário nesta sessão:

| Pergunta | Decisão |
| --- | --- |
| Escopo do GDD | **Reescrever o `GDD.md` inteiro.** O jogo idle é o produto; o brawl de controle direto sai do documento. |
| Agência do jogador na partida | **Idle puro — só habilidades.** Sem camada de ordens táticas (sem "foca nesse", sem "recua"). Os magos lutam 100% pela IA. |
| Practice mode atual (`src/systems/**`) | **Fica como está, congelado.** Não é migrado nem deletado nesta virada. |

## Por que isso é mais fácil (o motivo é específico, não é otimismo)

As três sessões anteriores queimaram no mesmo problema: *"online não parece o
practice mode"*. Os bugs encontrados foram mira virando vetor unitário, movimento
travado ao carregar, knockback instantâneo, câmera. **Todos são bugs de controle
direto.** Latência de 150 ms em mirar é fatal; em "lançar uma maldição" é
invisível. O modelo idle não conserta essa categoria de bug — ele a **elimina**.

E o ativo mais caro do repo já está pronto e é exatamente o motor de um
auto-battler: `sim/bot/Brain.ts` (671 linhas — modelo de utilidade com 5 ações,
focus-fire de esquadrão, cover/peek, dodge reativo, aim leading, 3 dificuldades,
com `Brain.test.ts`). Hoje ele existe só para preencher vaga vazia. No modelo
idle ele **vira o jogo**.

## ⚠️ Correção crítica antes de qualquer código: "em cima do practice mode" ≠ `src/systems/`

O usuário descreveu o pivot como *"totalmente em cima do practice mode"*. Isso
está **certo em intenção e errado em path**:

- O practice mode roda a sim **antiga**: `src/systems/**`, modelo `Player`/`moveTarget`,
  **sem elementos**, sem obstáculos na sim autoritativa (ver HANDOVER de baixo, seção
  "Cuidado / não feito").
- `sim/**` é essa mesma jogabilidade **já portada, testada e superior**: tem os 7
  elementos (`sim/elements.ts`), arena com obstáculos e line-of-sight (`sim/Arena.ts`),
  e `src/systems/AISystem.ts` (616 linhas) inteiro portado para `sim/bot/Brain.ts`.

**A base do jogo novo é `sim/`, não `src/systems/`.** Construir literalmente sobre
`src/systems/` recriaria a duplicação que a sessão anterior gastou ~4.300 linhas
removendo.

## Inventário: o que sobrevive, o que muda, o que é novo

### Sobrevive intacto (a maior parte do custo já pago)
`sim/World.ts`, `sim/Arena.ts`, `sim/elements.ts`, `sim/entities.ts`, `sim/Vec2.ts`,
`sim/rng.ts`, `sim/config.ts`, `sim/defaultMap.ts` · `sim/bot/Brain.ts` · o servidor
Node inteiro (`server/src/{Hub,Room,RoomManager,Session,App,main}.ts`) · o pipeline
de render do cliente (`src/net/SnapshotSync.ts`, `ArenaRenderer`, `PlayerRenderer`,
`ParticleRenderer`, `PuddleRenderer`, `HUD`, `Minimap`) · a `api/` (contas, ranking,
`MatchLog`) — que num idle passa a ser **mais** importante, não menos.

### Muda (é pouco, e é cirúrgico)
| Hoje | Vira |
| --- | --- |
| `InputMsg` (`move`/`aim`/`charging`/`release`) em `sim/protocol.ts:29` | `CommandMsg` — cast de habilidade + alvo. Frequência cai de ~60 Hz para eventos esparsos. |
| Captura WASD + mouse em `src/net/OnlineMatch.ts` | Barra de habilidades / painel de comandante |
| Câmera que segue o mago local | Câmera de visão geral do combate |
| 1 slot = 1 mago (`server/src/Session.ts`, `Room.ts`) | 1 comandante = N magos (2–3) |
| `teamSize` no `create_room` | Nº de comandantes por time × tamanho do esquadrão |

**Não apagar o "modo online".** O transporte, o lobby e a sim autoritativa
continuam iguais; só o `InputMsg` morre. Deletar `server/src/**` ou `sim/**` seria
jogar fora exatamente o que o modelo novo precisa.

### Novo — o custo real
O pivot **não reduz trabalho total**: ele troca trabalho de risco (netcode/feel)
por trabalho de design/balance. O que não existe hoje:

1. **Sistema de status effects genérico.** `sim/entities.ts` só tem `stunTimer`,
   `slowFactor`/`slowTimer`, `immunityTimer` — precedente, não sistema. Buffs,
   maldições, DoT, escudo, dispel pedem um modelo genérico com stacking e duração.
2. **Economia de recurso.** Não existe mana, custo de cast, nem cooldown. É o
   único freio do jogador num idle puro — define o ritmo da partida inteira.
3. **Catálogo de habilidades do comandante.** Não existe nada. Ver o risco abaixo.
4. **Balance IA-vs-IA.** O mais subestimado. O `Brain` foi afinado contra um humano
   que desvia; espelho de IA boa tende a empatar ou virar coinflip. Vai exigir
   simulação em massa (headless, `sim/` já roda fora do browser — usar isso).
5. **Roster/invocação.** Escolher 2–3 magos + elemento de cada, pré-partida.

## 🔴 O risco número um: agência

Com **idle puro** (decisão fechada), o kit de habilidades **é o jogo inteiro**.
Não há ordens táticas para compensar. Se os buffs/maldições não forem
decisivos — se o jogador sentir que o resultado seria o mesmo sem ele — o
produto vira protetor de tela e nenhuma quantidade de netcode salva.

Teste que o novo GDD tem que passar: **uma partida com o jogador AFK e a mesma
partida jogada bem precisam terminar diferente, de forma visível.** Se o design
não garantir isso explicitamente, ele está errado.

## Perguntas em aberto que o novo GDD precisa fechar

1. **Real-time ou assíncrono?** Idle games costumam ser assíncronos (você luta
   contra um *snapshot* do roster de outro jogador). O repo já tem salas
   real-time funcionando, então real-time é o caminho barato — mas assíncrono
   casa muito melhor com o gênero e com progressão. **Decidir isto primeiro:
   muda o `server/src/**` inteiro.**
2. Duração da partida e condição de vitória (hoje é vidas + `round_end`).
3. 2 ou 3 magos por jogador; quantos comandantes por time.
4. Progressão/meta: o que persiste na `api/` entre partidas.
5. Se os 7 elementos atuais bastam como identidade dos magos ou se elemento
   passa a ser classe/papel (tank, dano, suporte).

## Próximos passos sugeridos (ordem)

1. Fechar a pergunta 1 acima (real-time vs assíncrono) — bloqueia arquitetura.
2. Reescrever `GDD.md` do zero com o modelo idle, incluindo o catálogo de
   habilidades e a economia de recurso, e passando pelo teste de agência.
3. Só então código: status effects em `sim/`, depois `CommandMsg`, depois UI.
4. `multiplayer-plan.md` e `design.md` (1.820 linhas, descreve o controle direto)
   ficam **obsoletos** — marcar como histórico, não editar em paralelo.

## Cuidado / não feito

- **Nada foi codado.** Nenhum arquivo mudou nesta sessão.
- **A duplicação `sim/` vs `src/systems/` permanece por decisão** (practice mode
  congelado). Aceita conscientemente — mas quem mexer em `sim/` não deve
  presumir que o practice mode acompanha.
- `AGENTS.md` marca `sim/**` como zona de "coordenar sempre" e `GDD.md` como
  "coordenar antes de editar". Este pivot toca as duas — alinhar com o Cursor
  antes de reescrever o GDD.
- Os containers Docker continuam desatualizados (ver handover abaixo).

---

# Handover — 2026-08-04 (Claude — servidor Go substituído por servidor Node com a simulação compartilhada)

## Por que esta sessão aconteceu
Depois de duas sessões inteiras gastas em "online não parece o practice mode", o usuário perguntou se um servidor em Node teria facilitado, e depois se valeria trocar de engine. A conclusão foi que **o problema nunca foi a engine, foi a duplicação**: ~4.300 linhas de Go reimplementando à mão o que o cliente já tinha em TypeScript. O usuário aprovou a troca de arquitetura e pediu para fazer de uma vez.

## O que mudou

### 1. Novo pacote `sim/` — a simulação, compartilhada de verdade entre cliente e servidor
Nenhum arquivo Go foi traduzido "para o servidor": ele virou código que os dois lados importam.

| Novo | Substitui |
| --- | --- |
| `sim/World.ts` | `server/internal/game/world.go` |
| `sim/Arena.ts` | `server/internal/game/arena.go` |
| `sim/elements.ts` | `server/internal/game/elements.go` |
| `sim/entities.ts`, `sim/config.ts`, `sim/Vec2.ts` | `entities.go`, `config.go`, `vector.go` |
| `sim/bot/Brain.ts` | `server/internal/bot/ai.go` |
| `sim/protocol.ts` | `server/internal/protocol/protocol.go` **e** o antigo `src/net/protocol.ts` |
| `sim/rng.ts` | `math/rand` (PRNG mulberry32 semeado, determinístico) |
| `sim/defaultMap.ts` | `server/internal/game/maps/arena1.json` + `TestEmbeddedMapMatchesClientCopy` |

- **O mapa duplicado acabou.** `sim/defaultMap.ts` importa `public/maps/arena1.json` direto — o mesmo arquivo que o cliente faz fetch. O bundler embute em build time. O teste-guarda que existia só para detectar drift entre as duas cópias foi deletado porque não há mais duas cópias.
- **O protocolo duplicado acabou.** `src/net/protocol.ts` virou um re-export de `sim/protocol.ts`; zero imports do cliente mudaram.
- `sim/Vec2.ts` é **imutável** (valor, como o `Vec2` do Go), não o `Vector2` mutável do cliente — evita bugs de aliasing na sim autoritativa. O `Vector2` do render continua como está.

### 2. Novo servidor Node em `server/src/` — só lobby e transporte
`Room.ts` ← `room.go`, `RoomManager.ts` ← `manager.go`, `Session.ts` ← `match/session.go`, `Hub.ts` ← `ws/hub.go` (usando `ws`), `App.ts` ← `cmd/mageserver/{app,broadcast}.go`, `main.ts` ← `cmd/mageserver/main.go`.

Duas diferenças deliberadas em relação ao Go:
- **O mutex de `Session` não foi traduzido.** O event loop do Node já serializa tick e mensagem WebSocket; o lock não tem função.
- **`runLoop` acumula tempo real em vez de confiar no intervalo.** O ticker do Go dropava ticks sob carga (partida rodando devagar); agora há catch-up limitado a 5 ticks para não entrar em espiral.

### 3. Protocolo de fio: **zero mudanças**
Foi um requisito de projeto. O cliente não precisou de nenhuma alteração além do re-export do protocolo e de três strings de UI que diziam "Go server".

### 4. Infra
- `server/Dockerfile` → Node multi-stage; **contexto de build agora é a raiz do repo** (precisa de `sim/` e `public/maps/`), refletido em `docker-compose.yml` e `.dockerignore` (que deixou de ignorar `server/`).
- `Dockerfile` do cliente roda `typecheck && build:client` (não constrói mais o servidor junto).
- Scripts: `build:client`, `build:server`, `start:server`, `dev:server` (tsx watch). `npm run build` faz os três.
- Deps novas: `ws` (runtime), `@types/ws`/`@types/node`/`tsx` (dev).
- `eslint.config.js` passou a ignorar `dist-server` e `.claude` (esse último já vinha poluindo o lint com cópias de worktree).

### 5. Testes: uma suíte só, 124 → 208
Todos os testes Go foram portados para vitest e passam. Além disso:
- **`sim/Arena.test.ts` tem uma checagem de paridade mais forte do que o Go tinha**: compara a tabela de obstáculos da sim contra o `createObstacle`/`TEMPLATES` real do cliente e o `OBSTACLE_HEIGHT`, por tipo. O Go só conseguia comparar o arquivo JSON do mapa; footprint e altura eram comentário.
- `sim/elements.test.ts` cruza o catálogo de combate com o catálogo de apresentação do cliente.
- `server/src/App.test.ts` é novo: percorre o protocolo inteiro contra um transporte gravador (`create_room` → … → `round_end`), incluindo o detalhe de que campos vazios são **omitidos** (o `omitempty` do Go) porque o cliente testa presença de campo.

## Como isso foi verificado
`npm run typecheck && npm run lint && npm test && npm run build` — verdes (208 testes). Além disso, contra o servidor real rodando (`PORT=8099 node dist-server/main.js`):

1. **Smoke por WebSocket cru**: sala criada, lobby, `list_rooms`, espectador entrando no meio da partida, `claim_slot`, 4s de input real → 86 snapshots (~21.5 Hz), mago andou 14 unidades, projéteis em voo, reconexão com o mesmo id.
2. **Partida 4v4 de bots até o fim**: `round_end` após 88.7s, 1765 snapshots a **19.9 Hz** (alvo 20), dano até 0 de vida, vidas perdidas, respawn, sala volta a `lobby` com as vagas preservadas, rematch iniciou, **0 erros**.
3. **Poças de veneno no fio**: 164 snapshots com poças, `remaining` decrescendo, raio 1.5 conforme o def do elemento.
4. **Navegador real (Playwright + Vite dev)**: fluxo completo pela UI — Enter Hall → guest → Create room → Open lobby → Ready → Start duel → jogar com WASD + segurar clique. Resultado: 99 frames de `input`, 174 snapshots, **24 frames com `move` e `charging` juntos** (a correção de "carregar não trava o movimento" sobreviveu), `aim` variando de 1.0 a 11.1 em coordenadas de mundo (a correção do bug de mira sobreviveu — não é vetor unitário), charge chegou a 1.00, projéteis, mapa decorado renderizando, HUD e minimapa OK, **0 erros de console**.

## Cuidado / não feito
- **Os containers Docker estão desatualizados.** Nada foi rebuildado. `docker compose build client gameserver && docker compose up -d client gameserver` antes de testar via :8080 — e note que o contexto do `gameserver` mudou, então um build antigo em cache não serve.
- **Nada foi commitado.** Tudo está na working tree. Os arquivos Go aparecem como ` D` em `git status`.
- **`AGENTS.md` foi reescrito** — os paths de ownership mudaram todos. `sim/**` é agora a zona mais sensível: mexer lá muda practice mode **e** online ao mesmo tempo. Coordenar com o Cursor antes.
- **A sim do practice mode ainda é separada.** Este trabalho unificou cliente↔servidor no eixo *online*: `sim/` é o que o servidor roda e o que o `SnapshotSync` do cliente consome. O practice mode continua rodando `src/systems/*` com o modelo antigo (`Player`/`moveTarget`/sem elementos). Unificar os dois é o próximo passo natural e **não** foi feito aqui — era um escopo bem maior do que trocar o servidor.
- Continuam valendo: sem path planner no servidor (bots usam probe + sidestep), sem forfeit ao sair no meio da partida, sem host explícito, sem GC de salas encerradas.
- Corrigi de passagem um `prefer-const` pré-existente em `src/app/roomStore.ts:150` que já quebrava `npm run lint` antes desta sessão.

---

# Handover — 2026-08-03 (Claude — online↔practice parity: menus/audio/results, real map in both sims, aim fix, full AI port) — READ THIS FIRST

## Why this session happened
Continuation of the session below. User's request: "use a copy of what's in practice mode for the other modes when we create the room, with and without bots" — and when asked to scope it, chose **everything**: render pipeline (done previously), pre-match config flow, audio, menus/screens, and explicitly "principalmente jogabilidade e também IA." Mid-session they play-tested and reported three concrete defects, all reproduced and fixed: aim locking to screen centre, "where the hell is the map?", and "holding to shoot won't let me move + the AI is dumb compared to practice mode."

## What changed this session

### 1. Client: online matches now have the same audio, pause menu, and victory/defeat screen as practice mode (done, verified via `npm run typecheck && npm run lint && npm test && npm run build`)
- **`src/net/SnapshotSync.ts`**: now takes an `EventBus` (3rd constructor arg) and emits the same `GameEvents` the offline systems emit (`PlayerHit`, `PlayerDefeated`, `SnowballThrown`, `SnowballImpact`), inferred from snapshot deltas (health drop, alive→dead transition, projectile appear/disappear) since the wire protocol has no discrete event messages. Also gained `isMyTeam(wireTeam): boolean` so callers can turn a wire-team-number winner into a POV win/loss. This is what makes `AudioManager` — completely unmodified — work against online matches.
- **`src/ui/Menus.tsx`**: three small additive changes so the same class serves online matches, offline call site (`src/main.ts`) unaffected:
  - New 4th constructor arg `startVisible = true` — pass `false` to skip the "Start Duel" main screen (online matches are already in progress when this view mounts).
  - New optional `MenuActions.restartLabel` / `playAgainLabel` — override the pause screen's "Restart" and result screen's "Play Again" button text (online uses "Leave Match" / "Back to Lobby"; the underlying handler is the same `restart()` callback in both cases, same as offline).
  - New optional `RunResult.showScore` (default `true`) — hides the score/time/lives lines on the result screen for matches with no scoring concept (online).
- **`src/net/OnlineMatch.ts`**: now constructs `AudioManager` (unlocked on first pointerdown, muted state read from `Settings`, same as `src/main.ts`) and `Menus` (`startVisible: false`) exactly like `bootOfflineMatch` does. Escape/P toggles a local pause (blocks outgoing input + shows the pause overlay; does **not** pause the authoritative server sim — there's no such thing in a live multiplayer match). New `showRoundResult(winnerTeam: number)` public method — shows the victory/defeat screen; called by `App.tsx` when `round_end` arrives. Constructor opts gained `onLeaveMatch(reason: 'quit' | 'roundEnd'): void`, invoked by both the pause screen's "Leave Match" and the result screen's "Back to Lobby" (same underlying click path in `Menus`, differentiated by `this.roundEnded`).
- **`src/app/App.tsx`**: `onRoundEnd` no longer immediately disposes the match and jumps to the lobby — it calls `onlineMatchRef.current?.showRoundResult(msg.winnerTeam)` and waits for the player to dismiss it. This mattered because the Go server sends `room_state` (rematch lobby) **immediately** after `round_end` on the same call (`broadcast.go`'s `broadcastRoundEnd`) — the existing `onRoomState` handler used to see that and yank the match view away before the result screen could ever show. Fixed with a `metaRef.current.awaitingResultDismiss` guard: `onRoomState` skips its auto-navigate-to-lobby while a result screen is pending; the new `onLeaveMatch` callback (passed into `OnlineMatch`) does the actual `setScreen`/dispose once the player clicks through — `'roundEnd'` → `'lobby'` (room's already in rematch lobby state by then), `'quit'` (mid-match Leave Match) → `'rooms'` + refresh.
- Known deliberate scope cut: mid-match "Leave Match" has no real forfeit — there's no `leave`/`forfeit` message in the wire protocol (`src/net/protocol.ts`'s `ClientMsg`), and adding one means touching `server/internal/{room,match,protocol}`, explicitly Cursor's zone. Today it just stops rendering/sending input locally (bridge stays connected); the bot/opponent keeps fighting a stationary ghost until the round ends normally. Flagged, not fixed.
- Not done (lower priority, didn't block "principalmente jogabilidade e IA"): `DebugOverlay` and the FPS toggle UI aren't wired into online (FPS pill reads `Settings.showFps` but there's no in-match way to flip it, matching how offline's own pause screen also has no options tab — only the main menu does).

### 2. Aim was broken: the client sent a direction where the server wanted a point (fixed, verified live)
User reported "when I hold click to aim, it corresponds to something in the center of the screen, not the real mouse position." Real bug, and an exact-cause one: `MageInput.Aim` is a **world-space point** — `game/world.go` does `input.Aim.Sub(m.Position)` to derive the throw direction (the Go bot AI always passed `target.Position`, a point). `OnlineMatch.onPointer` was normalizing the cursor into a **unit direction vector** before sending it, so the server computed `unitVector - myPosition` and every shot aimed at roughly the world origin — the middle of the map. Fixed by sending the raw ground-plane raycast hit (`{ x: point.x, y: point.z }`). Verified live by patching `WebSocket.send` in a real match: aim values now span the arena (±17, ±11 on a 40×30 map) and track the cursor, instead of being length-1.

### 3. The real map is now in both simulations (user asked for the full port, not client-only decoration)
Online was a hardcoded bare `24×16` rectangle with zero obstacles (the documented v1 scope cut) while practice mode loads decorated `40×30`+ maps. User picked the full port over the cheap options, so both sides now play the same map:
- **New `server/internal/game/arena.go`**: an `Arena` (width/height/obstacles/spawns) parsed from the client's own map JSON schema, with the per-type footprints and blocking flags ported from `src/game/Obstacle.ts` (`TEMPLATES`) and heights from `config.ts`'s `OBSTACLE_HEIGHT`. Provides `Clamp`/`Contains`/`OutOfBounds`, `BlocksMovementAt`, `BlocksProjectileAt` (height-aware: shots arcing above an obstacle fly over it, mirroring `CollisionSystem.ts`), `HasLineOfSight` (sampled, mirrors `physics/LineOfSight.ts`) and `SpawnFor`.
- **Where the map lives**: Go's `go:embed` cannot reach outside its package directory, so the server has its own copy at `server/internal/game/maps/arena1.json`. `TestEmbeddedMapMatchesClientCopy` reads `../../../public/maps/arena1.json` and fails if the two ever drift — that guard is the whole reason the duplication is safe. **If you change the map, copy it to both places.**
- **`world.go`**: `World` gained an `Arena`; `NewWorld()` keeps its signature (loads the default map) so `internal/room` needed no change, and `NewWorldWithArena` exists for tests wanting a bare rectangle. Movement resolves against obstacles with axis-separated **sliding** (walking diagonally into a wall slides along it instead of sticking), projectiles are destroyed by blockers, spawns come from the map, and knockback respects obstacles too.
- **`src/net/OnlineMatch.ts`** fetches the same `public/maps/arena1.json` (cached module-level promise, exported as `loadOnlineMapData()`) and builds its `World`/`ArenaRenderer` from it via the existing `MapLoader`, sharing one `IdAllocator` exactly like `Game.init`. `App.tsx` awaits that before constructing the match.

### 4. Charging no longer roots you — and the bot AI is a real port of `AISystem.ts`, not a simplification
User: "when I hold to shoot it doesn't let me move, [unlike] the original" and "the AI is pretty dumb compared to practice mode." Both confirmed against the offline code and fixed:
- **Movement while charging/recovering**: offline gates movement on `canAcceptOrders` only, which is `alive && !(Hit || Frozen || Defeated)` — `PreparingThrow` and `Recovering` do **not** stop you. The Go sim had `if !m.Charging && m.State != MageRecovering` plus an early `return` during recovery, rooting you on both. Removed; only stun/freeze/death stop a mage now. Covered by `TestWorld_MageCanMoveWhileCharging` / `...WhileRecovering`.
- **Movement feel**: ported `PLAYER.acceleration` (40), `PLAYER.turnSpeed` (12 rad/s), `AIM.turnSpeed` (15) + `AIM.deadzoneRadius`, and mage-vs-mage separation at `PLAYER.spacing` (1.4). Mages now accelerate and turn instead of snapping, and aim rotates toward the cursor over time. New `Mage.Velocity` backs this (and feeds the AI's aim leading).
- **`server/internal/bot/ai.go` rewritten as a port of `AISystem.ts`**: the same five-action utility model (`retreat`/`takeCover`/`attack`/`advance`/`wander`) with the **same scoring weights and tie-break precedence**, the same easy/normal/hard `AI_TUNING` (aim error scale, decision-interval scale, throw willingness, dodge reliability, `seeksCover:false` for easy), reactive dodging held for `DODGE_DURATION`, cover seeking + peek spots (now possible because the arena has obstacles), squad focus-fire target selection (hurt/exposed/close weighting), aim leading via `AIM_LEAD_TIME` and target velocity, distance-scaled aim error, ally separation, and `ADVANCE_STOP_DISTANCE` so bots fight at range instead of walking into your face.
- **API change this forced**: the AI now needs per-bot state across ticks (decision timers, dodge timers), so the stateless `bot.Step(w, bots, rng)` became `bot.NewBrain(rng)` + `brain.Step(w, bots, dt)`. `match/session.go` owns a `Brain` created fresh per match. All map iteration that can pick a "best" candidate now goes through sorted-id helpers, because Go randomizes map order and an authoritative sim must be deterministic.
- Verified live: a hard bot now repositions to cover, holds range, and took the player 100→20 HP while manoeuvring, versus the old bot that walked in a straight line and planted itself.

## Verified how
Both suites green (`npm run typecheck && npm test && npm run build`, 124 tests; `go vet ./... && go test ./...`). Beyond that, driven in a real browser against a real `mageserver`: create-room-with-bots → ready → start → play → round end → result screen → rematch lobby, plus a two-human "without bots" room joined from a second isolated browser context. `WebSocket.send` was patched in-page to read the actual input frames, which is how the aim fix and "54/54 frames sent `charging:true` **and** a non-zero move together" were confirmed rather than assumed.

## Careful / not done
- **Ownership**: `AGENTS.md` assigns `server/internal/{game,bot,match}/**` to Cursor. This session changed all three (the user explicitly asked for the full map + AI port, which is impossible client-side). Coordinate before Cursor picks that slice back up.
- **The running Docker containers are stale.** Everything above is in the working tree only, nothing committed. `docker compose build client gameserver && docker compose up -d client gameserver` before testing through :8080, or you will be testing the old build — this exact confusion cost a previous session a lot of time.
- Mid-match "Leave Match" still has no real forfeit (no such wire message); the opponent fights a stationary ghost until the round ends.
- The server has no path planner. Bots use a short probe + sidestep (`steerTo`) rather than the client's `PathGrid`, so they can still scrape along a long wall instead of routing around it.
- Per-element combat tuning still lives only in the Go sim; the offline TS sim remains uniform/team-colored. The two simulations are still hand-synced by design — see the note in the older handover below.

## Files touched this session
`src/net/SnapshotSync.ts`, `src/ui/Menus.tsx`, `src/net/OnlineMatch.ts`, `src/app/App.tsx`, `server/internal/game/{arena.go (new), arena_test.go (new), world.go, world_test.go, entities.go, config.go, vector.go}`, `server/internal/game/maps/arena1.json (new)`, `server/internal/bot/{ai.go, ai_test.go}`, `server/internal/match/{session.go, session_test.go}`.

---



## Why this session happened
User reported that online duels dropped into what looked like a completely different, primitive game compared to practice mode. `OnlineMatch.ts` was (per the Cursor handover below) an intentional stopgap: a bare Three.js scene with capsule meshes, unrelated to the real practice-mode rendering pipeline. User wants online duels to look **and behave** exactly like practice mode.

## ⚠️ Read this before touching anything — unresolved as of end of session
Every fix below was verified by automated Playwright (headless Chromium, synthetic WebSocket/keyboard/mouse) — real WS traffic was captured and inspected to confirm each bug and each fix, not guessed. Despite that, **the user says it's still broken after the last round of fixes, with no new concrete symptom given yet.** Do not repeat the trial-and-error loop blind. Before writing any more code:

1. **Rule out browser cache first — prime suspect, not yet ruled out.** `nginx.conf` sets no `Cache-Control` on `index.html`. Vite hashes JS filenames so a truly fresh `index.html` fetch gets the new bundle, but if the browser cached the *old* `index.html`, it keeps referencing the old JS forever. Ask the user to hard-refresh (Cmd+Shift+R) or test in a fresh private window before assuming any fix didn't land. If that turns out to be it, add `add_header Cache-Control "no-cache";` for `/index.html` in `nginx.conf` (or an nginx `location = /index.html { ... }` block) and rebuild `client`.
2. **Confirm the running containers are actually current** before debugging further: `docker inspect mage-craft-client-1 --format '{{.Image}}'` and same for `mage-craft-gameserver-1`; compare against `docker images`. At the end of this session they were `2c88dc5378d9…` (client) and `e687c144a423…` (gameserver) — both freshly built from what's described below. If they differ, `docker compose build <service> && docker compose up -d <service>` first.
3. **Get an actual reproducible complaint** before changing code: exact steps, ideally a screen recording, or at minimum what was expected vs. what happened + browser console/network errors (F12 → Console/Network). "still broken" alone isn't actionable — three times this session a vague complaint was chased down to a *specific, real* bug (see below), each confirmed via live network capture, but a headless automated re-test after each fix showed it working — meaning either (a) it's #1/#2 above, (b) it's a UX/expectation mismatch not a bug, or (c) it's real but only triggers under conditions the automated tests aren't hitting (real mouse timing, specific element/bot difficulty, real network latency, etc.). Narrow it down before guessing again.

## What changed this session

### 1. Client: online match now renders through the real practice-mode pipeline (done, verified)
- `src/net/OnlineMatch.ts` rewritten internally — same public API (`constructor(container, net, opts)` / `applySnapshot` / `setSpectating` / `dispose`), so `src/app/App.tsx` needed **zero** changes — to build a real `World` and drive the actual `ArenaRenderer` / `PlayerRenderer` / `NavIndicatorRenderer` / `AimIndicatorRenderer` / `ParticleRenderer` / `PickupRenderer` / `HUD` / `Minimap` / `engine/Renderer` (the exact same classes `src/main.ts`'s `bootOfflineMatch` uses for practice mode), instead of its own bespoke perspective-camera/capsule-mesh scene.
- New `src/net/SnapshotSync.ts`: translates server `SnapshotMsg`s into that `World` — creates/updates/removes mages, projectiles and puddles by wire id; maps team → POV-relative `Team.Player`/`Team.Enemy` (learned from the first snapshot containing your own id); infers alive (`health > 0`, confirmed exact against the Go server), animation/state (hit-flash on health drop, charging, moving vs idle), and smooths position/rotation between the server's ~20Hz snapshots for 60fps rendering.
- New `src/render/PuddleRenderer.ts`: renders poison puddles (a mechanic with no offline precedent — plain translucent disc per puddle, no discrete events needed).
- Small additive changes, offline behavior unchanged: `src/game/types.ts` (`Player.lives?: number`, new `Puddle` type), `src/game/World.ts` (`readonly puddles: Puddle[]`), `src/ui/HUD.tsx` (optional 6th constructor param `getLocalId?: () => EntityId | null` so HUD can find "my own" mage instead of assuming exactly one `Team.Player` entity — offline's 5-arg call site is untouched and falls back to the old behavior).
- Also fixed in this same pass: `OnlineMatch`'s container had `this.container.style.position = 'relative'` unconditionally set inline, which clobbered the CSS module's `position: absolute; inset: 0` and collapsed the whole match viewport to a ~300px sliver instead of filling the screen. Now only sets it if the container is currently `static`.
- **Verification**: two real Playwright browser contexts (host + joiner) through the full create-room → join-by-code → ready → start-duel flow. Confirmed: real wizard model renders (not capsules), HUD/minimap match practice mode pixel-for-pixel in style, POV colors correctly mirrored per client (each player sees themself blue, opponent red), camera follows the local mage, full charge/aim-trajectory-preview/throw cycle renders correctly, zero console errors on either client. Solo/practice mode re-verified unaffected. `npm run typecheck && npm run lint && npm test && npm run build` all green (124 unit tests).

### 2. Go server: 3 real gameplay bugs found + fixed after user reported gameplay still felt broken (done, verified via live WS traffic + `go test`)
Found by proxying `window.WebSocket` in a real Playwright page to log every sent/received JSON frame during an actual match, not by guessing. All in `server/internal/game/`:

- **Movement permanently locked after your first throw** (`world.go`, `updateMage`). Once `RecoveryTimer` decayed to exactly `0`, the early-return block for recovery stopped firing — but `m.State` was left at `MageRecovering` forever, and the movement gate (`if !m.Charging && m.State != MageRecovering`) was the *only* code path that could ever clear it. Self-perpetuating deadlock: throw once, never move again (until you charge again, since the charging branch does reset state — this is why it wasn't caught immediately). Fixed: explicitly reset `m.State = MageIdle` the tick recovery ends, then fall through instead of returning.
- **Character never turns to face its walking direction.** `m.Facing` was only ever updated in the charging/aim-at-cursor branch; `moveMage()` never touched it, so the mage kept facing spawn direction (or last-aim direction) regardless of which way it walked. Fixed: `moveMage()` now sets `m.Facing = move.Normalized()` while actually moving. Bots get this for free (same input path).
- **Instant "teleport" knockback.** `dealDamage()` added the *full* knockback magnitude straight to `Position` in a single 1/60s tick — e.g. up to 8.5 world units instantly for wind (highest-knockback element). Practice mode's `src/systems/DamageSystem.ts` applies knockback as an initial velocity that decays exponentially over the hit-stun window (~0.29 world units of actual slide for a magnitude-3.5 hit, ~12/s damping). Ported the same model server-side: new `Mage.KnockbackVelocity Vec2` field, `KnockbackDamping = 12.0` / `KnockbackStopSpeed = 0.02` constants in `config.go` (numerically matching the client's `KNOCKBACK_DAMPING`/`STOP_SPEED`), integrated during the existing `StunTimer > 0` window in `updateMage`.
- One existing test, `TestWorld_ProjectileHitsEnemyAppliesDamageAndKnockback` in `world_test.go`, had its timing assumption updated (steps a few extra ticks after the hit lands) since it asserted on the old instant-jump behavior, which no longer exists by design.
- `go build ./...` and `go test ./...` (all packages) green. Rebuilt + restarted the `gameserver` container after this fix.

### 3. Known, real, NOT yet addressed — separate from both of the above
While investigating the "bots don't work like practice bots" complaint, found the Go bot AI (`server/internal/bot/ai.go`) is more capable than first assumed — it has real advance/retreat/attack logic with easy/normal/hard tuning, same spirit as `src/systems/AISystem.ts`. But two real, verified gaps remain if full parity is wanted:
- Go bot never dodges incoming projectiles (offline `AISystem.ts` has `AI.dodgeRadius` dodge behavior; `bot/ai.go` has none).
- Go bot doesn't reposition/strafe once already within `EngageRange` (9.0 units) — it just plants and throws from a stationary position. Whether offline is meaningfully more dynamic here wasn't fully compared side-by-side.
- The Go server's arena is a bare open rectangle, `ArenaWidth=24 × ArenaHeight=16`, **no obstacles/cover** — an explicit, documented v1 scope cut (`multiplayer-plan.md`), unlike practice mode's decorated `40×30` maps (e.g. `public/maps/arena1.json`) with trees/rocks/forts. This is why the online camera "feels different" from practice mode even though it's the exact same `Renderer`/`CameraController` class/code — it's framing a much smaller, emptier map, not a camera bug. Porting obstacles/cover/line-of-sight into the Go sim is a much bigger, separate undertaking, not attempted this session.
- Per-element combat tuning (damage/knockback/speed per element) is rich in the Go server (`elements.go`, 7 elements) but **not wired into the offline TS sim at all** — offline's `Player`/`Snowball` types have no `element` field; offline combat is uniform/team-colored only. The two simulations are explicitly NOT in full behavioral parity by design — `multiplayer-plan.md` calls this out as an ongoing, hand-maintained risk between the TS client sim and the Go server sim, not something either side gets "for free." Worth keeping in mind before assuming "just copy X" is a small change — the two implementations are separate Go/TypeScript codebases that must be kept in sync by hand.

## How to rebuild after further changes
```bash
# client (TypeScript/Vite) — from repo root:
npm run typecheck && npm run lint && npm test && npm run build
docker compose build client && docker compose up -d client

# gameserver (Go):
cd server && go build ./... && go test ./...
cd .. && docker compose build gameserver && docker compose up -d gameserver
```
Full stack: `docker compose ps` for status; `docker compose logs -f gameserver` / `client` to tail logs live while reproducing an issue. Nothing from this session has been committed to git yet — everything is in the working tree (`git status` / `git diff --stat`).

## Files touched this session
`server/internal/game/config.go`, `server/internal/game/entities.go`, `server/internal/game/world.go`, `server/internal/game/world_test.go`, `src/game/World.ts`, `src/game/types.ts`, `src/net/OnlineMatch.ts` (rewritten), `src/net/SnapshotSync.ts` (new), `src/render/PuddleRenderer.ts` (new), `src/ui/HUD.tsx`.

---

# Handover — 2026-08-02 (Cursor — join-as-spectator + bots no create)

## What changed this session
- **Protocolo**: `fillBots`/`botDifficulty` em `create_room`; `list_rooms` /
  `room_list`; `claim_slot`; `room_state` com `spectators`, `youRole`,
  `pendingClaimPlayerId`.
- **Room/Session**: `JoinAsSpectator`, `ClaimSlot`, `FillEmptyWithBots`,
  rematch após `round_end` (`ApplyClaims` + `ResetToLobby`) — não fica em
  `ended` permanente.
- **mageserver**: handlers + restart de `RunLoop` no rematch; auto-fill bots
  no `select_element` quando a sala foi criada com `fillBots`.
- **magesmoke** + integration test cobrem fillBots + spectator claim.
- **Cliente**: `src/net/{protocol,NetworkClient,lobbyBridge,OnlineMatch}.ts`;
  UI create com checkbox de bots; lista live; join mid-match como espectador;
  claim de bot; Start online com render de snapshots.

## Key decisions (and why)
- Join mid-match = **espectador** até o fim da rodada; claim só aplica no
  rematch (bot continua jogando). Mais simples e alinhado ao pedido do user.
- `round_end` → lobby de rematch (não sala morta), para o late joiner entrar.
- Ownership desta fatia: **Cursor** (ver `AGENTS.md`).

## Plan / todo status
- Done: protocolo, room/session/rematch, mageserver, magesmoke, NetworkClient,
  UI create/list/spectator/claim, OnlineMatch snapshots, AGENTS/HANDOVER.
- Pending polish: host explícito no server; interpolação de snapshots;
  POV-relative colors no OnlineMatch; forfeit/disconnect bot-takeover mid-round.

## Known issues / risks
- ~~OnlineMatch é render mínimo (capsules + projéteis), não o pipeline SP completo.~~ **Resolvido na sessão acima (2026-08-02, Claude).**
- `isHost` no client é “quem criou”; server ainda deixa qualquer um dar Start.
- Create/join com server offline cai no lobby local (demos / practice).
- Dois agentes: Claude deve coordenar antes de tocar `src/**` ou
  `server/internal/{room,match,protocol}` / `cmd/mageserver`.

## Next steps
1. Jogar manualmente: `go run ./cmd/mageserver` + Vite; create com bots →
   Start → 2º browser join live → claim → esperar round_end → Start rematch.
2. `go test ./...` no server (já verde na entrega).
3. Claude (se retomar UI): polish HUD/POV online em cima de `OnlineMatch` /
   NetworkClient sem reescrever o protocolo.
