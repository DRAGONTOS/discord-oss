package main

import (
	"encoding/binary"
	"strings"
	"testing"

	"github.com/pion/rtp"
)

func TestParameterSetsCaptureSingleNALs(t *testing.T) {
	var ps parameterSets
	sps := []byte{0x67, 0x42, 0xc0, 0x1f, 0x8c, 0x68}
	pps := []byte{0x68, 0xce, 0x3c, 0x80}
	ps.capture(sps)
	ps.capture(pps)
	if !ps.ready() {
		t.Fatal("expected parameter sets to be ready")
	}
	if string(ps.sps) != string(sps) || string(ps.pps) != string(pps) {
		t.Fatalf("captured sps=%x pps=%x", ps.sps, ps.pps)
	}
}

func TestParameterSetsCaptureSTAPA(t *testing.T) {
	sps := []byte{0x67, 0x42, 0xc0, 0x1f}
	pps := []byte{0x68, 0xce, 0x3c}
	stap := []byte{0x78}
	stap = binary.BigEndian.AppendUint16(stap, uint16(len(sps)))
	stap = append(stap, sps...)
	stap = binary.BigEndian.AppendUint16(stap, uint16(len(pps)))
	stap = append(stap, pps...)

	var ps parameterSets
	ps.capture(stap)
	if !ps.ready() {
		t.Fatal("expected STAP-A to populate parameter sets")
	}
	if string(ps.sps) != string(sps) || string(ps.pps) != string(pps) {
		t.Fatalf("captured sps=%x pps=%x", ps.sps, ps.pps)
	}
}

func TestParameterSetsSTAPABuild(t *testing.T) {
	ps := parameterSets{
		sps: []byte{0x67, 0x01, 0x02},
		pps: []byte{0x68, 0x03},
	}
	stap := ps.stapA()
	if stap[0] != 0x78 {
		t.Fatalf("STAP-A header %x", stap[0])
	}
	n1 := int(binary.BigEndian.Uint16(stap[1:3]))
	if n1 != 3 || string(stap[3:3+n1]) != string(ps.sps) {
		t.Fatalf("first NAL length=%d bytes=%x", n1, stap[3:3+n1])
	}
	off := 3 + n1
	n2 := int(binary.BigEndian.Uint16(stap[off : off+2]))
	off += 2
	if n2 != 2 || string(stap[off:off+n2]) != string(ps.pps) {
		t.Fatalf("second NAL length=%d bytes=%x", n2, stap[off:off+n2])
	}
}

func TestParameterSetPacketHeader(t *testing.T) {
	idr := &rtp.Packet{Header: rtp.Header{SSRC: 42, SequenceNumber: 10, Timestamp: 100, Marker: true}, Payload: []byte{0x65, 0x01}}
	ps := parameterSetPacket(idr, []byte{0x78, 0x01})
	if ps.SSRC != idr.SSRC || ps.SequenceNumber != idr.SequenceNumber || ps.Timestamp != idr.Timestamp {
		t.Fatalf("header mismatch: %+v", ps.Header)
	}
	if ps.Marker {
		t.Fatal("parameter set packet marker must be clear")
	}
}

func TestIsH264IDRStart(t *testing.T) {
	cases := []struct {
		payload []byte
		want    bool
	}{
		{[]byte{0x65, 0x01}, true},        // single NAL IDR
		{[]byte{0x41, 0x01}, false},       // single NAL non-IDR
		{[]byte{0x7c, 0x85, 0x01}, true},  // FU-A start of IDR
		{[]byte{0x7c, 0x05, 0x01}, false}, // FU-A middle of IDR
		{[]byte{0x7c, 0x45, 0x01}, false}, // FU-A end of IDR
		{[]byte{0x7c, 0x81, 0x01}, false}, // FU-A start of non-IDR
		{[]byte{0x78, 0x01}, false},       // STAP-A
		{nil, false},
	}
	for _, c := range cases {
		if got := isH264IDRStart(c.payload); got != c.want {
			t.Errorf("isH264IDRStart(%x) = %v, want %v", c.payload, got, c.want)
		}
	}
}

func TestParameterSetsReset(t *testing.T) {
	ps := parameterSets{sps: []byte{0x67}, pps: []byte{0x68}}
	ps.reset()
	if ps.ready() {
		t.Fatal("expected parameter sets to be cleared")
	}
}

func TestAddSpropParameterSets(t *testing.T) {
	sdp := "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\na=rtpmap:111 opus/48000/2\r\n"
	out := addSpropParameterSets(sdp)
	if !strings.Contains(out, "sprop-parameter-sets="+spropParameterSets) {
		t.Fatalf("sprop not injected: %s", out)
	}
	if strings.Count(out, "sprop-parameter-sets=") != 1 {
		t.Fatalf("expected one sprop line: %s", out)
	}
	// idempotent
	out2 := addSpropParameterSets(out)
	if strings.Count(out2, "sprop-parameter-sets=") != 1 {
		t.Fatalf("sprop injected twice: %s", out2)
	}
}
