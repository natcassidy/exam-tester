// Field Manual entries are Markdown files imported as raw strings.
const files = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const MANUAL: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, body]) => [path.replace('./', '').replace('.md', ''), body]),
);

export function manualTitle(id: string): string {
  const body = MANUAL[id];
  return body?.split('\n')[0].replace(/^#\s*/, '') ?? id;
}
