import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { bracketMatching, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { lintGutter, linter } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import type { PolicyDocument } from '../../engine/iam/types';
import { parsePolicy, PolicyKind, policyText } from '../../engine/iam/policy';

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bg-2)', color: 'var(--text)', fontSize: '12px', border: '1px solid var(--line-2)', borderRadius: '6px' },
    '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--accent)' },
    '.cm-gutters': { backgroundColor: 'var(--bg-2)', color: 'var(--faint)', border: 'none' },
    '&.cm-focused': { outline: '2px solid var(--accent)' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-tooltip': { backgroundColor: 'var(--panel-3)', border: '1px solid var(--line-2)' },
    '.cm-scroller': { maxHeight: '320px' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#ffb547' },
  { tag: tags.string, color: '#3fd68f' },
  { tag: [tags.bool, tags.null, tags.number], color: '#58a6ff' },
]);

export function PolicyEditor({
  doc,
  kind,
  onSave,
  readOnly = false,
  allowRemove = false,
  emptyText,
}: {
  doc: PolicyDocument | null | undefined;
  kind: PolicyKind;
  /** Return true when the save was accepted, so the editor resets its dirty state. */
  onSave?: (doc: PolicyDocument | null) => boolean;
  readOnly?: boolean;
  allowRemove?: boolean;
  emptyText?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saved = doc ? policyText(doc) : '';
  const [text, setText] = useState(saved);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: saved,
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          json(),
          linter(jsonParseLinter()),
          lintGutter(),
          syntaxHighlighting(highlight),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          theme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': `${kind} policy JSON` }),
          EditorView.updateListener.of((u) => u.docChanged && setText(u.state.doc.toString())),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [readOnly, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the stored policy changes underneath (save, undo elsewhere, reset), show it.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === saved) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: saved } });
    setText(saved);
    setErrors([]);
  }, [saved]);

  const dirty = text !== saved;
  const save = () => {
    if (!onSave) return;
    if (!text.trim()) {
      if (allowRemove && onSave(null)) setErrors([]);
      else if (!allowRemove) setErrors(['A policy document is required here.']);
      return;
    }
    const r = parsePolicy(text, kind);
    if (!r.ok) return setErrors(r.errors);
    setErrors([]);
    onSave(r.doc);
  };

  return (
    <div className="policy-editor">
      {!saved && readOnly && <p className="hint">{emptyText ?? 'No policy.'}</p>}
      <div ref={host} hidden={!saved && readOnly} />
      {errors.length > 0 && (
        <div className="policy-errors" role="alert">
          <b>MalformedPolicyDocument</b>
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      {!readOnly && onSave && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button className="btn small primary" disabled={!dirty} onClick={save}>
            Save policy
          </button>
          <button
            className="btn small ghost"
            disabled={!dirty}
            onClick={() => {
              const v = view.current;
              v?.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: saved } });
              setErrors([]);
            }}
          >
            Revert
          </button>
          {allowRemove && saved && (
            <button className="btn small ghost danger" onClick={() => onSave(null)}>
              Remove policy
            </button>
          )}
        </div>
      )}
    </div>
  );
}
