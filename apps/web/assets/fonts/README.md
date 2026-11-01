# Bundled fonts

Static TrueType files used where `next/font` is not available, such as `app/opengraph-image.tsx` (`next/og` needs raw font data and the image must not fetch fonts at runtime).

| File                        | Family and weight     | Source       | License                                          |
| --------------------------- | --------------------- | ------------ | ------------------------------------------------ |
| `Inter-Medium.ttf`          | Inter 500             | Google Fonts | SIL Open Font License 1.1 (`Inter-OFL.txt`)        |
| `Inter-Bold.ttf`            | Inter 700             | Google Fonts | SIL Open Font License 1.1 (`Inter-OFL.txt`)        |
| `SourceSerif4-SemiBold.ttf` | Source Serif 4 600    | Google Fonts | SIL Open Font License 1.1 (`SourceSerif4-OFL.txt`) |

The web pages themselves load Inter and Source Serif 4 through `next/font/google` in `app/layout.tsx`.
