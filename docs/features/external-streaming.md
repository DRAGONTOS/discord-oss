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
