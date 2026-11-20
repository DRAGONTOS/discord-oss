package main

import (
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

type discardWriter struct{}

func (discardWriter) WriteRTP(header *rtp.Header, payload []byte) (int, error) {
	return len(payload), nil
}
func (discardWriter) Write(b []byte) (int, error) { return len(b), nil }

type testTrackLocalContext struct {
	codecs []webrtc.RTPCodecParameters
	exts   []webrtc.RTPHeaderExtensionParameter
	ssrc   webrtc.SSRC
}

func (c *testTrackLocalContext) CodecParameters() []webrtc.RTPCodecParameters {
	return c.codecs
}
func (c *testTrackLocalContext) HeaderExtensions() []webrtc.RTPHeaderExtensionParameter {
	return c.exts
}
func (c *testTrackLocalContext) SSRC() webrtc.SSRC                       { return c.ssrc }
func (c *testTrackLocalContext) SSRCRetransmission() webrtc.SSRC         { return 0 }
func (c *testTrackLocalContext) SSRCForwardErrorCorrection() webrtc.SSRC { return 0 }
func (c *testTrackLocalContext) WriteStream() webrtc.TrackLocalWriter    { return discardWriter{} }
func (c *testTrackLocalContext) ID() string                              { return "test" }
func (c *testTrackLocalContext) RTCPReader() interceptor.RTCPReader      { return nil }

func TestBindMatchesCaseInsensitiveMimeAndNumericApt(t *testing.T) {
	ctx := &testTrackLocalContext{
		codecs: []webrtc.RTPCodecParameters{
			{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: "VIDEO/H264", ClockRate: 90000}, PayloadType: 105},
			{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: "VIDEO/RTX", ClockRate: 90000, SDPFmtpLine: "apt=105;foo=bar"}, PayloadType: 106},
		},
		ssrc: 1,
	}
	track := NewMultiplexTrack(webrtc.RTPCodecTypeVideo, "video", "multiplex")
	codec, err := track.Bind(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if codec.PayloadType != 105 {
		t.Fatalf("negotiated payload type %d", codec.PayloadType)
	}
	if binding := track.bindings[1]; binding == nil || binding.rtxPayloadType != 106 {
		t.Fatalf("rtx payload type not parsed: %#v", binding)
	}
}

func TestParseApt(t *testing.T) {
	for _, test := range []struct {
		fmtp string
		want int
		ok   bool
	}{
		{"apt=103", 103, true},
		{"APT= 103 ; packetization-mode=1", 103, true},
		{"apt=103;apt=104", 103, true},
		{"apt=abc", 0, false},
		{"fmtp=1", 0, false},
		{"", 0, false},
	} {
		got, ok := parseApt(test.fmtp)
		if got != test.want || ok != test.ok {
			t.Fatalf("parseApt(%q) = (%d, %v), want (%d, %v)", test.fmtp, got, ok, test.want, test.ok)
		}
	}
}

func TestRemapExtensionsSelectsProfileByTargetAndPayload(t *testing.T) {
	from := map[uint8]string{1: "urn:a", 2: "urn:b"}
	var src rtp.Header
	src.Extension = true
	src.ExtensionProfile = rtp.ExtensionProfileOneByte
	if err := src.SetExtension(1, []byte{1, 2}); err != nil {
		t.Fatal(err)
	}
	if err := src.SetExtension(2, []byte{3, 4}); err != nil {
		t.Fatal(err)
	}

	var dst rtp.Header
	remapExtensions(&dst, &src, from, map[string]uint8{"urn:a": 1, "urn:b": 2})
	if !dst.Extension || dst.ExtensionProfile != rtp.ExtensionProfileOneByte {
		t.Fatalf("one-byte profile: extension=%v profile=%#x", dst.Extension, dst.ExtensionProfile)
	}
	if !bytesEqual(dst.GetExtension(1), []byte{1, 2}) || !bytesEqual(dst.GetExtension(2), []byte{3, 4}) {
		t.Fatalf("one-byte extensions: %#v", dst.Extensions)
	}

	remapExtensions(&dst, &src, from, map[string]uint8{"urn:a": 1, "urn:b": 15})
	if !dst.Extension || dst.ExtensionProfile != rtp.ExtensionProfileTwoByte {
		t.Fatalf("two-byte profile: extension=%v profile=%#x", dst.Extension, dst.ExtensionProfile)
	}
	if !bytesEqual(dst.GetExtension(1), []byte{1, 2}) || !bytesEqual(dst.GetExtension(15), []byte{3, 4}) {
		t.Fatalf("two-byte extensions: %#v", dst.Extensions)
	}

	remapExtensions(&dst, &src, from, map[string]uint8{"urn:z": 1})
	if dst.Extension || len(dst.Extensions) != 0 {
		t.Fatalf("unmapped extensions were kept: %#v", dst.Extensions)
	}
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestSubscribedTrackIndexFollowsPublishReplaceAndLeave(t *testing.T) {
	previous := sfu
	sfu = NewSfu()
	defer func() { sfu = previous }()

	publisher := &Peer{id: "pub"}
	sub := &Peer{id: "sub"}
	sfu.AddPeer(publisher)
	sfu.AddPeer(sub)
	if err := sfu.Subscribe(sub, publisher, "video"); err != nil {
		t.Fatal(err)
	}
	if err := sfu.Subscribe(sub, publisher, "audio"); err != nil {
		t.Fatal(err)
	}

	pt := &PublishedTrack{ssrc: 1000, kind: "video", key: subscriptionKey(publisher.id, "video"), publisher: publisher, stop: make(chan struct{})}
	sfu.IndexTrack(pt)
	if got := sub.subscribedTrack(1000); got != pt {
		t.Fatalf("lookup by media ssrc: %#v", got)
	}
	if got := sub.subscribedTrack(1001); got != pt {
		t.Fatalf("lookup by rtx ssrc: %#v", got)
	}

	next := &PublishedTrack{ssrc: 2000, kind: "video", key: pt.key, publisher: publisher, stop: make(chan struct{})}
	sfu.SwapTrack(pt, next)
	pt.close()
	if got := sub.subscribedTrack(1000); got != nil {
		t.Fatalf("a replaced track was found: %#v", got)
	}
	if got := sub.subscribedTrack(2000); got != next {
		t.Fatalf("replacement was not indexed: %#v", got)
	}
	if got := sub.subscribedTrack(2001); got != next {
		t.Fatalf("replacement rtx ssrc was not indexed: %#v", got)
	}

	other := &PublishedTrack{ssrc: 2000, kind: "audio", key: subscriptionKey("other", "audio"), publisher: &Peer{id: "other"}, stop: make(chan struct{})}
	sfu.IndexTrack(other)
	if got := sfu.tracksBySSRC[2000]; got != other {
		t.Fatal("an ssrc collision did not take the newest track")
	}
	sfu.ForgetTrack(other)
	if _, ok := sfu.tracksBySSRC[2000]; ok {
		t.Fatal("forgetting the colliding track left an entry")
	}
	sfu.IndexTrack(next)
	if got := sfu.tracksBySSRC[2000]; got != next {
		t.Fatal("the displaced track was not restored")
	}

	stale := &PublishedTrack{ssrc: 3000, kind: "audio", key: subscriptionKey(publisher.id, "audio"), publisher: publisher, stop: make(chan struct{})}
	sfu.IndexTrack(stale)
	stale.close()
	if got := sub.subscribedTrack(3000); got != nil {
		t.Fatalf("a closed track was found: %#v", got)
	}
	if _, ok := sfu.tracksBySSRC[3000]; ok {
		t.Fatal("a stale index entry survived a lookup")
	}

	sfu.ForgetTrack(next)
	if got := sub.subscribedTrack(2000); got != nil {
		t.Fatalf("a removed track was found: %#v", got)
	}
}

func TestReadRepairStreamHonoursStop(t *testing.T) {
	stop := make(chan struct{})
	close(stop)
	done := make(chan struct{})
	go func() {
		readRepairStream(&Peer{}, nil, stop)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("repair stream did not stop")
	}
}

func BenchmarkSeal(b *testing.B) {
	for _, mode := range []string{modeAES256GCM, modeXChaCha20Poly1305} {
		b.Run(mode, func(b *testing.B) {
			nc, err := newNativeCipher(mode, testKey(5))
			if err != nil {
				b.Fatal(err)
			}
			pkt := &rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: 7, Timestamp: 960, SSRC: 4242}, Payload: []byte{0xfc, 0xff, 0xfe, 1, 2, 3, 4, 5}}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := nc.seal(pkt, nativeOpusPayloadType, uint32(i)); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkOpen(b *testing.B) {
	for _, mode := range []string{modeAES256GCM, modeXChaCha20Poly1305} {
		b.Run(mode, func(b *testing.B) {
			nc, err := newNativeCipher(mode, testKey(6))
			if err != nil {
				b.Fatal(err)
			}
			pkt := &rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: 7, Timestamp: 960, SSRC: 4242}, Payload: []byte{0xfc, 0xff, 0xfe, 1, 2, 3, 4, 5}}
			sealed, err := nc.seal(pkt, nativeOpusPayloadType, 7)
			if err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := nc.open(sealed); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkRemapExtensions(b *testing.B) {
	from := map[uint8]string{1: "urn:a", 2: "urn:b", 3: "urn:c"}
	for _, test := range []struct {
		name string
		to   map[string]uint8
	}{
		{"one-byte", map[string]uint8{"urn:a": 1, "urn:b": 2, "urn:c": 3}},
		{"two-byte", map[string]uint8{"urn:a": 1, "urn:b": 20, "urn:c": 3}},
	} {
		b.Run(test.name, func(b *testing.B) {
			var src rtp.Header
			src.Extension = true
			src.ExtensionProfile = rtp.ExtensionProfileOneByte
			_ = src.SetExtension(1, []byte{1, 2})
			_ = src.SetExtension(2, []byte{3, 4})
			_ = src.SetExtension(3, []byte{5, 6})
			var dst rtp.Header
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				remapExtensions(&dst, &src, from, test.to)
			}
		})
	}
}

func BenchmarkWriteRTP(b *testing.B) {
	track := NewMultiplexTrack(webrtc.RTPCodecTypeVideo, "video", "multiplex")
	for ssrc := 1; ssrc <= 5; ssrc++ {
		ctx := &testTrackLocalContext{
			codecs: []webrtc.RTPCodecParameters{
				{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000}, PayloadType: 103},
				{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeRTX, ClockRate: 90000, SDPFmtpLine: "apt=103"}, PayloadType: 104},
			},
			exts: []webrtc.RTPHeaderExtensionParameter{{URI: "urn:a", ID: 1}, {URI: "urn:b", ID: 2}},
			ssrc: webrtc.SSRC(ssrc),
		}
		if _, err := track.Bind(ctx); err != nil {
			b.Fatal(err)
		}
	}
	from := map[uint8]string{1: "urn:a", 2: "urn:b"}
	pkt := &rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: 1, Timestamp: 960, SSRC: 777}, Payload: make([]byte, 1000)}
	pkt.Extension = true
	pkt.ExtensionProfile = rtp.ExtensionProfileOneByte
	if err := pkt.SetExtension(1, []byte{1, 2}); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := track.WriteRTP(pkt, from); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSubscribedTrack(b *testing.B) {
	previous := sfu
	sfu = NewSfu()
	defer func() { sfu = previous }()
	sub := &Peer{id: "sub"}
	sfu.AddPeer(sub)
	for i := 0; i < 1000; i++ {
		publisher := &Peer{id: fmt.Sprint(i)}
		sfu.AddPeer(publisher)
		key := subscriptionKey(publisher.id, "video")
		if err := sfu.Subscribe(sub, publisher, "video"); err != nil {
			b.Fatal(err)
		}
		sfu.IndexTrack(&PublishedTrack{ssrc: webrtc.SSRC(10000 + i), kind: "video", key: key, publisher: publisher, stop: make(chan struct{})})
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if got := sub.subscribedTrack(uint32(10000 + i%1000)); got == nil {
			b.Fatal("track not found")
		}
	}
}

func BenchmarkRetransmit(b *testing.B) {
	sub := &Peer{id: "sub", rtxSequence: map[uint32]uint16{}, videoLoss: map[uint32]lossReport{}, sinks: map[uint32]*rtcpSink{}}
	master := NewMultiplexTrack(webrtc.RTPCodecTypeVideo, "video", "multiplex")
	ctx := &testTrackLocalContext{
		codecs: []webrtc.RTPCodecParameters{
			{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000}, PayloadType: 103},
			{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeRTX, ClockRate: 90000, SDPFmtpLine: "apt=103"}, PayloadType: 104},
		},
		ssrc: 5,
	}
	if _, err := master.Bind(ctx); err != nil {
		b.Fatal(err)
	}
	sub.masterVideo = master
	sub.masterAudio = NewMultiplexTrack(webrtc.RTPCodecTypeAudio, "audio", "multiplex")

	publisher := &Peer{id: "pub"}
	pt := &PublishedTrack{
		ssrc: 1000, kind: "video", key: subscriptionKey(publisher.id, "video"),
		publisher: publisher, stop: make(chan struct{}), cache: newPacketCache(2048), losses: newLossTracker(),
	}
	for seq := 0; seq < 20; seq++ {
		pt.cache.put(&rtp.Packet{Header: rtp.Header{SequenceNumber: uint16(seq), SSRC: 1000}, Payload: []byte{1, 2, 3}})
	}
	nack := &rtcp.TransportLayerNack{MediaSSRC: 1000, Nacks: []rtcp.NackPair{{PacketID: 1, LostPackets: 0x0006}}}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sub.retransmit(pt, nack)
	}
}

func BenchmarkNativeAddrLookup(b *testing.B) {
	transport := newNativeTransport()
	for i := 0; i < 1000; i++ {
		addr := &net.UDPAddr{IP: net.IPv4(10, 0, byte(i/256), byte(i%256)), Port: 10000 + i}
		transport.byAddr[addr.AddrPort()] = &nativeClient{ssrc: uint32(i)}
	}
	from := &net.UDPAddr{IP: net.IPv4(10, 0, 0, 1), Port: 10001}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if transport.byAddr[from.AddrPort()] == nil {
			b.Fatal("client not found")
		}
	}
}
