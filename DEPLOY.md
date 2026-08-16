# Deploy — VPS por IP e porta

Quatro containers, um único ponto de entrada. Nginx serve o bundle do cliente e
faz proxy de `/api` para o serviço de contas e de `/ws` para o servidor de
partidas — o navegador fala com uma origem só, e nem Mongo nem os dois backends
precisam estar acessíveis pela internet.

```
                    :8080 (única porta publicada)
browser ─────────────► client (nginx)
                          ├── /            bundle Vite
                          ├── /api/  ───►  api (Express + Mongo)  :4000
                          └── /ws    ───►  gameserver (ws)        :8080
                                             api ──► mongo :27017
```

## Requisitos na VPS

- Docker Engine e o plugin Compose v2 (`docker compose version`).
- ~2 GB de RAM. O build do cliente roda `tsc` e o bundle do Vite dentro da
  imagem; numa VPS de 1 GB isso é o que costuma morrer por OOM. Se for o caso,
  buildue as imagens numa máquina maior e envie para um registry.
- A porta escolhida em `CLIENT_PORT` liberada no firewall. Só ela.

## Dois caminhos

- **Pipeline (recomendado)** — GitHub Actions builda as imagens, publica no GHCR
  e a VPS só puxa. Ver [Deploy por pipeline](#deploy-por-pipeline) abaixo.
- **Manual** — a VPS builda do código. Serve para o primeiro boot e para
  depurar. É o que está descrito logo a seguir.

## Primeiro deploy (manual)

```bash
git clone <repo> mage-craft && cd mage-craft

cp .env.example .env
# Gere os dois segredos — o compose se recusa a subir sem eles:
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "MATCH_INGEST_API_KEY=$(openssl rand -hex 32)" >> .env
# E aponte a origem pública para o IP:porta da VPS:
#   PUBLIC_ORIGIN=http://203.0.113.10:8080

docker compose up -d --build
docker compose ps          # os quatro devem ficar healthy
```

Abra `http://<IP-DA-VPS>:8080`. A primeira tela pede uma conta — não existe mais
modo convidado, então crie uma em **Register** para entrar.

## Verificação rápida

```bash
curl -f http://<IP>:8080/healthz          # nginx
docker compose exec api node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>console.log(r.status))"
docker compose logs -f gameserver         # 'mageserver: listening on :8080'
```

O caminho do WebSocket é o que mais quebra em deploy: se a fila ficar girando
sem parear, cheque `docker compose logs client` procurando 502 em `/ws`.

## Atualizar

```bash
git pull
docker compose up -d --build
```

O volume `mongo-data` sobrevive — contas, partidas e ranking permanecem. Para
apagar tudo: `docker compose down -v`.

### Aba aberta durante o deploy do modo idle (v1.2)

Desde o pivô idle o jogador não conjura à mão: o assento é jogado pelo programa
de estratégia que ele escreveu antes da partida. Uma aba carregada **antes** deste
deploy continua falando o protocolo antigo, e o servidor novo responde assim:

- O `set_loadout` dela não leva `strategy`, então o assento recebe
  `defaultStrategy(deck)`. **Joga normalmente** — só não joga o programa do
  jogador, porque a aba antiga não sabe que existe um.
- Todo clique de carta vira `cast`, e o servidor responde
  `error: cast rejected: idle_mode`. A partida segue; a aba só mostra erros.

Nada disso corrompe estado — é degradação, não falha. Um F5 resolve, e o
`mongo-data` já guarda o loadout da conta (`GET /api/me/loadout`), então o
programa volta sozinho no primeiro boot da aba nova.

## Deploy por pipeline

`.github/workflows/deploy.yml` roda a cada push na `main`: builda as três
imagens num runner hospedado do GitHub e publica em
`ghcr.io/niltoncalegari/mage-craft/{client,gameserver,api}` com a tag do
commit. O segundo job — o que efetivamente troca o que está no ar — roda **na
própria VPS**, via um runner self-hosted registrado só para este repositório,
não por SSH. `pull` + `up -d` executam localmente, contra o socket do Docker
da máquina; no fim ele confere `/healthz` de dentro da caixa e falha o job se
o stack não subir.

Isso significa **nenhum segredo de VPS no GitHub** — nem host, nem usuário, nem
chave privada. O runner já está na máquina; a confiança está em quem registrou
o runner, não numa chave guardada num secret.

O build das imagens continua fora da VPS de propósito: `tsc` + Vite + três
imagens é o passo que derruba uma VPS pequena por falta de memória. A VPS só
baixa e reinicia.

`.github/workflows/ci.yml` roda typecheck, lint, testes e build em todo push e
PR num runner hospedado comum — separado do deploy, para PR ter sinal sem
tocar a VPS.

### Preparar a VPS (uma vez)

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. Diretório do stack — só o .env de produção mora aqui, não o código
mkdir -p /opt/mage-craft

# 3. .env de produção — os segredos da aplicação vivem só aqui, nunca no GitHub
JWT_SECRET=$(openssl rand -hex 32)
MATCH_KEY=$(openssl rand -hex 32)
cat > /opt/mage-craft/.env <<EOF
JWT_SECRET=${JWT_SECRET}
MATCH_INGEST_API_KEY=${MATCH_KEY}
CLIENT_PORT=8080
PUBLIC_ORIGIN=http://SEU.IP.AQUI:8080
EOF
chmod 600 /opt/mage-craft/.env
```

### Registrar o runner (uma vez)

Usuário dedicado, sem sudo, só no grupo `docker` — o mesmo alcance que o deploy
manual já tinha, nada mais:

```bash
adduser --disabled-password --gecos "" mage-craft-runner
usermod -aG docker mage-craft-runner

# The deploy job runs as this user, so it — not root, not a "deploy" account —
# is who needs to read the secrets. Skipping this is a silent 403: `docker
# compose` fails with "open /opt/mage-craft/.env: permission denied" the first
# time the pipeline actually runs, which is a worse place to learn about it.
chown mage-craft-runner:mage-craft-runner /opt/mage-craft/.env
chmod 600 /opt/mage-craft/.env
```

Baixe e extraia o runner como esse usuário (troque a versão pela mais recente
em `github.com/actions/runner/releases` — o asset é `linux-x64`, não `amd64`):

```bash
sudo -u mage-craft-runner mkdir -p /home/mage-craft-runner/actions-runner
cd /home/mage-craft-runner/actions-runner
VER=2.336.0
sudo -u mage-craft-runner curl -sL -o runner.tar.gz \
  "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz"
sudo -u mage-craft-runner tar xzf runner.tar.gz && rm runner.tar.gz
```

Um token de registro (válido por 1h, minerado do lado da sua máquina com `gh`
autenticado — não é um secret de longa duração):

```bash
gh api -X POST repos/niltoncalegari/mage-craft/actions/runners/registration-token --jq .token
```

Configure e suba como serviço systemd:

```bash
sudo -u mage-craft-runner ./config.sh --unattended \
  --url https://github.com/niltoncalegari/mage-craft \
  --token <token-do-comando-acima> \
  --name mage-craft-vps \
  --work _work \
  --labels mage-craft
./svc.sh install mage-craft-runner
./svc.sh start
```

Confirma em `Settings → Actions → Runners` no repositório, ou:

```bash
gh api repos/niltoncalegari/mage-craft/actions/runners --jq '.runners[]|{name,status,busy}'
```

### Pacotes públicos

O repositório é público e as imagens saem públicas junto, então a VPS puxa sem
login. Se o repositório virar privado, o `docker compose pull` passa a exigir
`docker login ghcr.io` na VPS com um PAT de escopo `read:packages`.

### Rollback

Cada commit vira uma tag de imagem. Para voltar:

`Actions → Deploy → Run workflow`, e informe o SHA antigo em `image_tag`.
Ou direto na VPS:

```bash
cd /opt/mage-craft
IMAGE_TAG=<sha-antigo> docker compose -f docker-compose.prod.yml up -d
```

## Notas de segurança para este setup

Coisas que este arranjo **não** resolve, e que valem antes de abrir para gente
de fora:

- **Sem TLS.** Tudo trafega em claro, incluindo a senha no `POST /api/auth/login`
  e o JWT em cada requisição seguinte. Qualquer um no caminho lê ambos. Assim que
  houver domínio, ponha um Caddy ou um `certbot` na frente — é o próximo passo
  óbvio, e por IP puro não dá para emitir certificado confiável.
- **Mongo sem autenticação.** Ele não publica porta, então só é alcançável pela
  rede interna do compose. Não publique essa porta sem antes criar um usuário.
- **O nick vai no fio sem verificação.** O servidor de partidas aceita o nome que
  o cliente mandar em `join_queue`/`join_room`; ele não valida o JWT da API. Um
  cliente modificado pode se apresentar com o nick de outra pessoa. Fechar isso
  significa o gameserver verificar o token (compartilhando `JWT_SECRET`) em vez
  de confiar no campo `name`.
- **Sem rate limit no registro/login.** Nada impede força bruta ou criação de
  contas em massa.
