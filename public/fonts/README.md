# Self-hosted fonts

These files are served from our own origin instead of `fonts.googleapis.com`,
so the first paint does not wait on a third-party DNS + TLS round trip and no
request leaves our servers — which is also what the privacy notice promises.

| File                               | Font             | Subset    |
| ---------------------------------- | ---------------- | --------- |
| `dm-sans-latin.woff2`              | DM Sans          | latin     |
| `dm-sans-latin-ext.woff2`          | DM Sans          | latin-ext |
| `playfair-display-latin.woff2`     | Playfair Display | latin     |
| `playfair-display-latin-ext.woff2` | Playfair Display | latin-ext |

Both are **variable** fonts covering weight 400–700, so a single file per
subset serves every weight the design uses. They are wired up in
`src/styles.css` with `@font-face` rules that keep Google's original
`unicode-range` values, so a browser only downloads the latin-ext file when the
page actually uses a character from that range.

## Licence

Both fonts are licensed under the **SIL Open Font License 1.1**, which permits
self-hosting and redistribution — including bundled with software — provided
the copyright notice and the licence travel with the files. That is why the two
`OFL-*.txt` files sit beside the fonts, and clause 2 explicitly allows this to
be satisfied by stand-alone text files like these.

- **DM Sans** — `OFL-DM-Sans.txt`
  Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts)
- **Playfair Display** — `OFL-Playfair-Display.txt`
  Copyright 2017 The Playfair Display Project Authors
  (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display"

Playfair's licence reserves the name "Playfair Display". We only redistribute
the font unmodified, which the OFL permits; if anyone ever edits or subsets
these files further, the reserved name must not be reused on the result
(clause 3 of the licence).

Both licence texts were taken verbatim from the canonical Google Fonts
repository (`google/fonts`, paths `ofl/dmsans/OFL.txt` and
`ofl/playfairdisplay/OFL.txt`), matching the builds served from this directory.

**Do not delete these files.** Removing the notice while continuing to serve
the fonts is the exact thing the OFL conditions prohibit. If a font is ever
dropped from the design, its licence file may be removed with it.
