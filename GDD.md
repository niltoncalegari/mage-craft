# GDD — Mage Craft

**Título:** Mage Craft  
**Versão:** 0.1  
**Status:** rascunho vivo — base de produto, não especificação de engine  
**Herança:** remake SnowCraft — loop, feel e arquitetura de simulação (código base neste repo)  
**Idioma do doc:** PT-BR  

> Slug sugerido no GitHub / npm: `mage-craft` · Nome Steam: **Mage Craft**

---

## 1. Visão

Um duelo rápido de magos em arena top-down: posicionamento, mira com carga e projéteis elementais decidem a luta. O jogador é um **mago solo** (não um esquadrão). Bolinhas de neve viram **conjurações** — fogo, gelo, raio, veneno, pedra e outros — com o mesmo verbo de input (carregar → soltar), mas efeitos distintos no hit e no chão.

**Promessa ao jogador:**  
*“Eu leio a arena, escolho o elemento certo e acerto o oponente com timing — ou morro porque fiquei no lugar errado.”*

**Sensação-alvo:** tático, cartunesco, legível, intenso em partidas curtas (1–3 min).

---

## 2. Design brief (contrato)

| Campo | Definição |
| --- | --- |
| Fantasia | Mago de arena num duelo elemental |
| Feeling | Tenso, rápido, posicional, legível |
| Verbo primário | **Carregar e lançar** projétil |
| Verbos secundários | Mover, usar cover, trocar elemento, coletar buff, dodgar |
| Loop curto (5–20s) | Posicionar → mirar/carregar → lançar → reagir ao retorno |
| Loop de partida (1–5 min) | Gastar lives do oponente; adaptar elemento ao padrão dele |
| Falha / retry | Perde life → respawn com imunidade curta; 0 lives = derrota |
| Skill expression | Lead de mira, uso de cover, escolha de elemento, bait de charge |
| Legibilidade | Silhueta + cor por elemento; poças/zonas no chão óbvias; telegraph de charge |
| Non-goals (v1) | RPG de progressão profunda, inventário complexo, open world, MOBA de lanes, 5v5 |

**Core loop contract:**

```text
O jogador move e carrega um conjuro para eliminar o oponente
enquanto projéteis, knockback e zonas no chão criam risco;
acerto/controle gera pressão e perda de lives do rival;
morrer gasta uma life e respawna com janela curta de imunidade.
```

---

## 3. O que herdamos do SnowCraft (e o que muda)

### Mantém (DNA)

- Arena vista ortográfica / quase top-down, mapa inteiro legível
- Movimento responsivo + cover que importa (LoS / altura de obstáculo)
- Projétil com tempo de voo, arco, miss e dodge possíveis
- Charge no hold do mouse; release = lançar (sem cancel fácil)
- Lives + respawn com imunidade
- Simulação desacoplada do render (fixed timestep ~60 Hz)
- Modo treino vs AI antes / junto do PvP

### Muda

| Antes (SnowCraft) | Agora |
| --- | --- |
| Tema neve / crianças | Magos / arena arcana |
| Snowball único | Catálogo elemental de projéteis |
| Fantasia “brigada de neve” | Fantasia “duelo de conjuradores” |
| Remake fiel Flash 1999 | IP própria (Steam / desktop) |
| Foco SP + AI | Foco **PvP 1v1**, SP como modo offline |

### Em pausa (outro projeto)

O protótipo MOBA atual fica em hold (`moba_hold` / archive). Este GDD **não** cobre lanes, minions nem draft de heróis MOBA.

---

## 4. Pilares

1. **Posicionamento > aim perfeito** — cover, ângulos e spacing decidem mais que tracking pixel-perfect.
2. **Combate de projétil imperfeito** — tudo voa no tempo; dá para errar, desviar e baitar.
3. **Elementos como identidade tática** — mesmo input, consequências diferentes (hit, zona, CC).
4. **Partidas curtas e legíveis** — round rápido, silhuetas claras, pouca UI obrigatória.
5. **Fair PvP** — servidor autoritativo; cosméticos ≠ poder pago (ver §12).

---

## 5. Entidade jogável — o Mago

- **1 herói** controlado por jogador (auto-selecionado; sem squad click).
- Stats base herdados do feel SnowCraft (tuning em data): move speed, radius, HP, charge time, windup/recovery/cooldown.
- Visual: corpo procedural ou mesh simples de mago; staff / mãos como origem do projétil.
- **Loadout elemental** (ver §7): 1 elemento ativo por vez no MVP; expansão para 2 slots depois.
- Times: team 0 / team 1 (cores POV-relative no cliente: *eu* sempre “aliado”, oponente “inimigo”).

---

## 6. Controles (MVP)

| Ação | Input |
| --- | --- |
| Mover | WASD ou botão direito no chão |
| Mirar + carregar | Segurar botão esquerdo |
| Lançar | Soltar botão esquerdo |
| Trocar elemento | Teclas `1–5` ou scroll (se multi-elemento na build) |
| Pause (só offline) | Esc / P |

Aiming: deadzone perto do mago, rotação suave para o cursor, reticle a raio fixo (herança AIM do SnowCraft).

---

## 7. Sistema de elementos e loadout

### Regras gerais

- Todo conjuro usa o **mesmo pipeline**: charge → windup → spawn projétil → arco/física → hit ou expiração.
- Diferenças vêm de **dados** (`ProjectileDef`): velocidade, arco, dano, knockback, onHit, onExpire, groundEffect.
- Charge escala poder **dentro da def** (ex.: veneno aumenta raio/duração da poça; pedra aumenta dano e reduz velocidade).
- Legibilidade: **cor dominante + trail + ícone de carga** únicos por elemento.

### Seleção (fases)

| Fase | Modelo |
| --- | --- |
| **Alpha** | Um elemento fixo por partida (menu) — validar feel |
| **Beta** | Troca no match via teclas / pickups de elemento na arena |
| **Release** | Loadout pré-partida: escolher 2–3 elementos; hotkeys in-match |

### Sala pré-jogo e times (servidor autoritativo)

O jogo é organizado em **salas** com times de tamanho configurável, de **1x1 até 6x6** (capacidade total = 2× o tamanho do time, definido na criação da sala).

Fluxo da sala (fase Alpha — 1 elemento fixo por mago, ver tabela acima):

1. Jogadores entram na sala e escolhem um time (0 ou 1).
2. Cada mago escolhe **exatamente 1 elemento** do catálogo completo de **7 elementos** (`fire`, `ice`, `lightning`, `poison`, `stone`, `arcane`, `wind` — ver §8.1). Esse catálogo de 7 é usado desde já **na seleção de sala** mesmo com `arcane`/`wind` marcados como pós-MVP no combate (§8.1), justamente para garantir que um time de até 6 jogadores sempre tenha um elemento livre.
3. **Regra de unicidade:** um elemento só pode estar selecionado por **um mago por vez dentro do mesmo time**; dois magos do mesmo time nunca podem usar o mesmo elemento simultaneamente. Times adversários podem repetir elementos livremente entre si.
4. O host pode **preencher vagas vazias com bots** (dificuldade easy/normal/hard); o bot seleciona automaticamente um elemento ainda livre no seu time.
5. A partida começa quando todas as vagas do(s) time(s) estão preenchidas (humano ou bot) e cada mago tem um elemento válido selecionado.

Ao desconectar durante a sala (fase de lobby), a vaga e o elemento do jogador voltam a ficar livres para os demais.

---

## 8. Catálogo de projéteis

Valores abaixo são **direção de design** (não constantes finais). Balanceamento vive em data (`config` / Data Assets).

### 8.1 Matriz rápida

| ID | Nome | Papel | On-hit | No chão / extra | Risco |
| --- | --- | --- | --- | --- | --- |
| `fire` | Bola de fogo | Pressão / padrão | Dano médio + knockback leve; opcional DoT curto | — | Leitura fácil; baseline |
| `ice` | Fragmento de gelo | Controle | Dano baixo–médio + **slow** | — | Bom para fechar espaço |
| `lightning` | Raio / bolt | Poke | Dano médio, voo **mais rápido**, arco baixo, knockback menor | — | Errar custa menos tempo; acertar exige lead menor |
| `poison` | Frasco de veneno | Zona / negação | Dano baixo no impacto | **Poça** no impacto (ou no chão se expirar baixo) | Controla chão; self-damage se mal posicionado |
| `stone` | Projétil de pedra | Burst / interrupt | Dano **alto**, mais lento, knockback forte; pode **interromper charge** inimigo | Opcional: rimochete leve em parede (fase 2) | Telegraphed; punível se errar |
| `arcane` *(opcional)* | Orbe arcano | Flex | Dano médio | Pequena explosão AoE no impacto | Preenche gap entre fogo e pedra |
| `wind` *(opcional)* | Lâmina de vento | Deslocamento | Dano baixo + **empurrão** forte | — | Utility / peel |
| `holy` / `shadow` | Cosmético ou modo futuro | — | — | — | Fora do MVP |

**MVP obrigatório:** `fire`, `ice`, `lightning`, `poison`, `stone`.  
**Pós-MVP:** `arcane`, `wind`, e variações cosméticas.

---

### 8.2 Fogo (`fire`) — baseline

- **Fantasia:** bola de fogo clássica.
- **Voo:** velocidade/arco próximos ao snowball atual.
- **Hit:** dano ~baseline; knockback leve; DoT opcional (ex. 3 ticks fracos) se precisar diferenciar de pedra.
- **Por que existe:** tutorial do verbo; referência de balanceamento (“1.0×”).

---

### 8.3 Gelo (`ice`) — soft CC

- **Fantasia:** estilhaço / orbe gelado.
- **Voo:** um pouco mais lento que fogo.
- **Hit:** menos dano; aplica **slow** (ex. 30–40% move speed por 1.0–1.5s); refresha duração, não stacka infinito.
- **Dinâmica:** força o oponente a respeitar espaço; combina com pedra/fogo no follow-up (quando houver 2 slots).

---

### 8.4 Raio (`lightning`) — poke

- **Fantasia:** relâmpago lançado da staff.
- **Voo:** mais rápido, arco mais baixo (quase “linha com leve queda”).
- **Hit:** dano médio; pouco knockback (não empurra tanto o aim do rival).
- **Dinâmica:** castiga inimigo exposto longe do cover; pior contra alguém atrás de fort alto.

---

### 8.5 Veneno (`poison`) — poça no chão

- **Fantasia:** frasco / globo tóxico que estoura e contamina o chão.
- **Voo:** velocidade média; silhueta verde distinta.
- **On-hit (impacto em player):** dano baixo + spawna **GroundPuddle** no ponto do impacto (ou aos pés do alvo).
- **On-hit (impacto no chão / obstáculo baixo):** spawna poça no ponto de contato.
- **On-expire (ttl no ar):** se cair no chão sem acertar player, ainda cria poça (negação de espaço).

#### Poça (`GroundPuddle`)

| Propriedade | Direção de design |
| --- | --- |
| Duração | `T` segundos (ex. 3.5–5.0), escalável com charge |
| Raio | `R` (ex. 1.2–1.8), escalável com charge |
| Tick | Dano a cada `tickInterval` (ex. 0.25–0.4s) enquanto o collider do mago overlap a poça |
| Team rule | **Hurt everyone** (incluindo caster) — skill expression / anti-camp |
| Stack | Mesma célula: refresha duração ou mantém a mais forte; **não** multiplica dano por N poças no mesmo ponto |
| Max ativas | Cap global por time ou por partida (ex. 4) para não poluir a arena |
| Visual | Disco / névoa baixa, borda clara, cor veneno; some com fade |
| Audio | Loop baixo + tick sutil no dano |

**Por que self-damage:** evita spam seguro na própria cara e cria decisões (“nego a porta do respawn ou corto a minha rota?”).

**Interação com outros sistemas:**

- Imunidade de respawn / pickup de immunity: **não** toma dano da poça (ou toma 50% — decidir no balance pass; default: imunidade completa).
- Slow de gelo + poça: permitido (combo espacial).
- Pedra / knockback pode **empurrar** o player para dentro/fora da poça (feature, não bug).

---

### 8.6 Pedra (`stone`) — heavy hit

- **Fantasia:** pedregulho / meteorito pequeno conjurado.
- **Voo:** **mais lento**, arco mais alto (mais telegraphed), mais fácil de desviar.
- **Hit:** dano alto; knockback forte; **cancela charge** do oponente se estiver mirando (interrupt).
- **Dinâmica:** punidor de erro; ruim como poke spam; ótimo depois de slow/gelo ou para quebrar alguém colado em cover.
- **Fase 2 (opcional):** ricochete 1× em obstáculo sólido com perda de velocidade.

---

### 8.7 Extensões futuras (backlog de design)

| Ideia | Nota |
| --- | --- |
| `arcane` | AoE pequena no impacto — limpa cluster / magos colados |
| `wind` | Quase zero dano, máximo deslocamento — peel / edge kill |
| Elemento “muro” | Não é projétil: consumível que sobe cover temporário (pode ser pickup, não loadout) |
| Fusão / overcharge | Segurar charge no máximo muda levemente o efeito (só se legível) |

---

## 9. Arena e level design

### Formato

- Arena fechada, tamanho próximo ao SnowCraft.
- Obstáculos: pedras arcanas, pilares, ruínas baixas (fence), muros médios (fort), árvores/totens altos.
- Altura de obstáculo continua governando “projétil passa por cima?” e cover/LoS.

### Tema visual

- Chão: pedra / areia mágica / grama amaldiçoada (não neve).
- Props batem com magia cartunesca, alta legibilidade, baixo ruído.

### Encontro / pacing numa partida

1. Spawn oposto ou assimétrico leve  
2. Primeira decisão: peek vs rotate  
3. Primeira troca de conjuro (~10–20s)  
4. Pickups / zonas (veneno) criam hotspots  
5. Endgame: poucas lives → respeito a charge e a poças em choke  

Mapas novos = JSON / data (herança `public/maps/`), não hardcode.

---

## 10. Modos de jogo

### 10.1 Offline vs AI (sempre disponível)

- Mesmas regras de lives / elementos.
- Dificuldades: easy / normal / hard (pesos de AI + handicaps só na AI, nunca no PvP humano).
- Útil para tutorial, practice de elemento e QA.

### 10.2 PvP em salas por time — NxN, até 6x6 (prioridade de produto)

- Servidor autoritativo (Go, ver §14) organiza partidas em **salas de time** configuráveis de 1x1 a 6x6 (§7 — Sala pré-jogo e times); 1v1 é apenas o caso `teamSize = 1`.
- Servidor autoritativo (snapshots); clientes enviam input commands.
- Simetria de regras entre jogadores humanos; handicaps de AI só valem para bots (nunca entre humanos).
- Cores POV-relative.
- Bots podem preencher vagas vazias de qualquer time na sala (§7).
- Desconexão: forfeit ou bot takeover curto (decidir na fase netcode).

### 10.3 Fora do escopo inicial

- FFA, ranked seasons, battle pass, matchmaking por rating/contas — times NxN (até 6x6) já deixam de ser "fora de escopo" a partir do servidor Go (§10.2, §14).

---

## 11. Progressão, score e meta (leve)

**Release mínimo:**

- Vitória/derrota + rematch  
- Leaderboard local / conta simples (opcional)  
- Unlocks **cosméticos** (cor da staff, trail) — não poder  

**Evitar no v1:** árvore de talentos que mude dano base; pay-to-win.

Score offline pode reaproveitar a lógica SnowCraft (tempo, lives gastos, dificuldade).

---

## 12. Plataformas e distribuição

| Alvo | Notas |
| --- | --- |
| Browser | Dev + playtest rápido (Vite) |
| Desktop | **Tauri 2** preferido (binário menor que Electron) |
| Steam | Build desktop + Steamworks (overlay, achivements depois) |

Ordem: **jogo online estável no browser → wrap Tauri → Steam page**.

---

## 13. Áudio e feedback

- Cada elemento: SFX de charge, release, voo, hit e (se houver) loop de zona.
- Hitstop curto / screen shake leve no impacto de pedra; mais sutil no fogo/raio.
- Poça: feedback contínuo baixo, nunca ensurdecedor.
- UI: ícone do elemento ativo, charge bar tingida pela cor do elemento, lives.

---

## 14. Arquitetura (intenção de implementação)

- Manter simulação pura (sem Three.js) em `core/game/systems/physics` no cliente.
- `ProjectileDef` + `GroundEffect` como dados; systems genéricos (`ProjectileSystem`, `GroundEffectSystem`).
- Veneno = projétil que **spawna** entidade `Puddle` no mundo; tick de dano num system dedicado.
- Testes unitários da simulação (já cultura do SnowCraft) para defs e poças.

### Pivot de servidor: Go (`server/`)

`multiplayer-plan.md` assumia um servidor **Node.js** reaproveitando diretamente a simulação TypeScript do cliente (monorepo `shared/`). Essa suposição foi substituída: o servidor autoritativo real é um **módulo Go independente** em `server/` (WebSocket + JSON), que **reimplementa** a simulação — dados equivalentes a `ProjectileDef`/catálogo de elementos, movimento, projéteis, dano/knockback, vidas/respawn e o sistema de salas/times (§7, §10.2) — já que não há reaproveitamento direto de código entre TypeScript e Go. `multiplayer-plan.md` permanece como referência conceitual (server-authoritative, snapshots, cores POV-relative), não como plano de stack.

Notas de processo adotadas no desenvolvimento do servidor Go:

- Desenvolvimento **test-first** (TDD): seams definidos por pacote (`room`, `game`, `bot`, `protocol`) antes de implementar cada fatia.
- Padrões de arquitetura de jogo (state machine explícita para sala/mago, configuração data-driven em vez de números soltos, sem alocações no hot loop de simulação a 60 Hz) seguem a mesma disciplina descrita para o cliente.
- Quando a integração do **cliente** (Three.js/Preact) com o novo protocolo WebSocket do servidor Go começar, essa é uma fase à parte deste documento, ainda não iniciada.

---

## 15. Fases de entrega

| Fase | Entrega | Critério de “pronto” |
| --- | --- | --- |
| **0 — Fundação** | Repo novo, rename, tema mago, `fire` only | Feel ≥ SnowCraft baseline |
| **1 — Catálogo** | `ice`, `lightning`, `poison`+poça, `stone` | 5 elementos jogáveis offline |
| **2 — PvP** | 1v1 autoritativo + lobby mínimo | Duas machines, partida justa |
| **3 — Desktop** | Tauri 2 packaging | Installer macOS/Windows (Linux nice-to-have) |
| **4 — Steam** | Store presence + build pipeline | Depósito Steam OK, playtest externo |

MOBA permanece em hold; não bloqueia este roadmap.

---

## 16. Riscos e decisões abertas

| Tópico | Opções | Inclinação atual |
| --- | --- | --- |
| Nome do jogo | — | **Mage Craft** (fechado) |
| Poça fere o caster? | sim / não / reduzido | **Sim** (skill) |
| Quantos elementos in-match | 1 fixo / hotswap / 2 slots | Alpha: 1; Beta: hotswap |
| Interrupt de charge com pedra | sim / não | **Sim** |
| DoT de fogo | sim / não | Opcional; só se fogo ≠ pedra na prática |
| 2v2 | depois | Fora do v1 |

---

## 17. Success metrics (qualitativos)

- Novo jogador entende charge + cover em &lt; 60s.
- Em PvP, mortes “baratas” por lag são raras (interpolação / authority ok).
- Cada um dos 5 elementos MVP aparece como escolha válida em alguma situação (não há elemento morto no meta).
- Partida média &lt; ~4 min; rematch é imediato.

---

## 18. Referências internas

- `design.md` — design técnico original SnowCraft (detalhe de sim/ECS)
- `multiplayer-plan.md` — plano 1v1 server-authoritative
- `src/game/config.ts` — tuning herdado (ponto de partida numérico)
- Este `GDD.md` — **fonte da verdade de produto/gameplay** da nova IP

---

## Changelog do GDD

| Versão | Data | Notas |
| --- | --- | --- |
| 0.2 | 2026-08-02 | Sala pré-jogo com times NxN (até 6x6, §7/§10.2); regra de elemento único por mago dentro do time, usando catálogo completo de 7 elementos; bots preenchem vagas vazias; pivot de servidor de Node.js (assumido em `multiplayer-plan.md`) para servidor **Go** independente (`server/`) (§14) |
| 0.1 | 2026-08-02 | Primeiro rascunho: mago, 5 elementos MVP (veneno+poça, pedra), PvP/Tauri/Steam, herança SnowCraft; título **Mage Craft** |
