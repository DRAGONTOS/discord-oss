package main

import (
	"encoding/binary"
	"strings"

	"github.com/pion/rtp"
)

// spropParameterSets is the base64 SPS,PPS pair injected into the SDP answer
// for external publishers that do not emit parameter sets in the RTP stream.
// These bytes come from a real libopenh264 encode of 1280x720 Constrained
// Baseline (profile-level-id 42e01f), which is what OBS offers.
const spropParameterSets = "Z0LAH4xoBQBbsBAR4RCNQA==,aM48gA=="

// addSpropParameterSets appends sprop-parameter-sets to every H264 fmtp line
// in the SDP answer that does not already carry it.
func addSpropParameterSets(sdp string) string {
	lines := strings.Split(sdp, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "a=fmtp:") || !strings.Contains(trimmed, "profile-level-id=") {
			continue
		}
		if strings.Contains(trimmed, "sprop-parameter-sets=") {
			continue
		}
		lines[i] = line + ";sprop-parameter-sets=" + spropParameterSets
	}
	return strings.Join(lines, "\n")
}

// parameterSets holds the SPS and PPS NAL units (including their NAL headers)
// observed in the incoming H264 stream. They are captured live rather than
// hardcoded so the injected headers always match the encoder that is running.
type parameterSets struct {
	sps []byte
	pps []byte
}

func (ps *parameterSets) ready() bool {
	return len(ps.sps) > 0 && len(ps.pps) > 0
}

func (ps *parameterSets) reset() {
	ps.sps = nil
	ps.pps = nil
}

// capture extracts SPS/PPS NALs from a single RTP packet payload. It handles
// single NAL units (7/8) and STAP-A aggregation (24) with 2-byte length prefixes.
func (ps *parameterSets) capture(payload []byte) {
	if len(payload) == 0 {
		return
	}
	switch payload[0] & 0x1f {
	case 7, 8:
		nal := append([]byte(nil), payload...)
		if payload[0]&0x1f == 7 {
			ps.sps = nal
		} else {
			ps.pps = nal
		}
	case 24:
		for i := 1; i+2 < len(payload); {
			n := int(binary.BigEndian.Uint16(payload[i : i+2]))
			i += 2
			if n <= 0 || i+n > len(payload) {
				break
			}
			nal := payload[i : i+n]
			switch nal[0] & 0x1f {
			case 7:
				ps.sps = append([]byte(nil), nal...)
			case 8:
				ps.pps = append([]byte(nil), nal...)
			}
			i += n
		}
	}
}

// stapA builds a STAP-A aggregation packet (NAL type 24) from the captured
// SPS and PPS.
func (ps *parameterSets) stapA() []byte {
	sps, pps := ps.sps, ps.pps
	payload := make([]byte, 1+2+len(sps)+2+len(pps))
	payload[0] = 0x78
	binary.BigEndian.PutUint16(payload[1:3], uint16(len(sps)))
	copy(payload[3:], sps)
	offset := 3 + len(sps)
	binary.BigEndian.PutUint16(payload[offset:offset+2], uint16(len(pps)))
	copy(payload[offset+2:], pps)
	return payload
}

// isH264IDRStart reports whether a payload begins an IDR picture: a single
// NAL of type 5, or a FU-A (28) start fragment whose inner NAL type is 5.
func isH264IDRStart(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}
	switch payload[0] & 0x1f {
	case 5:
		return true
	case 28:
		return len(payload) > 1 && payload[1]&0x80 != 0 && payload[1]&0x1f == 5
	}
	return false
}

func parameterSetPacket(idr *rtp.Packet, stap []byte) *rtp.Packet {
	packet := &rtp.Packet{Header: idr.Header, Payload: stap}
	packet.Marker = false
	return packet
}
