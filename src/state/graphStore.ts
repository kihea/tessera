// The persistent, cross-session knowledge graph -- "a formation of curated
// intellect that connects to itself." Every session's woven corpus folds in
// here (concepts as nodes, shared-concept co-occurrence as edges), accumulating
// across topics. Source PASSAGES are stored byte-identical and never mutated --
// the app's verbatim invariant holds in the graph too. Only the user's own
// notes (GraphNote) add authored text, and those are clearly the user's.
//
// On disk everything is plain arrays (Maps don't serialize); the live Corpus
// Maps are rebuilt only when a subgraph is rehydrated for the feed (slice 3).
//
// IDs from a session (freshId) are a per-page counter and collide across
// sessions, so on insert we re-key docs/passages to content-stable ids and
// remap every reference (passage.docId, concept.passageIds, edges).

import type { Concept, Corpus, Dimension, Formula, Passage, SourceDoc } from '../types';
import { nearDuplicate, wordSet } from '../research/providers';
import { isAdjectiveHeaded, normalizeTerm } from '../weave/terms';
import { buildConnections } from '../weave/connections';
import { annotateDepth } from '../weave/depth';
import { conceptDimension } from '../weave/dimensions';
import { extractDates } from '../weave/chronology';
import { embed, embeddingsAvailable } from '../ai/embeddings';
import { centroid, cosine } from '../ai/vec';
import { dequantizeVector, isQuantizedVector } from './quantize';
import { idbGet, idbSet, idbDel } from './idb';

const GRAPH_KEY = 'graph:v1';

export interface GraphDoc extends SourceDoc {
  firstSeen: number;
  topics: string[]; // seed queries that contributed this doc
}
export interface GraphConcept {
  id: string; // normalized key (extractConcepts id)
  label: string;
  df: number; // = passageIds.length
  passageIds: string[];
  important: boolean;
  definition?: Concept['definition'];
  definedByPassage?: string;
  generality: number; // abstraction signal: higher = more general/abstract
  topics: string[]; // distinct seed topics this concept has appeared under
  hypernyms?: string[]; // concept ids this one is-a / falls under (pig -> animal)
  kind?: NodeKind; // form (entity) vs attribute (quality); derived if absent
  vector?: number[]; // optional embedding of the concept's holistic context
  vectorHash?: string; // hash of the context the vector was built from (staleness)
  dimension?: Dimension; // 1-5 layer, classified semantically (weave/dimensions.ts)
}
/** An embedding-derived link between ideas that never shared a passage. Kept
 *  apart from co-occurrence `edges` so the per-merge typing never clobbers it. */
export interface SemanticEdge {
  a: string;
  b: string;
  degree: number; // cosine similarity in [0,1]
}
export type NodeKind = 'form' | 'attribute';
export type EdgeKind = 'associative' | 'abstraction' | 'attribute';
export interface GraphEdge {
  a: string; // concept id, canonical a < b
  b: string;
  weight: number; // accumulated co-occurrence strength
  kind: EdgeKind;
  /** 0..1 traversal magnitude: how characteristically the relation holds, with
   *  contrast links damped so they don't dominate "what belongs together". */
  degree?: number;
  /** -1..1 SIGNED intensity: + embodiment/affirmation (toward the outward, radiating
   *  pole), - contrast/repulsion ("infinitely away"). Magnitude is characteristic
   *  strength; direction (which idea embodies which) is read from `generality`. */
  intensity?: number;
  passageIds: string[];
}
export interface GraphNote {
  id: string;
  text: string; // the user's own words -- attributed to the user, never a source
  conceptIds: string[];
  clippedPassageIds: string[];
  slug: string;
  addedAt: number;
}
export interface KnowledgeGraph {
  version: 1;
  docs: GraphDoc[];
  passages: Passage[];
  concepts: GraphConcept[];
  edges: GraphEdge[];
  semanticEdges?: SemanticEdge[]; // embedding-derived (optional; built on enrichment)
  dimensionAnchors?: Partial<Record<Dimension, number[]>>; // baked exemplar vectors per dimension (1-5)
  notes: GraphNote[];
  formulas: Formula[];
  topics: { query: string; addedAt: number; passageCount: number }[];
  excluded: { docUrls: string[]; conceptIds: string[] };
}

/** What a session hands the graph -- already computed, no re-research. */
export interface GraphContribution {
  query: string;
  docs: SourceDoc[];
  passages: Passage[];
  concepts: Concept[];
  formulas: Formula[];
}

export function emptyGraph(): KnowledgeGraph {
  return {
    version: 1,
    docs: [],
    passages: [],
    concepts: [],
    edges: [],
    notes: [],
    formulas: [],
    topics: [],
    excluded: { docUrls: [], conceptIds: [] },
  };
}

export async function loadGraph(): Promise<KnowledgeGraph> {
  const g = await idbGet<KnowledgeGraph>(GRAPH_KEY);
  return g && g.version === 1 ? g : emptyGraph();
}

export async function saveGraph(graph: KnowledgeGraph): Promise<void> {
  await idbSet(GRAPH_KEY, graph);
}

export async function clearGraph(): Promise<void> {
  await idbDel(GRAPH_KEY);
  // A distinct sentinel (not a version number) so a deliberate clear is honored
  // ACROSS future SEED_VERSION bumps -- it must never silently re-seed.
  await idbSet(SEEDED_KEY, CLEARED_MARKER);
}

const SEEDED_KEY = 'graph:seeded';
// Bump when the bundled baseline meaningfully changes. The stored marker is a
// VERSION number; an older marker (or the legacy boolean `true` from when the
// shipped seed was an empty placeholder) re-seeds an EMPTY graph so early
// installs pick up a real baseline -- without ever clobbering a graph the user
// has built on. The CLEARED_MARKER is a separate signal (see clearGraph).
const SEED_VERSION = 1;
const CLEARED_MARKER = 'cleared';

/**
 * On first run, load the bundled baseline graph (public/seedGraph.json) so the
 * app is useful before the user has researched anything -- roughly a
 * high-school-graduate's breadth, built offline from freely redistributable
 * sources (scripts/buildSeedGraph.ts). No-op once seeded at the current version,
 * after the user has built their own graph, or after a deliberate clear.
 */
export async function ensureSeeded(): Promise<void> {
  const marker = await idbGet<number | boolean | string>(SEEDED_KEY);
  if (marker === CLEARED_MARKER) return; // user deliberately emptied the graph -- honor it
  if (typeof marker === 'number' && marker >= SEED_VERSION) return; // already current
  const g = await loadGraph();
  if (g.concepts.length > 0 || g.topics.length > 0) {
    await idbSet(SEEDED_KEY, SEED_VERSION); // never clobber the user's own graph
    return;
  }
  try {
    const res = await fetch('/seedGraph.json');
    if (res.ok) {
      const seed = (await res.json()) as KnowledgeGraph;
      if (seed?.version === 1 && seed.concepts.length > 0) {
        decodeSeedVectors(seed);
        await saveGraph(seed);
      }
    }
  } catch {
    // no baseline bundled / offline -- start empty
  }
  await idbSet(SEEDED_KEY, SEED_VERSION);
}

/**
 * The bundled seed ships its concept vectors int8-quantized to keep the asset
 * small (see state/quantize.ts). Turn them back into plain float arrays on load
 * so the rest of the runtime sees ordinary `number[]` vectors. A topology-only
 * bundle (no vectors) is left untouched.
 */
function decodeSeedVectors(graph: KnowledgeGraph): void {
  for (const c of graph.concepts) {
    const v = c.vector as unknown;
    if (isQuantizedVector(v)) c.vector = dequantizeVector(v);
  }
}

// -- stable, collision-free ids ----------------------------------------------

/** FNV-1a, base36 -- a short content hash for stable graph ids. Exported so the
 *  offline seed build can stamp the same `vectorHash` the runtime expects. */
export function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
const docKey = (url: string) => `gd${hash(url)}`;
const passageKey = (text: string) => `gp${hash(text)}`;
const edgeKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

// -- forms vs attributes, and connection degree ------------------------------
// A concept whose term is a quality (adjective-headed) is an ATTRIBUTE; a
// noun-headed term is a FORM (entity/substance). Reuses the app's existing
// adjective/noun detection -- no model, source-grounded. `kind` is stored on
// merge but always derivable from the label, so old graphs read fine.

/** The node kind, falling back to the label heuristic when not yet stored. */
export function nodeKind(c: { label: string; kind?: NodeKind }): NodeKind {
  return c.kind ?? (isAdjectiveHeaded(c.label) ? 'attribute' : 'form');
}

// Intensity adverbs that scale a relation's degree up or down (the textual half
// of the degree signal; passage-global, so approximate by design).
const STRONG_INTENSITY =
  /\b(very|highly|extremely|deeply|profoundly|intensely|strongly|entirely|fully|wholly|completely|largely|mostly|markedly)\b/i;
const WEAK_INTENSITY =
  /\b(slightly|somewhat|partially|partly|marginally|mildly|barely|occasionally|sometimes|relatively|moderately)\b/i;

/** A per-passage intensity vote: +1 strong, -1 weak, 0 neither/both. */
function intensityVote(text: string): number {
  const strong = STRONG_INTENSITY.test(text);
  const weak = WEAK_INTENSITY.test(text);
  return strong === weak ? 0 : strong ? 1 : -1;
}

// Genuinely OPPOSITIONAL, relation-level cues -- the inward, repulsive half of
// the torus. Deliberately narrow: bare "not"/"never"/"against" are far too common
// in affirmative prose ("not only X but Y", "protects against disease") to signal
// opposition, so they are excluded; hasContrastCue (connections.ts) already covers
// however/whereas/unlike/contrary-to/critics. This adds only true antagonism.
// Genuinely OPPOSITIONAL cues for the SIGN of an edge. Deliberately stronger than
// the weak discourse markers hasContrastCue also matches (however/despite/but) --
// those are far too common in affirmative prose to mean two SPECIFIC ideas oppose.
const STRONG_OPPOSITION =
  /\b(unlike|in contrast|contrary to|as opposed to|opposed to|oppos(?:e|es|ed|ing)|versus|vs\.?|antithesis|at odds|incompatible|reject(?:s|ed)?|refut(?:e|es|ed)|contradict(?:s|ed)?|rival(?:s|ry)?)\b/i;
const CONTRAST_NEAR = 64; // chars of context around the two ideas to read for opposition
/**
 * Is the relation between two ideas framed as genuine opposition WHERE THEY MEET?
 * Reads strong-opposition cues only in the window spanning the two concept mentions
 * (plus context), so neither a stray marker elsewhere nor a weak "however" can flip
 * an affirmative pair. Falls back to the whole passage when a label isn't verbatim.
 */
function contrastBetween(text: string, a?: string, b?: string): number {
  const hit = (s: string) => (STRONG_OPPOSITION.test(s) ? 1 : 0);
  if (a && b) {
    const lc = text.toLowerCase();
    const ia = lc.indexOf(a.toLowerCase());
    const ib = lc.indexOf(b.toLowerCase());
    if (ia >= 0 && ib >= 0) {
      const lo = Math.max(0, Math.min(ia, ib) - CONTRAST_NEAR);
      const hi = Math.min(text.length, Math.max(ia + a.length, ib + b.length) + CONTRAST_NEAR);
      return hit(text.slice(lo, hi));
    }
  }
  return hit(text);
}

/** Edge degree (positive traversal magnitude), falling back to a normalized weight. */
export function edgeDegree(e: GraphEdge): number {
  return e.degree ?? Math.min(1, e.weight / 6);
}

/** Signed edge intensity in [-1,1]; falls back to the (positive) degree for old graphs. */
export function edgeIntensity(e: GraphEdge): number {
  return e.intensity ?? edgeDegree(e);
}

const MAX_EDGE_CONCEPTS = 12; // cap pairs per passage so edge-building stays cheap
const INTENSITY_SAMPLE = 12; // shared passages read per edge for the intensity signal

/**
 * Fold one session's woven material into the graph (pure -- returns the same,
 * mutated graph for the caller to save). Dedups docs by url and passages by
 * near-duplicate text, re-keys to stable ids, merges concepts by normalized id,
 * and accumulates concept co-occurrence edges. Excluded docs/concepts are
 * skipped so user pruning sticks.
 */
export function mergeIntoGraph(graph: KnowledgeGraph, c: GraphContribution): KnowledgeGraph {
  const excludedUrls = new Set(graph.excluded.docUrls);
  const excludedConcepts = new Set(graph.excluded.conceptIds);
  const now = Date.now();

  // -- docs: dedup by url -> stable id, remap session docId -> graph docId
  const docById = new Map(graph.docs.map((d) => [d.id, d] as const));
  const docRemap = new Map<string, string>(); // session docId -> graph docId
  for (const d of c.docs) {
    if (!d.url || excludedUrls.has(d.url)) continue;
    const gid = docKey(d.url);
    docRemap.set(d.id, gid);
    const existing = docById.get(gid);
    if (existing) {
      if (!existing.topics.includes(c.query)) existing.topics.push(c.query);
    } else {
      const gd: GraphDoc = { ...d, id: gid, firstSeen: now, topics: [c.query] };
      docById.set(gid, gd);
      graph.docs.push(gd);
    }
  }

  // -- passages: exact dedup by text hash, then near-duplicate against stored
  // passages of the SAME doc; remap session passage id -> graph passage id.
  const passageById = new Map(graph.passages.map((p) => [p.id, p] as const));
  const passagesByDoc = new Map<string, Passage[]>();
  for (const p of graph.passages) {
    const arr = passagesByDoc.get(p.docId) ?? [];
    arr.push(p);
    passagesByDoc.set(p.docId, arr);
  }
  const idRemap = new Map<string, string>(); // session passage id -> graph passage id
  let added = 0;
  for (const p of c.passages) {
    const gDocId = docRemap.get(p.docId);
    if (!gDocId) continue; // its doc was excluded / had no url
    const exactId = passageKey(p.text);
    if (passageById.has(exactId)) {
      idRemap.set(p.id, exactId);
      continue;
    }
    // near-duplicate of an existing passage from the same doc?
    const words = wordSet(p.text);
    const sameDoc = passagesByDoc.get(gDocId) ?? [];
    const dup = sameDoc.find((q) => nearDuplicate(words, wordSet(q.text)));
    if (dup) {
      idRemap.set(p.id, dup.id);
      continue;
    }
    const gp: Passage = { ...p, id: exactId, docId: gDocId };
    idRemap.set(p.id, exactId);
    passageById.set(exactId, gp);
    sameDoc.push(gp);
    passagesByDoc.set(gDocId, sameDoc);
    graph.passages.push(gp);
    added++;
  }

  // -- concepts: merge by normalized id, union passageIds (remapped), recompute df
  const conceptById = new Map(graph.concepts.map((gc) => [gc.id, gc] as const));
  for (const concept of c.concepts) {
    if (excludedConcepts.has(concept.id)) continue;
    const remappedPids = concept.passageIds
      .map((pid) => idRemap.get(pid))
      .filter((x): x is string => !!x);
    if (remappedPids.length === 0) continue;
    const definedBy = concept.definedByPassage
      ? idRemap.get(concept.definedByPassage)
      : undefined;
    let gc = conceptById.get(concept.id);
    if (!gc) {
      gc = {
        id: concept.id,
        label: concept.label,
        df: 0,
        passageIds: [],
        important: !!concept.important,
        definition: concept.definition,
        definedByPassage: definedBy,
        generality: 0,
        topics: [],
        kind: isAdjectiveHeaded(concept.label) ? 'attribute' : 'form',
      };
      conceptById.set(concept.id, gc);
      graph.concepts.push(gc);
    }
    if (!gc.kind) gc.kind = isAdjectiveHeaded(gc.label) ? 'attribute' : 'form';
    const pidSet = new Set(gc.passageIds);
    for (const pid of remappedPids) pidSet.add(pid);
    gc.passageIds = [...pidSet];
    gc.df = gc.passageIds.length;
    gc.important = gc.important || !!concept.important;
    if (!gc.definition && concept.definition) gc.definition = concept.definition;
    if (!gc.definedByPassage && definedBy) gc.definedByPassage = definedBy;
    if (!gc.topics.includes(c.query)) gc.topics.push(c.query);
    // Abstraction proxy: a term that recurs across many DISTINCT topics and many
    // passages is more general ("system", "animal") than one confined to one
    // subject. This is the axis traversal moves "up" toward animalness along.
    gc.generality = gc.topics.length + Math.log(1 + gc.df);
  }

  // Abstraction edges (is-a): when a defining passage says "X is a/are a {Y}",
  // record Y as a hypernym of X if Y is also a known concept -- source-grounded,
  // no authored content. Cheap and best-effort; sparse is fine.
  const IS_A = /\b(?:is|are|was|were)\s+(?:a|an)\s+(?:(?:type|kind|form|class|sort|species|branch|member|category)s?\s+of\s+)?([a-z][a-z-]{2,}(?:\s+[a-z][a-z-]{2,}){0,2})/i;
  const conceptIdSet = new Set(graph.concepts.map((gc) => gc.id));
  const conceptByIdNow = new Map(graph.concepts.map((gc) => [gc.id, gc] as const));
  for (const concept of c.concepts) {
    if (excludedConcepts.has(concept.id) || !concept.definedByPassage) continue;
    const p = c.passages.find((pp) => pp.id === concept.definedByPassage);
    if (!p) continue;
    const m = IS_A.exec(p.text);
    if (!m) continue;
    const phrase = m[1].trim();
    const words = phrase.split(/\s+/);
    // try the whole phrase, then its head (last word) -- both normalized
    const candidates = [normalizeTerm(phrase), normalizeTerm(words[words.length - 1])];
    const general = candidates.find((id) => id !== concept.id && conceptIdSet.has(id));
    if (!general) continue;
    const gc = conceptByIdNow.get(concept.id);
    if (!gc) continue;
    gc.hypernyms = gc.hypernyms ?? [];
    if (!gc.hypernyms.includes(general)) gc.hypernyms.push(general);
  }

  // -- edges: concept co-occurrence within the contribution, accumulated
  const conceptsByPassage = new Map<string, string[]>(); // graph passage id -> concept ids
  for (const concept of c.concepts) {
    if (excludedConcepts.has(concept.id)) continue;
    for (const pid of concept.passageIds) {
      const gp = idRemap.get(pid);
      if (!gp) continue;
      const arr = conceptsByPassage.get(gp) ?? [];
      arr.push(concept.id);
      conceptsByPassage.set(gp, arr);
    }
  }
  const edgeByKey = new Map(graph.edges.map((e) => [edgeKey(e.a, e.b), e] as const));
  for (const [gp, ids] of conceptsByPassage) {
    const list = ids.slice(0, MAX_EDGE_CONCEPTS);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a === b) continue;
        const key = edgeKey(a, b);
        let e = edgeByKey.get(key);
        if (!e) {
          e = { a: a < b ? a : b, b: a < b ? b : a, weight: 0, kind: 'associative', passageIds: [] };
          edgeByKey.set(key, e);
          graph.edges.push(e);
        }
        e.weight += 1;
        if (!e.passageIds.includes(gp)) e.passageIds.push(gp);
      }
    }
  }

  // -- type every edge by its endpoints and score its degree (0..1). Kind: a
  // form-attribute pair is "has-attribute"; an is-a pair is "abstraction"; else
  // "associative". Degree combines characteristic strength (how much of the
  // rarer endpoint's passages they share) with textual intensity (very/slightly
  // adverbs in the shared passages). Recomputed each merge -- cheap, and df may
  // have shifted.
  for (const e of graph.edges) {
    const aC = conceptById.get(e.a);
    const bC = conceptById.get(e.b);
    const ka = aC ? nodeKind(aC) : 'form';
    const kb = bC ? nodeKind(bC) : 'form';
    if ((ka === 'attribute') !== (kb === 'attribute')) e.kind = 'attribute';
    else if (aC?.hypernyms?.includes(e.b) || bC?.hypernyms?.includes(e.a)) e.kind = 'abstraction';
    else e.kind = 'associative';

    const minDf = Math.max(1, Math.min(aC?.df ?? 1, bC?.df ?? 1));
    const strength = Math.min(1, e.passageIds.length / minDf);
    // Read the shared passages where the two ideas actually meet: how intensely
    // (adverbs) and in what polarity (affirmation vs contrast/negation) they relate.
    let adv = 0;
    let contrast = 0;
    let seen = 0;
    for (const pid of e.passageIds.slice(0, INTENSITY_SAMPLE)) {
      const p = passageById.get(pid);
      if (!p) continue;
      adv += intensityVote(p.text);
      contrast += contrastBetween(p.text, aC?.label, bC?.label);
      seen += 1;
    }
    const factor = seen ? 1 + 0.3 * (adv / seen) : 1; // ~[0.7, 1.3]
    const magnitude = Math.max(0, Math.min(1, strength * factor));
    // Mostly affirmative; flips to the repulsive pole only when contrast genuinely
    // DOMINATES where the two ideas meet -- a majority of at least two sampled
    // passages, so one stray oppositional word can never flip an affirmative edge.
    const sign = seen >= 2 && contrast / seen > 0.5 ? -1 : 1;
    e.intensity = sign * magnitude;
    // Traversal affinity: a contrast is a real link but must not dominate the
    // "what belongs together" expansion, so it is damped rather than dropped.
    e.degree = sign > 0 ? magnitude : magnitude * 0.3;
  }

  // -- formulas: dedup by id (already content-ish)
  const formulaIds = new Set(graph.formulas.map((f) => f.id));
  for (const f of c.formulas) {
    if (!formulaIds.has(f.id)) {
      formulaIds.add(f.id);
      graph.formulas.push(f);
    }
  }

  graph.topics.push({ query: c.query, addedAt: now, passageCount: added });
  return graph;
}

// -- curation: remove a source the user reported, and keep it out -------------

/**
 * Drop every doc with this url (and its passages) from the graph, prune those
 * passage ids out of concepts/edges, and remember the url as excluded so a
 * future merge never re-adds it. Mirrors the reported-source exclusion in
 * session.ts, extended to the persistent graph. Pure -- caller saves.
 */
export function pruneDoc(graph: KnowledgeGraph, url: string): KnowledgeGraph {
  if (!graph.excluded.docUrls.includes(url)) graph.excluded.docUrls.push(url);
  const goneDocIds = new Set(graph.docs.filter((d) => d.url === url).map((d) => d.id));
  if (goneDocIds.size === 0) return graph;
  graph.docs = graph.docs.filter((d) => !goneDocIds.has(d.id));
  const gonePassageIds = new Set(
    graph.passages.filter((p) => goneDocIds.has(p.docId)).map((p) => p.id),
  );
  graph.passages = graph.passages.filter((p) => !goneDocIds.has(p.docId));
  for (const gc of graph.concepts) {
    if (gc.passageIds.some((pid) => gonePassageIds.has(pid))) {
      gc.passageIds = gc.passageIds.filter((pid) => !gonePassageIds.has(pid));
      gc.df = gc.passageIds.length;
    }
  }
  graph.concepts = graph.concepts.filter((gc) => gc.passageIds.length > 0);
  const liveConcepts = new Set(graph.concepts.map((gc) => gc.id));
  for (const e of graph.edges) {
    if (e.passageIds.some((pid) => gonePassageIds.has(pid))) {
      e.passageIds = e.passageIds.filter((pid) => !gonePassageIds.has(pid));
    }
  }
  graph.edges = graph.edges.filter(
    (e) => e.passageIds.length > 0 && liveConcepts.has(e.a) && liveConcepts.has(e.b),
  );
  graph.formulas = graph.formulas.filter((f) => f.conceptIds.some((id) => liveConcepts.has(id)));
  return graph;
}

/** Load → prune a reported source → save. Best-effort. */
export async function excludeDocFromGraph(url: string): Promise<void> {
  const g = await loadGraph();
  pruneDoc(g, url);
  await saveGraph(g);
}

/** Load → fold a session's material in → save. Best-effort, serialized by callers. */
export async function addContribution(c: GraphContribution): Promise<void> {
  const g = await loadGraph();
  mergeIntoGraph(g, c);
  await saveGraph(g);
}

// -- optional embeddings enrichment ------------------------------------------
// We embed each concept from a HOLISTIC context drawn from the graph -- its
// definition, its own verbatim passages, its attributes, its strongest
// neighbours -- so the vector understands the concept as it lives in the corpus,
// not a bare dictionary word. Topology stays the backbone; the deep vectors only
// deepen it (semantic edges, neighbourhoods, geometric abstraction). No LLM --
// purely geometric/programmatic. Opt-in; a null backend leaves the graph as its
// topology-only self.

const CONTEXT_CHARS = 800; // cap per-concept embedding input
// qwen3-embedding cosines run markedly lower than nomic's: measured over the seed,
// non-co-occurring concept pairs sit at p50≈0.14 / p99≈0.40, so 0.78 captured almost
// nothing. 0.6 stays clearly above the 99th-pct noise floor (high precision) while
// linking a useful set of genuinely-close ideas. Tune with scripts/analyzeSemantic.ts.
const SEMANTIC_MIN_SIM = 0.6;
const SEMANTIC_PER_CONCEPT = 4;

/**
 * Build the rich context that represents a concept for embedding: its label,
 * definition, a couple of its own verbatim passages, its attributes, and its
 * strongest neighbouring ideas. Deterministic -- the same graph state yields the
 * same string (so its hash drives re-embedding only when the context changes).
 */
export function conceptContext(graph: KnowledgeGraph, concept: GraphConcept): string {
  const passageById = new Map(graph.passages.map((p) => [p.id, p] as const));
  const conceptById = new Map(graph.concepts.map((c) => [c.id, c] as const));

  // a couple of its own passages, longest first (more context per call)
  const ownPassages = concept.passageIds
    .map((pid) => passageById.get(pid))
    .filter((p): p is Passage => !!p)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 2)
    .map((p) => p.text);

  // attributes (has-attribute neighbours) and strongest other neighbours
  const attrs: string[] = [];
  const neighbours: { label: string; w: number }[] = [];
  for (const e of graph.edges) {
    const other = e.a === concept.id ? e.b : e.b === concept.id ? e.a : null;
    if (!other) continue;
    const oc = conceptById.get(other);
    if (!oc) continue;
    if (e.kind === 'attribute' && nodeKind(oc) === 'attribute') attrs.push(oc.label);
    else neighbours.push({ label: oc.label, w: edgeDegree(e) });
  }
  neighbours.sort((a, b) => b.w - a.w);

  const parts = [
    concept.label,
    concept.definition?.text ?? '',
    attrs.length ? `Qualities: ${[...new Set(attrs)].slice(0, 6).join(', ')}.` : '',
    neighbours.length
      ? `Related: ${[...new Set(neighbours.map((n) => n.label))].slice(0, 8).join(', ')}.`
      : '',
    ...ownPassages,
  ].filter(Boolean);
  return parts.join('\n').slice(0, CONTEXT_CHARS);
}

/**
 * Blend concept-vector similarity into the topology when vectors are present:
 * a co-occurrence edge whose endpoints are semantically close gets a degree
 * bump, and a concept near the centroid (broadly similar to everything) reads as
 * more general. Pure over the stored vectors. No-op without embeddings.
 */
export function applyVectorSignals(graph: KnowledgeGraph): void {
  const byId = new Map(graph.concepts.map((c) => [c.id, c] as const));
  for (const e of graph.edges) {
    const a = byId.get(e.a)?.vector;
    const b = byId.get(e.b)?.vector;
    if (!a || !b) continue;
    const sim = Math.max(0, cosine(a, b));
    // Deepen the magnitude with vector closeness, then re-derive BOTH fields from
    // one (magnitude, sign) source -- mirroring the merge loop -- so the contrast
    // damping (degree = 0.3 * |intensity|) stays coupled. Geometry sharpens "how
    // strong"; only the text decides embodiment vs tension.
    if (typeof e.intensity === 'number') {
      const sign = e.intensity < 0 ? -1 : 1;
      const mag = Math.max(0, Math.min(1, 0.6 * Math.abs(e.intensity) + 0.4 * sim));
      e.intensity = sign * mag;
      e.degree = sign > 0 ? mag : mag * 0.3;
    } else {
      // Legacy edge with no signed intensity: blend the positive degree as before.
      e.degree = Math.max(0, Math.min(1, 0.6 * edgeDegree(e) + 0.4 * sim));
    }
  }
  const vectored = graph.concepts.filter((c) => c.vector);
  if (vectored.length > 3) {
    const cen = centroid(vectored.map((c) => c.vector!));
    for (const c of vectored) {
      const central = Math.max(0, cosine(c.vector!, cen)); // near the centroid = more general
      c.generality = (c.topics.length + Math.log(1 + c.df)) * (0.7 + 0.6 * central);
    }
  }
}

/**
 * Rebuild the semantic edges from concept vectors: each vectored concept's
 * nearest neighbours above a high cosine bar that DON'T already co-occur. These
 * are the "belong together without sharing a passage" links. Pure; kept apart
 * from `edges`. Symmetric and deduped.
 */
export function rebuildSemanticEdges(graph: KnowledgeGraph): void {
  const vectored = graph.concepts.filter((c) => c.vector);
  if (vectored.length < 2) {
    graph.semanticEdges = [];
    return;
  }
  const coOccur = new Set(graph.edges.map((e) => edgeKey(e.a, e.b)));
  const out = new Map<string, SemanticEdge>();
  for (const c of vectored) {
    const near = vectored
      .filter((o) => o.id !== c.id)
      .map((o) => ({ id: o.id, s: cosine(c.vector!, o.vector!) }))
      .filter((x) => x.s >= SEMANTIC_MIN_SIM && !coOccur.has(edgeKey(c.id, x.id)))
      .sort((a, b) => b.s - a.s)
      .slice(0, SEMANTIC_PER_CONCEPT);
    for (const n of near) {
      const key = edgeKey(c.id, n.id);
      const prev = out.get(key);
      if (!prev || n.s > prev.degree) {
        const a = c.id < n.id ? c.id : n.id;
        const b = c.id < n.id ? n.id : c.id;
        out.set(key, { a, b, degree: Math.min(1, n.s) });
      }
    }
  }
  graph.semanticEdges = [...out.values()];
}

/**
 * Classify every concept's dimensional layer (1-5) SEMANTICALLY: cosine of its
 * vector to the baked dimensional anchors (weave/dimensions.ts), with generality
 * percentile / is-a / era breaking near-ties. No anchors or no vector -> a coarse
 * relational fallback. Pure; run after vectors + anchors exist.
 */
export function annotateDimensions(
  graph: KnowledgeGraph,
  opts: { only?: Set<string>; vectorFor?: (c: GraphConcept) => number[] | undefined } = {},
): void {
  const anchors = graph.dimensionAnchors;
  // Relative thresholds, not magic numbers: a concept's generality PERCENTILE.
  const gens = graph.concepts.map((c) => c.generality).sort((a, b) => a - b);
  const pct = (g: number): number => {
    if (gens.length === 0) return 0;
    let lo = 0;
    let hi = gens.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (gens[mid] <= g) lo = mid + 1;
      else hi = mid;
    }
    return lo / gens.length;
  };
  // Temporal signal: which passages carry dates (computed once).
  const dated = new Set(graph.passages.filter((p) => extractDates(p.text).length > 0).map((p) => p.id));
  for (const c of graph.concepts) {
    if (opts.only && !opts.only.has(c.id)) continue; // leave untouched dims (e.g. the seed's) intact
    c.dimension = conceptDimension({
      vector: opts.vectorFor ? opts.vectorFor(c) : c.vector,
      anchors,
      isAttribute: nodeKind(c) === 'attribute',
      generalityPct: pct(c.generality),
      hasEra: c.passageIds.some((pid) => dated.has(pid)),
      hasHypernyms: !!c.hypernyms?.length,
    });
  }
}

/**
 * Fill/refresh concept vectors from the embeddings backend, then refold the
 * geometric signals (degree blend, generality, semantic edges). A concept is
 * (re-)embedded when the hash of its holistic context changes -- so vectors
 * stay deep AND current as the graph grows. Capped per call. Returns whether
 * anything changed. Opt-in, best-effort.
 */
export async function enrichGraphWithEmbeddings(
  graph: KnowledgeGraph,
  { maxToEmbed = 96 }: { maxToEmbed?: number } = {},
): Promise<boolean> {
  if (!embeddingsAvailable()) return false;
  const candidates = graph.concepts
    .filter((c) => c.important)
    .map((c) => ({ c, ctx: conceptContext(graph, c) }))
    .filter(({ c, ctx }) => c.vectorHash !== hash(ctx))
    .sort((a, b) => b.c.df - a.c.df)
    .slice(0, maxToEmbed);
  if (candidates.length === 0) return false;

  const vecs = await embed(candidates.map((x) => x.ctx));
  if (!vecs || vecs.length !== candidates.length) return false;
  candidates.forEach(({ c, ctx }, i) => {
    c.vector = vecs[i];
    c.vectorHash = hash(ctx);
  });
  applyVectorSignals(graph);
  rebuildSemanticEdges(graph);
  // Dimensions: (re)classify ONLY the concepts touched this call, from their LABELS
  // (type-pure), reusing the baked anchors -- so the rest of the graph (e.g. the
  // seed's label-based dims) is never clobbered by the process-polluted context read.
  const touched = new Set(candidates.map(({ c }) => c.id));
  const labelVecs = graph.dimensionAnchors ? await embed(candidates.map(({ c }) => c.label)) : null;
  const labelMap =
    labelVecs && labelVecs.length === candidates.length
      ? new Map(candidates.map(({ c }, i) => [c.id, labelVecs[i]] as const))
      : null;
  annotateDimensions(graph, {
    only: touched,
    vectorFor: labelMap ? (c) => labelMap.get(c.id) : undefined,
  });
  return true;
}

/**
 * Upsert the user's notes for a topic as their own layer in the graph, linked
 * to the ideas they touch -- "a formation of curated intellect that connects to
 * itself." The note text is the USER's words (the one authored layer), never a
 * source. Keyed by slug so editing replaces rather than duplicates. An empty
 * note removes any prior one.
 */
export async function upsertNote(
  note: { slug: string; text: string; conceptIds: string[]; clippedPassageIds?: string[] },
): Promise<void> {
  const g = await loadGraph();
  g.notes = g.notes.filter((n) => n.slug !== note.slug);
  if (note.text.trim()) {
    g.notes.push({
      id: `note:${note.slug}`,
      text: note.text,
      conceptIds: note.conceptIds,
      clippedPassageIds: note.clippedPassageIds ?? [],
      slug: note.slug,
      addedAt: Date.now(),
    });
  }
  await saveGraph(g);
}

/** Notes whose linked concepts intersect a set (for the graph screen). */
export function notesForConcepts(graph: KnowledgeGraph, conceptIds: string[]): GraphNote[] {
  const want = new Set(conceptIds);
  return graph.notes.filter((n) => n.conceptIds.some((id) => want.has(id)));
}

// -- search & traversal -------------------------------------------------------

export interface Subgraph {
  conceptIds: string[];
  passages: Passage[];
  docs: GraphDoc[];
}

/**
 * Find the region of the graph around a topic: match seed concepts by the
 * topic's normalized id / label / tokens, then expand along the strongest edges
 * (the "subsection" the topic sits in) up to a node/hop budget. Returns the
 * subgraph's concept ids plus the verbatim passages/docs they cover.
 */
export function searchGraph(
  graph: KnowledgeGraph,
  topic: string,
  {
    maxNodes = 18,
    maxHops = 2,
    seedFloor = 0,
    minRelevance = 0,
    coOccurOnly = false,
  }: {
    maxNodes?: number;
    maxHops?: number;
    seedFloor?: number;
    minRelevance?: number;
    coOccurOnly?: boolean;
  } = {},
): Subgraph {
  const norm = normalizeTerm(topic);
  const tokens = (topic.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).map(normalizeTerm);
  const lowerTopic = topic.toLowerCase();

  const scored = graph.concepts
    .map((c) => {
      let s = 0;
      const label = c.label.toLowerCase();
      if (c.id === norm) s += 100;
      // Topic PROVENANCE: concept.topics records which seed query gathered a
      // concept. Extraction excludes the query's OWN words, so a canon/seed topic
      // ("the Roman Empire") has no concept named after it -- its gathered
      // neighbours, tagged with the topic, are what make it searchable at all.
      let prov = 0;
      for (const t of c.topics ?? []) {
        const tl = t.toLowerCase();
        if (tl === lowerTopic) prov = Math.max(prov, 50);
        else if (tl.includes(lowerTopic) || lowerTopic.includes(tl)) prov = Math.max(prov, 20);
      }
      s += prov;
      if (label.includes(lowerTopic) || c.id.includes(norm)) s += 5;
      // WHOLE-WORD token match. A substring test let the article "the" in "the
      // Roman Empire" match "theory"/"theories" and seed an entire unrelated
      // physics neighborhood -- match normalized words, never substrings.
      const words = new Set<string>([...c.id.split(' '), ...label.split(/\s+/)]);
      for (const t of tokens) if (words.has(t)) s += 2;
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.c.df - a.c.df);

  // Seeds must clear `seedFloor`: lets the graph-as-a-provider stay conservative (a
  // lone token collision like "cell"->"cell shading" must NOT inject an unrelated
  // cluster into every live feed) while the graph SCREEN keeps the floor at 0.
  const seeds = scored.filter((x) => x.s >= seedFloor).slice(0, 4).map((x) => x.c.id);
  if (seeds.length === 0) return { conceptIds: [], passages: [], docs: [] };

  const conceptById = new Map(graph.concepts.map((c) => [c.id, c] as const));
  const kindOf = (id: string) => {
    const c = conceptById.get(id);
    return c ? nodeKind(c) : 'form';
  };

  // adjacency: each link carries its traversal degree AND its signed intensity.
  const adj = new Map<string, { other: string; w: number; int: number; attr: boolean }[]>();
  const link = (from: string, other: string, w: number, int: number, attr: boolean) => {
    const list = adj.get(from) ?? [];
    list.push({ other, w, int, attr });
    adj.set(from, list);
  };
  for (const e of graph.edges) {
    link(e.a, e.b, edgeDegree(e), edgeIntensity(e), e.kind === 'attribute');
    link(e.b, e.a, edgeDegree(e), edgeIntensity(e), e.kind === 'attribute');
  }
  // Embedding-derived links: ideas that belong together without sharing a passage.
  // Always affirmative (a similarity bond), traversed like any other edge.
  for (const e of graph.semanticEdges ?? []) {
    link(e.a, e.b, e.degree, e.degree, false);
    link(e.b, e.a, e.degree, e.degree, false);
  }

  // Relevance-to-subject ranking: prefer neighbours genuinely ABOUT the subject over
  // mere frequent co-mentions. The embedding cosine is the strongest signal WHEN
  // vectors exist -- but it must not be the ONLY thing that discriminates, or the feed
  // collapses to loose co-occurrence the instant embeddings are off (and one dominant
  // cluster leaks into every result). So we blend embedding-FREE signals that
  // approximate "aboutness" structurally: co-occurrence salience, shared-neighbour
  // overlap (Adamic-Adar, hubs discounted), and taxonomic/provenance kinship. Cosine
  // refines this; the floor stays coherent without it.
  const seedVectors = seeds
    .map((id) => conceptById.get(id)?.vector)
    .filter((v): v is number[] => Array.isArray(v) && v.length > 0);
  const seedSet = new Set(seeds);
  const seedPassages = new Set<string>();
  const seedNeighbours = new Set<string>();
  const seedHypernyms = new Set<string>();
  const seedTopics = new Set<string>();
  for (const id of seeds) {
    const sc = conceptById.get(id);
    for (const pid of sc?.passageIds ?? []) seedPassages.add(pid);
    for (const n of adj.get(id) ?? []) seedNeighbours.add(n.other);
    for (const h of sc?.hypernyms ?? []) seedHypernyms.add(h);
    for (const t of sc?.topics ?? []) seedTopics.add(t.toLowerCase());
  }
  const degreeOf = (id: string) => adj.get(id)?.length ?? 0;
  const relevance = (otherId: string, linkInt: number): number => {
    const c = conceptById.get(otherId);
    if (!c) return 0;
    // (a) semantic cosine -- the deep-model signal; 0 when no vectors.
    let cos = 0;
    if (c.vector && seedVectors.length) for (const sv of seedVectors) cos = Math.max(cos, cosine(sv, c.vector));
    // (b) co-occurrence salience: how much of THIS concept is explained by the seed.
    const pids = c.passageIds;
    const salience = pids.length ? pids.filter((p) => seedPassages.has(p)).length / pids.length : 0;
    // (c) shared-neighbour overlap (Adamic-Adar): two ideas that point at the same
    // other ideas are related even if they never shared a passage; generic hubs
    // (high degree) contribute less. Soft-normalized to ~[0,1).
    let aa = 0;
    for (const n of adj.get(otherId) ?? []) if (seedNeighbours.has(n.other)) aa += 1 / Math.log(2 + degreeOf(n.other));
    const struct = aa / (aa + 1.5);
    // (d) kinship: shares an is-a parent with a seed (or is one), or was gathered under
    // the same topic -- a cheap stand-in for "same area of meaning" without vectors.
    const sharesParent = c.hypernyms?.some((h) => seedSet.has(h) || seedHypernyms.has(h)) ?? false;
    const kin = sharesParent || seedHypernyms.has(c.id) ? 1 : 0;
    const topic = c.topics?.some((t) => seedTopics.has(t.toLowerCase())) ? 1 : 0;
    return (
      0.42 * cos +
      0.2 * salience +
      0.18 * struct +
      0.1 * kin +
      0.06 * topic +
      0.12 * Math.max(0, linkInt) -
      0.25 * Math.max(0, -linkInt)
    );
  };

  // Forms are the backbone: expand the subgraph through form↔form links, ranked by
  // relevance to the subject. (Attributes are attached afterwards, off their forms.)
  const chosen = new Set(seeds);
  let frontier = [...seeds];
  for (let hop = 0; hop < maxHops && chosen.size < maxNodes; hop++) {
    // Dedup candidates reached from several frontier nodes (keep the strongest
    // link), then score each ONCE -- relevance() runs 1024-dim cosines, so it must
    // never be called from inside a sort comparator.
    const best = new Map<string, number>(); // candidate form id -> strongest link intensity
    for (const id of frontier)
      for (const n of adj.get(id) ?? []) {
        if (chosen.has(n.other) || kindOf(n.other) !== 'form') continue;
        const prev = best.get(n.other);
        if (prev === undefined || n.int > prev) best.set(n.other, n.int);
      }
    const ranked = [...best.entries()]
      .map(([other, int]) => ({ other, score: relevance(other, int) }))
      .sort((a, b) => b.score - a.score);
    frontier = [];
    for (const n of ranked) {
      if (chosen.size >= maxNodes) break;
      if (n.score < minRelevance) break; // ranked desc -> the rest are weaker; stop before drift
      // coOccurOnly: only follow neighbours that genuinely SHARED A PASSAGE with a seed
      // (real co-occurrence in the gathered material), never a semantic/embedding bridge
      // -- those vector-similarity links are what drift "the internet" into "DNA".
      if (coOccurOnly && !conceptById.get(n.other)?.passageIds.some((p) => seedPassages.has(p)))
        continue;
      chosen.add(n.other);
      frontier.push(n.other);
    }
  }

  // (Embedding-derived neighbours are already in `adj` above as semantic edges,
  // so the form expansion traverses them at a principled similarity threshold.)

  // Attach each chosen form's most characteristic attributes (top-degree
  // has-attribute neighbors), capped per form so qualities never flood the node.
  const ATTR_PER_FORM = 4;
  for (const formId of [...chosen]) {
    if (kindOf(formId) !== 'form') continue;
    const attrs = (adj.get(formId) ?? [])
      .filter((n) => n.attr && kindOf(n.other) === 'attribute')
      .sort((a, b) => b.int - a.int) // most strongly embodied qualities first
      .slice(0, ATTR_PER_FORM);
    for (const a of attrs) chosen.add(a.other);
  }

  const conceptIds = [...chosen];
  const pidSet = new Set<string>();
  for (const id of conceptIds) for (const pid of conceptById.get(id)?.passageIds ?? []) pidSet.add(pid);
  const passages = graph.passages.filter((p) => pidSet.has(p.id));
  const docIds = new Set(passages.map((p) => p.docId));
  const docs = graph.docs.filter((d) => docIds.has(d.id));
  return { conceptIds, passages, docs };
}

/**
 * Rehydrate a live Corpus from a subgraph so the existing Loom can play it as a
 * feed. Concepts' passageIds are filtered to in-subgraph passages (or the loom
 * would reference passages that aren't here), weight is recomputed, and the
 * passage connections are rebuilt with the same builder the session uses.
 */
export function subgraphToCorpus(graph: KnowledgeGraph, conceptIds: string[]): Corpus {
  const idSet = new Set(conceptIds);
  const subConcepts = graph.concepts.filter((c) => idSet.has(c.id));
  const wantedPids = new Set<string>();
  for (const c of subConcepts) for (const pid of c.passageIds) wantedPids.add(pid);

  const passages: Passage[] = graph.passages.filter((p) => wantedPids.has(p.id)).map((p) => ({ ...p }));
  const havePids = new Set(passages.map((p) => p.id));
  const docIds = new Set(passages.map((p) => p.docId));
  const docs = graph.docs.filter((d) => docIds.has(d.id));
  const docMap = new Map<string, SourceDoc>(docs.map((d) => [d.id, d as SourceDoc]));

  const n = passages.length;
  const concepts: Concept[] = subConcepts
    .map((c): Concept => {
      const pids = c.passageIds.filter((pid) => havePids.has(pid));
      const df = pids.length;
      return {
        id: c.id,
        label: c.label,
        df,
        weight: Math.log(1 + n / Math.max(1, df)),
        passageIds: pids,
        important: c.important,
        definition: c.definition,
        definedByPassage:
          c.definedByPassage && havePids.has(c.definedByPassage) ? c.definedByPassage : undefined,
        kind: nodeKind(c),
        dimension: c.dimension,
      };
    })
    .filter((c) => c.passageIds.length > 0);

  const formulas = graph.formulas.filter((f) => f.conceptIds.some((id) => idSet.has(id)));
  annotateDepth(passages, docMap, concepts);
  const connections = buildConnections(passages, concepts);
  return { docs: docMap, passages, concepts, connections, formulas };
}

/** Typed, degreed edges within a subgraph, for the graph visualization. */
export type VizEdgeKind = EdgeKind | 'semantic';
export function subgraphEdges(
  graph: KnowledgeGraph,
  conceptIds: string[],
): { a: string; b: string; degree: number; intensity: number; kind: VizEdgeKind }[] {
  const idSet = new Set(conceptIds);
  const out = graph.edges
    .filter((e) => idSet.has(e.a) && idSet.has(e.b))
    .map((e) => ({ a: e.a, b: e.b, degree: edgeDegree(e), intensity: edgeIntensity(e), kind: e.kind as VizEdgeKind }));
  for (const e of graph.semanticEdges ?? []) {
    if (idSet.has(e.a) && idSet.has(e.b)) {
      out.push({ a: e.a, b: e.b, degree: e.degree, intensity: e.degree, kind: 'semantic' });
    }
  }
  return out;
}

/**
 * The knowledge graph as a SOURCE provider in the normal research fan-out: a
 * search returns the verbatim passages/docs already in the graph for this
 * topic, so prior curated material is pulled alongside the live sources. The
 * orchestrator's dedup drops anything the live providers also returned.
 */
export async function graphProviderSearch(
  query: string,
): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const g = await loadGraph();
  if (g.passages.length === 0) return { docs: [], passages: [] };
  // Pull genuinely RELEVANT material from your graph (that's the point) without drift.
  // ONE hop only: the runaway drift was a hop-2 leak (firewall → generic hub like
  // "system" → an unrelated dense cluster); hop-1 neighbours stay on-topic (firewall →
  // DMZ / router). seedFloor 6 = a real id/label/provenance match (never a lone token),
  // minRelevance trims weakly-related neighbours, and the result is capped so it
  // complements the live feed instead of dominating a thin one.
  const sub = searchGraph(g, query, {
    maxNodes: 9,
    maxHops: 1,
    seedFloor: 6,
    minRelevance: 0.2,
    coOccurOnly: true,
  });
  return { docs: sub.docs, passages: sub.passages.slice(0, 12) };
}
