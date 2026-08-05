# GDD — Mage Craft

**Título:** Mage Craft
**Versão:** 1.0 — reescrito no pivot de produto
**Status:** rascunho vivo — base de produto, não especificação de engine
**Modelo de referência:** Clash Royale (real-time, invocação por custo de mana, unidades autônomas)
**Idioma do doc:** PT-BR

> **Este documento substitui o GDD 0.1 por inteiro.** O jogo deixou de ser um brawl
> de controle direto. Quem procura o design antigo (mago único controlado por
> WASD + mira) deve ler `design.md` e `multiplayer-plan.md`, que passam a ser
> **documentos históricos** — descrevem o produto anterior e não devem ser editados.

---

## 1. Visão

Dois conjuradores se enfrentam em tempo real numa arena. Nenhum dos dois controla
um mago diretamente: eles **invocam** magos que lutam sozinhos, e gastam mana
lançando **feitiços** — buffs nos seus, maldições nos do rival.

A partida é decidida por *o que você invoca, onde e quando* — nunca por mira ou
reflexo. O mago invocado é autônomo a partir do instante em que toca o chão.

**Promessa ao jogador:**
*"Eu li o que ele invocou, respondi com o contra certo no lugar certo, e a mana
que eu guardei virou a vantagem que fechou a partida."*

**Sensação-alvo:** tenso, legível, de leitura e resposta. Partidas de 3 minutos.

---

## 2. Design brief (contrato)

| Campo | Definição |
| --- | --- |
| Fantasia | Conjurador que comanda um esquadrão de magos elementais |
| Feeling | Leitura, resposta, economia — tenso sem exigir reflexo |
| Verbo primário | **Invocar** (escolher carta + escolher onde plantar) |
| Verbos secundários | Lançar feitiço (buff/maldição), guardar mana, ciclar a mão |
| Loop curto (3–10s) | Ler o que ele invocou → escolher o contra → plantar no lugar certo |
| Loop de partida (3 min) | Trocar pushes, abrir vantagem de mana, converter em dano de estrutura |
| Falha / retry | Push mal respondido custa Torre; sem vida do jogador, sem respawn pessoal |
| Skill expression | Contra-invocação, posicionamento, gestão de mana, ciclo de baralho |
| Legibilidade | Papel pela silhueta, elemento pela cor, mana e mão sempre visíveis |
| Non-goals (v1) | Controle direto de unidade, ordens táticas, mira manual, lanes de MOBA com creeps, 5v5, gacha |

**Core loop contract:**

```text
O jogador gasta mana invocando magos e lançando feitiços;
os magos lutam sozinhos e avançam para as estruturas inimigas;
ler o push do rival e responder com o contra certo gera vantagem de mana;
vantagem de mana vira push maior, que derruba Torre e depois o Núcleo.
```

---

## 3. O modelo: o que copiamos do Clash Royale e o que não

### Copiamos (é o que faz o gênero funcionar)

- **Real-time, simétrico, 1v1.** Os dois jogam ao mesmo tempo, na mesma sim autoritativa.
- **Mana única que regenera.** Um recurso só, teto baixo, regeneração constante. É o relógio da partida.
- **Baralho + mão + ciclo.** Você não tem acesso a tudo o tempo todo; a ordem das cartas é parte da decisão.
- **Unidades autônomas.** Invocou, acabou o seu controle sobre aquela unidade.
- **Posicionamento como agência.** Onde você planta é a decisão mais densa do jogo.
- **Objetivo estrutural.** Ganha quem derruba mais estrutura, não quem mata mais.

### Não copiamos

- **Lanes com ponte e rio.** Nossa arena é aberta e tem **cover real** — obstáculos com altura, bloqueio de projétil e line-of-sight, que já existem em [sim/Arena.ts](sim/Arena.ts). Isso é vantagem nossa: projétil com tempo de voo e cobertura dão profundidade posicional que a grade do CR não tem.
- **Progressão de nível de carta paga.** Cartas não sobem de poder. Ver §12.
- **Gacha / baús.** Ver §12.
- **Alvo travado até a morte.** Nossos magos têm IA real (esquiva, cover, focus-fire de esquadrão) — ver §11.

### A diferença que define nosso jogo

No Clash Royale a unidade é um autômato burro que anda reto. Aqui ela é um mago com
o `Brain` de 671 linhas que já existe no repo: ele busca cobertura, esquiva de
projétil, lidera a mira e coordena foco com os aliados. **A mesma invocação, no
mesmo lugar, joga diferente dependendo do terreno.** É esse o nosso diferencial, e
ele já está construído.

---

## 4. A partida

| Item | Definição |
| --- | --- |
| Formato | 1v1 real-time, entrada por **fila de matchmaking** (sem código de sala) |
| Duração | 3 min de tempo normal + até 1 min de morte súbita |
| Tick | 60 Hz autoritativo, snapshots a 20 Hz (já em produção) |
| Vitória normal | Mais estruturas derrubadas ao fim dos 3 min |
| Empate em estruturas | Morte súbita: **mana dobrada**, primeira estrutura a cair vence |
| Empate total | Menor HP restante de Núcleo perde; se idêntico, empate |

**Entrada na partida:** o jogador aperta Batalhar e entra numa fila. O servidor
pareia dois jogadores por ordem de chegada e monta a sala sozinho — sem lobby,
sem ready-up, sem código. Depois de 12 s sem par humano, ele recebe um
comandante de IA em vez de encarar um spinner. Salas manuais continuam
existindo para partidas privadas.

**Sem vidas de jogador. Sem respawn pessoal.** O jogador não tem corpo na arena —
ele é o conjurador fora dela. Magos invocados morrem e não voltam; o que volta é a
mana para invocar outros.

> Isto substitui o modelo de `lives` + `respawn` do GDD 0.1. Ver §13 para o que
> isso significa em `sim/config.ts` e `World.checkRoundEnd`.

---

## 5. Arena e estruturas

A arena é aberta, simétrica no eixo do adversário, com obstáculos que importam.

Cada lado tem:

| Estrutura | HP | Papel |
| --- | --- | --- |
| **Núcleo** (1) | 900 | Fundo da base. Cair = derrota imediata |
| **Torre** (2) | 400 cada | Flanqueiam o Núcleo. Atiram em inimigos ao alcance |

> Estes números **já passaram por uma medição**, não são chute. Os valores
> originais (1400/700) faziam dois jogadores competentes empatarem em 100% das
> partidas simuladas: nenhuma torre caía nunca contra defesa. Ver §14.

- Torres atacam sozinhas: projétil arcano, alcance 9.0 (o `ENGAGE_RANGE` que o `Brain` já usa), dano moderado. Elas são a defesa base — invocar nada nunca é a jogada certa, mas invocar mal também não.
- **Enquanto as duas Torres estiverem de pé, o Núcleo é imune.** Isso impede rush direto ao Núcleo no minuto 1 e dá forma à partida: quebrar flanco antes de fechar.
- Obstáculos (árvore, rocha, forte, cerca) continuam bloqueando movimento e projétil por altura, exatamente como hoje.

**Zona de invocação:** você só planta na **sua metade** da arena, mais um avanço
progressivo — cada Torre inimiga derrubada libera invocação naquele flanco do lado
dela. É o análogo direto da ponte do CR e é o que transforma vantagem em pressão.

> A arena de lanes/estruturas é um **mapa JSON novo** (`public/maps/`), não código:
> `Arena.fromData` já lê `width`/`height`/`objects[]`/`spawns[]`. Estruturas são o
> tipo de entidade novo — ver §13.

---

## 6. Mana — a economia

| Parâmetro | Valor v1 |
| --- | --- |
| Teto | 10 |
| Início da partida | 5 |
| Regeneração normal | 1 mana / 2.8 s |
| Regeneração em morte súbita | 1 mana / 1.4 s (dobrada) |
| Custo das cartas | 2 a 7 |

Por que teto baixo e regeneração lenta: é o que força a decisão. Com teto 10 e o
Golem custando 5, invocar o Golem é literalmente meio arsenal — e o rival vê o
Golem chegar e tem uma janela para punir do outro lado. **Toda vantagem no jogo é,
no fundo, vantagem de mana**: gastar 3 para anular um push de 5 é a jogada boa, e
é isso que o jogador aprende a fazer.

Mana é o único freio. Não há cooldown por carta — a carta volta pelo **ciclo do
baralho** (§7), o que é mais legível e cria a decisão de "ciclar barato agora para
ter o contra na mão daqui a 20 s".

---

## 7. Baralho, mão e ciclo

- **Baralho:** 8 cartas, montadas fora da partida.
- **Mão:** 4 cartas visíveis + **1 próxima** em preview.
- **Ciclo:** jogou uma carta, ela vai para o fim da fila e a próxima entra na mão.
- **Sem aleatoriedade oculta:** a próxima carta é sempre visível. O jogador planeja dois turnos à frente.

Regra de construção de baralho (v1): **mínimo 1 carta de cada papel** (tank, dano,
suporte) e **no máximo 3 feitiços**. Isso impede o baralho degenerado de só
feitiço, que transformaria o jogo em outra coisa.

---

## 8. Papéis — a identidade de uma unidade

Um mago é definido pelo **papel**. O elemento é o *ataque* que ele usa, não a
identidade dele.

| Papel | Silhueta | HP | Velocidade | Função |
| --- | --- | --- | --- | --- |
| **Tank** | Grande, pesado | 200–280 | 3.5–4.0 | Absorve dano e abre caminho. Alcance curto |
| **Dano** | Magro, alto | 60–90 | 5.0–5.5 | Mata. Morre rápido se alcançado |
| **Suporte** | Pequeno, curvado | 70–95 | 5.0 | Não mata sozinho. Multiplica quem está perto |

Referência: um mago do jogo antigo tinha 100 HP e velocidade 6 (`MAX_HEALTH`,
`MOVE_SPEED` em [sim/config.ts](sim/config.ts)). Esses continuam sendo o ponto de
partida numérico — o Dano é o mago antigo, um pouco mais frágil.

**A trinca é o balanceamento inteiro:** tank apanha bem mas não mata, dano mata mas
não apanha, suporte não faz nem um nem outro sozinho. Um push só funciona
combinando papéis, e é isso que dá ao rival algo específico para ler e responder.

---

## 9. Catálogo de cartas (v1)

Treze cartas para o pool inicial: 9 unidades + 4 feitiços. Números são **direção
de design**, não balance final — ver §14.

### Unidades

| Carta | Papel | Custo | HP | Vel. | Elemento (ataque) | Nota de design |
| --- | --- | --- | --- | --- | --- | --- |
| Golem de Pedra | Tank | 5 | 280 | 3.5 | `stone` | Dano 32 e interrompe conjuração. Lento o bastante para ser respondido |
| Sentinela de Gelo | Tank | 4 | 200 | 4.0 | `ice` | Lentidão em quem encosta. Tank de controle, não de dano |
| Piromante | Dano | 4 | 80 | 5.0 | `fire` | Dano 20 confiável. A carta de referência do papel |
| Condutor de Raio | Dano | 4 | 60 | 5.0 | `lightning` | Projétil 30 de velocidade, arco baixo — acerta alvo em movimento |
| Arqueiro Arcano | Dano | 3 | 70 | 5.5 | `arcane` | Splash 2.0. Contra de grupo, barato de ciclar |
| Alquimista | Dano | 4 | 70 | 5.0 | `poison` | Poça de 4 s nega terreno. Zoning, não burst |
| Dervixe do Vento | Dano | 3 | 65 | 7.0 | `wind` | Dano baixo, knockback alto. Empurra tank para fora da cobertura |
| Clérigo | Suporte | 4 | 95 | 5.0 | — | Cura o aliado ferido mais próximo, 8 HP/s, alcance 5 |
| Bardo Arcano | Suporte | 3 | 70 | 5.0 | — | Aura: +25% velocidade de conjuração aos aliados em raio 4 |

### Feitiços (sem unidade — efeito direto na área escolhida)

| Carta | Tipo | Custo | Efeito |
| --- | --- | --- | --- |
| Bênção de Ímpeto | Buff | 2 | Aliados em raio 4: +40% velocidade, +25% conjuração, 5 s |
| Maldição da Lentidão | Maldição | 3 | Inimigos em raio 4: 50% de lentidão, 4 s |
| Escudo Arcano | Buff | 3 | Aliados em raio 4: absorve 60 de dano, 6 s |
| Praga | Maldição | 4 | Zona de 3.5 por 5 s: 10 de dano/s, atravessa o escudo |

Os quatro feitiços são a expressão direta de "buffs e maldições" — e note que
todos são de **área escolhida pelo jogador**, ou seja: mesmo o feitiço exige a
decisão de posicionamento. Nenhuma carta do jogo é um botão que se aperta sem pensar onde.

---

## 10. O teste de agência

> **Uma partida com o jogador AFK e a mesma partida jogada bem precisam terminar
> diferente, de forma visível.**

Este era o risco número um do pivot. No modelo escolhido ele está resolvido por
construção, e dá para afirmar isso com precisão:

- **AFK = derrota garantida em ~90 s.** O jogador AFK não invoca nada. As duas
  Torres dele caem para qualquer push mínimo, e o Núcleo cai em seguida. Não existe
  estado passivo defensável.
- **A decisão acontece a cada ~3 s.** É o intervalo de uma mana. Numa partida de
  3 min o jogador toma ordem de 60 decisões de invocação e posicionamento.
- **A mesma carta joga diferente.** Plantar o Golem atrás da cobertura ou no aberto
  muda o resultado do push, porque a sim tem line-of-sight e altura de obstáculo.

**Como isso vira teste de verdade, não parágrafo de GDD:** a sim é determinística
(`sim/rng.ts`, mulberry32 semeado) e roda headless — o servidor já provou isso
rodando 4v4 de bots a 19.9 Hz sem browser. Então o teste é executável:

Esse teste **existe e roda** em `sim/agency.test.ts`. Resultado medido:

| Cenário | Resultado |
| --- | --- |
| Comandante ativo vs **AFK**, 5 seeds | **AFK perde 5/5**, sempre por Núcleo destruído |
| Estruturas perdidas | AFK perde 3; o lado ativo perde **0** |
| Tempo até decidir | **93–136 s** — dentro do que esta seção prometia |

O risco número um está fechado com evidência. O que **não** está fechado é a
separação por habilidade — ver §14.

---

## 11. Como os magos lutam (IA)

A IA **não** é trabalho novo. [sim/bot/Brain.ts](sim/bot/Brain.ts) já entrega, com
cobertura de teste:

- Modelo de utilidade com 5 ações (`wander`, `advance`, `takeCover`, `retreat`, `attack`)
- Focus-fire de esquadrão (alvo ponderado por ferido/exposto/perto)
- Busca de cobertura e peek spots
- Esquiva reativa de projétil (`DODGE_RADIUS` 3.5)
- Mira com lead por velocidade do alvo e erro escalado por distância
- Separação de aliados
- Três dificuldades

O que precisa mudar nele para o modelo novo é pequeno e localizado:

1. **Prioridade de alvo estrutural.** Hoje `nearestEnemy` só olha magos. Precisa considerar Torre/Núcleo, com peso por papel — o Tank prefere estrutura, o Dano prefere unidade que o ameaça.
2. **Vetor de avanço.** Hoje o bot vagueia quando não há inimigo; precisa avançar em direção à estrutura inimiga.
3. **Comportamento por papel.** `ADVANCE_STOP_DISTANCE` já existe (6.5) — o Tank usa um valor baixo, o Dano um alto, e o Suporte segue o aliado mais avançado em vez de procurar inimigo.

Nenhum desses toca o modelo de utilidade nem as três dificuldades. É extensão, não reescrita.

---

## 12. Progressão e monetização

A `api/` já existe (contas, `MatchLog`, ranking, agregação de stats) e no modelo
novo ela fica **mais** central, não menos.

- **Progressão é de acesso, não de poder.** Jogar desbloqueia cartas novas para o pool. Uma carta desbloqueada nunca é mais forte que uma inicial — é uma opção diferente.
- **Cartas não sobem de nível.** Esta é a divergência deliberada do Clash Royale e é uma decisão de produto: um jogador novo e um veterano jogam com números idênticos. O ranking mede jogador, não coleção.
- **Monetização (fora do escopo v1): apenas cosmético.** Skin de mago, efeito de conjuração, emote. Nada que altere um número da §9.
- **Ranking:** ELO por vitória, já suportado pelo que existe em `api/src/routes/ranking.ts`.

---

## 13. Mapeamento técnico — o que existe, o que muda, o que é novo

> Esta seção é o contrato com o código. Ela existe para impedir que alguém leia
> "pivot" e conclua "recomeçar".

### Sobrevive intacto (a maior parte do custo já foi paga)

`sim/World.ts` · `sim/Arena.ts` · `sim/elements.ts` · `sim/entities.ts` ·
`sim/Vec2.ts` · `sim/rng.ts` · `sim/defaultMap.ts` · `sim/bot/Brain.ts` ·
o servidor Node inteiro (`server/src/**`: Hub, Room, RoomManager, Session, App, main) ·
o pipeline de render do cliente (`SnapshotSync`, `ArenaRenderer`, `PlayerRenderer`,
`ParticleRenderer`, `PuddleRenderer`, `HUD`, `Minimap`) · a `api/` inteira.

**Em particular, `sim/elements.ts` não muda.** Os 7 elementos são o catálogo de
ataque das unidades da §9. Os números de dano, knockback, arco e poça já estão
afinados e cobertos por teste.

### Muda — é pouco e é cirúrgico

| Hoje | Vira |
| --- | --- |
| `InputMsg` (`move`/`aim`/`charging`/`release`) em [sim/protocol.ts:29](sim/protocol.ts#L29) | `CastMsg` — `{ cardId, position }`. É a única remoção real do pivot: 7 linhas |
| Captura WASD + mouse em `src/net/OnlineMatch.ts` | Mão de 4 cartas + barra de mana + clique no chão para plantar |
| Câmera seguindo o mago local | Câmera fixa mostrando a arena inteira |
| `World.addMage(id, team, element, isBot)` posiciona por slot de spawn | Ganha variante que aceita posição (a invocação) |
| `lives` + `respawn` + `checkRoundEnd` por vidas | Estruturas + timer de 3 min |
| `teamSize` no `create_room` | Fica; 1v1 é `teamSize: 1` |

### Novo — o custo real do pivot

1. **Entidade `Structure`** (Núcleo, Torre) em `sim/entities.ts` + tratamento em `World.step` e no snapshot. Alvo estático que atira.
2. **Sistema de mana** — servidor autoritativo, por jogador. Simples, mas é o coração do balance.
3. **Baralho / mão / ciclo** — estado por jogador na `Session`, e a UI correspondente.
4. **Sistema de status effects genérico.** `sim/entities.ts` hoje tem `stunTimer`, `slowFactor`/`slowTimer`, `immunityTimer` — precedente, não sistema. Buffs, maldições, DoT, escudo e dispel pedem um modelo com stacking e duração.
5. **Catálogo de cartas** — a §9 virando dado, no mesmo formato de `elements.ts`.
6. **Mapa de estruturas** — JSON novo em `public/maps/`.
7. **Balance IA-vs-IA** — o item mais subestimado. Ver §14.

### Ordem sugerida de implementação

1. `Structure` na sim + condição de vitória por estrutura (destrava tudo o mais)
2. Sistema de mana no servidor + `CastMsg` no protocolo
3. Invocação: `addMageAt(position)` + validação de zona de invocação
4. Catálogo de cartas como dado, começando só com unidades
5. Ajustes do `Brain` da §11 (alvo estrutural, avanço, papel)
6. UI: mão, mana, preview da próxima carta
7. Status effects genéricos + os 4 feitiços
8. Harness de simulação em massa (§14) — e só então falar em balance

---

## 14. Balance IA-vs-IA — o risco técnico restante

O `Brain` foi afinado contra um humano que erra e desvia. **Espelho de IA boa tende
a empatar ou virar coinflip**, e num jogo onde o jogador não controla a unidade,
isso apareceria como "minhas decisões não importam" — o mesmo sintoma do risco de
agência, por outra causa.

E foi exatamente o que a primeira medição encontrou. O harness existe
(`sim/agency.test.ts`), e o que ele revelou até agora:

1. **Empate era o resultado padrão.** Com estruturas a 1400/900, `hard` vs
   `easy` empatava em **6/6** partidas no timeout da morte súbita. Ninguém
   conseguia derrubar torre contra defesa. Corrigido baixando estrutura para
   900/400 e o dano de torre de 14 para 10.
2. **A dificuldade estava invertida.** `hard` perdia **0/6** para `easy`, porque
   guardava 3 de mana de reserva e acabava invocando *menos*. Os dois lados são
   limitados por mana, não por velocidade de decisão — então cadência quase não
   separa nada (30 casts contra 27 numa partida inteira). A dificuldade foi
   movida para eixos que a economia não anula: **responder a ameaça** e
   **escolher a carta certa para a situação**.
3. **Estado atual: hard 2, easy 1, 3 empates.** Melhor que invertido, longe de
   resolvido. Empate ainda é o resultado mais comum entre dois comandantes.

Próximos passos do balance (§13, passo 8):

- Rodar milhares de partidas carta-contra-carta, não seis, e reportar taxa de vitória e mana trocada.
- **Critério de saúde: nenhuma carta acima de ~55% de vitória contra o pool**, e nenhum par carta-contra-carta em 100/0.
- **Critério novo, que a medição tornou óbvio: taxa de empate precisa cair muito.** Um jogo em que dois jogadores bons empatam metade das vezes não é jogável.
- Rodar em CI com seed fixa, tratando desvio como regressão.

---

## 15. Non-goals (v1)

- Controle direto ou ordens táticas a uma unidade invocada
- Mira manual, WASD, câmera que segue unidade
- Modo assíncrono / luta contra snapshot de roster (ver §16.1)
- 2v2, torneios, clãs
- Progressão de poder, gacha, baús
- Lanes com creeps automáticos de MOBA

---

## 16. Perguntas em aberto

1. **Assíncrono depois?** Real-time foi escolhido e é o que está sendo construído. Assíncrono continua possível *sem retrabalho*: a sim é determinística e headless, então "lutar contra o baralho gravado de outro jogador" é rodar o mesmo `World` sem socket. Decisão adiada de propósito, não esquecida.
2. **Duas Torres ou uma?** A §5 propõe duas + imunidade do Núcleo. Duas dão forma de flanco à partida; uma é mais simples de balancear. Confirmar antes de desenhar o mapa.
3. **Treze cartas bastam para o v1?** Baralho de 8 num pool de 13 deixa pouca variedade de composição — e a regra de construção da §7 (mín. 1 de cada papel, máx. 3 feitiços) aperta ainda mais. Pode ser o certo para testar, e o errado para reter jogador.
4. **O Suporte é legível?** É o papel com maior risco de o jogador não perceber o efeito. Pode exigir feedback visual mais forte que os outros dois.
5. **Practice mode.** Continua congelado em `src/systems/**` com o modelo antigo, e não migra neste pivot. Ele agora descreve um jogo que não existe mais — decidir se vira tutorial do modelo novo ou se sai.

---

## 17. Estado do repo relevante a este GDD

- `sim/**` e `server/src/**` estão na working tree, **não commitados**, e são a fundação deste design. Não deletar.
- A suíte é uma só: `npm run typecheck && npm run lint && npm test && npm run build` (208 testes verdes na última verificação).
- Containers Docker estão desatualizados; rebuildar antes de testar via `:8080`.
- `AGENTS.md` marca `sim/**` como zona de coordenação obrigatória — este GDD toca essa zona inteira.
