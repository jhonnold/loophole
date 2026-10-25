// The design kit's fonts in full (DECISIONS, "Self-hosted fonts"), with the Japanese glyph ranges.
// The root layout imports this after the first paint, since these stylesheets are about 700 KB of
// @font-face rules; the Latin subsets the root layout imports itself block the first paint (PRD §10).
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "@fontsource/zen-maru-gothic/700.css";
import "@fontsource/zen-maru-gothic/900.css";
