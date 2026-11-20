# Note to Self

You can message yourself from the account menu at the bottom left of the client. The FosscordNoteToSelf plugin adds a Note to Self item beside Edit Profile. Clicking it opens your note-to-self conversation, creating it on first use and reusing it after that.

A note to self is a normal DM channel whose only recipient is you. The server creates it when the client posts your own user id to `POST /users/@me/channels`, and it reuses an existing one instead of making another. `GET /users/@me/dms/:your_id` returns the same channel, and it appears in `GET /users/@me/channels` with you as its recipient, as it does in the gateway READY payload.

Messages in it use the same end-to-end encryption as other DMs. The content key is wrapped to every active device of yours and to your backup key, so each of your browsers can read the notes after unlocking. Nothing is sent to another account and no admin or server can read it. See [e2ee.md](e2ee.md).
