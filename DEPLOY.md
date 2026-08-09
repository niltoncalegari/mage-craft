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

## Deploy por pipeline

`.github/workflows/deploy.yml` roda a cada push na `main`: builda as três
imagens, publica em `ghcr.io/niltoncalegari/mage-craft/{client,gameserver,api}`
com a tag do commit, copia o `docker-compose.prod.yml` para a VPS e roda
`pull` + `up -d`. No fim confere `/healthz` de dentro da máquina e falha o job
se o stack não subir.

O build sai da VPS de propósito: `tsc` + Vite + três imagens é o passo que
derruba uma VPS pequena por falta de memória. Na VPS sobra download e restart.

`.github/workflows/ci.yml` roda typecheck, lint, testes e build em todo push e
PR — separado do deploy, para PR ter sinal sem publicar nada.

### Preparar a VPS (uma vez)

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. Usuário de deploy, sem senha e sem shell de login interativo
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# 3. Diretório do stack — só o compose e o .env moram aqui, não o código
mkdir -p /opt/mage-craft && chown deploy:deploy /opt/mage-craft

# 4. .env de produção (o mesmo do deploy manual)
sudo -u deploy tee /opt/mage-craft/.env >/dev/null <<EOF
JWT_SECRET=$(openssl rand -hex 32)
MATCH_INGEST_API_KEY=$(openssl rand -hex 32)
CLIENT_PORT=8080
PUBLIC_ORIGIN=http://SEU.IP.AQUI:8080
EOF
chmod 600 /opt/mage-craft/.env
```

Chave SSH só para o deploy, gerada **na sua máquina** (a privada nunca toca a VPS):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mage-craft-deploy -C "github-actions" -N ""
ssh-copy-id -i ~/.ssh/mage-craft-deploy.pub deploy@SEU.IP
# Fingerprint do host, para o Actions não confiar cegamente no primeiro contato:
ssh-keyscan -H SEU.IP
```

### Secrets no GitHub

`Settings → Secrets and variables → Actions` (ou no environment `production`):

| Secret | Valor | Obrigatório |
| --- | --- | --- |
| `VPS_HOST` | IP da VPS | sim |
| `VPS_USER` | `deploy` | sim |
| `VPS_SSH_KEY` | conteúdo de `~/.ssh/mage-craft-deploy` (a **privada**, inteira) | sim |
| `VPS_SSH_HOST_KEY` | saída do `ssh-keyscan -H SEU.IP` | recomendado |
| `VPS_PORT` | porta SSH, se não for 22 | não |

Sem `VPS_SSH_HOST_KEY` o job cai em `ssh-keyscan` na hora e aceita qualquer
host que responda — funciona, mas é exatamente a brecha que a chave fixada
fecha.

Os segredos da aplicação (`JWT_SECRET`, `MATCH_INGEST_API_KEY`) **não** vão para
o GitHub: eles vivem só no `/opt/mage-craft/.env` da VPS. A pipeline nunca os lê.

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
