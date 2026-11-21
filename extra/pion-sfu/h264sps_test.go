package main

import (
	"bytes"
	"encoding/binary"
	"testing"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
)

type h264BitReader struct {
	data []byte
	pos  int
}

func (r *h264BitReader) bits(n int) uint32 {
	var value uint32
	for range n {
		value <<= 1
		if r.pos < len(r.data)*8 && r.data[r.pos/8]&(0x80>>(r.pos%8)) != 0 {
			value |= 1
		}
		r.pos++
	}
	return value
}

func (r *h264BitReader) ue() uint32 {
	zeros := 0
	for r.bits(1) == 0 {
		zeros++
	}
	if zeros == 0 {
		return 0
	}
	return (1<<zeros - 1) + r.bits(zeros)
}

func unescapeRBSP(nal []byte) []byte {
	out := make([]byte, 0, len(nal))
	for i := 0; i < len(nal); {
		if i+2 < len(nal) && nal[i] == 0 && nal[i+1] == 0 && nal[i+2] == 3 {
			out = append(out, nal[i], nal[i+1])
			i += 3
			continue
		}
		out = append(out, nal[i])
		i++
	}
	return out
}

func TestHardcodedParameterSetsDescribe720pConstrainedBaseline31(t *testing.T) {
	if h264SPS[0]&0x1f != 7 || h264PPS[0]&0x1f != 8 {
		t.Fatalf("SPS NAL type %d, PPS NAL type %d", h264SPS[0]&0x1f, h264PPS[0]&0x1f)
	}
	if h264SPS[1] != 0x42 || h264SPS[2]&0x40 == 0 || h264SPS[3] != 0x1f {
		t.Fatalf("SPS profile bytes %x %x %x, want constrained baseline level 3.1", h264SPS[1], h264SPS[2], h264SPS[3])
	}
	r := &h264BitReader{data: unescapeRBSP(h264SPS[1:])}
	profile := r.bits(8)
	constraints := r.bits(8)
	level := r.bits(8)
	r.ue()
	r.ue()
	switch r.ue() {
	case 0:
		r.ue()
	case 1:
		r.bits(1)
		r.ue()
		r.ue()
		for count := r.ue(); count > 0; count-- {
			r.ue()
		}
	case 2:
	}
	r.ue()
	r.bits(1)
	widthInMBs := r.ue() + 1
	heightInMapUnits := r.ue() + 1
	frameMBsOnly := r.bits(1)
	if frameMBsOnly == 0 {
		r.bits(1)
	}
	r.bits(1)
	if r.bits(1) != 0 {
		t.Fatal("unexpected frame cropping")
	}
	width := int(widthInMBs * 16)
	height := int(heightInMapUnits * 16 * (2 - frameMBsOnly))
	if profile != 0x42 || level != 0x1f || constraints&0x40 == 0 || width != 1280 || height != 720 {
		t.Fatalf("SPS describes profile=%x constraints=%x level=%x %dx%d", profile, constraints, level, width, height)
	}
	if h264PPS[0]&0x1f != 8 {
		t.Fatalf("PPS NAL type %d", h264PPS[0]&0x1f)
	}
}

func TestSTAPAggregationOfParameterSets(t *testing.T) {
	payload := h264ParameterSets
	if payload[0] != 0x78 {
		t.Fatalf("STAP-A header is %x", payload[0])
	}
	offset := 1
	for _, nal := range [][]byte{h264SPS, h264PPS} {
		if len(payload) < offset+2 {
			t.Fatal("truncated STAP-A length")
		}
		length := int(payload[offset])<<8 | int(payload[offset+1])
		offset += 2
		if length != len(nal) || len(payload) < offset+length {
			t.Fatalf("STAP-A NAL length %d, want %d", length, len(nal))
		}
		if !bytes.Equal(payload[offset:offset+length], nal) {
			t.Fatal("STAP-A NAL does not match")
		}
		offset += length
	}
	if offset != len(payload) {
		t.Fatalf("STAP-A has %d trailing bytes", len(payload)-offset)
	}
}

func TestIDRStartDetection(t *testing.T) {
	cases := []struct {
		name    string
		payload []byte
		want    bool
	}{
		{"single IDR", []byte{0x65, 0x88}, true},
		{"single IDR low NRI", []byte{0x05, 0x88}, true},
		{"FU-A start IDR", []byte{0x7c, 0x85, 1, 2}, true},
		{"FU-A start IDR low NRI", []byte{0x5c, 0x85, 1, 2}, true},
		{"FU-A middle IDR", []byte{0x7c, 0x05, 1, 2}, false},
		{"FU-A end IDR", []byte{0x7c, 0x45, 1, 2}, false},
		{"FU-A start non-IDR", []byte{0x7c, 0x81, 1, 2}, false},
		{"single non-IDR", []byte{0x41, 0x88}, false},
		{"STAP-A", []byte{0x78, 0x00, 0x04, 0x67}, false},
		{"empty", nil, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := isH264IDRStart(test.payload); got != test.want {
				t.Fatalf("isH264IDRStart(%x) = %t, want %t", test.payload, got, test.want)
			}
		})
	}
}

func TestParameterSetPacketHeader(t *testing.T) {
	idr := &rtp.Packet{Header: rtp.Header{
		Version:        2,
		Marker:         true,
		PayloadType:    103,
		SequenceNumber: 500,
		Timestamp:      90000,
		SSRC:           0x5eed,
	}, Payload: []byte{0x65, 1, 2, 3}}
	packet := h264ParameterSetPacket(idr)
	if packet.SequenceNumber != 500 || packet.Timestamp != 90000 || packet.SSRC != idr.SSRC || packet.PayloadType != 103 || packet.Marker {
		t.Fatalf("parameter set header %+v", packet.Header)
	}
	if !bytes.Equal(packet.Payload, h264ParameterSets) {
		t.Fatal("parameter set payload is not the SPS/PPS STAP-A")
	}
}

func videoIngestHarness(t *testing.T, external bool, viewerSSRC uint32) (*PublishedTrack, *nativeEndpoint) {
	t.Helper()
	server := nativeServer(t)
	publisher := &Peer{id: "video-publisher", external: external, isVideoPublished: true}
	sfu.AddPeer(publisher)
	t.Cleanup(func() { cleanupPeer(publisher) })
	track := &PublishedTrack{
		ssrc:       0x5eed,
		kind:       "video",
		key:        subscriptionKey(publisher.id, "video"),
		publisher:  publisher,
		extensions: map[uint8]string{},
		stop:       make(chan struct{}),
		cache:      newPacketCache(64),
		losses:     newLossTracker(),
	}
	publisher.videoPublished = track
	sfu.IndexTrack(track)
	viewer := joinNative(t, server, "video-viewer", viewerSSRC, modeAES256GCM, testKey(84), 105, 106)
	if err := sfu.Subscribe(viewer.peer, publisher, "video"); err != nil {
		t.Fatal(err)
	}
	return track, viewer
}

func TestExternalPublisherIDRInjectsParameterSetsBeforeEveryKeyframe(t *testing.T) {
	track, viewer := videoIngestHarness(t, true, 8101)
	var received []*rtp.Packet
	next := func() *rtp.Packet {
		t.Helper()
		pkt := viewer.nextRTP(2 * time.Second)
		if pkt != nil {
			received = append(received, pkt)
		}
		return pkt
	}

	slice := []byte{0x41, 0xaa, 0xbb}
	track.ingest(h264Packet(0x5eed, 103, 10, slice))
	if got := next(); got == nil || !bytes.Equal(got.Payload, slice) {
		t.Fatalf("viewer got %+v, want the non-IDR slice", got)
	}

	idr := h264Packet(0x5eed, 103, 11, []byte{0x7c, 0x85, 1, 2, 3})
	track.ingest(idr)
	sets := next()
	if sets == nil || !bytes.Equal(sets.Payload, h264ParameterSets) {
		t.Fatalf("viewer got %+v, want the SPS/PPS STAP-A", sets)
	}
	if sets.SequenceNumber != idr.SequenceNumber || sets.Timestamp != idr.Timestamp || sets.SSRC != idr.SSRC || sets.Marker {
		t.Fatalf("parameter set RTP header %+v", sets.Header)
	}
	if got := next(); got == nil || !bytes.Equal(got.Payload, idr.Payload) || got.SequenceNumber != idr.SequenceNumber+1 {
		t.Fatalf("viewer got %+v, want the IDR after the parameter sets", got)
	}

	continuation := []byte{0x7c, 0x05, 4, 5, 6}
	track.ingest(h264Packet(0x5eed, 103, 12, continuation))
	if got := next(); got == nil || !bytes.Equal(got.Payload, continuation) || got.SequenceNumber != 13 {
		t.Fatalf("viewer got %+v, want the FU-A continuation without new parameter sets", got)
	}

	secondIDR := h264Packet(0x5eed, 103, 13, []byte{0x7c, 0x85, 7, 8, 9})
	track.ingest(secondIDR)
	if got := next(); got == nil || !bytes.Equal(got.Payload, h264ParameterSets) || got.SequenceNumber != 14 {
		t.Fatalf("viewer got %+v, want parameter sets before the second IDR", got)
	}
	if got := next(); got == nil || !bytes.Equal(got.Payload, secondIDR.Payload) || got.SequenceNumber != 15 {
		t.Fatalf("viewer got %+v, want the second IDR", got)
	}

	for i, pkt := range received {
		if pkt.SequenceNumber != uint16(10+i) {
			t.Fatalf("packet %d has sequence %d, want %d (duplicate or gap in the injected stream)", i, pkt.SequenceNumber, 10+i)
		}
	}
}

func TestRetransmissionFollowsTheShiftedSequenceSpace(t *testing.T) {
	track, viewer := videoIngestHarness(t, true, 8103)
	frame := []byte{0x41, 0xaa, 0xbb}
	track.ingest(h264Packet(0x5eed, 103, 20, frame))
	if got := viewer.nextRTP(2 * time.Second); got == nil || got.SequenceNumber != 20 {
		t.Fatalf("viewer got %+v, want sequence 20", got)
	}

	idrPayload := []byte{0x7c, 0x85, 1, 2, 3}
	track.ingest(h264Packet(0x5eed, 103, 21, idrPayload))
	if got := viewer.nextRTP(2 * time.Second); got == nil || got.SequenceNumber != 21 {
		t.Fatalf("viewer got %+v, want the parameter sets at sequence 21", got)
	}
	if got := viewer.nextRTP(2 * time.Second); got == nil || got.SequenceNumber != 22 {
		t.Fatalf("viewer got %+v, want the IDR at sequence 22", got)
	}

	viewer.sendRTCP([]rtcp.Packet{&rtcp.TransportLayerNack{
		SenderSSRC: 8103,
		MediaSSRC:  0x5eed,
		Nacks:      rtcp.NackPairsFromSequenceNumbers([]uint16{22}),
	}}, 1)
	repair := viewer.nextRTP(2 * time.Second)
	if repair == nil || repair.SSRC != 0x5eed+1 || repair.PayloadType != 106 || binary.BigEndian.Uint16(repair.Payload) != 22 || !bytes.Equal(repair.Payload[2:], idrPayload) {
		t.Fatalf("viewer got no RTX repair on the shifted sequence: %+v", repair)
	}
}

func TestInternalPublisherIDRDoesNotInjectParameterSets(t *testing.T) {
	track, viewer := videoIngestHarness(t, false, 8102)
	track.ingest(h264Packet(0x5eed, 103, 10, []byte{0x7c, 0x85, 1, 2, 3}))
	if got := viewer.nextRTP(2 * time.Second); got == nil || got.Payload[0] != 0x7c {
		t.Fatalf("viewer got %+v, want just the IDR", got)
	}
	if got := viewer.nextRTP(200 * time.Millisecond); got != nil {
		t.Fatalf("injected parameter sets reached an internal publisher's viewer: %+v", got)
	}
}
