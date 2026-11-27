-- The player's cell shades with their saved board (docs/FORMAT.md, Cell shades): one 0, 1 or 2 per
-- cell, or null for none.
ALTER TABLE progress ADD COLUMN shades TEXT CHECK (
  shades IS NULL OR (length(shades) > 0 AND shades NOT GLOB '*[^012]*')
);
