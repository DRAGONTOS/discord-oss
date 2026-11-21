package main

import (
	"encoding/binary"

	"github.com/pion/rtp"
)

var (
	h264SPS = []byte{
		0x67, 0x42, 0xc0, 0x1f, 0xdc, 0x05, 0x00, 0x5b,
		0xb0, 0x11, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00,
		0x00, 0x03, 0x00, 0x3c, 0x0f, 0x18, 0x33, 0x80,
	}
	h264PPS = []byte{0x68, 0xce, 0x0f, 0x2c, 0x80}
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
