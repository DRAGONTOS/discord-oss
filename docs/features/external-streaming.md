# External streaming

Users can stream into a voice channel from an external encoder such as OBS. The encoder speaks WHIP to the instance, and the instance forwards the media into the voice channel over the same path a normal client uses.

## Stream keys

A stream key is a secret that belongs to one account and one voice channel. The keys are not the `guild:<id>` strings the gateway uses for normal streams, which are public identifiers and are not secrets.

The management endpoints live under `/api/v9/users/@me/stream-key` and require a user token:

- `GET` returns `{ has_key, created_at, last_used_at, guild_id, channel_id, expires_at }`. The timestamps are ISO strings, and any field is `null` when no key exists. The response never includes the key or its hash.
- `POST` takes `{ guild_id, channel_id }` and creates a key. It returns `{ key, created_at, guild_id, channel_id, expires_at }`. The plaintext key is returned only on this response.
- `DELETE` revokes the key and returns 204.

Creating a key replaces any key the same account already had. A key is 32 random bytes encoded as base64url and expires seven days after it is created. The database stores only the SHA-256 hash of the key, in base64url form, with a unique index. The plaintext is not stored and cannot be recovered from the management API, so a lost key has to be replaced with a new one.

## Client flow

The client shows the current key state with `GET`, generates a key with `POST` when the user chooses a voice channel, and shows the returned plaintext once for the user to copy into OBS. The WHIP ingest route hashes the key the encoder sends, looks up the matching hash, checks the expiry, records `last_used_at`, and resolves the owning user, guild and channel. The encoder keeps using the same key for the life of the stream. `DELETE` stops new WHIP sessions from using the key.

## Encoders on the local network

The SFU normally replaces its ICE candidates with `WRTC_PUBLIC_IP`. An encoder on the same LAN as that public address then has to hairpin through the router, which many home routers do not support, and the WHIP connection fails with a PeerConnection state of `Failed`.

Set `WRTC_LAN_IP` in `.env` to the host's LAN IPv4 address (for example `192.168.178.10`). The SFU then advertises both the public and the LAN address as extra host candidates and keeps its own candidates. Local encoders use the LAN route, remote viewers use the public one. Leave `WRTC_LAN_IP` empty when no encoder runs on the LAN.

## Discovery and playback

On connect, the WHIP handler creates a `Stream` row for the encoder's voice channel, sets `self_stream` on the user's voice state and broadcasts the `VOICE_STATE_UPDATE` to the channel. Other members learn the stream exists from that flag and construct the stream key from the channel and user ids. A viewer sends `STREAM_WATCH` and receives a `STREAM_CREATE` and `STREAM_SERVER_UPDATE` with its own token, then joins the same SFU room and subscribes to the external publisher's tracks. The handler deliberately does not send a `STREAM_SERVER_UPDATE` to the encoder's own client, because that would make it open a stream voice connection it cannot authenticate.

On disconnect, delete or failed connect, the handler emits `STREAM_DELETE` addressed to the channel, removes the `Stream` row and clears `self_stream`, so the tile disappears for everyone.

The stream tile has no self-preview image. Discord uploads the preview thumbnail from the publishing client through `POST /streams/:key/preview`, and an external encoder never does that. Viewers can watch the live stream, but the thumbnail stays blank.

## H.264 parameter sets

Some encoders send IDR slices without SPS and PPS NAL units before them. Browsers cannot initialise their H.264 decoder without those parameter sets, so the stream shows audio and a black video area.

For publishers marked external, the SFU captures the SPS and PPS NAL units from the incoming stream, whether they arrive as single NALs or in a STAP-A aggregation, and replays them in a STAP-A packet immediately before each IDR start, which it detects from a single NAL of type 5 or a FU-A start with inner type 5. The replayed packet carries the IDR's timestamp and SSRC, and the marker bit is clear. Nothing is hardcoded: the headers always match the encoder that is actually running.

This means the encoder must emit SPS and PPS in its RTP stream at least once. x264 does this in every keyframe and works, as does VAAPI H.264 on AMD hardware. OBS's OpenH264 output on Linux is known to emit only slices and IDRs with no parameter sets, which leaves the browser with a black video area and makes the SFU log report `no SPS/PPS seen`. If an encoder has that problem, install `obs-studio-plugin-x264` on Fedora and select Software (x264). HEVC and AV1 are not supported, because the SFU registers only Opus and H.264.

Because the replay adds one RTP packet to the stream, the SFU advances the sequence number of the IDR and every later forwarded packet by one. The publisher's own sequence numbers are unchanged, so loss tracking and NACKs to the publisher still use the original values. Retransmissions to viewers translate back to the original sequence for the cache lookup and forward with the shifted number. Publishers that are not external keep their sequence numbers untouched.
