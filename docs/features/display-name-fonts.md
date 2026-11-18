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

## From the admin dashboard

Operators can do the same without editing files: Customization > Display name fonts in the admin dashboard takes a font file and a label, derives the id, the enum key, the file name and the CSS format from them, validates the entry with the same rules as the plugin, writes the file to `assets/public/fonts` and appends the entry to `fonts.json`. The page also edits the label and the weight, stretch and style declarations, and removes a font again, which it refuses while any profile still uses it.

The dashboard writes the live files of the instance it runs on, so the API accepts the new font id right away. The font picker lists it only after a rebuild, and for a Docker deployment the file and `fonts.json` have to be committed first: a container's copy of both is replaced when the image is rebuilt, so on Docker the page is a staging and validation step rather than the lasting record. Keep the font's license file next to it in `assets/public/fonts` either way.

## Limits

- Only instance staff can add fonts. Users cannot upload their own.
- The client patches that add the fonts match Discord's minified code and may need updating when the pinned client build changes.
- Removing a font leaves users who picked it with an id the client no longer knows. Change those users' font first.
