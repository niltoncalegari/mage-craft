package protocol

import (
	"encoding/json"
	"testing"
)

func TestPeekType_ReturnsDeclaredType(t *testing.T) {
	raw := []byte(`{"type":"select_element","element":"fire"}`)

	got, err := PeekType(raw)
	if err != nil {
		t.Fatalf("PeekType returned error: %v", err)
	}
	if got != TypeSelectElement {
		t.Errorf("got type %q, want %q", got, TypeSelectElement)
	}
}

func TestPeekType_MissingTypeIsError(t *testing.T) {
	if _, err := PeekType([]byte(`{"teamSize":2}`)); err == nil {
		t.Fatal("expected error for message without a \"type\" field, got nil")
	}
}

func TestPeekType_InvalidJSONIsError(t *testing.T) {
	if _, err := PeekType([]byte(`not json`)); err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

// clientMessageRoundTripCases documents every client -> server message from
// the protocol (see plan §4) and a sample payload for it.
func TestClientMessages_RoundTrip(t *testing.T) {
	cases := []struct {
		name string
		typ  string
		msg  interface{}
	}{
		{"create_room", TypeCreateRoom, CreateRoomMsg{Type: TypeCreateRoom, TeamSize: 3, FillBots: true, BotDifficulty: "normal"}},
		{"join_room", TypeJoinRoom, JoinRoomMsg{Type: TypeJoinRoom, RoomID: "AB12", Name: "Gandalf"}},
		{"list_rooms", TypeListRooms, ListRoomsMsg{Type: TypeListRooms}},
		{"select_team", TypeSelectTeam, SelectTeamMsg{Type: TypeSelectTeam, Team: 1}},
		{"select_element", TypeSelectElement, SelectElementMsg{Type: TypeSelectElement, Element: "poison"}},
		{"add_bot", TypeAddBot, AddBotMsg{Type: TypeAddBot, Team: 0, Difficulty: "hard"}},
		{"remove_bot", TypeRemoveBot, RemoveBotMsg{Type: TypeRemoveBot, SlotID: "slot-3"}},
		{"claim_slot", TypeClaimSlot, ClaimSlotMsg{Type: TypeClaimSlot, SlotID: "slot-3"}},
		{"set_ready", TypeSetReady, SetReadyMsg{Type: TypeSetReady, Ready: true}},
		{"start_match", TypeStartMatch, StartMatchMsg{Type: TypeStartMatch}},
		{"input", TypeInput, InputMsg{
			Type:     TypeInput,
			Move:     Vec2DTO{X: 1, Y: 0},
			Aim:      Vec2DTO{X: 0.5, Y: -0.5},
			Charging: true,
			Release:  false,
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.msg)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}

			gotType, err := PeekType(data)
			if err != nil {
				t.Fatalf("PeekType: %v", err)
			}
			if gotType != tc.typ {
				t.Fatalf("PeekType = %q, want %q", gotType, tc.typ)
			}

			switch want := tc.msg.(type) {
			case CreateRoomMsg:
				var got CreateRoomMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case JoinRoomMsg:
				var got JoinRoomMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case ListRoomsMsg:
				var got ListRoomsMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case ClaimSlotMsg:
				var got ClaimSlotMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case SelectTeamMsg:
				var got SelectTeamMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case SelectElementMsg:
				var got SelectElementMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case AddBotMsg:
				var got AddBotMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case RemoveBotMsg:
				var got RemoveBotMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case SetReadyMsg:
				var got SetReadyMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case StartMatchMsg:
				var got StartMatchMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			case InputMsg:
				var got InputMsg
				mustUnmarshal(t, data, &got)
				if got != want {
					t.Errorf("got %+v, want %+v", got, want)
				}
			default:
				t.Fatalf("unhandled case type %T", want)
			}
		})
	}
}

func TestServerMessages_RoundTrip(t *testing.T) {
	roomState := RoomStateMsg{
		Type:     TypeRoomState,
		RoomID:   "AB12",
		TeamSize: 2,
		State:    "lobby",
		FillBots: true,
		Slots: []PlayerSlotDTO{
			{SlotID: "slot-0", Team: 0, PlayerID: "p1", Name: "Gandalf", IsBot: false, Element: "fire", Ready: true},
			{SlotID: "slot-1", Team: 0, IsBot: true, Element: "ice", Ready: true, PendingClaimPlayerID: "p2"},
		},
		Spectators: []SpectatorDTO{
			{PlayerID: "p2", Name: "Merlin", ClaimedSlotID: "slot-1"},
		},
		YouRole: "spectator",
	}
	data, err := json.Marshal(roomState)
	if err != nil {
		t.Fatalf("Marshal RoomStateMsg: %v", err)
	}
	gotType, err := PeekType(data)
	if err != nil {
		t.Fatalf("PeekType: %v", err)
	}
	if gotType != TypeRoomState {
		t.Fatalf("PeekType = %q, want %q", gotType, TypeRoomState)
	}
	var gotRoomState RoomStateMsg
	mustUnmarshal(t, data, &gotRoomState)
	if len(gotRoomState.Slots) != 2 || gotRoomState.Slots[0].Element != "fire" {
		t.Errorf("round-tripped RoomStateMsg lost slot data: %+v", gotRoomState)
	}

	snapshot := SnapshotMsg{
		Type: TypeSnapshot,
		Tick: 120,
		Mages: []MageSnapshotDTO{
			{ID: "p1", Team: 0, Position: Vec2DTO{X: 1, Y: 2}, Facing: Vec2DTO{X: 1, Y: 0}, Health: 80, Lives: 2, Element: "fire"},
		},
		Projectiles: []ProjectileSnapshotDTO{
			{ID: "proj-1", Element: "fire", Position: Vec2DTO{X: 3, Y: 4}, Velocity: Vec2DTO{X: 5, Y: 0}},
		},
		Puddles: []PuddleSnapshotDTO{
			{ID: "puddle-1", Position: Vec2DTO{X: 6, Y: 7}, Radius: 1.5, Remaining: 2.0},
		},
	}
	data, err = json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("Marshal SnapshotMsg: %v", err)
	}
	var gotSnapshot SnapshotMsg
	mustUnmarshal(t, data, &gotSnapshot)
	if gotSnapshot.Tick != 120 || len(gotSnapshot.Mages) != 1 || len(gotSnapshot.Projectiles) != 1 || len(gotSnapshot.Puddles) != 1 {
		t.Errorf("round-tripped SnapshotMsg lost data: %+v", gotSnapshot)
	}

	roundEnd := RoundEndMsg{Type: TypeRoundEnd, WinnerTeam: 1}
	data, err = json.Marshal(roundEnd)
	if err != nil {
		t.Fatalf("Marshal RoundEndMsg: %v", err)
	}
	var gotRoundEnd RoundEndMsg
	mustUnmarshal(t, data, &gotRoundEnd)
	if gotRoundEnd != roundEnd {
		t.Errorf("got %+v, want %+v", gotRoundEnd, roundEnd)
	}

	errMsg := ErrorMsg{Type: TypeError, Message: "room is full"}
	data, err = json.Marshal(errMsg)
	if err != nil {
		t.Fatalf("Marshal ErrorMsg: %v", err)
	}
	var gotErr ErrorMsg
	mustUnmarshal(t, data, &gotErr)
	if gotErr != errMsg {
		t.Errorf("got %+v, want %+v", gotErr, errMsg)
	}

	matchStart := MatchStartMsg{Type: TypeMatchStart}
	data, err = json.Marshal(matchStart)
	if err != nil {
		t.Fatalf("Marshal MatchStartMsg: %v", err)
	}
	var gotMatchStart MatchStartMsg
	mustUnmarshal(t, data, &gotMatchStart)
	if gotMatchStart != matchStart {
		t.Errorf("got %+v, want %+v", gotMatchStart, matchStart)
	}

	roomList := RoomListMsg{
		Type: TypeRoomList,
		Rooms: []RoomSummaryDTO{
			{RoomID: "AB12", TeamSize: 1, State: "in_progress", Filled: 2, Capacity: 2, OpenBotSlots: 1, AcceptsSpectators: true},
		},
	}
	data, err = json.Marshal(roomList)
	if err != nil {
		t.Fatalf("Marshal RoomListMsg: %v", err)
	}
	var gotRoomList RoomListMsg
	mustUnmarshal(t, data, &gotRoomList)
	if gotType, _ := PeekType(data); gotType != TypeRoomList {
		t.Fatalf("PeekType = %q, want %q", gotType, TypeRoomList)
	}
	if len(gotRoomList.Rooms) != 1 || gotRoomList.Rooms[0].OpenBotSlots != 1 {
		t.Errorf("round-tripped RoomListMsg lost data: %+v", gotRoomList)
	}
}

func mustUnmarshal(t *testing.T, data []byte, v interface{}) {
	t.Helper()
	if err := json.Unmarshal(data, v); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
}
