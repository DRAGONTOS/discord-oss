package main

import (
	"encoding/binary"

	"github.com/pion/rtp"
)

var (
	h264SPS = []byte{0x67, 0x42, 0xc0, 0x1f, 0xda, 0x01, 0x40, 0x16, 0xe4}
	h264PPS = []byte{0x68, 0xca, 0xfc, 0x80}
)

func buildSTAPA(sps, pps []byte) []byte {
	payload := make([]byte, 1+2+len(sps)+2+len(pps))
	payload[0] = 0x78
	binary.BigEndian.PutUint16(payload[1:3], uint16(len(sps)))
	copy(payload[3:], sps)
	offset := 3 + len(sps)
	binary.BigEndian.PutUint16(payload[offset:offset+2], uint16(len(pps)))
	copy(payload[offset+2:], pps)
	return payload
}

var h264ParameterSets = buildSTAPA(h264SPS, h264PPS)

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

func h264ParameterSetPacket(idr *rtp.Packet) *rtp.Packet {
	packet := &rtp.Packet{Header: idr.Header, Payload: h264ParameterSets}
	packet.Marker = false
	return packet
}

// fuAToAnnexB rebuilds Annex-B NAL units from a stream of RTP/H264 packets.
// STAP-A (24) is expanded by its length prefixes; FU-A (28) is reassembled
// from its start/middle/end fragments; single NALs are emitted directly.
func h264AnnexB(rtps []*rtp.Packet) []byte {
	var out []byte
	var fu []byte
	startCode := func() { out = append(out, 0x00, 0x00, 0x00, 0x01) }
	flushFU := func() {
		if len(fu) > 0 {
			startCode()
			out = append(out, fu...)
			fu = nil
		}
	}
	for _, pkt := range rtps {
		p := pkt.Payload
		if len(p) == 0 {
			continue
		}
		switch p[0] & 0x1f {
		case 24: // STAP-A
			flushFU()
			for i := 1; i+2 < len(p); {
				n := int(binary.BigEndian.Uint16(p[i : i+2]))
				i += 2
				if n <= 0 || i+n > len(p) {
					break
				}
				startCode()
				out = append(out, p[i:i+n]...)
				i += n
			}
		case 28: // FU-A
			if len(p) < 2 {
				continue
			}
			indicator, header := p[0], p[1]
			if header&0x80 != 0 { // start
				fu = []byte{indicator&0xe0 | header&0x1f}
			}
			fu = append(fu, p[2:]...)
			if header&0x40 != 0 { // end
				flushFU()
			}
		default:
			flushFU()
			startCode()
			out = append(out, p...)
		}
	}
	flushFU()
	return out
}
