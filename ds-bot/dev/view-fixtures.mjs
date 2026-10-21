export const LONG_NOTE_TITLE = 'A long note'

export function makeLongNoteView() {
  return {
    type: 'stack',
    children: Array.from({ length: 4 }, () => ({ type: 'text', text: 'x'.repeat(1950) })),
  }
}
