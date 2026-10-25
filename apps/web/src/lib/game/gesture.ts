import { EdgeState, type Grid, NONE } from "@loophole/core";
import type { EdgeChange } from "./board.ts";
import { dotAt, dotPath, edgeAt, type Layout } from "./geometry.ts";

/** What a pointer movement did to the board. */
export interface StrokeStep {
  readonly changes: EdgeChange[];
  /** False for the first step of a stroke (a new undo step), true for the rest. */
  readonly merge: boolean;
}

/**
 * Turns one pointer's down/move/up into board input (FR-13), in board pixel coordinates.
 *
 * - A press that stays put is a tap: on release, the edge whose diamond holds the press point
 *   cycles line → cross → empty (the caller applies `nextState`).
 * - Moving farther than the slop starts a drag stroke that follows the dots under the pointer;
 *   each pair of consecutive dots marks the edge between them. If the first edge of the stroke was
 *   a line the stroke erases lines; otherwise it draws lines, over crosses too.
 */
export class PointerGesture {
  private active = false;
  private dragging = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private dot = 0;
  private mode: EdgeState | null = null;

  constructor(
    private readonly grid: Grid,
    private readonly layout: Layout,
  ) {}

  /** Distance the pointer must travel before a press becomes a drag. */
  get slop(): number {
    return Math.max(8, this.layout.cell * 0.25);
  }

  down(x: number, y: number): void {
    this.active = true;
    this.dragging = false;
    this.mode = null;
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
    this.dot = dotAt(this.grid, this.layout, x, y);
  }

  /** Feeds a pointer position; returns the edges to change, or null if none. */
  move(x: number, y: number, edges: Uint8Array): StrokeStep | null {
    if (!this.active) return null;
    if (!this.dragging) {
      if (Math.hypot(x - this.startX, y - this.startY) < this.slop) return null;
      this.dragging = true;
    }
    // Walk from the last position in steps of at most a quarter cell, so a fast swipe still
    // passes through every dot on its way.
    const dist = Math.hypot(x - this.lastX, y - this.lastY);
    const steps = Math.max(1, Math.ceil(dist / (this.layout.cell / 4)));
    const changes: EdgeChange[] = [];
    const merge = this.mode !== null;
    for (let i = 1; i <= steps; i++) {
      const px = this.lastX + ((x - this.lastX) * i) / steps;
      const py = this.lastY + ((y - this.lastY) * i) / steps;
      const next = dotAt(this.grid, this.layout, px, py);
      if (next === this.dot) continue;
      for (const edge of dotPath(this.grid, this.dot, next)) {
        if (this.mode === null) {
          this.mode = edges[edge] === EdgeState.Line ? EdgeState.Unknown : EdgeState.Line;
        }
        if (this.mode === EdgeState.Line) changes.push([edge, EdgeState.Line]);
        else if (edges[edge] === EdgeState.Line) changes.push([edge, EdgeState.Unknown]);
      }
      this.dot = next;
    }
    this.lastX = x;
    this.lastY = y;
    return changes.length > 0 ? { changes, merge } : null;
  }

  /** Ends the gesture. Returns the tapped edge, or `NONE` if it was a drag or missed the board. */
  up(): number {
    const tapped =
      this.active && !this.dragging
        ? edgeAt(this.grid, this.layout, this.startX, this.startY)
        : NONE;
    this.active = false;
    this.dragging = false;
    return tapped;
  }

  cancel(): void {
    this.active = false;
    this.dragging = false;
  }
}
