import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import fontList from "./fonts.json";
import { classMapReplacement, enumReplacement, fontCss, InstanceFont, listReplacement, validateFonts } from "./registry";
import managedStyle from "./style.css?managed";

const fonts = validateFonts(fontList as InstanceFont[]);
const STYLE_ID = "fosscord-display-name-fonts";

export default definePlugin({
    name: "FosscordDisplayNameFonts",
    description: "Adds the instance's own display name fonts, listed in fonts.json, to the font picker.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
    fontName: (fontId: number) => fonts.find((font) => font.id === fontId)?.name ?? null,
    start() {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = fontCss(fonts);
        document.head.append(style);
    },
    stop() {
        document.getElementById(STYLE_ID)?.remove();
    },
    patches: fonts.length
        ? [
              {
                  find: '.HEXAGON=17]="HEXAGON"',
                  all: true,
                  replacement: {
                      match: /(\i)\[\1\.HEXAGON=17\]="HEXAGON",/,
                      replace: enumReplacement(fonts),
                  },
              },
              {
                  find: /\[\i\.\i\.PLAYPEN_SANS,\i\.\i\.ORBITRON,\i\.\i\.NEW_ROCKER,\i\.\i\.KALAM\]/,
                  replacement: {
                      match: /(\[\i\.\i\.PLAYPEN_SANS,\i\.\i\.ORBITRON,\i\.\i\.NEW_ROCKER,\i\.\i\.KALAM)\]/,
                      replace: listReplacement(fonts),
                  },
              },
              {
                  find: /\[\i\.\i\.KALAM\]:\i\.\i(?:,\[\i\.\i\.\w+\]:\i\.\i)*\};function \i\(\i\)\{return\{name:/,
                  all: true,
                  replacement: [
                      {
                          match: /(\[\i\.\i\.KALAM\]:\i\.\i(?:,\[\i\.\i\.\w+\]:\i\.\i)*)\}/,
                          replace: classMapReplacement(fonts),
                      },
                  ],
              },
              {
                  find: '"--custom-dns-tile-columns"',
                  replacement: {
                      match: /(\i)=>\{let (\i)=(\(0,\i\.\i\)\(\1\)),([^;]{0,80}?)(\i)=(\i\.intl\.string\(\2\.name\))/,
                      replace: "$1=>{let $2=$3,$4$5=$self.fontName($1)??$6",
                  },
              },
          ]
        : [],
});
