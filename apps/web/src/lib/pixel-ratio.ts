/**
 * Calls `onchange` whenever `devicePixelRatio` may have changed (a zoomed page, or a window dragged
 * to a screen with another scale); returns a function that stops it. A media query on the current
 * ratio reports the change where the browser does; it is armed again for the new ratio. A resize
 * is the fallback, for browsers that do not report the change.
 */
export function onPixelRatioChange(onchange: () => void): () => void {
  let media: MediaQueryList | null = null;
  const fire = () => {
    disarm();
    onchange();
    arm();
  };
  const arm = () => {
    media = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    media.addEventListener("change", fire);
  };
  const disarm = () => {
    media?.removeEventListener("change", fire);
    media = null;
  };
  window.addEventListener("resize", fire);
  arm();
  return () => {
    disarm();
    window.removeEventListener("resize", fire);
  };
}
