import type { ReactNode } from 'react';

/** Tiny Markdown renderer for Field Manual entries: headings, paragraphs, lists, tables, code, bold, inline code, [[xrefs]]. */
export function Markdown({ src, onXref }: { src: string; onXref: (id: string) => void }) {
  const lines = src.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const inline = (text: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[a-z0-9-]+\]\])/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('**')) parts.push(<strong key={key++}>{t.slice(2, -2)}</strong>);
      else if (t.startsWith('`')) parts.push(<code key={key++}>{t.slice(1, -1)}</code>);
      else {
        const id = t.slice(2, -2);
        parts.push(
          <button key={key++} className="xref" onClick={() => onXref(id)}>
            {id.replace(/-/g, ' ')}
          </button>,
        );
      }
      last = m.index + t.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(<pre key={key++}>{body.join('\n')}</pre>);
      continue;
    }
    if (l.startsWith('# ')) {
      out.push(<h1 key={key++}>{l.slice(2)}</h1>);
      i++;
      continue;
    }
    if (l.startsWith('## ')) {
      out.push(<h2 key={key++}>{l.slice(3)}</h2>);
      i++;
      continue;
    }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <table key={key++}>
          <thead>
            <tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, k) => (
              <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l);
      const items: string[] = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      out.push(<Tag key={key++}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</Tag>);
      continue;
    }
    if (l.trim() === '') {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|\||- |\d+\. |```)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return <div className="md">{out}</div>;
}
