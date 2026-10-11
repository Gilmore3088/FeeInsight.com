# Self-hosted application fonts

These are the same Newsreader, JetBrains Mono, and Plus Jakarta Sans families previously loaded by
`next/font/google`. Self-hosting avoids the Next.js 16 production build failure
on Google's extensionless `/l/font?kit=...` responses (Fee Insight issue #1003;
upstream [vercel/next.js#99114](https://github.com/vercel/next.js/issues/99114)).
The SIL Open Font License for each family is included alongside the font files.

Official sources are from [google/fonts](https://github.com/google/fonts):

| Local file | Upstream source | Upstream Git blob |
| --- | --- | --- |
| `newsreader-variable.ttf` | `ofl/newsreader/Newsreader[opsz,wght].ttf` | `ad4a9a8c44ec328c80b61c773f1ba02f6b5ed292` |
| `newsreader-italic-variable.ttf` | `ofl/newsreader/Newsreader-Italic[opsz,wght].ttf` | `d25879656a601d44c49836f9e773d100190c62e1` |
| `jetbrains-mono-variable.ttf` | `ofl/jetbrainsmono/JetBrainsMono[wght].ttf` | `aa310be8b717fe3774f9444dd89d5f4101cc6d10` |
| `plus-jakarta-sans-variable.ttf` | `ofl/plusjakartasans/PlusJakartaSans[wght].ttf` | `0cb13a998ed525ba226d911b10d6c4c4f923a961` |

The Newsreader files pin the `opsz` axis to 16 with FontTools' variable-font
instancer, matching the original `next/font/google` default optical size.
Their weight axis remains variable (200–800); the layout still requests 300–600,
in normal and italic styles. JetBrains Mono is the unchanged upstream variable
font and the layout still requests 300–700. CSS variables and `display: swap`
are preserved. Geist continues to use its existing package fonts.
Plus Jakarta Sans is the unchanged upstream variable font; the subscribe page
still requests 400–700 in normal style with `--font-jakarta` and `display: swap`.

To reproduce the Newsreader transformation from either original source file:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont(source_path)
instantiateVariableFont(font, {"opsz": 16}, inplace=True).save(output_path)
```
