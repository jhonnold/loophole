import type { Violations } from "@loophole/core";

export interface RuleMessage {
  readonly title: string;
  readonly detail: string;
}

/** One message per kind of definite rule break on the board (FR-15), worded as on the artboards. */
export function violationMessages(v: Violations): RuleMessage[] {
  const out: RuleMessage[] = [];
  if (v.dots.length > 0) {
    out.push({
      title: "Three lines meet at a dot.",
      detail: "A loop passes through a dot at most once.",
    });
  }
  if (v.overfullCells.length > 0) {
    out.push({
      title: "Too many lines.",
      detail: "A circled clue has more lines around it than its number.",
    });
  }
  if (v.starvedCells.length > 0) {
    out.push({
      title: "Too many crosses.",
      detail: "A circled clue can no longer get enough lines.",
    });
  }
  if (v.loopEdges.length > 0) {
    out.push({
      title: "Closed too early.",
      detail: "That loop is closed, but the puzzle is not solved yet.",
    });
  }
  return out;
}
