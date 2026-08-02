package room

import (
	"crypto/rand"
	"fmt"
	"sync"
)

const roomIDAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I, easier to read aloud
const roomIDLength = 4

// Manager creates and tracks rooms in memory (project plan §2/§3). It has
// no persistence: rooms disappear on process restart, which is fine for
// this stage (no accounts/matchmaking, GDD §7/§10.3).
type Manager struct {
	mu     sync.Mutex
	rooms  map[string]*Room
	nextID func() string
}

// NewManager creates an empty room manager with randomly generated room
// codes.
func NewManager() *Manager {
	return &Manager{
		rooms:  make(map[string]*Room),
		nextID: randomRoomID,
	}
}

// CreateRoom allocates a new room with the given team size (1-6) and a
// freshly generated, unique room code.
func (m *Manager) CreateRoom(teamSize int) (*Room, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var id string
	for {
		id = m.nextID()
		if _, exists := m.rooms[id]; !exists {
			break
		}
	}

	r, err := NewRoom(id, teamSize)
	if err != nil {
		return nil, err
	}
	m.rooms[id] = r
	return r, nil
}

// Room looks up a room by its code.
func (m *Manager) Room(id string) (*Room, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rooms[id]
	return r, ok
}

// RemoveRoom drops a room from the manager (e.g. once a match ends and
// everyone has disconnected).
func (m *Manager) RemoveRoom(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, id)
}

func randomRoomID() string {
	b := make([]byte, roomIDLength)
	buf := make([]byte, roomIDLength)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand.Read on a supported platform practically never fails;
		// panicking here would be worse than falling back to a fixed value
		// that at least keeps the server running.
		return fmt.Sprintf("ERR%d", len(buf))
	}
	for i, v := range buf {
		b[i] = roomIDAlphabet[int(v)%len(roomIDAlphabet)]
	}
	return string(b)
}
