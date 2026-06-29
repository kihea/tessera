import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Session } from '../state/session';
import { Whiteboard } from './Whiteboard';
import { Tabs } from './Tabs';

marked.setOptions({ gfm: true, breaks: true });

export function NotesPane({ session, query }: { session: Session; query: string }) {
  const { notes, setNotes, noteInsertTick, slug } = session;
  const [tab, setTab] = useState<'write' | 'preview' | 'whiteboard'>('write');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDetailsElement>(null);

  // When a clip/checkpoint lands, reveal it.
  useEffect(() => {
    if (noteInsertTick === 0) return;
    const ta = taRef.current;
    if (ta) ta.scrollTop = ta.scrollHeight;
    const pv = previewRef.current;
    if (pv) pv.scrollTop = pv.scrollHeight;
  }, [noteInsertTick]);

  const words = notes.split(/\s+/).filter(Boolean).length;

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  // Each export action also closes the menu.
  const run = (fn: () => void) => () => {
    fn();
    if (exportRef.current) exportRef.current.open = false;
  };
  const exportMd = run(() => download(notes, `${slug || 'notes'}.md`, 'text/markdown;charset=utf-8'));
  const exportJson = run(() =>
    download(
      JSON.stringify({ query, slug, words, notes, exportedAt: new Date().toISOString() }, null, 2),
      `${slug || 'notes'}.json`,
      'application/json',
    ),
  );
  const copyNotes = run(() => void navigator.clipboard?.writeText(notes));

  const html =
    tab === 'preview'
      ? DOMPurify.sanitize(marked.parse(notes, { async: false }) as string, {
          ADD_ATTR: ['target'],
        })
      : '';

  return (
    <div className="notes-pane">
      <div className="notes-header">
        <span className="notes-title">Notebook</span>
        <Tabs
          className="notes-tabs"
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'write', label: 'Write' },
            { key: 'preview', label: 'Preview' },
            { key: 'whiteboard', label: 'Board' },
          ]}
        />
        <span className="notes-count">{words} words</span>
        <details className="export-menu" ref={exportRef}>
          <summary className="action" title="Export your notebook">
            ⤓ Export
          </summary>
          <div className="export-pop" role="menu">
            <button type="button" role="menuitem" onClick={exportMd}>
              Markdown <span className="export-ext">.md</span>
            </button>
            <button type="button" role="menuitem" onClick={exportJson}>
              JSON <span className="export-ext">.json</span>
            </button>
            <button type="button" role="menuitem" onClick={copyNotes}>
              Copy to clipboard
            </button>
          </div>
        </details>
      </div>
      {tab === 'write' ? (
        <textarea
          ref={taRef}
          className="notes-editor"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={`Your synthesis of "${query}" — clip excerpts from the feed, then write the connections between them in your own words.`}
          spellCheck={false}
        />
      ) : tab === 'preview' ? (
        <div ref={previewRef} className="notes-preview" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <Whiteboard slug={slug} />
      )}
      <div className="notes-foot">
        Autosaved locally · quotes stay verbatim with links to their sources — your words are the
        weave between them.
      </div>
    </div>
  );
}
