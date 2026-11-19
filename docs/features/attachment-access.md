# Attachment access

Every server can decide whether links to its attachment files keep working outside the instance. The setting is off by default, which is Discord's behavior: anyone who has an attachment link, member or not, can open the file. Turning the setting on makes each attachment link work only for the server's members, so copies pasted outside the instance stop resolving. This is for private servers whose uploads shouldn't leak through shared links.

## The toggle

The toggle sits in Server Settings > Access under the People category, above the join-type cards and the Apply to Join form. FosscordAttachmentAccess in `client/plugins/fosscordAttachmentAccess` adds it; the plugin reads the current state with `GET /guilds/:id` and saves it with `PATCH /guilds/:id`, so only members with `MANAGE_GUILD` can change it. The change lands in the audit log like the other guild settings.

The state is the `restrict_attachments` column on the guild, added by migration `1794470000000` for Postgres and SQLite. It defaults to false, ships in READY guilds, guild fetches and `GUILD_UPDATE` events, and changing it takes effect immediately, no restart needed.

## What it does

When the setting is on, `GET /attachments/:channel/:attachment/:filename` on the CDN authorizes a request for a file in a channel of that server only when one of these holds, whether or not `security.cdnSignUrls` is on:

- The URL carries a valid signature (`ex`, `is`, `hm`), which the client's image and file loads already do, because the message routes sign attachment URLs per requester with the requester's IP and user agent. A link copied to another machine or browser carries a signature for someone else, so it fails, and after `security.cdnSignatureDuration` (24 hours by default) it fails for everyone.
- The request carries a token of a member of that server. This covers API-level reads such as the lightbox and scripts.
- The request carries the internal server signature header, so server-side fetches like link unfurls keep working.

Everything else gets 404, the same "This content is no longer available." body an expired link gets. The lookup resolves the file's channel to its server with two indexed queries and no caching, so toggling the setting is instant. DMs and group DMs are never affected; the setting has no meaning outside servers.

`POST /attachments/refresh-urls` follows the same rule: a requester who isn't a member of a restricted server gets their URLs back unchanged, and the CDN rejects them as usual.

## Signing everywhere

Members' browsers load images through `<img>` tags, which carry no token, so restricted servers lean on signed URLs. That made signing coverage matter: pins, pinned message lists, single message fetches, message edits, poll expiry responses, crossposts, thread preload data, preload messages and message search responses returned unsigned attachment URLs. With `security.cdnSignUrls` off those URLs answered fine, so the gap was invisible until now; with `security.cdnSignUrls` on those same surfaces were broken for everyone. All of them sign per request now through `Message.prototype.withSignedAttachments`, using the new `requestSignatureData` helper in `src/util/Signing.ts`, so they behave the same as the main message list.

## Tests

`scripts/dev/cdn-storage.test.cjs` covers the CDN authorization branches. The restricted-server behavior was tried live: with the setting off an anonymous GET answers 200, with it on an anonymous request and a signed-in non-member get 404 while a member's token and the member's own signed URL keep working.
