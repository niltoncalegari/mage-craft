# GDD — Mage Craft

**Título:** Mage Craft
**Versão:** 1.2 — idle: a partida é o programa que você escreveu antes dela
**Status:** rascunho vivo — base de produto, não especificação de engine
**Modelo de referência:** Clash Royale para a economia (mana única, baralho, mão, ciclo); auto brawler para o campo (esquadrão permanente e autônomo); idle/gambit para o verbo (o jogador programa, não executa)
**Idioma do doc:** PT-BR

> **Este documento substitui o GDD 0.1 por inteiro.** O jogo deixou de ser um brawl
> de controle direto. Quem procura o design antigo (mago único controlado por
> WASD + mira) deve ler `design.md` e `multiplayer-plan.md`, que passam a ser
> **documentos históricos** — descrevem o produto anterior e não devem ser editados.

> ⚠️ **Mudança da v1.1 para a v1.2 (idle).** Na v1.1 o jogador clicava uma carta
> da mão e depois clicava no chão para conjurar. Na v1.2 **ele não clica em nada
> durante a partida**: escreve antes um **programa** — uma lista ordenada de
> regras `SE <situação> ENTÃO <carta> EM <alvo>` — e a partida executa esse
> programa. O verbo primário deixa de ser Potenciar e passa a ser **Programar**.
>
> Reescritas por causa disso: §1, §2, §7, §9, §10, §13, §14, §15, §16, §17 e §18.
>
> **As duas dívidas que a v1.1 deixou em aberto estão pagas**, e é a v1.2 que as
> paga:
>
> - **O teste de agência da §10 fechou de novo, com medição.** A v1.1 o tinha
>   invalidado (um jogador AFK tinha 4 magos lutando por ele, então "AFK perde"
>   deixou de ser verdade por construção). O modelo idle o torna respondível de
>   novo, porque **não jogar virou um estado representável** — um programa sem
>   regras, que conjura exatamente zero vezes — em vez de um jogador ausente que
>   o jogo não conseguia distinguir de um presente.
> - **O baralho está completo.** Eram 4 cartas para 8 slots; o catálogo da §9
>   agora tem **25 cartas em 5 cores**, com regra de construção (§7).
>
> A v1.1 registrava a v1.0 como "medida num jogo que não existe mais". A v1.2 não
> repete isso: as medições da §10 e da §14 foram **refeitas** neste modelo.

---

## 1. Visão

Dois conjuradores se enfrentam em tempo real numa arena. Nenhum dos dois controla
um mago diretamente, e nenhum dos dois invoca: cada um tem um **esquadrão de magos
que já está em campo**, lutando sozinho do primeiro segundo. A mana é gasta
**potenciando os seus e sabotando os do rival** — buffs, maldições, escudos,
pragas.

O que mudou na v1.2 é *quem aperta o botão*: ninguém. Antes da partida o jogador
escreve um **programa** — uma lista ordenada de regras do tipo
`SE <situação> ENTÃO <carta> EM <alvo>` — e durante a partida é o programa que
conjura. O jogador assiste.

A partida é decidida por *que regras você escreveu e em que ordem* — nunca por
mira, reflexo ou velocidade de clique. Os magos são autônomos o tempo inteiro; o
jogador nunca dá uma ordem a ninguém, e desde a v1.2 nem uma carta ele joga à mão.

**Promessa ao jogador:**
*"Eu escrevi 'se um inimigo passar da metade do campo, joga o pântano nele'.
Passou. Jogou. Aquela briga virou porque eu previ."*

**Sensação-alvo:** tenso, legível, de leitura e resposta — mas a leitura acontece
**entre** partidas, sobre o que o programa fez, e a resposta é uma edição na lista
de regras. Partidas de 3 minutos.

> **Por que isto é um jogo e não um screensaver.** A resposta é uma só e é
> estrutural: o jogador precisa conseguir **atribuir** o que aconteceu a uma
> regra que ele escreveu. É por isso que o fio carrega `firedRule` e o HUD
> escreve "Regra 3 · Praga → aglomerado inimigo" (§13, §17). Sem atribuição, um
> jogo idle é de fato um screensaver — e o item que fecha isso é requisito, não
> polimento.

---

## 2. Design brief (contrato)

| Campo | Definição |
| --- | --- |
| Fantasia | Conjurador que **escreve a doutrina** de um esquadrão de magos elementais e a vê ser executada |
| Feeling | Antecipação e autoria — prever a situação em vez de reagir a ela |
| Verbo primário | **Programar** (escrever, ordenar e podar regras `SE → ENTÃO → EM`, fora da partida) |
| Verbos secundários | Montar baralho e esquadrão, ler o rastro de regras da partida, reordenar prioridades |
| Loop curto (3–10s) | *Fora da partida:* ler o que a última partida fez → achar a regra que faltou ou que disparou cedo demais → editar e reordenar |
| Loop de partida (3 min) | Assistir o programa executar, ler o painel de rastro, anotar onde ele erra |
| Falha / retry | Programa errado perde a partida inteira e **só é corrigível entre partidas** — é o que dá peso à escrita |
| Skill expression | Ordem das regras, escolha de guardas, orçamento de mana embutido nas condições, montagem de baralho, montagem do esquadrão |
| Legibilidade | Papel pela silhueta, elemento pela cor, efeitos ativos visíveis no mago, **e a regra que disparou nomeada no HUD** |
| Non-goals (v1) | **Jogar carta durante a partida**, **invocar unidade com carta**, controle direto, ordens táticas, mira manual, lanes de MOBA com creeps, 5v5, gacha |

**Core loop contract:**

```text
Antes da partida o jogador escreve um programa: regras SE <situação> ENTÃO <carta> EM <alvo>,
lidas de cima para baixo, primeira que casa vence;
o esquadrão de cada lado luta sozinho e avança para as estruturas inimigas;
o programa gasta a mana pelo jogador, e um programa que lê melhor a situação gera vantagem;
vantagem vira briga ganha, que derruba Torre e depois o Núcleo;
o jogador lê no rastro qual regra disparou, e edita o programa para a próxima.
```

> **O que a v1.2 resolveu de graça.** A §16.2 da v1.1 estava aberta com "sem
> invocação, posicionamento virou *onde centrar um raio*, uma decisão mais rasa".
> Isso **fechou por outro caminho**: a densidade não voltou para o posicionamento,
> ela migrou para o programa. Escolher entre `aglomerado inimigo`, `intruso mais
> profundo` e `linha de frente aliada` — e sob que guarda — é uma decisão bem mais
> densa que arrastar um círculo, e é tomada com tempo para pensar. Ver §16.2.

> **O que esta mudança custou.** O jogo perdeu o momento a momento. Não há mais
> "eu vi e reagi": entre a decisão e a consequência agora existe uma partida
> inteira. É uma troca deliberada — a decisão ficou mais densa e menos frequente —
> e o risco que ela abre é de **engajamento**, não de profundidade: um jogador que
> não entende por que perdeu não tem o que editar. Ver §17 e a §16.9.

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

**Não há cooldown por carta** — a carta volta pelo **ciclo do baralho** (§7), o que
é mais legível e cria a decisão de "ciclar barato agora para ter o contra na mão
daqui a 20 s".

Mana era o único freio até a v1.1. A v1.2 acrescentou um segundo, e por um motivo
que só o modelo idle cria: um **cooldown global de conjuração de 0.75 s**, no
`World`, por onde passam programa, bot e (historicamente) a mão humana. Sem ele o
programa seria estritamente mais forte que a interface que substituiu — o avaliador
roda muitas vezes por segundo, e um banco de 10 com carta de 2 sairia como cinco
conjurações em cinco quadros consecutivos. Ele é frouxo de propósito: os intervalos
que o bot já usava (1.1 / 1.6 / 2.6 s) nunca encostam nele, então ele limita o
programa e **não** altera nada do que já existia.

---

## 7. As três montagens: esquadrão, baralho e estratégia

Na v1.2 o jogador monta **três coisas separadas** antes da partida, e é importante
que sejam separadas: uma é quem luta, a outra é o que você tem à disposição, a
terceira é o que fazer com isso. **Toda a partida está nestas três telas** — depois
que ela começa não há mais entrada nenhuma.

### Esquadrão (quem entra em campo)

- **4 magos**, escolhidos do catálogo de 9 (§9).
- Regra de construção: **mínimo 1 de cada papel** (tank, dano, suporte). Um esquadrão de 4 danos morre junto; um de 4 tanks não mata nada.
- Entram em campo no início e ressuscitam ao morrer (§4). Não custam mana — o custo deles foi a escolha.

### Baralho de feitiços (o que você traz)

- **Baralho:** 8 cartas de efeito, escolhidas das 25 (§9).
- **Regra de construção (fecha a §16.4):** no máximo **2 cores**, no máximo **2 cópias** de cada carta, no mínimo **3 cartas distintas**.

> ✅ **As três regras estão ligadas.** `MAX_COPIES`, `MIN_DISTINCT` e
> `MAX_COLORS` são todas validadas em `validateDeck`.
>
> A das cores foi a última a entrar, e **foi adiada de propósito, não esquecida**:
> enquanto o preto teve uma carta só, nenhum par que o incluísse alcançava 8 cartas
> dentro do teto de 2 cópias, e ligar a regra teria **removido a Maldição da
> Lentidão do jogo** em vez de restringir como ela é usada. A terceira carta verde
> é o que deu ao preto um par viável, e esse é o commit que pôde bancar a regra.
>
> O teste-armadilha (`colorLimitIsPlayable()`) que guardava isso **continua de pé,
> invertido**: agora ele falha se uma edição de catálogo voltar a encalhar uma cor,
> tornando alguma carta immontável em silêncio. É a mesma guarda, apontando para o
> outro lado.
- **Mão:** 4 cartas visíveis + **1 próxima** em preview.
- **Ciclo:** jogou uma carta, ela vai para o fim da fila e a próxima entra na mão.
- **Sem aleatoriedade oculta:** a próxima carta é sempre visível.

> **Por que duas cores.** Uma cor são 5 cartas para 8 slots — duplicata forçada,
> escolha nenhuma. Livre entre 25 torna a cor cosmética e transforma a paleta do
> editor de estratégia num scroll de 25 itens. Duas cores dão um pool de 10 para 8
> slots: corte real, identidade legível, e um seletor que cabe num telefone em
> landscape. **Máximo 2 cópias** preserva o desenho do ciclo — com mão de 4, duas
> cópias é "volta a cada duas mãos", enquanto 8 cópias de uma carta colapsariam
> todo programa a uma regra só.

### Estratégia (o que fazer com isso) — **novo na v1.2**

- **Programa:** até **12 regras**, ordenadas, editadas numa tela própria (`StrategyBuilder`).
- **Uma regra:** `SE <condição> ENTÃO <carta> EM <alvo>`, mais um interruptor liga/desliga.
- **Condição:** mana, tempo, morte súbita, postura do esquadrão, contagem/vida/aglomeração de aliados e inimigos, intruso na nossa metade, vida de Núcleo e Torres, efeito ativo em alguém. Combináveis com `E`/`OU` e negáveis com `não`.
- **Alvo:** `aglomerado inimigo`, `aglomerado aliado`, `intruso mais profundo`, `aliado mais ferido`, `inimigo mais forte`, `linha de frente` (aliada ou inimiga), `nosso Núcleo`, `Núcleo inimigo`, `nosso objetivo`, `ponto de reunião`.

**Semântica: primeira que casa vence, de cima para baixo.** Uma regra é elegível se
está ligada, a carta está na mão, a mana paga, a condição é verdadeira e o alvo
resolve para um ponto. Qualquer falha **pula para a próxima regra** — nunca espera.

> **Por que pular e não esperar.** Se uma regra inelegível bloqueasse as de baixo,
> a regra do topo faria negação de serviço sobre o resto do programa do próprio
> jogador, e a seta de "senão" do editor seria mentira. Esperar continua
> perfeitamente expressável, só que **explicitamente**: guarde as regras baratas
> sob `SE mana >= 7` para poupar para a cara. É o idioma de Gambit que o gênero já
> conhece, e custa zero de engine.

> **Por que 12 e não ilimitado.** Doze regras é o que ainda se lê de relance numa
> coluna, e o que um jogador consegue segurar na cabeça ao explicar por que perdeu.
> O teto também é o que mantém a avaliação barata o bastante para rodar 4×/s por
> time sem entrar no orçamento de frame.

**Cadência.** O programa é avaliado 4×/s, mas conjurar tem um **cooldown global de
0.75 s** que vale para todo mundo (§6). Sem ele o programa seria estritamente mais
forte que a mão humana que substituiu — um banco de 10 de mana com carta de 2 sairia
como cinco conjurações em cinco quadros consecutivos, coisa que nenhuma mão faz.
**Não existe botão de dificuldade:** a qualidade do programa é o programa.

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
4. **Empurrão pesado corta a cura.** Um acerto que imponha pelo menos
   `HEAL_INTERRUPT_KNOCKBACK` (3.0 — fogo, arcano, pedra e vento) desliga a cura
   da vítima por `HEAL_INTERRUPT_DURATION` (0.8 s). A regra lê o *knockback*, não
   uma lista de elementos: o que é pesado o bastante para mover um mago é pesado
   o bastante para tirar o Clérigo do ritmo, e afinar quem se qualifica continua
   sendo uma edição de `balance.json`. O corte é momentâneo por definição — a
   cura volta sozinha quando o timer zera (§9).

Os números todos — voo, dano, knockback, efeitos, papéis, roster, feitiços e as
constantes de `config.ts` — vivem em **[public/data/balance.json](public/data/balance.json)**,
lido por import estático (`sim/balance.ts`, mesmo padrão de `defaultMap.ts`), para
que servidor, cliente e Vitest nunca discordem sobre quanto dói uma bola de fogo.

---

## 9. Catálogo (v1.2)

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
| Clérigo | Suporte | 95 | 5.0 | `holy` | Cura o aliado ferido mais próximo, 8 HP/s, alcance 5, **cortada por 0.8 s a cada empurrão pesado** (§8.10). Ataque fraco (dano 8, splash 1.2) |
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

### Cartas — buffs e maldições (o que o programa joga)

Todas de **área**, aplicada no ponto que o **seletor da regra** resolver (§7) — não
mais num ponto que a mão do jogador escolhe. Nenhuma carta do jogo é um botão que se
aperta sem pensar onde; na v1.2 o "onde" é escrito antes, o que o torna uma decisão
mais deliberada e não menos.

**O catálogo desenhado é de 25 cartas em 5 cores.** As cores são o eixo de
identidade e a base da regra de construção (§7):

| Cor | Fantasia | Cartas desenhadas |
| --- | --- | --- |
| ⚪ Branco | Sustentar e proteger — escudo, cura, fortificação | 5 |
| 🟢 Verde | Negar terreno e prender — zonas, raízes, obstáculo | 5 |
| 🔴 Vermelho | Dano direto e agressão — explosão, marca, frenesi | 5 |
| 🔵 Azul | Controle e manipulação — petrificar, dispel, teleporte, economia | 5 |
| ⚫ Preto | Sacrifício e sabotagem — silêncio, vínculo de dor, paranoia | 5 |

#### O que está implementado hoje — **14 cartas**

> 🚧 **Esta contagem está se movendo enquanto a Fase 13 roda.** Tier 1 está
> completo e o Tier 2 está a duas cartas do fim (faltam Clarão Nulo e Erupção
> Vulcânica); o Tier 3 inteiro ainda não começou. A fonte de verdade é
> `ALL_SPELLS` em [sim/spells.ts](sim/spells.ts) e os números em
> `public/data/balance.json` — quando as duas discordarem deste texto, é o texto
> que está errado.

Distribuição atual: 🔴 4 · 🟢 4 · ⚪ 3 · 🔵 2 · ⚫ 1.

| Carta | Cor | Tipo | Custo | Raio | Dur. | Efeito |
| --- | --- | --- | --- | --- | --- | --- |
| Bênção de Ímpeto | ⚪ | Buff | 2 | 4 | 5 s | Aliados: +40% velocidade, +25% conjuração |
| Escudo Arcano | ⚪ | Buff | 3 | 4 | 6 s | Aliados: absorve 60 de dano |
| Solo Consagrado | ⚪ | Buff | 4 | 4 | 4 s | Aliados: regeneração + dano recebido reduzido |
| Praga | 🟢 | Maldição | 4 | 3.5 | 5 s | Zona: 10 de dano/s, **atravessa o escudo** |
| Pântano Pegajoso | 🟢 | Maldição | 3 | 4 | 5 s | Inimigos: 35% de lentidão de passo **e** de conjuração |
| Raízes Entrelaçadas | 🟢 | Maldição | 4 | 3 | 2 s | Inimigos: passo travado — lentidão não faz isso |
| Brisa Rejuvenescedora | 🟢 | Buff | 3 | 4 | 4 s | Aliados: cura por tick |
| Maldição da Lentidão | ⚫ | Maldição | 3 | 4 | 4 s | Inimigos: 50% de lentidão |
| Campo de Sobrecarga | 🔴 | Maldição | 4 | 3.5 | 4 s | **Todos** na área: +50% de dano recebido e +50% de conjuração |
| Chuva de Meteoros | 🔴 | Maldição | 5 | 5 | 1.5 s | Zona: 18 de dano a cada 0.5 s — o maior raio do jogo |
| Frenesi Sanguinário | 🔴 | Buff | 4 | 3.5 | 4 s | Aliados: multiplicador de dano causado |
| Marca do Carrasco | 🔴 | Maldição | 3 | 3.5 | 6 s | Inimigos: marca que amplifica o golpe seguinte |
| Petrificar | 🔵 | Maldição | 4 | 3.5 | 2.5 s | Inimigos: preso, sem agir — **e imune a dano** |
| Fúria do Trovão | 🔵 | Maldição | 4 | 2.5 | 0.9 s | O menor raio do jogo, e o mais curto |

> **Campo de Sobrecarga é a única carta que acerta os dois lados** (`target: all`).
> É de propósito, e é o tipo de carta que só o modelo idle torna interessante: uma
> carta que exige uma **guarda** na regra para não ser um tiro no próprio pé.
> Escrever `SE não há aliado no aglomerado ENTÃO Sobrecarga` é exatamente a
> densidade de decisão que a §16.2 tinha perdido.

#### O que falta

**Tier 1** = só uma lista de efeitos já existentes (JSON puro, zero código).
**Tier 2** = efeito novo e/ou stat derivado novo. **Tier 3** = subsistema novo.

| Carta | Cor | Tier | O que exige |
| --- | --- | --- | --- |
| Erupção Vulcânica | 🔴 | 2 | conjuração atrasada (com aviso no chão) + empurrão |
| Clarão Nulo | 🔵 | 2 | dispel, com buff/debuff etiquetados no balance |
| Silêncio Sepulcral | ⚫ | 2 | não pode conjurar |
| Vórtice Gravitacional | 🔵 | 3 | campo persistente + atração no integrador |
| Dobra Espacial | 🔵 | 3 | teleporte, limpando estado de rota e esquiva |
| Fluxo de Mana | 🔵 | 3 | modificador de taxa de mana por time |
| Fenda de Cristal | 🟢 | 3 | obstáculo temporário + invalidação da grade de rota |
| Vínculo de Solidariedade | ⚪ | 3 | pool de dano compartilhado |
| Chamado à Batalha | ⚪ | 3 | acelera o respawn |
| Vínculo da Dor | ⚫ | 3 | espelho de dano, com guarda de recursão |
| Paranoia | ⚫ | 3 | força retarget — o maior raio de explosão da lista |
| Tributo Obscuro | ⚫ | 3 | auto-dano convertido em mana |

**7 Tier 1 · 9 Tier 2 · 9 Tier 3**, dos quais 14 existem e 11 faltam.

> ✅ **O buraco da v1.1 fechou, e é importante ser preciso sobre em que sentido.**
> A v1.1 registrava aqui "o baralho é de 8 e só existem 4 cartas": era impossível
> montar um baralho legal. Isso deixou de ser verdade já com o Tier 1, e o Tier 2
> foi bem além — **toda cor tem pelo menos uma carta**, que é a condição que
> permitiu ligar a regra de 2 cores (§7).
>
> O que continua aberto é **variedade**, não viabilidade: faltam 11 das 25, e o
> **preto ainda tem uma carta só** — é a cor mais rasa, e as três que faltariam
> para ela (Silêncio Sepulcral, Vínculo da Dor, Paranoia, Tributo Obscuro) são
> quase todas Tier 3.

---

## 10. O teste de agência

> **Uma partida com o jogador AFK e a mesma partida jogada bem precisam terminar
> diferente, de forma visível.**

Este era o risco número um do pivot. A v1.0 o tinha fechado, a v1.1 **reabriu**, e a
v1.2 **fecha de novo — com medição, não com argumento.**

### Por que a v1.1 tinha invalidado a prova da v1.0

Na v1.0 a alegação se resolvia por construção: o jogador AFK não invocava nada,
não tinha nada em campo, e qualquer push mínimo derrubava tudo. O esquadrão
permanente destruiu essa premissa — **o jogador AFK passou a ter 4 magos lutando e
ressuscitando por ele**, com o mesmo `Brain` do adversário. Os dois lados ficaram
com exatamente a mesma força em campo, e "AFK perde" deixou de ser verdade por
construção.

Pior que isso: **o jogo não conseguia mais nem representar o AFK.** Um jogador que
não clica é indistinguível de um que clica mal, e uma alegação que não tem linha de
base não é mensurável.

### O que o modelo idle mudou — e é uma mudança de *estrutura*, não de balance

O pivot da v1.2 devolve a linha de base, e essa é a razão de design mais forte para
tê-lo feito. **Não jogar virou um estado representável:** um programa sem regras
(`emptyStrategy()`) que conjura exatamente **zero** vezes, e que o teste afirma ser
zero em vez de supor. Não é um jogador ausente que o jogo tenta adivinhar — é um
dado.

### A remedição (v1.2)

Feita em `sim/agency.test.ts` e na varredura de `scripts/ai-report.mts`, sobre
`defaultDeck()` e o esquadrão padrão, alternando os lados a cada seed porque o mapa
não é simétrico. **120 partidas, 5 programas, todos contra todos.**

> ⚠️ **Limite do experimento, e ele é mais estreito do que parece.** A varredura
> monta os dois lados com `defaultDeck()`, que tem **quatro cartas distintas**
> (Bênção, Escudo Arcano, Praga, Pântano), e os programas de referência nomeiam
> exatamente essas quatro por id. Logo **nenhuma outra carta do catálogo pode
> aparecer em nenhuma partida da varredura** — hoje são 18 cartas e 14 delas são
> inalcançáveis por esta medição, incluindo o Campo de Sobrecarga.
>
> Isso não invalida os números abaixo, mas define do que eles falam: são um
> resultado sobre **este baralho de quatro cartas**, não sobre o jogo inteiro.
> Em particular, **rodar `ai-report` depois de acrescentar cartas não testa as
> cartas novas** — elas não entram no baralho. Medir o efeito do Tier 2/3 exige um
> baralho e programas construídos sobre elas; enquanto isso não existir, um "50% de
> novo" quer dizer "a medição não viu as cartas novas", e não "as cartas novas não
> ajudaram".

| Programa | O que é | V-D-E | % das decididas | Conjurações |
| --- | --- | --- | --- | --- |
| **responsiva** | 4 regras, com guardas de situação | 33-15-0 | **69%** | 1185 |
| **plana** | as mesmas 4 cartas, `sempre`, sem guarda nenhuma | 33-15-0 | **69%** | 1177 |
| **padrão** | o que `defaultStrategy` abre no editor | 31-17-0 | **65%** | 1181 |
| **ingênua** | 1 regra, 1 carta, `sempre` | 12-36-0 | **25%** | **45** |
| **vazia** | nenhuma regra — a linha de base AFK | 11-37-0 | **23%** | **0** |

**A alegação da §10 fecha:** um programa autoral vence um programa vazio em **83%
das partidas decididas**, perde estritamente menos estrutura, e a linha de base é
zero conjurações por construção. Nenhuma partida empatou.

### Os dois achados que a medição entregou, e um deles é desconfortável

> ⚠️ **1. Ler a situação ainda não paga.** `responsiva` contra `plana` deu
> **6-6, exatamente 50%** — com volume de conjuração dentro de 1% um do outro. Ou
> seja: as guardas não custam nada e também **não compram nada** que esta medição
> consiga ver. O que decide a partida hoje é *conjurar*, não *conjurar na hora
> certa*. Isso é o mesmo sintoma que a §14 registrava para dificuldade de bot,
> reaparecendo no eixo novo: **indiferenciado, não invertido.**
>
> Isso não invalida o pivot — a agência contra o AFK fechou com folga. Mas é
> preciso ser exato sobre **do que** este 50% é evidência, porque a primeira versão
> desta seção não foi e afirmou demais.
>
> O que está medido: com **estas quatro cartas** (Bênção, Escudo, Praga, Pântano),
> escrever guardas não ganha mais partidas do que não escrever. Todas as quatro são
> "buff de área" ou "maldição de área" aplicadas sobre o próprio aglomerado, e para
> cartas assim quase todo momento é um momento aceitável — não há o que a guarda
> possa acertar melhor.
>
> O que **não** está medido, e a primeira redação tratou como se estivesse: se as
> cartas condicionais mudam isso. A hipótese continua sendo que sim — Petrificar,
> Marca do Carrasco, Clarão Nulo e sobretudo o **Campo de Sobrecarga**, que acerta
> os dois lados e portanto pune quem não escreve guarda, são cartas em que *quando*
> deveria importar. Mas o Campo de Sobrecarga **existe desde o Tier 1 e nunca
> esteve no baralho da medição**, então nem a versão fraca dessa hipótese foi
> testada. Chamar as cartas de "genéricas demais" era uma explicação para um
> resultado que o experimento não tinha isolado.
>
> A direção do trabalho não muda — é **design de carta**, não vocabulário de regra,
> e não é dial de HP de estrutura. O que muda é o que vem antes: **primeiro um
> baralho e programas de referência que contenham as cartas condicionais**, senão
> a medição seguinte responde a mesma coisa que esta.

> ⚠️ **2. Um programa com uma regra é quase um programa vazio — e isso não é
> óbvio de lugar nenhum.** `ingênua` conjurou **45 vezes em 48 partidas** (≈1 por
> partida) e ficou **6-6 contra `vazia`**, estatisticamente indistinguível de não
> jogar. A causa é mecânica e vale a pena estar escrita: **uma carta só sai da mão
> sendo jogada, e o baralho só cicla quando alguma carta é jogada.** Um programa
> que nomeia uma carta a joga uma vez, vê ela ir para o fim de uma fila de oito, e
> nunca mais a encontra.
>
> Consequência de produto: **8 slots de baralho e 1 regra é um baralho morto**, e
> nada na tela avisa. É por isso que `defaultStrategy` gasta uma regra por carta
> que consegue (§7) e que o editor abre num programa que funciona em vez de numa
> lista vazia. O `plana` contra `vazia` — mesmas ausências de guarda, só mais
> cartas nomeadas — dá **92%**. **A variedade de cartas nomeadas é, hoje, a
> variável mais forte do jogo inteiro.**

Tudo isso é reprodutível: a sim é determinística (`sim/rng.ts`, mulberry32 semeado)
e roda headless. O `Tactician` **não sorteia nada**, o que está preso por teste — dois
programas diferentes que não conjuram deixam a partida byte-idêntica.

> ✅ **Status honesto: o risco número um está fechado, com evidência.** O que
> continua aberto não é mais "as decisões do jogador importam?", e sim **"quais
> decisões importam?"** — hoje a resposta é "quais cartas você nomeia", e ainda não
> é "quando você as joga". Ver §14 e §16.9.

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
3. ~~**As 4 cartas que faltam** para fechar o baralho de 8 (§9).~~ **Feito** — são 7 hoje (§9).
4. **Feedback de efeito na tela**: sem isso o jogador não vê o que a carta dele fez, e o jogo inteiro depende de ele ver.
5. ~~**Remedição do teste de agência** (§10)~~ **Feita na v1.2** (§10).

### O que a v1.2 muda — o pivot idle

| Antes (v1.1) | Vira (v1.2) |
| --- | --- |
| O jogador clica carta na mão e depois clica o chão (`MatchHUD`, `OnlineMatch`) | **Não há entrada durante a partida.** A mão fica visível e `pointerEvents: 'none'` |
| `CastMsg` chega do cliente e o servidor conjura | `CastMsg` marcada `@deprecated` e o roteamento responde `cast rejected: idle_mode`. A mensagem **fica** — é o seam de um futuro modo override |
| `Commander` joga a mão dos dois assentos | Assento humano recebe **`Tactician`**; assento de bot continua com `Commander` |
| Sem cadência mínima: 5 conjurações em 5 quadros são possíveis | **Cooldown global de 0.75 s** no `World`, por onde passam humano, `Commander` e `Tactician` |
| `applySpellEffect` com um `case` por carta | Orientado a dados: `target` + lista `apply` no balance, com `sim/spellRiders.ts` para o que não é `EffectKind` |
| Baralho de 4 cartas, sem regra | Catálogo em expansão, com `MAX_COPIES`, `MIN_DISTINCT` e `MAX_COLORS` validadas (§7) |
| Nada no fio explica o que aconteceu | `SnapshotMsg.firedRule` por destinatário, e o HUD nomeia a regra |

### Novo na v1.2

1. **`sim/strategy.ts`** — o modelo e o avaliador. JSON-serializável, determinístico, headless, **zero `Rng`**. `Condition`, `TargetSelector`, `StrategyRule`, `evaluateStrategy`, `validateStrategy`, `defaultStrategy(deck)`, `emptyStrategy()`.
2. **`sim/strategyFacts.ts`** — `buildFacts(w, team, plan?)`, construído **uma vez por avaliação** e nunca por regra: 12 regras × 8 magos × 60 Hz é o que tornaria a sim quadrática. Desempate por id de mago, sempre.
3. **`sim/bot/Tactician.ts`** — implementa exatamente a assinatura de `Commander.step`. É o que torna o pivot barato: `Session` e `LocalSession` já dirigiam um caster com essa forma.
4. **`sim/spellRiders.ts`** — efeitos que não são `EffectKind` (poça, e o que o Tier 2/3 trouxer). **Nenhum `case` novo em `World.ts` daqui em diante.**
5. **`sim/strategyPresets.ts`** — os programas de referência contra os quais o jogo é medido (§10, §14), compartilhados entre o teste e o relatório para que um não pare de corroborar o outro.
6. **`src/app/screens/strategy/**`** — o editor: paleta, lista de regras, editor de condição recursivo, editor de seletor, e o hook de arrasto por pointer events (não HTML5 DnD, que não dispara em toque).
7. **Persistência de perfil** — `loadouts` no `api/`, com o `when` de cada regra como `Mixed` de propósito: a API impõe só limites estruturais e **o servidor de jogo continua sendo a autoridade de regras**.
8. **VFX/SFX por carta** — `shape` no descritor, `EFFECT_VFX` por `EffectKind`, telegraph preso por teste ao `delay` da sim, `ShakeRig`, e som procedural por carta com teto de vozes (§17).

> **A regra de ouro do pivot: o `Tactician` não sorteia nada.** O servidor
> compartilha um `Rng` entre `Brain`, os dois embaralhamentos e o `Commander`. Um
> caster que sorteasse faria **editar uma regra mudar como todos os magos lutam** —
> o jogador mexeria no programa e veria uma briga sem relação acontecer diferente.
> Está preso por teste em `agency.test.ts`.

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

> ⚠️ **A v1.1 invalidou os três achados acima.** Todos foram medidos num jogo em que
> a mana comprava unidade. Com esquadrão fixo, a mana não compra presença em campo,
> e o eixo de dificuldade ("escolher a carta certa") passa a significar outra coisa.

### Remedido na v1.2 — e o empate **acabou**

A varredura de `scripts/ai-report.mts` agora roda **programa contra programa**, que
é o que a partida de verdade virou, e não mais bot contra bot. Sobre **120 partidas**
(5 programas, todos contra todos, 12 seeds, lados alternados):

> ⚠️ **Medido sobre `defaultDeck()` — quatro cartas — e não sobre o catálogo.**
> Acrescentar cartas ao jogo **não muda estes números**, porque as cartas novas não
> entram no baralho da varredura (§10). Já foi confirmado na prática: com o Tier 2
> fechado, a varredura devolveu resultado idêntico, **até nas contagens de
> conjuração**. Isso mede o harness, não as cartas.
>
> Consequência para quem for usar isto como teste de aceite: **construa primeiro um
> baralho e programas de referência sobre as cartas novas.** Sem isso, `ai-report`
> responde sempre a mesma pergunta.

| Métrica | v1.1 | v1.2 |
| --- | --- | --- |
| **Taxa de empate** | 3 em 6, e antes 6 em 6 | **0 em 120 — 0%** |
| Separação do melhor programa contra o pior | invertida, depois indiferenciada | **69% contra 23%** |
| Duração típica | quase sempre até a morte súbita | decidida antes do timeout |

> ✅ **O problema aberto número um da §14 fechou.** "Um jogo em que dois jogadores
> bons empatam metade das vezes não é jogável" era o critério; a taxa de empate é
> **zero**. Vale dizer *por que*, para não se creditar mérito indevido: parte é o
> pivot (programas conjuram muito mais que os comandantes conservadores mediam —
> ~1180 conjurações por programa contra ~30 na medição antiga), e parte é o Tier 1,
> que trouxe cartas de dano de verdade. Não foi um dial de HP de estrutura.

**O que a v1.2 abriu no lugar**, e é o próximo trabalho de balance:

1. ⚠️ **Timing não separa nada — nas quatro cartas em que foi medido.** `responsiva` × `plana` = **50%** (§10). O eixo em que a dificuldade foi colocada na v1.1 — "escolher a carta certa para a situação" — continua indiferenciado, agora medido no jogador em vez do bot. **Isto é o item nº 1 do balance da v1.2**, e o primeiro passo dele não é desenhar carta: é **dar ao experimento um baralho que contenha as cartas condicionais**, para saber se o problema é o material ou o modelo.
2. ⚠️ **A variedade de cartas domina tudo.** É a única variável com efeito grande hoje (25% → 92%). Um jogo em que a decisão dominante é "nomeie mais cartas" é raso, mesmo que não empate.
3. **Nenhuma carta foi medida individualmente.** Nada de win rate por carta ainda.

Próximos passos do balance (§13):

- Rodar milhares de partidas **carta-contra-carta** e programa-contra-programa, não 120, e reportar taxa de vitória e mana trocada por carta.
- **Critério de saúde: nenhuma carta acima de ~55% de vitória contra o pool**, e nenhum par carta-contra-carta em 100/0.
- ✅ ~~Taxa de empate precisa cair muito.~~ **Feito: 0%.** Vira critério de regressão, não meta.
- **Critério novo:** um programa com guardas tem que separar de um sem guardas. Enquanto `responsiva` × `plana` estiver em 50%, o vocabulário de regras está sendo pago e não usado (§16.10).
- Rodar em CI com seed fixa, tratando desvio como regressão.

---

## 15. Non-goals (v1)

- **Jogar carta durante a partida** (era o verbo primário da v1.1; saiu na v1.2 — a partida não tem entrada nenhuma)
- **Invocar unidade com carta** (era o verbo primário da v1.0; saiu na v1.1)
- Controle direto ou ordens táticas a um mago do esquadrão
- Mira manual, WASD, câmera que segue unidade
- Modo assíncrono / luta contra snapshot de roster (ver §16.5)
- 2v2, torneios, clãs
- Progressão de poder, gacha, baús
- Lanes com creeps automáticos de MOBA

> **Um non-goal que é tentador furar: o "modo override".** Deixar o jogador
> intervir manualmente numa emergência parece um meio-termo generoso e destruiria
> o jogo — o programa deixaria de ser a coisa que decide a partida e viraria um
> piloto automático para os momentos chatos, o que é o oposto da fantasia da §2.
> O seam existe no código (`CastMsg` ficou, marcada `@deprecated`) porque remover
> e reconstruir sairia caro; **a existência do seam não é uma intenção.**

---

## 16. Perguntas em aberto

As duas primeiras eram as mais graves da v1.1 e **fecharam na v1.2**.

1. ✅ **O AFK ainda perde? — RESPONDIDA, com medição.** Sim, e por larga margem. O modelo idle tornou a pergunta respondível ao dar a ela uma linha de base representável: um programa sem regras conjura exatamente zero vezes. Medido, o programa padrão vence o programa vazio em **83% das partidas decididas**, e perde estritamente menos estrutura. Ver §10.
2. ✅ **Posicionamento ainda é decisão densa? — RESPONDIDA por outro caminho.** A densidade **não** voltou para o posicionamento; ela migrou para o programa. "Onde centrar um raio" continua raso — mas ninguém centra raio nenhum: o jogador escolhe entre onze seletores nomeados, sob guardas que ele escreve, com tempo para pensar. A saída que a v1.1 temia precisar (dar influência sobre para onde o esquadrão empurra, encostando no non-goal de ordens táticas) **não foi necessária**.
3. **Quatro magos é o número certo?** Ainda aberta. Escolhido por parecer legível (4 cabem na tela e na cabeça), não por medição. Interage com o raio dos feitiços: esquadrão pequeno e espalhado torna buff de área difícil de acertar; esquadrão grande e junto torna todo buff um acerto garantido, e a decisão desaparece.
4. ✅ **Qual a regra de construção do baralho? — RESPONDIDA e em vigor.** 8 cartas, no máximo 2 cópias, no mínimo 3 distintas, no máximo 2 cores — as três validadas. Ver §7.
5. **Assíncrono depois?** Real-time foi escolhido e é o que está sendo construído. Assíncrono continua possível *sem retrabalho*: a sim é determinística e headless, então "lutar contra o esquadrão e o baralho gravados de outro jogador" é rodar o mesmo `World` sem socket. Decisão adiada de propósito, não esquecida.
6. **Duas Torres ou uma?** A §5 propõe duas + imunidade do Núcleo, e o mapa `siege1.json` foi construído assim. Duas dão forma de flanco à partida; uma é mais simples de balancear.
7. **O Suporte é legível?** É o papel com maior risco de o jogador não perceber o efeito. Piora na v1.1: agora o Clérigo cura *e* o jogador joga cura, e os dois precisam ser distinguíveis na tela. **Atacado, não fechado:** o suporte agora tem ataque próprio (§9), anel de área no chão marcando o alcance real e feixe do Clérigo até quem ele curou (`SupportRenderer`). Falta medir se o jogador atribui o efeito ao mago certo quando uma Bênção jogada e um Clérigo agem no mesmo aglomerado.
8. **Practice mode.** Continua congelado em `src/systems/**` com o modelo antigo. Descreve um jogo que não existe mais há duas versões — decidir se vira tutorial do modelo novo ou se sai.

As três seguintes são **novas na v1.2** e são todas sobre o mesmo eixo: um jogo em
que o jogador não age durante a partida vive ou morre pelo que ele entende depois.

9. **O jogador consegue narrar por que perdeu?** É o risco nº 1 da v1.2, e o único que nenhum teste verde responde. O painel de rastro nomeia a regra que disparou, mas nomear não é explicar: "Regra 4 · Bênção → linha de frente aliada" não diz *por que a regra 2 não disparou*, que é quase sempre a pergunta real. O candidato natural é um resumo pós-partida — quantas vezes cada regra disparou, e quantas vezes cada uma foi pulada e por qual gate (mana, carta fora da mão, condição falsa, alvo não resolvido). **Não construído.** O teste de aceitação continua sendo humano: montar duas estratégias visivelmente diferentes, jogar as duas, e conseguir narrar em voz alta por que uma ganhou.
10. **Doze regras é liberdade suficiente ou já é uma linguagem de programação?** O vocabulário atual (condições combináveis com `E`/`OU`/`não`, aninhamento de um nível) parou num ponto escolhido por legibilidade, não por medição. Se os programas bons convergirem todos para a mesma forma, o vocabulário é pequeno demais; se a maioria dos jogadores nunca passar de 4 regras, é grande demais e a complexidade está sendo paga sem ser usada.
11. **Um jogo idle precisa da partida em tempo real?** Nada no modelo v1.2 exige que as duas partes assistam ao mesmo tempo — a sim é determinística e headless, e o programa é um dado pequeno. Isso torna o assíncrono (§16.5) mais barato do que era, e ao mesmo tempo levanta a pergunta desconfortável de para que serve o tempo real aqui. Decisão adiada de propósito: real-time é o que está construído e funciona.

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
- ✅ **Mute e volume alcançáveis de dentro da partida.** Era bug de produto em aberto desde a v1.0 (o controle só existia no menu do practice). **Fechado na v1.2:** botão no `MatchHUD` e tecla `M`. Não foi para o menu de pausa porque o menu de pausa online não pausa nada — o servidor continua — e silenciar o jogo é chrome, não uma jogada.

### O que a v1.2 acrescenta — feedback num jogo que ninguém joga com a mão

> **O reenquadramento que o pivot idle força.** A regra nº 1 de game feel — "o
> verbo primário responde em menos de 100 ms" — **muda de endereço**. O verbo
> primário agora é *escrever uma regra*, e ele acontece fora da partida. Dentro da
> partida o feedback deixa de ser **impacto** e passa a ser **atribuição**: o
> jogador não precisa sentir o soco, precisa entender *que regra dele causou
> aquilo*. Por isso cada conjuração tem que responder **três** perguntas ao mesmo
> tempo na tela: *que carta caiu*, *onde*, e *de quem foi*.

**Forma por carta.** O descritor de VFX ganhou um campo `shape` selecionando uma
primitiva, em vez de todo feitiço ser a mesma batida recolorida:

| Carta | Forma | Trauma de câmera | Som |
| --- | --- | --- | --- |
| Bênção de Ímpeto | `burst`, motes subindo | 0 | acorde + tom |
| Escudo Arcano | `dome` | 0 | ruído + tom + acorde |
| Praga | `burst` | 0 | ruído + tom |
| Pântano Pegajoso | `burst`, motes descendo | 0 | ruído + tom |
| Maldição da Lentidão | `burst`, motes descendo | 0 | tom + ruído |
| Campo de Sobrecarga | `torus` girando no chão | 0 | dois tons + ruído |
| Chuva de Meteoros | `column` — **7 impactos ao longo de 1 s**, espalhados pelo raio inteiro | **0.35** | ruído + dois tons |

> **A escala de trauma é menor aqui do que num jogo de ação, e é de propósito.**
> Tremer a câmera pressupõe que o tremor confirma algo que a mão do jogador fez.
> Aqui nenhuma mão fez nada, e a câmera é o instrumento pelo qual a *próxima* regra
> vai ser lida — tremor esconde exatamente o aglomerado que o jogador precisa ver.
> Só o Núcleo caindo dá flash de tela; **Torre só treme**, porque torre cai várias
> vezes por partida e um quadro branco em cada uma é um alarme que ninguém desliga.

- **`EFFECT_VFX`, uma tabela por `EffectKind`**, no lugar dos `if (burn)` escritos à mão. Anéis, tint de corpo e casca de vulnerabilidade continuam sendo material clonado por mago no `PlayerRenderer` — não entram nessa tabela, que é só emissão.
- **Telegraph é requisito de legibilidade, não polimento.** Carta com atraso tem que desenhar o aviso no chão **antes** do dano, senão o dano parece vir do nada. O campo do descritor e o `delay` da sim são dois números que precisam ser o mesmo, e estão **presos por teste** nos dois sentidos — hoje nenhuma carta tem atraso, e o teste proíbe prometer um aviso que a sim não honra.
- **Som por carta, com orçamento.** Nenhum som pode durar mais que o cooldown global de 0.75 s (senão empilha sobre o próprio sucessor) e nenhuma carta pode somar mais que 0.3 de ganho — qualquer carta sozinha é sempre defensável, é a sétima que estraga a mistura. Conjuração inimiga entra com ganho atenuado: o cast do outro lado do campo não pode soar tão perto quanto o seu.
- **Teto de vozes que corta a mais velha, não recusa a mais nova.** Dois programas conjurando a cada 0.75 s por 3 minutos são ~480 conjurações. A voz nova é o evento sobre o qual o jogador espera ser informado; a cortada já foi quase toda ouvida, e sai em fade de 20 ms.
- **`prefers-reduced-motion` corta o tremor e afina os motes**, mas deixa intactos a pegada no chão e a emissão de status: quem pediu menos movimento não pediu para ser informado menos.

> ⚠️ **A dívida de arte da v1.2.** As 18 cartas do Tier 2/3 (§9) não têm forma nem
> som, e **carta sem forma e sem som é carta que o jogador não sabe que jogou** —
> num jogo idle ele nem clicou para saber. Por isso a ordem de trabalho é uma carta
> por commit, **cada uma trazendo sua linha de VFX e de SFX junto**, e não uma
> passada de arte no fim.

---

## 18. Estado do repo relevante a este GDD

- `sim/**` e `server/src/**` são a fundação deste design. **Não deletar.**
- A suíte da raiz: **628 testes verdes em 55 arquivos**, medidos no fim da Fase 12 da v1.2 (a nota anterior dizia 273, número de duas versões atrás). A `api/` tem suíte própria, **50 verdes**, com `mongodb-memory-server`.
- **`sim/agency.test.ts` é lento de propósito** — joga partidas inteiras headless, e o `testTimeout` de 30 s no `vite.config.ts` existe por causa dele. Não é teste para rodar em loop de edição; é a medição da §10.
- ⚠️ **`npm run lint` está poluído**: reporta centenas de erros de parsing vindos **inteiramente** de `.cursor/worktrees/**`, uma worktree aninhada dentro do repo que confunde o `tsconfigRootDir` do eslint. O código real fica limpo com `npx eslint sim server src api/src`. É problema de infra, não de código.
- Containers Docker **estão atualizados** para o servidor Node (`server/Dockerfile` builda da raiz, porque o servidor importa `sim/` e `public/maps/`; `nginx.conf` faz proxy de `/ws` com upgrade). A nota anterior de "desatualizados" ficou obsoleta. Não verificado com build real recente — o daemon estava desligado.
- Existe smoke de browser de ponta a ponta: `node scripts/siege.mjs`. **Reescrito na v1.2** — registra conta descartável, entra na fila, e afirma o que o modelo idle exige: que **regras disparam sozinhas** no fio e que **clicar na arena não envia cast nenhum**. Precisa da API e do Mongo no ar.
- Existe varredura headless de balance: `npx tsx scripts/ai-report.mts` — mix de ações do `Brain` e a varredura programa-contra-programa da §14. É onde a taxa de empate é medida.
- `AGENTS.md` marca `sim/**` como zona de coordenação obrigatória — a v1.2 toca essa zona inteira de novo, incluindo `World`, `Deck`, `protocol`, `snapshot`, `bot/` e os arquivos novos de estratégia.
