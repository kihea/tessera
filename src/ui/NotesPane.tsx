import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Session } from '../state/session';

marked.setOptions({ gfm: true, breaks: true });

export function NotesPane({ session, query }: { session: Session; query: string }) {
  const { notes, setNotes, noteInsertTick, slug } = session;
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // When a clip/checkpoint lands, reveal it.
  useEffect(() => {
    if (noteInsertTick === 0) return;
    const ta = taRef.current;
    if (ta) ta.scrollTop = ta.scrollHeight;
    const pv = previewRef.current;
    if (pv) pv.scrollTop = pv.scrollHeight;
  }, [noteInsertTick]);

  const words = notes.split(/\s+/).filter(Boolean).length;

  const exportNotes = () => {
    const blob = new Blob([notes], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug || 'notes'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
        <div className="notes-tabs">
          <button className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>
            Write
          </button>
          <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
            Preview
          </button>
        </div>
        <span className="notes-count">{words} words</span>
        <button className="action" onClick={exportNotes} title="Download as Markdown">
          ⤓ Export .md
        </button>
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
      ) : (
        <div ref={previewRef} className="notes-preview" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      <div className="notes-foot">
        Autosaved locally · quotes stay verbatim with links to their sources — your words are the
        weave between them.
      </div>
    </div>
  );
}
