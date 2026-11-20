package main

import (
	"encoding/hex"
	"strings"
	"testing"

	"github.com/pion/webrtc/v4"
)

func fmtpParam(fmtp, key string) string {
	for _, field := range strings.Split(fmtp, ";") {
		name, value, ok := strings.Cut(field, "=")
		if ok && strings.EqualFold(strings.TrimSpace(name), key) {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func TestH264CodecParametersRegisterProfilesWithRtx(t *testing.T) {
	codecs := h264CodecParameters()
	if len(codecs) != len(h264Profiles)*2 {
		t.Fatalf("got %d codecs, want %d", len(codecs), len(h264Profiles)*2)
	}

	rtxByApt := make(map[webrtc.PayloadType]webrtc.PayloadType)
	for _, codec := range codecs {
		if !strings.EqualFold(codec.MimeType, webrtc.MimeTypeRTX) {
			continue
		}
		apt, ok := parseApt(codec.SDPFmtpLine)
		if !ok {
			t.Fatalf("RTX codec %d has no valid apt", codec.PayloadType)
		}
		rtxByApt[webrtc.PayloadType(apt)] = codec.PayloadType
	}

	profiles := make(map[string]webrtc.PayloadType)
	for _, codec := range codecs {
		if !strings.EqualFold(codec.MimeType, webrtc.MimeTypeH264) {
			continue
		}
		profile := fmtpParam(codec.SDPFmtpLine, "profile-level-id")
		if profile == "" {
			t.Fatalf("H264 codec %d has no profile-level-id", codec.PayloadType)
		}
		if _, duplicate := profiles[profile]; duplicate {
			t.Fatalf("duplicate H264 profile %s", profile)
		}
		profiles[profile] = codec.PayloadType
		rtx, ok := rtxByApt[codec.PayloadType]
		if !ok {
			t.Fatalf("no RTX codec with apt=%d", codec.PayloadType)
		}
		if rtx == codec.PayloadType {
			t.Fatalf("RTX payload type %d equals H264 payload type", rtx)
		}
	}

	payloadTypes := make(map[webrtc.PayloadType]bool)
	for _, payloadType := range profiles {
		if payloadTypes[payloadType] {
			t.Fatalf("profiles share payload type %d", payloadType)
		}
		payloadTypes[payloadType] = true
	}
}

func TestRegisteredProfilesMatchAllowedProfileIDs(t *testing.T) {
	for _, allowed := range []string{"42e01f", "4d0028", "64001f", "640028"} {
		candidate, err := hex.DecodeString(allowed)
		if err != nil || len(candidate) < 2 {
			t.Fatalf("invalid profile %s", allowed)
		}
		matched := false
		for _, codec := range h264CodecParameters() {
			registered := fmtpParam(codec.SDPFmtpLine, "profile-level-id")
			if registered == "" {
				continue
			}
			registeredBytes, err := hex.DecodeString(registered)
			if err != nil || len(registeredBytes) < 2 {
				continue
			}
			if candidate[0] == registeredBytes[0] && candidate[1] == registeredBytes[1] {
				matched = true
				break
			}
		}
		if !matched {
			t.Fatalf("no registered profile matches %s", allowed)
		}
	}
}

func TestCreateMediaEngineOffersEveryProfile(t *testing.T) {
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
	for _, profile := range h264Profiles {
		if !strings.Contains(offer.SDP, "profile-level-id="+profile.profileID) {
			t.Fatalf("offer is missing profile %s", profile.profileID)
		}
	}
}
