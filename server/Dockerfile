# Builds the existing server/cmd/mageserver binary as-is — no .go files are
# touched here (see AGENTS.md: server/** ownership stays with the session
# working on the Go multiplayer server).
FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/mageserver ./cmd/mageserver

FROM alpine:3.20
RUN adduser -D -H mageserver
COPY --from=build /out/mageserver /usr/local/bin/mageserver
USER mageserver
EXPOSE 8080
ENTRYPOINT ["mageserver"]
