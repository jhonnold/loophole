import type { Grid } from "@loophole/core";
import type { Point } from "./geometry.ts";
import { pinchView, type Size, type View, type ZoomLimits } from "./viewport.ts";

/**
 * Sorts the pointers on the board into drawing and zooming (FR-13). The first finger draws. A
 * second finger, on a zoomable board, turns the gesture into a two-finger pinch that zooms and pans
 * until every finger is up; the caller then cancels the drawing gesture. Further fingers are
 * ignored. Points are in viewport pixels.
 */
export class BoardPointers {
  private readonly points = new Map<number, Point>();
  private mode: "idle" | "draw" | "zoom" | "rest" = "idle";
  private start: { view: View; a: Point; b: Point } | null = null;

  /** True while one finger (or the mouse) is drawing. */
  get drawing(): boolean {
    return this.mode === "draw";
  }

  /**
   * A pointer went down. Returns "draw" when it starts a drawing gesture, "zoom" when it turns the
   * gesture into a pinch, or null when it is ignored.
   */
  down(id: number, p: Point, view: View, canZoom: boolean): "draw" | "zoom" | null {
    if (this.mode === "idle") {
      this.points.set(id, p);
      this.mode = "draw";
      return "draw";
    }
    if (this.mode === "draw" && canZoom) {
      const [a] = this.points.values();
      this.points.set(id, p);
      this.start = { view, a, b: p };
      this.mode = "zoom";
      return "zoom";
    }
    return null;
  }

  /** A tracked pointer moved. While pinching, returns the new view; otherwise null. */
  move(id: number, p: Point, grid: Grid, port: Size, limits: ZoomLimits): View | null {
    if (!this.points.has(id)) return null;
    this.points.set(id, p);
    if (this.mode !== "zoom" || this.start === null) return null;
    const [a, b] = this.points.values();
    const { view, a: a0, b: b0 } = this.start;
    return pinchView(grid, view, a0, b0, a, b, port, limits);
  }

  /** A pointer went up or was cancelled. Returns true when it ends a drawing gesture. */
  up(id: number): boolean {
    if (!this.points.delete(id)) return false;
    const ended = this.mode === "draw";
    if (this.points.size === 0) {
      this.mode = "idle";
      this.start = null;
    } else if (this.mode === "zoom") {
      this.mode = "rest";
    }
    return ended;
  }

  /** True when `id` is a pointer this tracker follows. */
  has(id: number): boolean {
    return this.points.has(id);
  }
}
