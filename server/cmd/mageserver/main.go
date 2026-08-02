// Command mageserver runs the Mage Craft authoritative game server: an HTTP
// server exposing a WebSocket endpoint for the room/lobby + match protocol
// (see server/README.md and the project plan, §2-§4).
//
// The composition root (App, in app.go) wires internal/ws (transport) to
// internal/room + internal/match (lobby + simulation) via
// internal/protocol (wire messages).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	"mage-craft/server/internal/ws"
)

func main() {
	port := 8080
	if v := os.Getenv("PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil {
			log.Fatalf("mageserver: invalid PORT %q: %v", v, err)
		}
		port = p
	}

	var nextClientID atomic.Uint64

	var hub *ws.Hub
	var app *App
	hub = ws.NewHub(
		func(clientID string, data []byte) {
			app.HandleMessage(clientID, data)
		},
		func(clientID string) {
			log.Printf("mageserver: client %s disconnected", clientID)
			app.HandleDisconnect(clientID)
		},
	)
	app = NewApp(hub)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("id")
		if clientID == "" {
			clientID = "anon-" + strconv.FormatUint(nextClientID.Add(1), 10)
		}
		log.Printf("mageserver: client %s connected", clientID)
		if err := hub.Upgrade(w, r, clientID); err != nil {
			log.Printf("mageserver: upgrade failed for %s: %v", clientID, err)
		}
	})

	addr := ":" + strconv.Itoa(port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("mageserver: listening on %s (ws endpoint: /ws, health check: /healthz)", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("mageserver: ListenAndServe: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()

	log.Println("mageserver: shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("mageserver: graceful shutdown failed: %v", err)
	}
}
