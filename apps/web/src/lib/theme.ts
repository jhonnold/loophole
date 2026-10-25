import type { KeyValueStorage } from "./game/progress.ts";

/** The user's theme override (FR-16). "system" follows `prefers-color-scheme`. */
export type ThemeChoice = "light" | "dark" | "system";

/** Also read by the inline script in app.html, which applies the theme before first paint. */
export const THEME_KEY = "loophole:theme";

export function readThemeChoice(storage: KeyValueStorage | null): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function saveThemeChoice(storage: KeyValueStorage | null, choice: ThemeChoice): void {
  try {
    if (choice === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies for this visit.
  }
}

/** Sets `data-theme` on the root element; "system" removes it so the media query decides. */
export function applyThemeChoice(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/** Calls `onchange` whenever the theme in effect changes; returns a function that stops it. */
export function onThemeChange(onchange: () => void): () => void {
  const observer = new MutationObserver(onchange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const dark = matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", onchange);
  return () => {
    observer.disconnect();
    dark.removeEventListener("change", onchange);
  };
}
