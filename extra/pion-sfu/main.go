package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/logging"
	"github.com/pion/sdp/v3"
	"github.com/pion/transport/v4/stdnet"
	"github.com/pion/webrtc/v4"
)

var (
	sfu       = NewSfu()
	webrtcAPI *webrtc.API

	// IPC
	ipcConn *IpcConnection
)

type h264Profile struct {
	profileID      string
	payloadType    webrtc.PayloadType
	rtxPayloadType webrtc.PayloadType
}

var h264Profiles = []h264Profile{
	{"42e01f", 103, 104},
	{"4d0028", 105, 106},
	{"640028", 107, 108},
	{"64001f", 109, 110},
	{"42e028", 112, 113},
	{"4d0033", 114, 115},
	{"640033", 116, 117},
	{"42e033", 118, 119},
}

func h264CodecParameters() []webrtc.RTPCodecParameters {
	var codecs []webrtc.RTPCodecParameters
	for _, profile := range h264Profiles {
		codecs = append(codecs, webrtc.RTPCodecParameters{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType:    webrtc.MimeTypeH264,
				ClockRate:   90000,
				SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=" + profile.profileID + ";x-google-max-bitrate=2500",
			},
			PayloadType: profile.payloadType,
		}, webrtc.RTPCodecParameters{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType:    webrtc.MimeTypeRTX,
				ClockRate:   90000,
				SDPFmtpLine: "apt=" + strconv.Itoa(int(profile.payloadType)),
			},
			PayloadType: profile.rtxPayloadType,
		})
	}
	return codecs
}

// mediaEngine: only Opus + H264
func createMediaEngine() (*webrtc.MediaEngine, error) {
	m := &webrtc.MediaEngine{}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeOpus,
			ClockRate:   48000,
			Channels:    2,
			SDPFmtpLine: "minptime=10;usedtx=1;useinbandfec=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}

	for _, codec := range h264CodecParameters() {
		if err := m.RegisterCodec(codec, webrtc.RTPCodecTypeVideo); err != nil {
			return nil, err
		}
	}

	if err := m.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: sdp.AudioLevelURI}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}
	for _, uri := range []string{sdp.ABSSendTimeURI, "urn:ietf:params:rtp-hdrext:toffset", "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay", "urn:3gpp:video-orientation"} {
		if err := m.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: uri}, webrtc.RTPCodecTypeVideo); err != nil {
			return nil, err
		}
	}
	m.RegisterFeedback(webrtc.RTCPFeedback{Type: webrtc.TypeRTCPFBNACK}, webrtc.RTPCodecTypeVideo)
	m.RegisterFeedback(webrtc.RTCPFeedback{Type: webrtc.TypeRTCPFBNACK, Parameter: "pli"}, webrtc.RTPCodecTypeVideo)
	m.RegisterFeedback(webrtc.RTCPFeedback{Type: webrtc.TypeRTCPFBCCM, Parameter: "fir"}, webrtc.RTPCodecTypeVideo)
	m.RegisterFeedback(webrtc.RTCPFeedback{Type: webrtc.TypeRTCPFBGoogREMB}, webrtc.RTPCodecTypeVideo)
	m.RegisterFeedback(webrtc.RTCPFeedback{Type: webrtc.TypeRTCPFBNACK}, webrtc.RTPCodecTypeAudio)

	return m, nil
}

// handle "join": intermediary signals a new client has connected.
// creates a peer connection for that clientId
func handleJoin(clientID string) error {
	if sfu.GetPeer(clientID) != nil {
		return fmt.Errorf("client %s already joined", clientID)
	}

	pc, err := webrtcAPI.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return fmt.Errorf("NewPeerConnection: %w", err)
	}

	// create the single downstream tracks for Audio and Video multiplexing
	masterAudio := NewMultiplexTrack(webrtc.RTPCodecTypeAudio, "audio", "multiplex")
	masterVideo := NewMultiplexTrack(webrtc.RTPCodecTypeVideo, "video", "multiplex")

	// add them to the peer connection immediately so they are included in the initial Offer/Answer
	audioSender, err := pc.AddTrack(masterAudio)
	if err != nil {
		return fmt.Errorf("AddTrack audio: %w", err)
	}
	videoSender, err := pc.AddTrack(masterVideo)
	if err != nil {
		return fmt.Errorf("AddTrack video: %w", err)
	}
	go drainRTCP(audioSender)
	go drainRTCP(videoSender)

	p := &Peer{
		id:          clientID,
		pc:          pc,
		transport:   videoSender.Transport(),
		masterAudio: masterAudio,
		masterVideo: masterVideo,
		sinks:       make(map[uint32]*rtcpSink),
		rtxSequence: make(map[uint32]uint16),
		videoLoss:   make(map[uint32]lossReport),
	}

	sfu.AddPeer(p)
	setupOnTrack(p)

	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("Client %s ICE state: %s", p.id, state.String())
	})

	conn := ipcConn
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("Client %s peer connection state: %s", p.id, state.String())
		switch state {
		case webrtc.PeerConnectionStateConnected:
			remote := selectedRemote(p)
			log.Printf("Client %s media from %s", p.id, remote)
			// Notify the signaling server that this client's WebRTC session is fully established.
			sendErr := conn.sendReply("", SignalMessage{
				Type:     "connected",
				ClientID: p.id,
				Remote:   remote,
			}, "")
			if sendErr != nil {
				log.Printf("Failed to send 'connected' event for %s: %v", p.id, sendErr)
			}
		case webrtc.PeerConnectionStateDisconnected, webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			if p.disconnectEventSent.CompareAndSwap(false, true) {
				p.mu.Lock()
				roomID, userID := p.roomID, p.userID
				p.mu.Unlock()
				sendErr := conn.sendReply("", SignalMessage{
					Type:     "disconnected",
					ClientID: p.id,
					RoomID:   roomID,
					UserID:   userID,
				}, "")
				if sendErr != nil {
					log.Printf("Failed to send 'disconnected' event for %s: %v", p.id, sendErr)
				}
			}
		}
	})

	log.Printf("Client %s joined", clientID)
	return nil
}

func drainRTCP(sender *webrtc.RTPSender) {
	for {
		if _, _, err := sender.ReadRTCP(); err != nil {
			return
		}
	}
}

// handle "leave": intermediary signals a client has disconnected
func handleLeave(clientID string) error {
	p := sfu.GetPeer(clientID)
	if p == nil {
		return fmt.Errorf("client %s not found", clientID)
	}
	cleanupPeer(p)
	return nil
}

// handle the initial offer from a client
const iceGatherTimeout = 10 * time.Second

func waitForGathering(ctx context.Context, complete <-chan struct{}) error {
	select {
	case <-complete:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("ICE gathering: %w", ctx.Err())
	}
}

func externalPublishDirections(rawSDP string) (audio, video bool) {
	var session sdp.SessionDescription
	if err := session.Unmarshal([]byte(rawSDP)); err != nil {
		log.Printf("external offer SDP parse failed: %v", err)
		return false, false
	}
	for _, media := range session.MediaDescriptions {
		published := false
		for _, attr := range media.Attributes {
			if strings.EqualFold(attr.Key, "sendonly") || strings.EqualFold(attr.Key, "sendrecv") {
				published = true
				break
			}
		}
		if !published {
			continue
		}
		switch strings.ToLower(media.MediaName.Media) {
		case "audio":
			audio = true
		case "video":
			video = true
		}
	}
	return audio, video
}

func handleOffer(ctx context.Context, p *Peer, msg SignalMessage, requestID string) error {
	if msg.SDP == "" {
		return fmt.Errorf("offer message missing SDP")
	}

	if msg.External {
		audio, video := externalPublishDirections(msg.SDP)
		p.mu.Lock()
		p.external = true
		p.roomID = msg.RoomID
		p.userID = msg.UserID
		if audio {
			p.isAudioPublished = true
		}
		if video {
			p.isVideoPublished = true
		}
		p.mu.Unlock()
	}

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  msg.SDP,
	}

	if err := p.pc.SetRemoteDescription(offer); err != nil {
		return fmt.Errorf("SetRemoteDescription: %w", err)
	}

	answer, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return fmt.Errorf("CreateAnswer: %w", err)
	}
	// Install the completion callback before gathering can start.
	gatherComplete := webrtc.GatheringCompletePromise(p.pc)
	if err = p.pc.SetLocalDescription(answer); err != nil {
		return fmt.Errorf("SetLocalDescription: %w", err)
	}

	gatherCtx, cancel := context.WithTimeout(ctx, iceGatherTimeout)
	defer cancel()
	if err := waitForGathering(gatherCtx, gatherComplete); err != nil {
		return err
	}

	answerSDP := p.pc.LocalDescription().SDP
	if msg.External {
		answerSDP = addSpropParameterSets(answerSDP)
	}

	return ipcConn.sendReply(requestID, SignalMessage{
		Type:     "answer",
		ClientID: p.id,
		SDP:      answerSDP,
	}, "")
}

// handle "publish": client wants to start publishing a track
func handlePublish(p *Peer, msg SignalMessage) error {
	trackType := msg.TrackType
	if trackType != "audio" && trackType != "video" {
		return fmt.Errorf("invalid trackType: %s", trackType)
	}

	p.mu.Lock()
	if trackType == "audio" {
		p.isAudioPublished = true
	} else {
		p.isVideoPublished = true
		p.maxBitrate = int(msg.MaxBitrate)
	}
	external := p.external
	existing := p.getPublishedTrack(trackType)
	p.mu.Unlock()
	if external {
		return nil
	}
	if client := p.native.Load(); client != nil {
		if trackType == "video" {
			return client.publishVideo(msg.SSRC, msg.RtxSSRC)
		}
		return nil
	}
	if existing != nil {
		return fmt.Errorf("already publishing %s", trackType)
	}

	var codecType webrtc.RTPCodecType
	if trackType == "audio" {
		codecType = webrtc.RTPCodecTypeAudio
	} else {
		codecType = webrtc.RTPCodecTypeVideo
	}

	_, err := p.pc.AddTransceiverFromKind(codecType, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	})
	if err != nil {
		return fmt.Errorf("AddTransceiverFromKind: %w", err)
	}

	return nil
}

// handle "stop-publish": client wants to stop publishing a track
func handleStopPublish(p *Peer, msg SignalMessage) error {
	trackType := msg.TrackType
	if trackType != "audio" && trackType != "video" {
		return fmt.Errorf("invalid trackType: %s", trackType)
	}

	p.mu.Lock()
	if trackType == "audio" {
		p.isAudioPublished = false
	} else {
		p.isVideoPublished = false
	}

	pt := p.getPublishedTrack(trackType)
	if pt == nil {
		p.mu.Unlock()
		return fmt.Errorf("not publishing %s", trackType)
	}

	// don't remove the track from the peer, just stop sending packets
	//close(pt.stop)
	//p.setPublishedTrack(trackType, nil)

	p.mu.Unlock()

	// remove subscriptions from all other peers subscribing to this track
	// sfu.mu.RLock()
	// for _, other := range sfu.peers {
	// 	if other.id == p.id {
	// 		continue
	// 	}
	// 	subKey := p.id + "_" + trackType
	// 	other.mu.Lock()
	// 	delete(other.subscriptions, subKey)
	// 	other.mu.Unlock()
	// }
	// sfu.mu.RUnlock()

	return nil
}

// handle "subscribe": client wants to receive a specific publisher's track
func handleSubscribe(p *Peer, msg SignalMessage, requestID string) error {
	trackType := msg.TrackType
	publisherID := msg.PublisherID
	if trackType != "audio" && trackType != "video" {
		return fmt.Errorf("invalid trackType: %s", trackType)
	}
	if publisherID == "" {
		return fmt.Errorf("missing publisherId")
	}

	publisher := sfu.GetPeer(publisherID)
	if publisher == nil {
		return fmt.Errorf("publisher %s not found", publisherID)
	}

	if err := sfu.Subscribe(p, publisher, trackType); err != nil {
		return err
	}

	publisher.mu.Lock()
	pt := publisher.getPublishedTrack(trackType)
	publisher.mu.Unlock()

	var ssrc uint32
	if pt != nil {
		ssrc = uint32(pt.ssrc)
		log.Printf("%s Subscribed to track ssrc %d", p.id, pt.ssrc)
		p.ensureSinks(pt)
		pt.requestKeyframe()
	} else {
		log.Printf("%s Subscribed to %s of %s before its first packet", p.id, trackType, publisherID)
	}

	return ipcConn.sendReply(requestID, SignalMessage{
		Type:        "subscribed",
		ClientID:    p.id,
		PublisherID: publisherID,
		TrackType:   trackType,
		SSRC:        ssrc,
	}, "")
}

// handle "unsubscribe": client wants to stop receiving a publisher's track
func handleUnsubscribe(p *Peer, msg SignalMessage) error {
	trackType := msg.TrackType
	publisherID := msg.PublisherID
	if trackType != "audio" && trackType != "video" {
		return fmt.Errorf("invalid trackType: %s", trackType)
	}
	if publisherID == "" {
		return fmt.Errorf("missing publisherId")
	}

	if err := sfu.Unsubscribe(p, subscriptionKey(publisherID, trackType)); err != nil {
		return err
	}
	if publisher := sfu.GetPeer(publisherID); publisher != nil {
		p.dropSinks(publisher)
	}
	return nil
}

func setupOnTrack(p *Peer) {
	p.pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		var trackType string
		mime := remoteTrack.Codec().MimeType
		switch {
		case remoteTrack.Kind() == webrtc.RTPCodecTypeAudio && strings.EqualFold(mime, webrtc.MimeTypeOpus):
			trackType = "audio"
		case remoteTrack.Kind() == webrtc.RTPCodecTypeVideo && strings.EqualFold(mime, webrtc.MimeTypeH264):
			trackType = "video"
		case remoteTrack.Kind() == webrtc.RTPCodecTypeVideo && strings.EqualFold(mime, webrtc.MimeTypeRTX):
			log.Printf("Client %s started sending retransmissions (SSRC: %d)", p.id, remoteTrack.SSRC())
			go readRepairStream(p, remoteTrack, p.repairStopChannel())
			return
		default:
			log.Printf("Client %s started publishing unknown track type %s", p.id, mime)
			return
		}

		ssrc := webrtc.SSRC(remoteTrack.SSRC())
		extensions := make(map[uint8]string)
		for _, e := range receiver.GetParameters().HeaderExtensions {
			extensions[uint8(e.ID)] = e.URI
		}
		cacheSize := 512
		if trackType == "video" {
			cacheSize = 2048
		}

		p.mu.Lock()
		requestedBitrateCap := p.maxBitrate
		p.mu.Unlock()
		pt := &PublishedTrack{
			ssrc:                ssrc,
			kind:                trackType,
			key:                 subscriptionKey(p.id, trackType),
			publisher:           p,
			extensions:          extensions,
			stop:                make(chan struct{}),
			receiver:            receiver,
			cache:               newPacketCache(cacheSize),
			losses:              newLossTracker(),
			requestedBitrateCap: requestedBitrateCap,
		}

		p.mu.Lock()
		previous := p.getPublishedTrack(trackType)
		p.setPublishedTrack(trackType, pt)
		p.mu.Unlock()
		sfu.SwapTrack(previous, pt)
		if previous != nil {
			previous.close()
		}

		log.Printf("Client %s started publishing %s (SSRC: %d)", p.id, trackType, ssrc)

		for _, other := range sfu.Subscribers(pt.key) {
			other.ensureSinks(pt)
		}

		pt.requestKeyframe()
		go pt.requestRetransmissions()

		go func() {
			for {
				select {
				case <-pt.stop:
					return
				default:
				}

				rtpPkt, _, readErr := remoteTrack.ReadRTP()
				if readErr != nil {
					log.Printf("Track read error for %s/%s: %v", p.id, trackType, readErr)
					pt.close()
					return
				}
				rtpPkt.SSRC = uint32(ssrc)
				pt.ingest(rtpPkt)
			}
		}()
	})
}

// ---------------------------------------------------------------------------
// Cleanup when a peer disconnects.
// ---------------------------------------------------------------------------

func cleanupPeer(p *Peer) {
	subscribers := sfu.SubscribersOf(p.id)
	sfu.RemovePeer(p.id)
	p.leaveNative()

	var stale []*PublishedTrack
	p.mu.Lock()
	if p.audioPublished != nil {
		stale = append(stale, p.audioPublished)
		p.audioPublished = nil
		p.isAudioPublished = false
	}
	if p.videoPublished != nil {
		stale = append(stale, p.videoPublished)
		p.videoPublished = nil
		p.isVideoPublished = false
	}
	p.mu.Unlock()
	for _, pt := range stale {
		pt.close()
		sfu.ForgetTrack(pt)
	}
	p.dropSinks(nil)
	p.closeRepairStop()

	for _, other := range subscribers {
		other.dropSinks(p)
	}

	if p.pc != nil {
		p.pc.Close()
	}
	log.Printf("Client %s disconnected", p.id)
}

func main() {
	// parse command line args
	webrtcPort := flag.Int("port", 5000, "WebRTC UDP port")
	webrtcPublicIp := flag.String("ip", "[IP_ADDRESS]", "WebRTC public IPv4 address, or a host name that resolves to one")
	webrtcLanIp := flag.String("lan-ip", "", "Optional WebRTC IPv4 address to advertise for clients on the local network")
	ipcPath := flag.String("ipc", "/tmp/sfu-ipc.sock", "IPC unix socket path")
	verbose := flag.Bool("verbose", false, "Enable pion debug logging")
	flag.Float64Var(&incomingDropPercent, "drop-in", 0, "Percentage of publisher RTP packets to drop on arrival, for testing loss recovery")
	flag.Float64Var(&outgoingDropPercent, "drop-out", 0, "Percentage of RTP packets to drop on the way to subscribers, for testing loss recovery")

	// Parse the flags from the command line
	flag.Parse()

	if *webrtcPublicIp == "[IP_ADDRESS]" {
		log.Fatalf("WebRTC public IP is required. Use -ip <ip_address> -port <port>")
	}
	publicIP, err := resolvePublicIP(*webrtcPublicIp)
	if err != nil {
		log.Fatalf("resolve WebRTC public IP %q: %v", *webrtcPublicIp, err)
	}

	// media engine with only Opus + H264
	mediaEngine, err := createMediaEngine()
	if err != nil {
		log.Fatalf("createMediaEngine: %v", err)
	}

	// setting engine: ICE-lite + single UDP port
	settingEngine := webrtc.SettingEngine{}
	settingEngine.SetLite(true)

	// restrict to UDP4 to improve compatibility with Firefox's strict ICE parser
	settingEngine.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})

	// advertise the public IP so the SDP works behind NAT. With a LAN IP configured,
	// append both addresses so local encoders can use the private route instead of hairpin NAT.
	if *webrtcLanIp == "" {
		settingEngine.SetICEAddressRewriteRules(webrtc.ICEAddressRewriteRule{
			External:        []string{publicIP},
			AsCandidateType: webrtc.ICECandidateTypeHost,
			Mode:            webrtc.ICEAddressRewriteReplace,
		})
	} else {
		lanIP, err := resolvePublicIP(*webrtcLanIp)
		if err != nil {
			log.Fatalf("resolve WebRTC LAN IP %q: %v", *webrtcLanIp, err)
		}
		settingEngine.SetICEAddressRewriteRules(webrtc.ICEAddressRewriteRule{
			External:        []string{publicIP, lanIP},
			AsCandidateType: webrtc.ICECandidateTypeHost,
			Mode:            webrtc.ICEAddressRewriteAppend,
		})
		log.Printf("WebRTC LAN IP: %s", lanIP)
	}

	logFactory := logging.NewDefaultLoggerFactory()
	logFactory.DefaultLogLevel = logging.LogLevelWarn
	if *verbose {
		logFactory.DefaultLogLevel = logging.LogLevelDebug
	}
	settingEngine.LoggerFactory = logFactory

	// Listen on 0.0.0.0 (all interfaces) to avoid binding to each local IP individually.
	// NewMultiUDPMuxFromPort binds to every (interface, IP) pair separately, which fails
	// when the same IP appears on multiple interfaces (Docker bridge networks for exemple).
	udpConn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: *webrtcPort})
	if err != nil {
		log.Fatalf("ListenUDP: %v", err)
	}
	var conn net.PacketConn = udpConn
	if incomingDropPercent > 0 || outgoingDropPercent > 0 {
		conn = &lossyConn{PacketConn: udpConn}
	}
	conn = native.attach(conn)

	netTransport, err := stdnet.NewNet()
	if err != nil {
		log.Fatalf("stdnet.NewNet: %v", err)
	}

	mux := ice.NewUDPMuxDefault(ice.UDPMuxParams{
		UDPConn: conn,
		Net:     netTransport,
		Logger:  logFactory.NewLogger("ice"),
	})
	settingEngine.SetICEUDPMux(mux)
	log.Printf("WebRTC Public IP: %s", publicIP)
	log.Printf("WebRTC UDP port: %d", *webrtcPort)

	// Create an InterceptorRegistry. This is the user configurable RTP/RTCP Pipeline.
	// This provides NACKs, RTCP Reports and other features. If you use `webrtc.NewPeerConnection`
	// this is enabled by default. If you are manually managing You MUST create a InterceptorRegistry
	// for each PeerConnection.
	interceptorRegistry := &interceptor.Registry{}

	// Register a intervalpli factory
	// This interceptor sends a PLI every 5 seconds. A PLI causes a video keyframe to be generated by the sender.
	// This makes our video seekable and more error resilent, but at a cost of lower picture quality and higher bitrates
	// A real world application should process incoming RTCP packets from viewers and forward them to senders
	//intervalPliFactory, err := intervalpli.NewReceiverInterceptor(intervalpli.GeneratorInterval(1 * time.Second))

	// if err != nil {
	// 	panic(err)
	// }
	// interceptorRegistry.Add(intervalPliFactory)

	// Use the default set of Interceptors
	//if err = webrtc.RegisterDefaultInterceptors(mediaEngine, interceptorRegistry); err != nil {
	//	panic(err)
	//}

	if err = webrtc.ConfigureTWCCHeaderExtensionSender(mediaEngine, interceptorRegistry); err != nil {
		panic(err)
	}

	if err = webrtc.ConfigureTWCCSender(mediaEngine, interceptorRegistry); err != nil {
		panic(err)
	}

	if err = webrtc.ConfigureRTCPReports(interceptorRegistry); err != nil {
		panic(err)
	}

	webrtcAPI = webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithSettingEngine(settingEngine),
		webrtc.WithInterceptorRegistry(interceptorRegistry),
	)

	ipcConn = &IpcConnection{conn: nil}
	go bandwidthLoop()
	if incomingDropPercent > 0 || outgoingDropPercent > 0 {
		log.Printf("Simulating packet loss: %.1f%% incoming, %.1f%% outgoing", incomingDropPercent, outgoingDropPercent)
	}

	listener, err := getListener(*ipcPath)
	if err != nil {
		log.Fatalf("failed to start IPC listener: %v", err)
	}
	defer listener.Close()

	// graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Println("shutting down...")
		listener.Close()
		if runtime.GOOS != "windows" {
			os.Remove(*ipcPath)
		}
		os.Exit(0)
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("accept error: %v", err)
			continue
		}

		ipcConn.mu.Lock()
		if ipcConn.conn != nil {
			ipcConn.mu.Unlock()
			log.Printf("rejecting second IPC connection — only one allowed")
			conn.Close()
			continue
		}
		ipcConn.conn = conn
		ipcConn.mu.Unlock()

		log.Printf("Node.js client connected successfully")

		go func() {
			ipcConn.handleConnection()

			log.Println("Node.js client disconnected")

			// clean up all peers when the nodejs client disconnects: they belong to the process that went away.
			// This happens before a new connection is accepted, or the next process's first peers (people
			// reconnecting right after a restart) would be cleaned up along with the old ones
			for _, p := range sfu.PeerSnapshot() {
				if sfu.GetPeer(p.id) == p {
					cleanupPeer(p)
				}
			}

			// now a new connection can be accepted
			ipcConn.mu.Lock()
			ipcConn.conn = nil
			ipcConn.mu.Unlock()
		}()
	}
}
