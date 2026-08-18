# GDD — Mage Craft

**Título:** Mage Craft
**Versão:** 1.3 — treinador: a partida é o esquadrão que você montou antes dela
**Status:** rascunho vivo — base de produto, não especificação de engine
**Modelo de referência:** auto brawler para o campo (esquadrão permanente e autônomo); idle/gambit para o verbo (o jogador monta, não executa). Clash Royale foi o modelo de economia até a v1.2 e **deixou de ser** — não há mana, baralho, mão nem ciclo
**Idioma do doc:** PT-BR

> **Este documento substitui o GDD 0.1 por inteiro.** O jogo deixou de ser um brawl
> de controle direto. Quem procura o design antigo (mago único controlado por
> WASD + mira) deve ler `design.md` e `multiplayer-plan.md`, que passam a ser
> **documentos históricos** — descrevem o produto anterior e não devem ser editados.

> ⚠️ **Mudança da v1.2 para a v1.3 (treinador).** Na v1.2 o jogador escrevia um
> **programa** de regras `SE <situação> ENTÃO <carta> EM <alvo>` e o programa
> conjurava por ele, gastando mana de um baralho. Na v1.3 **nada disso existe**:
> cada mago carrega um **kit fixo de 2 ou 3 habilidades** e as gasta sozinho, com
> cooldown por skill no próprio corpo. O que o jogador monta é o **esquadrão** —
> quatro corpos — e a **postura** de cada um. O verbo primário deixa de ser
> Programar e passa a ser **Montar**.
>
> **Isso não foi gosto, foi medição.** A varredura da §10 mostrou um programa
> autoral empatando 6-6 com um programa plano, com volume de conjuração dentro de
> 1%: escrever guardas não comprava nada que a medição visse. A conclusão foi que
> o limite era o modelo, não o catálogo.
>
> Reescritas por causa disso: §1, §2, §6, §7, §9, §10, §12, §13, §14, §16 e §18.
>
> **O que sobreviveu do modelo antigo:** a *linguagem*. Condições, comparadores,
> aglomerados, intruso, efeito ativo, os onze seletores de alvo — tudo migrou
> para `sim/abilityPolicy.ts` e hoje descreve quando uma **skill** sai. Um mago
> decidindo por si precisa do mesmo vocabulário que uma lista de regras precisava.

---

---

## 1. Visão

Dois comandantes se enfrentam em tempo real numa arena. Nenhum dos dois controla
um mago diretamente, nenhum dos dois invoca, e desde a v1.3 nenhum dos dois
conjura: cada um tem um **esquadrão de quatro magos que já está em campo**,
lutando sozinho do primeiro segundo, e **cada mago gasta o próprio kit**.

O que mudou na v1.3 é *de onde vem a decisão*. Na v1.2 o jogador escrevia um
programa de regras e o programa conjurava por ele. A medição da §10 matou esse
modelo: um programa autoral empatava com um programa plano. A decisão migrou
para onde ela é legível — **quais quatro corpos você traz**, cada um com um kit
fixo de 2 ou 3 habilidades, e **com que postura** cada um joga.

A partida é decidida por *quem você trouxe* — nunca por mira, reflexo ou
velocidade de clique.

**Promessa ao jogador:**
*"Eu troquei o Sentinela pelo Golem porque o kit dele segura a linha. Segurou.
Aquela briga virou porque eu escolhi certo."*

**Sensação-alvo:** tenso, legível, de leitura e resposta — mas a leitura acontece
**entre** partidas, sobre o que o esquadrão fez, e a resposta é uma troca de
mago ou de postura. Partidas de 3 minutos.

> **Por que isto é um jogo e não um screensaver.** A resposta é uma só e é
> estrutural: o jogador precisa conseguir **atribuir** o que aconteceu a uma
> escolha que ele fez. É por isso que o fio carrega `firedAbility` e o HUD
> escreve "Erupção Vulcânica → aglomerado inimigo", o `SquadPanel` mostra a
> carga de cada skill descendo, e o pós-partida diz **qual mago** gastou o quê
> (§13, §17). Sem atribuição, um jogo idle é de fato um screensaver — e o item
> que fecha isso é requisito, não polimento.

---

## 2. Design brief (contrato)

| Campo | Definição |
| --- | --- |
| Fantasia | Treinador que **escolhe e regula** um esquadrão de magos elementais e o vê lutar |
| Feeling | Autoria e antecipação — montar para a situação em vez de reagir a ela |
| Verbo primário | **Montar** (escolher quatro corpos e a postura de cada um, fora da partida) |
| Verbos secundários | Comparar kits, ler quem gastou o quê na última partida, reajustar postura |
| Loop curto (3–10s) | *Fora da partida:* ler o que o esquadrão fez → achar o mago que não pagou o slot → trocar corpo ou postura |
| Loop de partida (3 min) | Assistir o esquadrão executar, ler as cargas e o rastro, anotar onde ele erra |
| Falha / retry | Esquadrão errado perde a partida inteira e **só é corrigível entre partidas** — é o que dá peso à montagem |
| Skill expression | Escolha dos quatro corpos, mistura de papéis, leitura de kit contra kit, postura por mago |
| Legibilidade | Papel pela silhueta, elemento pela cor, efeitos ativos visíveis no mago, **carga por skill no painel**, e a habilidade que disparou nomeada no HUD |
| Non-goals (v1) | **Jogar carta durante a partida**, **invocar unidade com carta**, **escrever programa de regras**, controle direto, ordens táticas, mira manual, lanes de MOBA com creeps, 5v5, gacha |

**Core loop contract:**

```text
Antes da partida o jogador monta um esquadrão: quatro magos, um de cada papel no mínimo,
sem duplicatas, cada um trazendo o próprio kit de 2 ou 3 habilidades e uma postura;
o esquadrão de cada lado luta sozinho e avança para as estruturas inimigas;
cada mago gasta o próprio kit quando o cooldown, a condição e o alcance permitem;
um esquadrão que lê melhor a situação gera vantagem;
vantagem vira briga ganha, que derruba Torre e depois o Núcleo;
o jogador lê no pós-partida qual mago gastou o quê, e remonta para a próxima.
```

> **O que a v1.3 resolveu, e o que ela custou.** A v1.2 tinha três telas de
> montagem (esquadrão, baralho, programa) e mediu que só uma delas importava —
> §10. Cortar duas não empobreceu a decisão, concentrou-a: o kit deixou de ser
> um pool de 25 cartas compartilhado e passou a ser propriedade de um corpo, o
> que torna "trocar um mago" uma mudança real no vocabulário da partida em vez
> de uma troca de estatística. O custo é que **o teto de expressão caiu**: não dá
> mais para escrever uma guarda específica. Ver §16.

> **O que o pivot idle custou, e continua custando.** O jogo não tem momento a
> momento. Não há "eu vi e reagi": entre a decisão e a consequência existe uma
> partida inteira. O risco que isso abre é de **engajamento**, não de
> profundidade: um jogador que não entende por que perdeu não tem o que editar.
> Ver §17.

---

## 3. O modelo: o que copiamos do Clash Royale e o que não

### Copiamos (é o que faz o gênero funcionar)

- **Real-time, simétrico, 1v1.** Os dois jogam ao mesmo tempo, na mesma sim autoritativa.
- **Unidades autônomas.** O jogador nunca comanda um mago.
- **Objetivo estrutural.** Ganha quem derruba mais estrutura, não quem mata mais.

### Não copiamos (mais)

- **Mana única que regenera, baralho, mão e ciclo.** Copiados até a v1.2 e
  **removidos na v1.3**. Eram a economia de um jogador que gasta cartas de uma
  mão, e não há mão. O que ficou no lugar é cooldown por skill no corpo do mago
  (§6): o custo deixou de ser um pote disputado durante a partida e passou a ser
  o kit que você escolheu antes dela.
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

## 6. Carga — a economia (v1.3)

**Não há mana.** Havia até a v1.2: um pote por time, teto 10, regenerando 1 a
cada 2.8 s, com custo por carta. Ele saiu inteiro na v1.3 — do sim, do fio, do
servidor e da tela — porque servia a um jogador que gastava cartas de uma mão, e
não existe mais mão.

O que ficou no lugar é **carga no corpo do mago**:

| Parâmetro | Valor v1.3 |
| --- | --- |
| Recarga | **cooldown por skill**, 6 a 18 s, declarado em `balance.json` |
| Freio por mago | GCD de **0.75 s**, para um kit não sair inteiro num quadro |
| Morte súbita | recarga **acelerada 2×** (`suddenDeathCooldownMultiplier`) |
| Aceleradores | `attune` acelera a recarga do time; `tribute` devolve carga pagando HP |

Por que a troca não é cosmética. Mana era **um** recurso disputado por quatro
magos: gastar no Piromante era não gastar no Clérigo, e essa disputa era a
decisão do jogador. Sem jogador na partida, a disputa não tem quem a arbitre — o
que sobra é uma fila, e uma fila não é economia. Cooldown por skill move o custo
para onde a decisão agora mora: **no kit que você escolheu antes da partida**.
Trazer o Piromante é comprar duas skills de 18 s; trazer o Alquimista é comprar
uma de 6 s.

Consequência medida: **toda skill do catálogo roda perto do teto do próprio
cooldown**. `paranoia` (cd 11) dispara ~11.8 vezes numa partida de 150 s contra
um teto de ~13. Isso torna o cooldown o dial que morde no balance (§14) — e
significa que um kit de 2 skills tem estruturalmente menos throughput que um de
3, o que é um problema aberto e não um desenho.

> **O dial da morte súbita sobreviveu à troca de recurso.** Era
> `suddenDeathManaMultiplier`, dobrando o recurso que ninguém gasta mais; virou
> `suddenDeathCooldownMultiplier`, dobrando o que tomou o lugar dele. Mesma
> alavanca, recurso novo — sem ela a prorrogação seria "igual, só que sem o
> acelerador".

---

## 7. A montagem: um esquadrão, quatro posturas (v1.3)

Na v1.2 o jogador montava **três coisas**: esquadrão, baralho e um programa de
regras. A v1.3 aposentou duas delas. O que sobrou é uma tela só, e é a mais
consequente das três.

### Esquadrão (quem entra em campo)

- **4 magos**, escolhidos do catálogo de 9 (§9).
- Regra de construção: **mínimo 1 de cada papel** (tank, dano, suporte) e
  **sem duplicatas**. Quatro cópias de um mago não é composição, é um mago com
  quatro barras de vida. Validado em `sim/squad.ts` e conferido pelo servidor
  antes da partida começar.
- Entram em campo no início e ressuscitam ao morrer (§4).
- **Cada mago traz o próprio kit**: 2 ou 3 skills, fixas, listadas no
  `SquadBuilder`. Os kits são **disjuntos e cobrem o catálogo inteiro** — toda
  skill das 25 pertence a exatamente um mago. É isso que permite creditar um
  cast a um corpo sem uma segunda tabela para manter em dia.

### Postura (o quanto você solta a coleira)

Uma por mago, escolhida na mesma tela, default `normal`:

| Postura | O que muda |
| --- | --- |
| `hold` | Além do `when` da skill, exige a guarda: nosso Núcleo sob pressão, **este** mago ferido, ou intruso na nossa metade |
| `normal` | Exige que o alvo pegue `minTargets` corpos — o "vale a pena" da skill |
| `aggressive` | Ignora `minTargets`: gasta no que alcançar |

> **`hold` é acelerador, não interruptor.** O plano previa "≈ 0 casts" e a
> medição desmentiu: a guarda abre com core sob pressão, corpo ferido ou
> intruso, e isso acontece em qualquer partida indo mal — que é exatamente
> quando um kit guardado deve acordar. Medido sobre 40 partidas, `hold` gasta
> **5209 casts contra 6683** do `normal`, ~78%. A escada de vitória é monotônica
> (`aggressive` > `normal` > `hold`), mas o degrau de cima é raso: `aggressive`
> bate `normal` 22-18.

### O que morreu, e por quê

- **Baralho de 8 cartas, mão de 4, ciclo, `next` em preview.** Todos existiam
  para dar ao jogador uma sequência de escolhas *durante* a partida. O pivot idle
  tirou o jogador da partida; o baralho virou uma fila que se esvazia sozinha.
- **Programa de até 12 regras (`SE ... ENTÃO ... EM ...`).** Aposentado pela
  medição da §10, não por gosto: um programa autoral empatava 6-6 com um
  programa plano. O limite era o modelo, não o catálogo.
- A **linguagem** dos dois sobreviveu inteira. `when`, `at`, comparadores,
  aglomerados, intruso, efeito ativo — tudo migrou para `sim/abilityPolicy.ts` e
  hoje descreve quando uma **skill** sai, em vez de quando uma **carta** saía.
  Um mago decidindo por si precisa do mesmo vocabulário que uma lista de regras
  precisava.

**Semântica de disparo: nunca espera.** Um mago avalia o kit 4×/s; uma skill que
não pode sair é pulada, não enfileirada. É a mesma regra que o avaliador de
regras tinha, e pelo mesmo motivo — senão a skill mais cara de um kit faz negação
de serviço sobre as duas abaixo dela. Empate de escolha resolve por maior custo e
depois por ordem do kit, ambos fixos antes da partida.

**A escolha do kit não sorteia nada.** `chooseAbility` não recebe `Rng`, de
propósito: o `Brain` entrega um único `Rng` para o movimento e a mira de todos os
magos, e uma escolha que sacasse dele faria **trocar um mago do esquadrão**
re-sortear como todos os outros andam. Asserido em `sim/agency.test.ts`.

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

## 9. Catálogo

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

Este era o risco número um do pivot. A v1.0 o tinha fechado, a v1.1 **reabriu**, a
v1.2 fechou de novo com medição — e a v1.3 **mudou o eixo do que é medido**,
porque o que o jogador traz mudou.

### Por que a v1.1 tinha invalidado a prova da v1.0

Na v1.0 a alegação se resolvia por construção: o jogador AFK não invocava nada e
qualquer push mínimo derrubava tudo. O esquadrão permanente destruiu essa
premissa — **o AFK passou a ter 4 magos lutando e ressuscitando por ele**, com o
mesmo `Brain` do adversário. Os dois lados ficaram com a mesma força em campo.

### O que a v1.2 mediu, e por que esse resultado matou o modelo dela

A v1.2 respondia com um programa de regras, e a linha de base era um programa
vazio — zero conjurações por construção. A agência contra o AFK fechou com
folga. Mas o mesmo experimento entregou o achado que aposentou o modelo:

- **`responsiva` contra `plana` deu 6-6, exatamente 50%.** Escrever guardas de
  situação não ganhava mais partidas do que não escrever nenhuma.
- O que separava programas era **quantas cartas distintas eles nomeavam**, não
  quando as jogavam. Um programa de uma regra era estatisticamente
  indistinguível de um programa vazio, porque uma carta jogada some no fim de
  uma fila de oito.

A conclusão da varredura foi que **o limite era o modelo, não o catálogo** — e é
dela que sai o pivot da v1.3.

### O eixo da v1.3

Não há programa, então "programa autoral contra programa vazio" não é mais uma
pergunta que exista. O que o jogador traz agora são **quatro corpos e uma
postura para cada**, e é nesses dois eixos que `sim/agency.test.ts` mede.

Todas as medições abaixo são **n=40**: 20 seeds, cada uma jogada **nos dois
assentos**.

| Eixo | Confronto | Resultado |
| --- | --- | --- |
| Composição | esquadrão balanceado × esquadrão sem dano nenhum | **40-0**, 0 estruturas perdidas contra 119 |
| Postura | `normal` × `hold` | **33-7**, 51 estruturas contra 96 |
| Postura | `aggressive` × `normal` | **22-18** |
| Volume | casts de `hold` contra casts de `normal` | **5209 contra 6683** (~78%) |

**A alegação da §10 fecha nos dois eixos.** Um esquadrão que pode machucar vence
um que não pode, e soltar a coleira custa estrutura para quem não solta.

> ⚠️ **A linha de base zero morreu junto com o programa vazio.** O plano previa
> que um esquadrão todo em `hold` fosse o equivalente v1.3 de um programa sem
> regras — "≈ 0 casts". Não é, e não pode ser: a guarda do `hold` abre com nosso
> core sob pressão, com o corpo ferido ou com um intruso na nossa metade, e isso
> acontece em qualquer partida indo mal — que é exatamente quando um kit
> guardado deve acordar. `hold` é acelerador, não interruptor, e o teste afirma
> isso **nas duas direções**: um `hold` que parasse de disparar seria tão errado
> quanto um que ignorasse a guarda.

> ⚠️ **A régua estava torta até a Fase 3, e isso é parte do registro.** O
> harness alternava assento **por índice de seed** — cada seed jogava uma vez, do
> assento que sua posição na lista desse. Parece cancelar a assimetria do mapa e
> não cancela: só cancelaria se as seeds fossem intercambiáveis. Dois controles
> derrubaram o desenho — um espelho com esquadrões idênticos deu **8-4 para o
> rótulo da esquerda**, e o mesmo confronto rodado nas duas ordens de argumento
> discordou de si mesmo (8-4 contra 11-1). Todo número de esquadrão lido naquele
> desenho tinha a geometria de spawn dentro. Hoje cada seed é jogada nos dois
> assentos e o espelho dá 5-5.

Tudo isso é reprodutível: a sim é determinística (`sim/rng.ts`, mulberry32
semeado) e roda headless. **`chooseAbility` não sorteia nada** — não recebe
`Rng`, e o teste confirma que o fluxo compartilhado fica no mesmo ponto depois de
duas posturas diferentes. Sem isso, trocar um mago do esquadrão re-sortearia como
todos os outros andam.

> ✅ **Status honesto: o risco número um está fechado, com evidência.** O que
> continua aberto não é "as decisões do jogador importam?", e sim **"as decisões
> estão bem precificadas?"** — oito dos nove magos estão fora da banda de 45-55%
> de vitória contra o pool de quartetos legais, com 55 pontos entre o melhor e o
> pior. Ver §14.

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

- **Progressão é de acesso, não de poder.** Jogar desbloqueia **magos** novos para o pool. Um mago desbloqueado nunca é mais forte que um inicial — traz um kit diferente.
- **Magos não sobem de nível, e kits não são editáveis.** Esta é a divergência deliberada do Clash Royale e é uma decisão de produto: um jogador novo e um veterano jogam com números idênticos. O ranking mede jogador, não coleção. É também o que mantém o balance mensurável — um kit fixo por corpo é o que torna "este mago está forte demais" uma frase com significado (§14).
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
2. ~~**Sistema de mana** autoritativo por time.~~ **Removido na v1.3** (§6).
3. ~~**Baralho / mão / ciclo** (`sim/Deck.ts`) e a mão no fio.~~ **Removido na v1.3** (§7).
4. **Catálogo como dado** (`sim/cards.ts`, `sim/roles.ts`).
5. **`CastMsg`** no lugar do `InputMsg`; câmera fixa; sem avatar do jogador.
6. **Ajustes do `Brain`**: ação `siege`, alvo estrutural, comportamento por papel.
7. **Fila de matchmaking** com fallback para bot (`server/src/Matchmaker.ts`).
8. **UI de partida**: relógio com morte súbita, HP das estruturas, Núcleo e Torres em 3D. (A mão, a barra de mana e o preview saíram na v1.3; a carga por skill entrou no lugar.)
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

### O que a v1.2 mudou — o pivot idle

| Antes (v1.1) | Virou (v1.2) |
| --- | --- |
| O jogador clica carta na mão e depois clica o chão | **Não há entrada durante a partida** |
| `CastMsg` chega do cliente e o servidor conjura | `CastMsg` marcada `@deprecated`; a mensagem **fica** como seam de um futuro modo override |
| `Commander` joga a mão dos dois assentos | Assento humano recebe `Tactician` |
| `applySpellEffect` com um `case` por carta | Orientado a dados: `target` + lista `apply` no balance, com `sim/spellRiders.ts` |
| Nada no fio explica o que aconteceu | `SnapshotMsg.firedRule`, e o HUD nomeia a regra |

### O que a v1.3 muda — o pivot do treinador

A medição da §10 mostrou que o programa não pagava o que custava. O que a v1.3
fez **não** foi trocar o avaliador: foi mover a decisão do programa para o corpo.

| Antes (v1.2) | Vira (v1.3) |
| --- | --- |
| Mana por time, teto 10, custo por carta | **Cooldown por skill** no corpo do mago + GCD de 0.75 s por mago (§6) |
| Baralho de 8, mão de 4, `next` em preview | **Nada disso.** O kit é do mago, fixo, 2 ou 3 skills |
| Programa de até 12 regras, editado numa tela | **Postura por mago** (`hold`/`normal`/`aggressive`), escolhida no `SquadBuilder` |
| `Tactician` (humano) e `Commander` (bot) conjuram por time | **Nenhum dos dois existe.** `Brain.step` chama `w.castAbility` por mago |
| `World.castSpell(team, …)` é a porta de jogo, com economia | `World.castAbility(mageId, spellId, pos)` é a porta de jogo; `castSpell` sobrevive `@internal` como porta de **efeito** |
| `SnapshotMsg` carrega `mana`, `hand`, `next`, `firedRule` | Carrega `firedAbility { mageId, spellId, at }` e `cd[]` por mago |
| `set_loadout` leva `deck` + `strategy` | Leva `squad` + `stances` |
| `squadPetrified` trava o time inteiro | Petrify tranca **um corpo** |
| Esquadrão podia duplicar mago | **Duplicata é ilegal** — quatro cópias de um mago é um mago com quatro barras de vida |

### Novo na v1.3

1. **`sim/abilityPolicy.ts`** — o vocabulário e o avaliador, herdados inteiros do
   programa que morreu. `Condition`, `TargetSelector`, `AbilityPolicy`
   (`cooldown`/`range`/`when`/`at`/`minTargets`), `Stance`, `holds`. O `when` de
   cada skill é dado em `balance.json`, não código.
2. **`sim/bot/kit.ts`** — `chooseAbility(mage, facts, self)`: pura, **sem `Rng`**,
   nunca espera. Escolhe entre as skills prontas a mais cara, com ordem de kit
   como desempate.
3. **`sim/kits.test.ts`** — o teste de catálogo: kits disjuntos, todo `SpellId`
   com exatamente um dono, todo `cooldown`/`range` positivo, todo `when` válido,
   e nenhum kit com duas skills do mesmo `(kind, target)`.
4. **`sim/kitUsage.test.ts`** — o piso da volta A: toda skill do catálogo é gasta
   ao menos uma vez, em quartetos que `validateSquad` aceita.
5. **`scripts/kit-report.mts`** — a varredura de balance por esquadrão (§14).
6. **`rosterOwnerOf(spellId)`** — bem definido porque os kits são disjuntos e
   cobrem o catálogo, o que é o que permite creditar um cast a um corpo sem uma
   segunda tabela.
7. **UI** — `SquadBuilder` mostra kit e postura; `SquadPanel` mostra a carga de
   cada skill; o pós-partida diz qual mago gastou o quê.

### Enterrado na v1.3

`sim/Deck.ts`, `sim/strategy.ts`, `sim/strategyPresets.ts`, `sim/bot/Tactician.ts`,
`sim/bot/Commander.ts`, `DeckBuilder`, `StrategyBuilder`, `src/app/screens/strategy/**`,
o kind `mana` do vocabulário e as constantes de mana em `config.ts` e
`balance.json`. O que sobreviveu deles foi a **linguagem** — que hoje descreve
quando uma skill sai — e `strategyFacts.ts`, que constrói os fatos uma vez por
time por avaliação.

> **A regra de ouro do pivot sobreviveu, apontada para o alvo novo: a escolha de
> habilidade não sorteia nada.** O servidor compartilha um `Rng` entre o `Brain`
> e os embaralhamentos. Uma escolha que sorteasse faria **trocar um mago do
> esquadrão** mudar como todos os outros lutam — o jogador mexeria num slot e
> veria uma briga sem relação acontecer diferente. `chooseAbility` não recebe
> `Rng`, e `agency.test.ts` confirma que o fluxo compartilhado fica no mesmo
> ponto depois de duas posturas diferentes.

---

## 14. Balance IA-vs-IA — o risco técnico restante

O `Brain` foi afinado contra um humano que erra e desvia. **Espelho de IA boa
tende a empatar ou virar coinflip**, e num jogo onde o jogador não controla a
unidade isso apareceria como "minhas decisões não importam" — o mesmo sintoma do
risco de agência, por outra causa.

### O histórico, em uma linha cada

- **v1.1:** empate era o resultado padrão (6 em 6), e a dificuldade estava
  **invertida** — `hard` guardava mana e acabava conjurando menos. Corrigido
  baixando estrutura de 1400/900 para 900/400 e dano de torre de 14 para 10.
- **v1.2:** com programas conjurando ~1180 vezes por partida em vez de ~30, a
  **taxa de empate foi a zero em 120 partidas** e nunca mais voltou. Mas a
  varredura media só as quatro cartas de `defaultDeck()`, então respondia sempre
  a mesma pergunta — acrescentar cartas ao jogo devolvia números idênticos, até
  nas contagens de conjuração. Isso media o harness, não o catálogo.
- **v1.3:** a varredura passou a ser **esquadrão contra esquadrão**
  (`scripts/kit-report.mts`), que é o que a partida virou. O problema do
  baralho-fixo desapareceu por construção: todo mago fielda o próprio kit, então
  varrer quartetos varre o catálogo.

### O que a varredura da v1.3 reporta

`npm run report:kit` roda os cortes da §5 do plano: espelho (viés de mapa),
postura, leave-one-out, e um round robin sobre **quartetos legais** — perguntando
a legalidade à `validateSquad`, a mesma função que o servidor roda antes da
partida, em vez de reimplementar a regra.

**Volta A — a IA consegue gastar: fechada.** Nenhuma skill do catálogo é muda, e
normalizando por side os volumes ficam dentro de uma ordem de grandeza no mesmo
tier de custo (custo 3 roda 10-16 casts/side; custo 4 roda 6-15). O piso está em
CI (`sim/kitUsage.test.ts`), em quartetos que a regra de construção aceita —
legalidade importa: uma janela deslizante sobre o catálogo é mais curta, mas
metade dos quartetos dela é immontável, e skill que só dispara ali é muda em toda
partida real.

**Volta B — o número: aberta.** Sobre 900 partidas em dez quartetos legais, com
o sampler que dá a cada mago 3-6 aparições:

| Mago | Vitória contra o pool | n (sides) |
| --- | --- | --- |
| pyromancer | 75.1% | 720 |
| stormcaller | 69.7% | 720 |
| ice_sentinel | 55.7% | 900 |
| cleric | 55.7% | 900 |
| stone_golem | 53.6% | 1080 |
| arcane_bard | 44.3% | 900 |
| arcane_archer | 43.9% | 720 |
| wind_dervish | 21.3% | 540 |
| alchemist | 20.3% | 720 |

**Oito dos nove estão fora da banda de 45-55%**, com **55 pontos** entre o melhor
e o pior. A desigualdade mora no papel de **dano**, não no de suporte: os dois
suportes ficam a 11 pontos um do outro, e os dois tanks a 2. Taxa de empate
continua **0%**, agora como critério de regressão e não como meta.

> ⚠️ **Como esta tabela corrigiu a anterior, e por que isso é a lição.** A
> primeira leitura desta varredura, com um pool espaçado uniformemente pela lista
> de quartetos (que sai em ordem de catálogo), dizia `cleric` 68.1%, `alchemist`
> 85.0% e `stormcaller` 40.9%. Com cobertura equilibrada os mesmos magos dão
> **55.7%, 20.3% e 69.7%**. O `alchemist` aparecia em **um** quarteto: os 85%
> eram o recorde daquele quarteto usando o nome de um mago. Nenhuma conclusão de
> balance sobrevive a um pool que não fielda os magos de forma comparável, e o
> relatório imprime quartetos-por-mago exatamente para isso não voltar a passar.

> ⚠️ **Uma passagem de volta B já foi feita e falhou — não repetir.** A hipótese
> era que os dois magos de **kit com 2 slots** perdiam por falta de throughput:
> gastam ~22 casts/side contra 26-38 dos kits de 3, e toda skill roda perto do
> teto do próprio cooldown (§6). Cortar `bond_of_pain` de 14→9 e `paranoia` de
> 11→7 levantou o throughput do bard em **36%** e moveu a vitória dele de 31.9%
> para 32.1% — três partidas em 1080. Revertido. **Frequência não é o que segura
> um kit de 2 slots.**

### Critérios de saúde (herdados e atualizados)

- Nenhum mago acima de **~55%** nem abaixo de **~45%** contra o pool.
- Nenhuma skill em **100/0** no recorte em que ela é gasta.
- Skill com 0 casts **não se nerfa** — conserta-se o `when`, o alcance ou o `at`.
- Taxa de empate continua critério de **regressão**.
- **Tetos são relatados, nunca asseridos.** O piso mora em CI
  (`sim/agency.test.ts`, `sim/kitUsage.test.ts`); volume mora no script. Um teto
  lido em doze seeds deixaria um flake escrever um nerf.

> ⚠️ **A amostra do relatório é 10 de 60 quartetos legais**, e o sampler é guloso
> na cobertura para dar a cada mago 3-6 aparições. Antes disso ele espaçava
> uniformemente a lista, que sai em ordem de catálogo — e o `alchemist` aparecia
> em **um** quarteto, o que fez os 85% dele parecerem teto quando eram o recorde
> daquele quarteto. O relatório imprime quartetos-por-mago para essa ressalva não
> ficar invisível.

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

1. ✅ **O AFK ainda perde? — RESPONDIDA, com medição.** Sim. O eixo mudou na
   v1.3 (não há mais programa vazio para servir de linha de base), mas a resposta
   segue: um esquadrão balanceado vence um sem dano nenhum **40-0**, e soltar a
   coleira bate segurá-la **33-7**. Ver §10.
2. ✅ **Posicionamento ainda é decisão densa? — RESPONDIDA por outro caminho.** A
   densidade não voltou para o posicionamento; migrou primeiro para o programa e
   agora para a **composição**. Ninguém centra raio nenhum: o jogador escolhe
   quatro kits e quatro posturas, com tempo para pensar.
3. **Quatro magos é o número certo?** Ainda aberta, e agora mais carregada: com
   kit por corpo, quatro magos são 8-12 skills, e é isso que define o vocabulário
   inteiro de uma partida.
4. ✅ **Qual a regra de construção do esquadrão? — RESPONDIDA e em vigor.** Quatro
   magos, mínimo um de cada papel, **sem duplicatas**. Ver §7.
5. **Assíncrono depois?** Continua possível sem retrabalho — a sim é
   determinística e headless, e um loadout v1.3 (quatro ids e quatro posturas) é
   um dado ainda menor que o programa era.
6. **Duas Torres ou uma?** Inalterada.
7. **O Suporte é legível?** Inalterada como pergunta de leitura. Deixou de ser
   também um problema de balance: com pool equilibrado os dois suportes ficam a
   11 pontos um do outro (§14).
8. **Practice mode.** Continua congelado em `src/systems/**` com o modelo antigo.

Novas na v1.3:

9. **O jogador consegue narrar por que perdeu?** Continua sendo o risco nº 1, e o
   único que nenhum teste verde responde. A v1.3 melhorou o material: o HUD nomeia
   a habilidade que disparou, o `SquadPanel` mostra a carga de cada skill descendo,
   e o pós-partida diz qual mago gastou o quê. O que ainda falta é o negativo —
   *por que a skill que eu esperava não saiu* (cooldown? `when` falso? fora de
   alcance? `minTargets`?). O teste de aceitação continua humano.
10. **Kit fixo ou 2-de-3?** O plano deixou fixo como default e a decisão para
    depois do balance. A medição da §14 dá o argumento mais forte até agora **a
    favor de mexer**: os dois magos de kit com 2 slots são os dois piores do pool,
    e não é por frequência — cortar os cooldowns deles 36% não moveu nada.
11. **Postura é decisão suficiente?** A escada é monotônica mas o degrau de cima é
    raso: `aggressive` bate `normal` 22-18 em n=40. Se ficar assim, postura é
    tempero e a decisão real é só a composição.
12. **Um jogo idle precisa da partida em tempo real?** Inalterada, e mais barata
    de responder do que era.

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
- A suíte da raiz: **verde**, ~810 testes em 69 arquivos ao fim da v1.3 Fase 5. A `api/` tem suíte própria, **51 verdes**, com `mongodb-memory-server`. Tudo exige **Node 22**.
- **`sim/agency.test.ts` é lento de propósito** — joga partidas inteiras headless, e o `testTimeout` de 30 s no `vite.config.ts` existe por causa dele. Não é teste para rodar em loop de edição; é a medição da §10.
- ⚠️ **`npm run lint` está poluído**: reporta centenas de erros de parsing vindos **inteiramente** de `.cursor/worktrees/**`, uma worktree aninhada dentro do repo que confunde o `tsconfigRootDir` do eslint. O código real fica limpo com `npx eslint sim server src api/src`. É problema de infra, não de código.
- Containers Docker **estão atualizados** para o servidor Node (`server/Dockerfile` builda da raiz, porque o servidor importa `sim/` e `public/maps/`; `nginx.conf` faz proxy de `/ws` com upgrade). A nota anterior de "desatualizados" ficou obsoleta. Não verificado com build real recente — o daemon estava desligado.
- Existe smoke de browser de ponta a ponta: `node scripts/siege.mjs`. Registra conta descartável, entra na fila, e afirma o que o modelo idle exige: que **habilidades disparam sozinhas** no fio e que **clicar na arena não envia cast nenhum**. Precisa da API e do Mongo no ar.
- Existem **duas** varreduras headless: `npm run report:ai` (mix de ações do
  `Brain`, profundidade de push, objetivos — sobre movimento, que o pivot não
  tocou) e `npm run report:kit` (a varredura de balance por esquadrão da §14). A
  seção programa-contra-programa do `ai-report` foi removida com o programa.
- `AGENTS.md` marca `sim/**` como zona de coordenação obrigatória — a v1.3 tocou essa zona inteira de novo, incluindo `World`, `entities`, `protocol`, `snapshot`, `bot/`, e apagou `Deck.ts` e `strategy*.ts`.
