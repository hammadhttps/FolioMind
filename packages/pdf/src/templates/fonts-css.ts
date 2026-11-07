import {
  interRegular,
  interSemiBold,
  serifItalic,
  serifRegular,
  serifSemiBold,
} from "../fonts.generated";

/** Inter and Source Serif 4 as data URIs (Section 26): the renderer fetches nothing. */
export const FONT_FACE_CSS = `
@font-face { font-family: "Inter"; font-weight: 400; src: url("${interRegular}") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 600; src: url("${interSemiBold}") format("woff2"); }
@font-face { font-family: "Source Serif 4"; font-weight: 400; src: url("${serifRegular}") format("woff2"); }
@font-face { font-family: "Source Serif 4"; font-weight: 400; font-style: italic; src: url("${serifItalic}") format("woff2"); }
@font-face { font-family: "Source Serif 4"; font-weight: 600; src: url("${serifSemiBold}") format("woff2"); }
`;
