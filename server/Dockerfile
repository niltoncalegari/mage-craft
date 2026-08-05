# The build context is the repo root, not server/ — the game server imports the
# shared simulation in sim/ and the map files in public/maps/, so it needs the
# whole tree (see vite.server.config.ts and docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# `ws` is the only runtime dependency; the sim and everything else is bundled
# into dist-server/main.js.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8080
CMD ["node", "dist-server/main.js"]
