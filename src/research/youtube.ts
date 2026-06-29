// YouTube source feed. Discovery + transcript fetch both route through the
// Tauri Rust core (browsers are CORS-blocked from YouTube's search and caption
// endpoints) and require a free YouTube Data API key in Settings. The pure-web
// build, or a missing key, yields nothing -- the feed degrades gracefully.
//
// Legal posture (see the design brief): videos are shown ONLY via the official
// embed at the relevant timestamp; we keep at most a couple of SHORT verbatim
// transcript snippets per video to point the learner into the source. Videos
// with no fetchable transcript are skipped entirely. We never reproduce a full
// transcript or download the video.

import type { Passage, SourceDoc } from '../types';
import { clampAtSentence, freshId, queryTokens, relevanceOk } from './net';
import { loadSettings } from '../state/storage';

interface YtVideo {
  videoId: string;
  title: string;
  channel?: string;
  description?: string;
  date?: string;
}
interface YtSegment {
  text: string;
  start: number;
  dur?: number;
}
interface Window {
  text: string;
  start: number;
  end: number;
}

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const WINDOW_SEC = 30; // ~a sentence or two of speech -> a short, defensible snippet
const MAX_VIDEOS = 6;
const PICKS_PER_VIDEO = 2;

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Group consecutive transcript segments into ~WINDOW_SEC speech windows. */
function windowSegments(segs: YtSegment[]): Window[] {
  const out: Window[] = [];
  let cur: Window | null = null;
  for (const s of segs) {
    const text = s.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const end = s.start + (s.dur ?? 0);
    if (!cur || s.start - cur.start >= WINDOW_SEC) {
      if (cur) out.push(cur);
      cur = { text, start: s.start, end };
    } else {
      cur.text += ' ' + text;
      cur.end = end;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Pick up to n items spread evenly across the list (start, middle, end). */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  return `${m}:${String(r).padStart(2, '0')}`;
}

export async function searchYouTube(query: string): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const empty = { docs: [] as SourceDoc[], passages: [] as Passage[] };
  if (!inTauri()) return empty; // CORS: desktop app only
  const apiKey = loadSettings().youtubeApiKey?.trim();
  if (!apiKey) return empty; // feature off until a key is added

  let videos: YtVideo[];
  try {
    videos = (await tauriInvoke<YtVideo[]>('yt_search', { query, apiKey, max: MAX_VIDEOS })) ?? [];
  } catch {
    return empty;
  }

  const tokens = queryTokens(query);
  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];

  await Promise.all(
    videos.map(async (v) => {
      if (!v.videoId) return;
      let segs: YtSegment[] = [];
      try {
        segs = (await tauriInvoke<YtSegment[]>('yt_transcript', { videoId: v.videoId })) ?? [];
      } catch {
        segs = [];
      }
      if (segs.length === 0) return; // no transcript -> skip the video entirely

      const relevant = windowSegments(segs).filter((w) => relevanceOk(w.text, tokens));
      const picks = spread(relevant, PICKS_PER_VIDEO);
      if (picks.length === 0) return;

      const doc: SourceDoc = {
        id: freshId('yt'),
        provider: 'YouTube',
        sourceType: 'video',
        title: v.title || 'YouTube video',
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        author: v.channel,
        date: v.date,
      };
      docs.push(doc);
      picks.forEach((w, i) => {
        const start = Math.floor(w.start);
        passages.push({
          id: freshId('yt-p'),
          docId: doc.id,
          // Short snippet only -- a sentence or two; the embed carries the rest.
          text: clampAtSentence(w.text, 200, 320),
          anchor: fmtTime(start),
          anchorUrl: `https://www.youtube.com/watch?v=${v.videoId}&t=${start}s`,
          index: i,
          embed: { videoId: v.videoId, startSec: start, endSec: w.end > start ? Math.ceil(w.end) : undefined },
        });
      });
    }),
  );

  return { docs, passages };
}
