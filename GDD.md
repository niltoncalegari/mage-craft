# GDD — Mage Craft

**Título:** Mage Craft
**Versão:** 1.1 — auto brawl: esquadrão permanente, cartas só de buff
**Status:** rascunho vivo — base de produto, não especificação de engine
**Modelo de referência:** Clash Royale para a economia (mana única, baralho, mão, ciclo); auto brawler para o campo (esquadrão permanente e autônomo)
**Idioma do doc:** PT-BR

> **Este documento substitui o GDD 0.1 por inteiro.** O jogo deixou de ser um brawl
> de controle direto. Quem procura o design antigo (mago único controlado por
> WASD + mira) deve ler `design.md` e `multiplayer-plan.md`, que passam a ser
> **documentos históricos** — descrevem o produto anterior e não devem ser editados.

> ⚠️ **Mudança da v1.0 para a v1.1 (auto brawl).** Na v1.0 a carta **invocava** um
> mago; o verbo primário era Invocar. Na v1.1 **a carta não invoca nada**: cada
> jogador tem um esquadrão fixo de magos que já está em campo, e a mana é gasta
> em **buffs e maldições** sobre quem já está lutando.
>
> Reescritas por causa disso: §1, §2, §3, §4, §5, §6, §7, §8, §9, §10, §11, §13,
> §14, §15 e §16. A §17 (arte e áudio) é nova.
>
> **Duas coisas que a v1.1 quebrou e ainda não consertou**, ditas aqui para
> ninguém descobrir tarde: o teste de agência da §10 foi **invalidado** — um
> jogador AFK agora tem 4 magos lutando por ele — e metade do baralho **não
> existe**, porque só 4 das 8 cartas de efeito estão desenhadas (§9).

---

## 1. Visão

Dois conjuradores se enfrentam em tempo real numa arena. Nenhum dos dois controla
um mago diretamente, e nenhum dos dois invoca: cada um tem um **esquadrão de magos
que já está em campo**, lutando sozinho do primeiro segundo. O que o jogador faz é
gastar mana **potenciando os seus e sabotando os do rival** — buffs, maldições,
escudos, pragas.

A partida é decidida por *em quem você aposta, onde e quando* — nunca por mira ou
reflexo. Os magos são autônomos o tempo inteiro; o jogador nunca dá uma ordem a
ninguém.

**Promessa ao jogador:**
*"Meus magos estavam perdendo a troca, eu joguei o buff certo no momento certo, e
a briga virou."*

**Sensação-alvo:** tenso, legível, de leitura e resposta. Partidas de 3 minutos.

---

## 2. Design brief (contrato)

| Campo | Definição |
| --- | --- |
| Fantasia | Conjurador que sustenta um esquadrão de magos elementais na briga |
| Feeling | Leitura, resposta, economia — tenso sem exigir reflexo |
| Verbo primário | **Potenciar** (escolher carta de efeito + escolher onde aplicar) |
| Verbos secundários | Maldizer o esquadrão inimigo, guardar mana, ciclar a mão |
| Loop curto (3–10s) | Ler qual briga está apertada → escolher o efeito certo → aplicar na área certa |
| Loop de partida (3 min) | Ganhar as trocas locais, abrir vantagem de mana, converter em dano de estrutura |
| Falha / retry | Briga perdida custa Torre; o mago morto volta, a mana gasta não |
| Skill expression | Timing do buff, leitura de aglomerado, gestão de mana, ciclo de baralho, montagem do esquadrão |
| Legibilidade | Papel pela silhueta, elemento pela cor, efeitos ativos visíveis no mago, mana e mão sempre visíveis |
| Non-goals (v1) | **Invocar unidade com carta**, controle direto, ordens táticas, mira manual, lanes de MOBA com creeps, 5v5, gacha |

**Core loop contract:**

```text
O esquadrão de cada lado luta sozinho e avança para as estruturas inimigas;
o jogador gasta mana em buffs nos seus e maldições nos do rival;
ler qual troca está para ser perdida e virá-la com o efeito certo gera vantagem;
vantagem vira briga ganha, que derruba Torre e depois o Núcleo.
```

> **O que esta mudança custou.** Na v1.0 a decisão mais densa do jogo era *onde
> plantar*. Sem invocação, posicionamento virou *onde centrar um raio*, que é uma
> decisão mais rasa. É o principal risco de design aberto da v1.1 — ver §16.2.

---

## 3. O modelo: o que copiamos do Clash Royale e o que não

### Copiamos (é o que faz o gênero funcionar)

- **Real-time, simétrico, 1v1.** Os dois jogam ao mesmo tempo, na mesma sim autoritativa.
- **Mana única que regenera.** Um recurso só, teto baixo, regeneração constante. É o relógio da partida.
- **Baralho + mão + ciclo.** Você não tem acesso a tudo o tempo todo; a ordem das cartas é parte da decisão.
- **Unidades autônomas.** O jogador nunca comanda um mago.
- **Objetivo estrutural.** Ganha quem derruba mais estrutura, não quem mata mais.

### Não copiamos

- **Invocação por carta.** É a divergência central da v1.1, e a maior. No CR a carta *cria* a unidade; aqui a unidade já existe e a carta a *modifica*. Ver §7 e §9.
- **Exército descartável.** Unidade de CR é consumível: nasce, empurra, morre, some. Nosso esquadrão é **permanente e ressuscita** — o jogador se apega aos mesmos quatro magos durante a partida inteira, o que muda o vínculo com eles.
- **Lanes com ponte e rio.** Nossa arena é aberta e tem **cover real** — obstáculos com altura, bloqueio de projétil e line-of-sight, que já existem em [sim/Arena.ts](sim/Arena.ts). Projétil com tempo de voo e cobertura dão profundidade posicional que a grade do CR não tem.
- **Progressão de nível de carta paga.** Cartas não sobem de poder. Ver §12.
- **Gacha / baús.** Ver §12.
- **Alvo travado até a morte.** Nossos magos têm IA real (esquiva, cover, focus-fire de esquadrão) — ver §11.

### A diferença que define nosso jogo

No Clash Royale a unidade é um autômato burro que anda reto, e você tem dezenas
delas ao longo da partida. Aqui você tem **quatro magos, os mesmos do começo ao
fim**, cada um rodando o `Brain` que já existe no repo: busca cobertura, esquiva de
projétil, lidera a mira e coordena foco com os aliados.

Isso troca a fantasia. Em vez de despachar tropa, o jogador **torce por e sustenta
um time que ele escolheu** — mais perto de treinador do que de general. É a razão
de o esquadrão ser montado antes da partida (§9) e de a morte ser temporária (§4).

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

**O jogador não tem corpo na arena** — ele é o conjurador fora dela, e nunca pode
ser atingido.

**O esquadrão, porém, é permanente.** Os 4 magos escolhidos (§9) nascem no início
da partida e, quando morrem, **voltam depois de um atraso** no spawn do seu lado.
Morte custa presença: o tempo em que aquele mago não está no campo é a punição, não
a perda definitiva. Nunca existe o estado "não tenho mais nada em campo".

> Isto muda duas vezes de posição na história do doc. O GDD 0.1 tinha `lives` +
> respawn de jogador; a v1.0 removeu respawn por inteiro ("magos invocados morrem e
> não voltam"); a v1.1 **traz respawn de volta**, agora para o esquadrão. O
> maquinário disso já existe parado em `sim/config.ts` (`RESPAWN_DELAY`) e em
> `World.respawn()` — ver §13.

> ⚠️ O atraso de respawn e o tamanho do esquadrão (4) são **números não medidos**.
> Eles são exatamente os dois parâmetros que decidem se o jogador AFK perde ou não
> — ver §10.

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

- Torres atacam sozinhas: projétil arcano, alcance 9.0 (o `ENGAGE_RANGE` que o `Brain` já usa), dano moderado. Elas são a defesa base: um esquadrão que avança sem apoio de carta apanha da Torre, o que dá à defesa uma vantagem de terreno sem exigir nada do jogador.
- **Enquanto as duas Torres estiverem de pé, o Núcleo é imune.** Isso impede rush direto ao Núcleo no minuto 1 e dá forma à partida: quebrar flanco antes de fechar.
- Obstáculos (árvore, rocha, forte, cerca) continuam bloqueando movimento e projétil por altura, exatamente como hoje.

**Não existe zona de invocação.** Como nada é invocado, o conceito saiu: um feitiço
pode ser lançado **em qualquer ponto da arena**, inclusive dentro da base inimiga.
Isso é deliberado por dois motivos. Primeiro, maldição só serve se alcançar onde o
inimigo está. Segundo, ele mata uma classe de frustração inteira: na v1.0 o clique
fora da zona era recusado pelo servidor e o jogador não recebia explicação nenhuma
— nada acontecia na tela.

> A zona de invocação da v1.0 (metade própria + avanço por flanco quebrado) foi
> construída, medida e **descartada** junto com a invocação. O código ainda tem
> `canDeployAt`/`canSummonAt`; ver §13 para o que fazer com eles.

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
| Custo das cartas | 2 a 5 (feitiços; ver §9) |

Por que teto baixo e regeneração lenta: é o que força a decisão. Com teto 10, um
escudo de 3 é quase um terço do arsenal — e enquanto você o gasta para salvar uma
troca, o rival tem mana livre para virar outra do outro lado do campo. **Toda
vantagem no jogo é, no fundo, vantagem de mana**: gastar 2 para anular um efeito de
4 é a jogada boa, e é isso que o jogador aprende a fazer.

> O teto de custo caiu de 7 para 5 na v1.1. As cartas caras da v1.0 eram as
> unidades pesadas (Golem, 5); sem invocação, sobrou só efeito, e efeito custando 7
> num teto de 10 travaria a mão inteira.

Mana é o único freio. Não há cooldown por carta — a carta volta pelo **ciclo do
baralho** (§7), o que é mais legível e cria a decisão de "ciclar barato agora para
ter o contra na mão daqui a 20 s".

---

## 7. As duas montagens: esquadrão e baralho

Na v1.1 o jogador monta **duas coisas separadas** antes da partida, e é importante
que sejam separadas — uma é quem luta, a outra é como você interfere.

### Esquadrão (quem entra em campo)

- **4 magos**, escolhidos do catálogo de 9 (§9).
- Regra de construção: **mínimo 1 de cada papel** (tank, dano, suporte). Um esquadrão de 4 danos morre junto; um de 4 tanks não mata nada.
- Entram em campo no início e ressuscitam ao morrer (§4). Não custam mana — o custo deles foi a escolha.

### Baralho de feitiços (como você interfere)

- **Baralho:** 8 cartas de efeito, montadas fora da partida.
- **Mão:** 4 cartas visíveis + **1 próxima** em preview.
- **Ciclo:** jogou uma carta, ela vai para o fim da fila e a próxima entra na mão.
- **Sem aleatoriedade oculta:** a próxima carta é sempre visível. O jogador planeja dois turnos à frente.

A regra de construção da v1.0 ("mínimo 1 de cada papel, máximo 3 feitiços") **não
existe mais**: papel agora é assunto do esquadrão, e a mão é 100% feitiço por
definição. A regra que a substitui ainda não está desenhada — ver §16.4.

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
não apanha, suporte não faz nem um nem outro sozinho. Um avanço só funciona
combinando papéis, e é isso que dá ao rival algo específico para ler e responder.

Na v1.1 o papel é escolhido **uma vez, na montagem do esquadrão** (§7), e não mais
carta a carta durante a partida. Isso torna a coluna "Silhueta" um requisito duro,
não sugestão: são só quatro magos em campo e eles ficam lá a partida inteira — se o
jogador não distingue o tank do suporte de relance, ele não sabe onde jogar o buff.
Ver §17.

### 8.10 O que cada elemento *faz* — a matriz de efeitos

O papel diz como o mago se comporta; o elemento diz o que o ataque dele deixa
para trás. Enquanto só o gelo e o veneno tinham rider, escolher elemento era
escolher um número de dano — a composição do esquadrão (§7) não era decisão
nenhuma. Cada elemento agora ocupa uma função tática distinta:

| Elemento | Função | Efeito |
| --- | --- | --- |
| **Fogo** | Dano sustentado | **Queimadura**: 2 acertos seguidos acendem um DoT empilhável (até 3 pilhas) |
| **Gelo** | Controle suave | **Lentidão** na velocidade de movimento |
| **Raio** | Controle duro | **Atordoamento** no 3º acerto seguido, e a sequência recomeça do zero |
| **Pedra** | Deslocamento pesado | Knockback alto + **interrompe** a conjuração do alvo |
| **Veneno** | Negação de área | **Poça** no chão, no acerto ou onde o frasco cair |
| **Arcano** | Amplificador | **Vulnerabilidade**: o alvo passa a tomar +25% de dano de todo mundo |
| **Vento** | Deslocamento leve | Knockback muito alto + **interrompe** a conjuração |
| **Sagrado** | Anti-buff | **Luz perfurante**: derruba o Escudo Arcano em vez de arranhá-lo |
| **Sônico** | Anti-conjuração | **Dissonância**: reduz a velocidade de conjuração, e um slow leve |

Três regras que dão forma a isso:

1. **"Acertos seguidos" conta por vítima e por elemento**, não por atacante.
   Dois Pyromancers focando o mesmo alvo alimentam a mesma sequência — é a
   composição que é premiada, não a pontaria de um mago só. Um acerto de outro
   elemento no meio **quebra** a sequência.
2. **A janela da sequência tem que ser maior que a cadência de tiro** de um
   mago (`throwCooldown + chargeTime`), ou o efeito fica inalcançável sozinho.
   `balance.test.ts` prende isso; foi exatamente assim que a primeira versão do
   stun do raio (janela de 2.5s contra cadência de 2.85s) foi pega, sem nunca
   ter falhado nada — ele simplesmente nunca acontecia.
3. **Dano ao longo do tempo não reaplica hit-stun.** Um DoT bate várias vezes
   por segundo; se cada tique repusesse `HIT_STUN`, ficar numa poça (ou pegando
   fogo) seria um root permanente e invisível. A poça de veneno tinha esse bug
   desde sempre.

Os números todos — voo, dano, knockback, efeitos, papéis, roster, feitiços e as
constantes de `config.ts` — vivem em **[public/data/balance.json](public/data/balance.json)**,
lido por import estático (`sim/balance.ts`, mesmo padrão de `defaultMap.ts`), para
que servidor, cliente e Vitest nunca discordem sobre quanto dói uma bola de fogo.

---

## 9. Catálogo (v1.1)

Duas listas, com papéis diferentes: **os 9 magos** são o que você pode levar em
campo, **as cartas** são o que você joga durante a partida. Números são **direção
de design**, não balance final — e agora menos que antes, porque o pivot invalidou
a medição que os afinou (§14).

### Magos — o catálogo do esquadrão (não são cartas)

Estes eram as cartas de unidade da v1.0. Continuam existindo com os mesmos números,
mas **saíram da mão**: agora são as opções da montagem do esquadrão (§7). A coluna
de custo de mana morreu — escolher o esquadrão não gasta mana.

| Mago | Papel | HP | Vel. | Elemento (ataque) | Nota de design |
| --- | --- | --- | --- | --- | --- |
| Golem de Pedra | Tank | 280 | 3.5 | `stone` | Dano 32 e interrompe conjuração. Lento o bastante para ser respondido |
| Sentinela de Gelo | Tank | 200 | 4.0 | `ice` | Lentidão em quem encosta. Tank de controle, não de dano |
| Piromante | Dano | 80 | 5.0 | `fire` | Dano 20 confiável. O mago de referência do papel |
| Condutor de Raio | Dano | 60 | 5.0 | `lightning` | Projétil 30 de velocidade, arco baixo — acerta alvo em movimento |
| Arqueiro Arcano | Dano | 70 | 5.5 | `arcane` | Splash 2.0. Contra de grupo |
| Alquimista | Dano | 70 | 5.0 | `poison` | Poça de 4 s nega terreno. Zoning, não burst |
| Dervixe do Vento | Dano | 65 | 7.0 | `wind` | Dano baixo, knockback alto. Empurra tank para fora da cobertura |
| Clérigo | Suporte | 95 | 5.0 | `holy` | Cura o aliado ferido mais próximo, 8 HP/s, alcance 5. Ataque fraco (dano 8, splash 1.2) |
| Bardo Arcano | Suporte | 70 | 5.0 | `sonic` | Aura: +25% velocidade de conjuração aos aliados em raio 4. Ataque fraco (dano 6, lentidão 15% por 0.6 s) |

> **Suporte passou a atacar.** Até aqui `ROLE_BEHAVIOR.support.attacks` era `false` e
> os dois suportes ficavam parados no meio de um tiroteio, sem nada saindo do cajado —
> o papel não *lia* como um mago. Agora cada um tem um elemento próprio, fraco de
> propósito: os dois estão entre os quatro menores danos do catálogo, e a vontade de
> atirar (`attackUrge` 0.45 contra 0.95) perde para escoltar e buscar cobertura na
> maioria dos estados. Um suporte atira da posição que já estava segurando; ele não
> larga o time para trocar tiro com uma Torre.
>
> O elemento próprio também resolve leitura: `holy` e `sonic` tingem chapéu e gema
> pelo `ELEMENT_TINT`, então o Clérigo é o mago dourado e o Bardo o rosa da arena.
> Antes os dois usavam `arcane`, indistinguíveis do Arqueiro Arcano.
> Nenhum dos dois é selecionável no lobby (`PICKABLE_ELEMENTS`): são ataques de
> classe, chegam com o esquadrão.

### Cartas — buffs e maldições (a mão)

Todas de **área escolhida pelo jogador**, em qualquer ponto da arena (§5). Nenhuma
carta do jogo é um botão que se aperta sem pensar onde.

| Carta | Tipo | Custo | Efeito |
| --- | --- | --- | --- |
| Bênção de Ímpeto | Buff | 2 | Aliados em raio 4: +40% velocidade, +25% conjuração, 5 s |
| Maldição da Lentidão | Maldição | 3 | Inimigos em raio 4: 50% de lentidão, 4 s |
| Escudo Arcano | Buff | 3 | Aliados em raio 4: absorve 60 de dano, 6 s |
| Praga | Maldição | 4 | Zona de 3.5 por 5 s: 10 de dano/s, atravessa o escudo |

> ⚠️ **O baralho é de 8 e só existem 4 cartas desenhadas.** Este é o buraco mais
> concreto que a v1.1 abre: metade do baralho não existe. Não vou inventar números
> aqui para tapar o furo. Os eixos que as 4 faltantes deveriam cobrir, para o
> baralho ter respostas de verdade:
>
> - **Cura instantânea**, distinta do Clérigo, que cura devagar e pode morrer.
> - **Amplificação de dano**, o par ofensivo do Escudo.
> - **Dispel / purgação**, para que buff inimigo tenha resposta e não só seja absorvido.
> - **Negação de terreno defensiva**, para segurar avanço sem precisar ganhar a troca.
>
> Ver §16.4.

---

## 10. O teste de agência

> **Uma partida com o jogador AFK e a mesma partida jogada bem precisam terminar
> diferente, de forma visível.**

Este é o risco número um do pivot, e a v1.1 **reabriu ele**.

### O que a v1.0 tinha provado

Na v1.0 a alegação era resolvida por construção: o jogador AFK não invocava nada,
então não tinha absolutamente nada em campo, e qualquer push mínimo derrubava as
duas Torres e o Núcleo. E isso foi **medido**, não afirmado, em `sim/agency.test.ts`:

| Cenário (v1.0, invocação) | Resultado |
| --- | --- |
| Comandante ativo vs **AFK**, 5 seeds | **AFK perde 5/5**, sempre por Núcleo destruído |
| Estruturas perdidas | AFK perde 3; o lado ativo perde **0** |
| Tempo até decidir | **93–136 s** |

### Por que a v1.1 invalidou isso

O esquadrão permanente destrói a premissa do teste. **O jogador AFK agora tem 4
magos lutando e ressuscitando por ele**, com o mesmo `Brain` do adversário. Os dois
lados têm exatamente a mesma força em campo; a única diferença entre jogar bem e não
jogar é o efeito dos buffs. O medido acima descreve um jogo que não existe mais.

Consequências, ditas com clareza para ninguém se enganar mais tarde:

- **`sim/agency.test.ts` vai ficar vermelho** quando o esquadrão entrar, e isso é correto. Consertar **não** é afrouxar o teste.
- **A alegação passa a depender inteiramente de balance**, não de estrutura. Se os buffs forem fracos, dois esquadrões idênticos se anulam e a partida é decidida por RNG — o sintoma exato de "minhas decisões não importam".
- **Os dois parâmetros que decidem isso** são a força/duração dos efeitos e o atraso de respawn do esquadrão. Nenhum dos dois está medido.

O que continua valendo da v1.0: a sim é determinística (`sim/rng.ts`, mulberry32
semeado) e roda headless, então a pergunta **é** respondível por medição, e o
harness para isso já existe. É trabalho de medir, não de construir.

> **Status honesto: o risco número um está aberto de novo.** A v1.0 tinha fechado
> com evidência; a v1.1 escolheu um modelo que o reabre em troca de outra fantasia
> (§3). Fechar de novo é pré-requisito para a v1.1 ser considerada jogável, não
> polimento posterior. Ver §14 e §16.1.

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

As três extensões que a v1.0 previu **já estão construídas**, e nenhuma tocou o
modelo de utilidade nem as três dificuldades:

1. **Alvo estrutural** — ação `siege` nova, Torre e Núcleo como alvo válido.
2. **Vetor de avanço** — o bot avança para a estrutura inimiga em vez de vaguear.
3. **Comportamento por papel** — `ROLE_BEHAVIOR` com distância de parada, preferência por estrutura, escolta e limiar de recuo por papel.

Há **dois agentes de IA distintos**, e a distinção importa: o `Brain` dirige cada
mago, e o `Commander` (`sim/bot/Commander.ts`) joga as cartas. Um bot de partida
usa os dois. Na v1.1 é o `Commander` que muda — ele para de escolher ponto de
invocação e passa a escolher aglomerado para buffar ou maldizer (§13).

O que a v1.1 acrescenta ao `Brain` é pouco: ele precisa **respeitar stats
derivados de efeito** em vez de ler o stat base do mago, senão um mago com
Bênção de Ímpeto continua planejando como se estivesse lento.

> Uma dívida conhecida do `Brain`, agravada pelo esquadrão permanente: **não há
> pathfinding**, só steering com desvio de um passo, e o probe não conhece
> estruturas. Magos encravam contra Torre. Com esquadrão descartável isso era
> feio; com os mesmos quatro magos a partida inteira, um deles preso é 25% da
> sua força fora do jogo.

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

**`sim/elements.ts` mudou depois disto.** O voo (arco, gravidade, velocidade)
continua intocado — `rangeMap.test.ts` o prende —, mas cada elemento ganhou uma
lista `onHit` de efeitos, e os números todos saíram do TypeScript para
`public/data/balance.json`. O motivo é de produto: com um só rider por elemento
(o slow do gelo, a poça do veneno) montar esquadrão não era decisão nenhuma. Ver
§8.10.

### Já construído (v1.0, e continua servindo)

Isto **não** é trabalho a fazer — está no repo, com teste:

1. **Entidade `Structure`** (Núcleo, Torre) na sim, com imunidade do Núcleo, torre que atira, e vitória por estrutura + morte súbita.
2. **Sistema de mana** autoritativo por time, com regeneração e dobra na morte súbita.
3. **Baralho / mão / ciclo** (`sim/Deck.ts`) e a mão no fio (`hand`/`next` no snapshot, por destinatário).
4. **Catálogo como dado** (`sim/cards.ts`, `sim/roles.ts`).
5. **`CastMsg`** no lugar do `InputMsg`; câmera fixa; sem avatar do jogador.
6. **Ajustes do `Brain`**: ação `siege`, alvo estrutural, comportamento por papel.
7. **Fila de matchmaking** com fallback para bot (`server/src/Matchmaker.ts`).
8. **UI de partida**: mão de 4 cartas clicável, barra de mana, preview da próxima, relógio com morte súbita, HP das estruturas, Núcleo e Torres em 3D.
9. **Mapa de estruturas** (`public/maps/siege1.json`).

### O que a v1.1 muda

| Hoje (v1.0) | Vira (v1.1) |
| --- | --- |
| `Card = UnitCard`, com `kind: 'unit'` | União `UnitCard \| SpellCard`. O discriminador já existe, preparado para isso |
| `World.deploy(team, cardId, pos)` gasta mana e invoca | `World.castSpell(team, cardId, pos)` gasta mana e aplica efeito em área |
| `canDeployAt` / `canSummonAt` (zona de invocação) | **Saem.** Feitiço vale em qualquer ponto (§5) |
| `validateDeck` exige mín. 1 por papel | Papel migra para a validação do **esquadrão**; baralho ganha regra nova (§16.4) |
| Mago nasce por `deploy` e morre para sempre (`DEFAULT_LIVES = 1`) | Esquadrão de 4 nasce no início e **ressuscita** — reativa `RESPAWN_DELAY` e `World.respawn()` |
| `Commander` escolhe carta e ponto de invocação | Escolhe feitiço e mira **aglomerado**: centroide dos meus sob ameaça, ou dos inimigos |
| Timers soltos (`slowFactor`/`slowTimer`, `chargeRateBonus`, `immunityTimer`) | **Feito.** Absorvidos pelo `sim/effects.ts`. `chargeRateBonus` sobrou como o meio-termo da aura (recalculado por proximidade a cada tick) e `immunityTimer` ficou como ciclo de vida |

### Novo — o custo real da v1.1

1. ~~**Sistema de status effects genérico** (`sim/effects.ts`).~~ **Feito.** `kind`/magnitude/duração/stacks, stacking declarado como dado (`refresh_strongest`, `stack_intensity`, `pool`) e stats derivados (`moveSpeedMultiplier`, `chargeRateMultiplier`, `damageTakenMultiplier`, `absorbWithShield`). Slow, haste, cast, escudo e o stun migraram para dentro; `stunTimer`, `knockbackVelocity` e `immunityTimer` ficaram de fora de propósito — são física de impacto e ciclo de vida, não status.
2. **Esquadrão** (`sim/Squad.ts`): montagem de 4, spawn no início, respawn com atraso.
3. **As 4 cartas que faltam** para fechar o baralho de 8 (§9).
4. **Feedback de efeito na tela**: sem isso o jogador não vê o que a carta dele fez, e o jogo inteiro depende de ele ver.
5. **Remedição do teste de agência** (§10) — não é opcional.

### Ordem sugerida de implementação

1. ~~Sistema de efeitos genérico, com o slow do gelo migrado para dentro dele~~ **Feito** (§8.10)
2. Esquadrão: montagem, spawn, respawn (esquadrão default hardcoded)
3. `SpellCard` + `World.castSpell`, começando com as 4 cartas que já existem
4. `Commander` jogando feitiço por aglomerado
5. UI: carta mostrando efeito, anel de raio no chão, aura visível no mago buffado
6. **Remedir agência (§10) e afinar a força dos efeitos até separar do AFK**
7. As 4 cartas faltantes + regra de construção de baralho
8. Tela de montagem de esquadrão
9. Harness em massa (§14) — e só então falar em balance

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

> ⚠️ **A v1.1 invalida os três achados acima.** Todos foram medidos num jogo em que
> a mana comprava unidade. Com esquadrão fixo, a mana não compra presença em campo,
> e o eixo de dificuldade ("escolher a carta certa") passa a significar outra coisa.
> Pior: o pivot **piora o prognóstico de empate**, porque agora os dois lados têm
> exatamente a mesma força em campo por construção, e só os efeitos diferenciam.
> Empate era o problema aberto número um antes; continua sendo, com menos folga.

Próximos passos do balance (§13, passo 9), a rodar **depois** de remedir a agência:

- Rodar milhares de partidas carta-contra-carta, não seis, e reportar taxa de vitória e mana trocada.
- **Critério de saúde: nenhuma carta acima de ~55% de vitória contra o pool**, e nenhum par carta-contra-carta em 100/0.
- **Critério novo, que a medição tornou óbvio: taxa de empate precisa cair muito.** Um jogo em que dois jogadores bons empatam metade das vezes não é jogável.
- Rodar em CI com seed fixa, tratando desvio como regressão.

---

## 15. Non-goals (v1)

- **Invocar unidade com carta** (era o verbo primário da v1.0; saiu na v1.1)
- Controle direto ou ordens táticas a um mago do esquadrão
- Mira manual, WASD, câmera que segue unidade
- Modo assíncrono / luta contra snapshot de roster (ver §16.5)
- 2v2, torneios, clãs
- Progressão de poder, gacha, baús
- Lanes com creeps automáticos de MOBA

---

## 16. Perguntas em aberto

As três primeiras são consequência direta da v1.1 e estão em ordem de gravidade.

1. **O AFK ainda perde?** É a pergunta que decide se a v1.1 é um jogo. Com esquadrão permanente e ressuscitando, o jogador parado tem a mesma força em campo que o jogador ativo. Ou os buffs decidem partida, ou o pivot não fecha. **Respondível por medição** (§10), e é a primeira coisa a medir depois que a primeira carta funcionar.
2. **Posicionamento ainda é decisão densa?** Na v1.0 a agência posicional era *onde plantar*, com terreno, cobertura e flanco pesando. Sem invocação, sobrou *onde centrar um raio de 4*, sobre magos que se movem sozinhos. Se isso se provar raso, o candidato natural é dar ao jogador alguma influência sobre **para onde o esquadrão empurra** — o que encosta perigosamente no non-goal de ordens táticas (§15) e por isso não foi decidido aqui.
3. **Quatro magos é o número certo?** Escolhido por parecer legível (4 cabem na tela e na cabeça), não por medição. Interage com o raio dos feitiços: esquadrão pequeno e espalhado torna buff de área difícil de acertar; esquadrão grande e junto torna todo buff um acerto garantido, e a decisão desaparece.
4. **Qual a regra de construção do baralho?** A da v1.0 morreu com a invocação (§7). Sem regra, o baralho degenerado provável é só maldição, ou só o efeito mais barato para ciclar rápido. Depende das 4 cartas que faltam (§9).
5. **Assíncrono depois?** Real-time foi escolhido e é o que está sendo construído. Assíncrono continua possível *sem retrabalho*: a sim é determinística e headless, então "lutar contra o esquadrão e o baralho gravados de outro jogador" é rodar o mesmo `World` sem socket. Decisão adiada de propósito, não esquecida.
6. **Duas Torres ou uma?** A §5 propõe duas + imunidade do Núcleo, e o mapa `siege1.json` foi construído assim. Duas dão forma de flanco à partida; uma é mais simples de balancear.
7. **O Suporte é legível?** É o papel com maior risco de o jogador não perceber o efeito. Piora na v1.1: agora o Clérigo cura *e* o jogador joga cura, e os dois precisam ser distinguíveis na tela. **Atacado, não fechado:** o suporte agora tem ataque próprio (§9), anel de área no chão marcando o alcance real e feixe do Clérigo até quem ele curou (`SupportRenderer`). Falta medir se o jogador atribui o efeito ao mago certo quando uma Bênção jogada e um Clérigo agem no mesmo aglomerado.
8. **Practice mode.** Continua congelado em `src/systems/**` com o modelo antigo. Descreve um jogo que não existe mais há duas versões — decidir se vira tutorial do modelo novo ou se sai.

---

## 17. Direção de arte e áudio

Nada aqui é decoração: a legibilidade é requisito de design (§2), porque o jogador
não controla ninguém — se ele não consegue ler o campo, ele não tem jogo.

### Arte

- **Low poly procedural, sem textura de arquivo.** Tudo é primitiva de Three.js com paleta cartoon, gerado em código. Continua valendo e não é para mudar.
- **Chão: gramado com trilhas de terra.** Era neve. A terra marca as rotas por onde as unidades andam, o que dá referência espacial num campo aberto. Pintado proceduralmente num canvas — grama mosqueada em três tons, trilhas com bordas que desbotam. **Grama volumétrica animada por shader foi tentada e descartada**: 13 mil lâminas com vento no vertex shader leem como sujeira tremendo numa câmera afastada, não como grama.
- **Identidade do mago, em três camadas** (implementa a linha "Legibilidade" da §2): **time pela cor do corpo** (nunca perder "quem é meu"), **papel pela silhueta** conforme a §8 (tank grande e pesado, dano magro e alto, suporte pequeno e curvado), **elemento pelo acento** (chapéu, cajado, gema). O fio já carrega `role`, `element` e `cardId` por mago — é trabalho de render, não de protocolo.
- **Efeito ativo tem que ser visível no mago.** Na v1.1 o jogo inteiro é aplicar efeito; buff invisível é carta que o jogador não sabe se funcionou.
- **Cada elemento tem silhueta, não só cor.** Todo projétil já foi a mesma `SphereGeometry` recolorida, e o resultado foi que o pedregulho do Golem lia como bola de neve e só o raio — o único com malha própria — lia como feitiço. A cor não sobrevive à distância da câmera de partida; a forma sobrevive. Cada elemento tem corpo próprio em `src/render/projectileGeometry.ts` (rocha facetada que tomba, estilhaço que aponta para onde vai, gosma que se deforma, orbe com anel de runas, lâmina em meia-lua, sigilo, onda concêntrica) e giro próprio. Continua tudo primitiva de Three.js gerada em código, conforme a regra acima.
- **Estruturas:** Núcleo e Torre compartilham a linguagem de cristal sobre pedra, com escudo visível enquanto o Núcleo é imune.

### Áudio

- **Sem cama de ruído contínuo.** Havia um "ambiente" que era white noise literal em loop infinito — estática de TV. Foi removido: **silêncio é melhor que chiado**, e o orçamento de som vai para eventos, que é o que o jogador precisa ouvir.
- **Áudio é procedural** (Web Audio, sem arquivos), e serve ao feedback: conjuração, impacto, estrutura levando dano.
- **Mute e volume têm que ser alcançáveis de dentro da partida.** Na v1.0 o controle de som existia só no menu do practice, então numa partida online não havia como desligar nada. Um controle de áudio inacessível no único modo jogável é bug de produto, não de conforto.

---

## 18. Estado do repo relevante a este GDD

- `sim/**` e `server/src/**` são a fundação deste design. **Não deletar.**
- A suíte é uma só: `npm run typecheck && npm run lint && npm test && npm run build` — **273 testes verdes** na última verificação.
- Containers Docker **estão atualizados** para o servidor Node (`server/Dockerfile` builda da raiz, porque o servidor importa `sim/` e `public/maps/`; `nginx.conf` faz proxy de `/ws` com upgrade). A nota anterior de "desatualizados" ficou obsoleta. Não verificado com build real recente — o daemon estava desligado.
- Existe smoke de browser de ponta a ponta: `node scripts/siege.mjs` sobe fila, partida, cast, e confere mana e ciclo da mão no fio.
- `AGENTS.md` marca `sim/**` como zona de coordenação obrigatória — a v1.1 toca essa zona inteira, incluindo `World`, `entities`, `cards`, `Deck` e `bot/`.
