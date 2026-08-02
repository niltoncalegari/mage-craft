# Mage Craft — servidor Go

Servidor autoritativo do Mage Craft: lobby de salas por time (NxN, até 6x6),
seleção de elemento único por mago dentro do time, preenchimento de vagas com
bots, e um loop de simulação 60Hz (movimento, carga/lançamento, projéteis por
elemento, dano/knockback/slow/interrupt, poças, vidas/respawn, fim de round).

Ver `../GDD.md` (§7, §10.2, §14) para o contrato de produto e
`../multiplayer-plan.md` para o histórico de decisão (o plano original
assumia Node.js reaproveitando a simulação TypeScript; a implementação real é
este módulo Go independente, que reimplementa a simulação do zero).

## Rodando

```bash
cd server
go run ./cmd/mageserver
```

Variáveis de ambiente:

| Variável | Default | Descrição |
| --- | --- | --- |
| `PORT` | `8080` | Porta HTTP/WebSocket do servidor |

Endpoints:

- `GET /healthz` — health check simples (`200 ok`).
- `GET /ws?id=<clientId>` — upgrade para WebSocket; `id` é opcional (o
  servidor gera um `anon-N` se omitido). Ver protocolo abaixo.

## Testes

```bash
cd server
go test ./...        # suíte completa
go test ./... -race  # com detector de corrida (recomendado após mexer em internal/match)
```

A suíte cobre cada pacote isoladamente (TDD, seams por pacote) mais um smoke
test ponta a ponta em `cmd/mageserver/integration_test.go` que sobe o
servidor real (via `httptest`), conecta dois clientes WebSocket de verdade e
percorre o fluxo completo: `create_room` → `join_room` → `select_team` →
`select_element` → `start_match` → `input` → recebe um `snapshot` da
simulação rodando.

## Arquitetura (pacotes)

```mermaid
flowchart TB
    subgraph server ["server/ (Go module)"]
        main["cmd/mageserver — composition root (App: dispatch + broadcast)"]
        ws["internal/ws — hub de conexões WebSocket"]
        protocol["internal/protocol — mensagens JSON cliente↔servidor"]
        matchPkg["internal/match — Session: liga lobby + simulação + bots, 60Hz"]
        roomPkg["internal/room — RoomManager/Room: lobby, times, elementos"]
        gamePkg["internal/game — elementos, config, entidades, World.Step"]
        botPkg["internal/bot — IA utility-scoring"]
    end
    main --> ws
    main --> matchPkg
    main --> protocol
    ws --> protocol
    matchPkg --> roomPkg
    matchPkg --> botPkg
    roomPkg --> gamePkg
    botPkg --> gamePkg
```

| Pacote | Responsabilidade |
| --- | --- |
| `internal/game` | Catálogo de 7 elementos, config de tuning, entidades (`Mage`/`Projectile`/`Puddle`) e `World.Step` (movimento, charge/lançamento, colisão, dano/knockback/slow/interrupt, poça, vidas/respawn, fim de round) |
| `internal/bot` | IA utility-scoring simplificada (retreat/attack/advance/wander), dificuldades `easy`/`normal`/`hard` |
| `internal/room` | `RoomManager`/`Room` — lobby puro: join/leave, times, seleção de elemento com validação de unicidade por time, bots, `StartMatch` (constrói o `game.World`). Não depende de `internal/bot` nem de transporte. |
| `internal/match` | `Session` — o único ponto que conhece `room` **e** `bot`: serializa lobby + tick de simulação atrás de um mutex, roda o loop 60Hz (`RunLoop`/`Tick`) e expõe callbacks (`OnSnapshot`, `OnRoundEnd`) como dados puros (sem depender de `protocol`) |
| `internal/protocol` | Structs JSON das mensagens cliente↔servidor + `PeekType` para dispatch |
| `internal/ws` | Hub de conexões WebSocket (upgrade, leitura/escrita, broadcast) — não sabe nada sobre salas/protocolo |
| `cmd/mageserver` | Composition root (`App`): decodifica mensagens do protocolo, chama `match.Session`, serializa e faz broadcast das respostas via `ws.Hub` |

## Protocolo WebSocket (resumo)

Todas as mensagens são JSON planas com um campo `"type"` (ver
`internal/protocol/protocol.go` para os structs completos e `PeekType` para o
dispatch).

**Cliente → Servidor**

| `type` | Campos | Descrição |
| --- | --- | --- |
| `create_room` | `teamSize`, `fillBots?`, `botDifficulty?` | Cria sala (1–6); com `fillBots` o server preenche vagas restantes após o host escolher elemento |
| `join_room` | `roomId`, `name` | Lobby: entra sem time. `in_progress`: entra como **espectador** |
| `list_rooms` | — | Pede o catálogo de salas `lobby` + `in_progress` |
| `select_team` | `team` (0\|1) | Escolhe/troca de time, alocando uma vaga |
| `select_element` | `element` | Escolhe 1 dos 7 elementos (GDD §8.1); unicidade por time |
| `add_bot` | `team`, `difficulty` | Preenche uma vaga vazia com bot (`easy`\|`normal`\|`hard`) |
| `remove_bot` | `slotId` | Remove um bot, liberando vaga e elemento |
| `claim_slot` | `slotId` | Espectador reserva um bot para o **próximo rematch** (bot segue jogando) |
| `set_ready` | `ready` | Alterna o estado "pronto" no lobby |
| `start_match` | — | Inicia (ou reinicia) a partida; dispara o loop 60Hz |
| `input` | `move`, `aim`, `charging`, `release` | Input do mago durante a partida (no-op para espectador) |

**Servidor → Cliente**

| `type` | Campos | Descrição |
| --- | --- | --- |
| `room_state` | `roomId`, `teamSize`, `state`, `slots[]`, `spectators[]?`, `youRole?`, `fillBots?` | Mudança de lobby / rematch |
| `room_list` | `rooms[]` | Resposta a `list_rooms` |
| `match_start` | — | Loop de simulação 60Hz iniciado |
| `snapshot` | `tick`, `mages[]`, `projectiles[]`, `puddles[]` | Snapshot do mundo (~20Hz); inclui espectadores |
| `round_end` | `winnerTeam` | Fim da rodada → sala volta a `lobby` (rematch); claims aplicados |
| `error` | `message` | Ação rejeitada / mensagem inválida |

## Simplificações conhecidas do v1 (registradas no GDD como próximos passos)

- **Sem obstáculos/cover/linha de visão** na simulação — arena v1 é um
  retângulo aberto (`internal/game/config.go`).
- **Desconexão em partida** apenas congela o input daquele mago (ele para de
  se mover/atacar, mas continua no mundo); forfeit / bot-takeover mid-round
  ainda não implementado (join mid-match é via espectador + claim no rematch).
- **Sem host explícito** — qualquer jogador na sala pode chamar `add_bot`/
  `remove_bot`/`start_match`, não só quem criou a sala.
- **Sem limpeza de salas encerradas** — `room.Manager` mantém salas em
  memória indefinidamente; ok para dev/testes, precisa de um TTL/GC antes de
  produção.
