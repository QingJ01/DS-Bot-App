export type ReadingPosition = {
  offset: number;
  bottom: boolean;
  anchor?: { id: string; inset: number };
};
export type RowLayout = { y: number; height: number };

export function readingPosition(offset: number, height: number, viewport: number, rows: Map<string, RowLayout>, inverted = false): ReadingPosition {
  const row = [...rows].sort((a, b) => a[1].y - b[1].y)
    .find(([, layout]) => layout.y + layout.height > offset + 82);
  return {
    offset,
    bottom: inverted ? offset < 120 : height - offset - viewport < 120,
    anchor: row ? { id: row[0], inset: offset - row[1].y } : undefined,
  };
}

export function restoredOffset(position: ReadingPosition, rows: Map<string, RowLayout>) {
  const row = position.anchor && rows.get(position.anchor.id);
  return Math.max(0, row ? row.y + position.anchor!.inset : position.offset);
}

export function hasNewTail(previous: string | undefined, ids: string[]) {
  return !!previous && ids.includes(previous) && ids.at(-1) !== previous;
}
