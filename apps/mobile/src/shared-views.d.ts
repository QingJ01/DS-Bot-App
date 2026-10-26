declare module "*ds-bot/src/shared/views.js" {
  export interface ViewNode { type: string; [key: string]: any }
  export function checkShownView(title: unknown, view: unknown): { error?: string; title?: string; view?: ViewNode; interactive?: boolean };
  export function viewScope(view: ViewNode, values?: Record<string, unknown>): (name: string) => unknown;
  export function resolve(value: unknown, lookup: (name: string) => unknown, fallback?: unknown): unknown;
  export function asText(value: unknown): string;
  export function validateViewAnswer(view: ViewNode, action: string, values: Record<string, unknown>): { error?: string };
}
