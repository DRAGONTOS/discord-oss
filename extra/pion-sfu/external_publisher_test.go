package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
)

func testAPI(t *testing.T) {
	t.Helper()
	me, err := createMediaEngine()
	if err != nil {
		t.Fatal(err)
	}
	settings := &webrtc.SettingEngine{}
	settings.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
	api := webrtc.NewAPI(webrtc.WithMediaEngine(me), webrtc.WithSettingEngine(*settings))
	previous := webrtcAPI
	webrtcAPI = api
	t.Cleanup(func() { webrtcAPI = previous })
}

func captureIPC(t *testing.T) <-chan IpcMessage {
	t.Helper()
	server, client := net.Pipe()
	previous := ipcConn
	ipcConn = &IpcConnection{conn: server}
	events := make(chan IpcMessage, 32)
	go func() {
		header := make([]byte, 4)
		for {
			if _, err := io.ReadFull(client, header); err != nil {
				return
			}
			length := binary.BigEndian.Uint32(header)
			if length > 10*1024*1024 {
				return
			}
			payload := make([]byte, length)
			if _, err := io.ReadFull(client, payload); err != nil {
				return
			}
			var msg IpcMessage
			if err := json.Unmarshal(payload, &msg); err != nil {
				continue
			}
			select {
			case events <- msg:
			default:
			}
		}
	}()
	t.Cleanup(func() {
		ipcConn = previous
		_ = server.Close()
		_ = client.Close()
	})
	return events
}

func waitForEvent(t *testing.T, events <-chan IpcMessage, eventType string) IpcMessage {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case msg := <-events:
			if msg.Payload.Type == eventType {
				return msg
			}
		case <-deadline:
			t.Fatalf("timed out waiting for IPC event %q", eventType)
			return IpcMessage{}
		}
	}
}

func externalOffer(t *testing.T, audioDirection, videoDirection webrtc.RTPTransceiverDirection) string {
	t.Helper()
	me, err := createMediaEngine()
	if err != nil {
		t.Fatal(err)
	}
	settings := &webrtc.SettingEngine{}
	settings.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
	api := webrtc.NewAPI(webrtc.WithMediaEngine(me), webrtc.WithSettingEngine(*settings))
	pc, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	if _, err = pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: audioDirection}); err != nil {
		t.Fatal(err)
	}
	if _, err = pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: videoDirection}); err != nil {
		t.Fatal(err)
	}
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	return offer.SDP
}

func TestExternalPublishDirectionsFromRawOffer(t *testing.T) {
	raw := strings.Join([]string{
		"v=0",
		"o=- 0 0 IN IP4 127.0.0.1",
		"s=-",
		"t=0 0",
		"m=audio 9 UDP/TLS/RTP/SAVPF 111",
		"a=mid:0",
		"a=sendonly",
		"a=rtpmap:111 opus/48000/2",
		"m=video 9 UDP/TLS/RTP/SAVPF 103",
		"a=mid:1",
		"a=sendrecv",
		"a=rtpmap:103 H264/90000",
		"",
	}, "\r\n")
	audio, video := externalPublishDirections(raw)
	if !audio || !video {
		t.Fatalf("sendonly/sendrecv m-lines: audio=%t video=%t", audio, video)
	}

	raw = strings.Replace(raw, "a=sendonly", "a=recvonly", 1)
	raw = strings.Replace(raw, "a=sendrecv", "a=inactive", 1)
	audio, video = externalPublishDirections(raw)
	if audio || video {
		t.Fatalf("recvonly/inactive m-lines: audio=%t video=%t", audio, video)
	}
}

func TestExternalOfferSetsFlagsWithoutDuplicateTransceivers(t *testing.T) {
	testAPI(t)
	useTestIPC(t)
	if err := handleJoin("ext-publisher"); err != nil {
		t.Fatal(err)
	}
	p := sfu.GetPeer("ext-publisher")
	if p == nil {
		t.Fatal("external peer was not registered")
	}
	t.Cleanup(func() { cleanupPeer(p) })

	before := len(p.pc.GetTransceivers())
	msg := SignalMessage{
		Type:     "offer",
		ClientID: "ext-publisher",
		SDP:      externalOffer(t, webrtc.RTPTransceiverDirectionSendonly, webrtc.RTPTransceiverDirectionSendonly),
		External: true,
		RoomID:   "room-1",
		UserID:   "user-1",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := handleOffer(ctx, p, msg, "req-1"); err != nil {
		t.Fatal(err)
	}

	p.mu.Lock()
	external, audio, video, roomID, userID := p.external, p.isAudioPublished, p.isVideoPublished, p.roomID, p.userID
	p.mu.Unlock()
	if !external || !audio || !video {
		t.Fatalf("external=%t audio=%t video=%t", external, audio, video)
	}
	if roomID != "room-1" || userID != "user-1" {
		t.Fatalf("room=%q user=%q", roomID, userID)
	}

	after := len(p.pc.GetTransceivers())
	if after != before+2 {
		t.Fatalf("got %d transceivers after offer, want %d (one negotiated per m-line)", after, before+2)
	}
	if err := handlePublish(p, SignalMessage{ClientID: p.id, TrackType: "audio"}); err != nil {
		t.Fatal(err)
	}
	if err := handlePublish(p, SignalMessage{ClientID: p.id, TrackType: "video"}); err != nil {
		t.Fatal(err)
	}
	if got := len(p.pc.GetTransceivers()); got != after {
		t.Fatalf("publish added %d extra transceivers to an external peer", got-after)
	}

	for _, transceiver := range p.pc.GetTransceivers() {
		if transceiver.Mid() == "" {
			continue
		}
		if transceiver.Direction() != webrtc.RTPTransceiverDirectionRecvonly {
			t.Fatalf("mid %s direction %s, want recvonly", transceiver.Mid(), transceiver.Direction())
		}
	}
}

func TestExternalPublisherDisconnectEvent(t *testing.T) {
	testAPI(t)
	events := captureIPC(t)
	if err := handleJoin("ext-disconnect"); err != nil {
		t.Fatal(err)
	}
	p := sfu.GetPeer("ext-disconnect")
	if p == nil {
		t.Fatal("external peer was not registered")
	}
	t.Cleanup(func() { cleanupPeer(p) })

	msg := SignalMessage{
		Type:     "offer",
		ClientID: "ext-disconnect",
		SDP:      externalOffer(t, webrtc.RTPTransceiverDirectionSendonly, webrtc.RTPTransceiverDirectionSendonly),
		External: true,
		RoomID:   "room-2",
		UserID:   "user-2",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := handleOffer(ctx, p, msg, "req-2"); err != nil {
		t.Fatal(err)
	}

	if err := p.pc.Close(); err != nil {
		t.Fatal(err)
	}
	event := waitForEvent(t, events, "disconnected")
	if event.Payload.Type != "disconnected" || event.Payload.ClientID != "ext-disconnect" {
		t.Fatalf("got event %q for %q, want disconnected for ext-disconnect", event.Payload.Type, event.Payload.ClientID)
	}
	if event.Payload.RoomID != "room-2" || event.Payload.UserID != "user-2" {
		t.Fatalf("event room=%q user=%q", event.Payload.RoomID, event.Payload.UserID)
	}
	select {
	case extra := <-events:
		t.Fatalf("got duplicate disconnect event: %q", extra.Payload.Type)
	case <-time.After(200 * time.Millisecond):
	}
}

func TestH264Profile64001fRegisteredWithStablePayloadTypes(t *testing.T) {
	profiles := make(map[string]webrtc.PayloadType)
	for _, profile := range h264Profiles {
		profiles[profile.profileID] = profile.payloadType
	}
	if got := profiles["64001f"]; got != 109 {
		t.Fatalf("64001f payload type is %d, want 109", got)
	}
	if got := profiles["42e01f"]; got != 103 {
		t.Fatalf("42e01f payload type changed to %d, want 103", got)
	}

	mediaEngine, err := createMediaEngine()
	if err != nil {
		t.Fatal(err)
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(mediaEngine))
	pc, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	if _, err = pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendrecv}); err != nil {
		t.Fatal(err)
	}
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(offer.SDP, "profile-level-id=64001f") {
		t.Fatal("offer is missing profile 64001f")
	}
}
