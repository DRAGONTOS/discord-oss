# Display name fonts

Discord's own display name fonts (ids 0 to 17) always work. The instance can add more of its own. They are listed in
[`client/plugins/fosscordDisplayNameFonts/fonts.json`](../../client/plugins/fosscordDisplayNameFonts/fonts.json), which both the server and the client plugin read, so
the two always agree on which fonts exist.

## Adding a font

1. Put the font file in `assets/public/fonts/`. Keep its license file next to it. Variable fonts work, and so do plain TTF, OTF, WOFF and WOFF2 files.
2. Add an entry to `fonts.json`:

```json
{
    "id": 101,
    "key": "MY_FONT",
    "name": "My Font",
    "family": "My Font",
    "file": "MyFont.woff2",
    "format": "woff2",
    "weight": "100 900",
    "stretch": "75% 125%",
    "style": "font-weight:700;"
}
```

| Field                | Meaning                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                 | Unique integer of 100 or higher. Never reuse an id: it is what users' profiles store.                          |
| `key`                | Upper case name (letters, digits and underscores) for the client's font enum.                                  |
| `name`               | Label in the font picker.                                                                                      |
| `family`             | CSS family name used in the generated `@font-face`.                                                            |
| `file`, `format`     | File name in `assets/public/fonts` and its CSS format (`truetype`, `opentype`, `woff`, `woff2`).               |
| `weight`, `stretch`  | Optional `@font-face` descriptors. Use ranges for variable fonts.                                              |
| `style`              | Optional CSS declarations applied to the name, such as the weight and variation settings the font should use.  |

3. Rebuild the client (`bun run generate:client`) and restart the server. The plugin refuses to start if an entry is invalid, for example a duplicate or low id.

The server rejects `display_name_font_id` values that are neither a Discord font nor listed in `fonts.json`.

## Limits

- Only instance staff can add fonts. Users cannot upload their own.
- The client patches that add the fonts match Discord's minified code and may need updating when the pinned client build changes.
- Removing a font leaves users who picked it with an id the client no longer knows. Change those users' font first.
