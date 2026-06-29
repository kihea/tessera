// Concept extraction: find the terms that recur ACROSS sources. A term that
// only one source uses is that source's vocabulary; a term many independent
// sources share is part of the topic's actual structure -- a thread worth
// weaving. Plain TF-IDF-style statistics, no model, fully inspectable.

import type { Concept, Passage } from '../types';
import { stripUrls } from '../research/net';

const STOP = new Set(
  (
    // URL fragments: tokenization strips whole URLs, but stray pieces ("www",
    // "com" in a bare domain mention) must never weave either.
    'http https www com org net edu gov html htm php pdf url link links website site sites blog wiki ' +
    'a an the and or but nor so yet for of in on at to from by with about into over after before ' +
    'between under above below up down out off again further then once here there all any both each ' +
    'few more most other some such no not only own same than too very can will just should now this ' +
    'that these those it its is are was were be been being have has had having do does did doing would ' +
    'could may might must shall what which who whom whose when where why how if because as until while ' +
    'their they them he she his her him you your yours we our ours i me my mine also one two three ' +
    'many much like get got make made use used using way ways thing things something anything new old ' +
    'first second often usually within without however whereas nevertheless nonetheless moreover ' +
    'furthermore meanwhile conversely albeit notwithstanding regardless despite therefore thus although though since even still ' +
    'rather really quite per via etc example called known see refer based given take takes taken need ' +
    'needs different several including include includes around among during against able less least ' +
    'lot point case cases part parts kind sort means typically generally specifically particular ' +
    'people time year years day days work works well good better best say says said another every ' +
    // meta-words that describe discourse rather than the topic itself
    'term terms word phrase name fact facts question questions answer answers argument claim claims ' +
    'article page section chapter author writer reader comment post thread topic subject discussion ' +
    'paper papers abstract abstracts study studies become becomes became becoming ' +
    'according considered consider example examples through throughout regarding concerning whereby thereby ' +
    // generic method/discourse filler that recurs across any technical corpus
    'specific various certain approach approaches result results process processes number numbers ' +
    'method methods involved involving related relating associated due based common single multiple'
  ).split(/\s+/),
);

// Generic adjectives/quantifiers and catch-all nouns that recur across ANY
// corpus. They can still appear inside a meaningful bigram ("energy level"),
// but on their own they are not threads worth defining or quizzing -- exactly
// the "level"/"low" problem. Kept as a soft demotion + importance gate rather
// than a hard stop so bigrams survive.
const GENERIC = new Set(
  (
    'low high higher lower large small big huge long short overall total main basic simple general ' +
    'common average standard normal typical broad wide narrow major minor full current recent modern ' +
    'early late good great strong weak similar different level levels amount kind area areas type types ' +
    'range degree extent factor factors aspect aspects feature features element elements ' +
    // generic change/quantity/abstract nouns and verbs that recur in any corpus
    'increase increases rise rises rising fall falls decline declines decrease decreases change changes ' +
    'cost costs effect effects impact impacts set sets real future past present economic role roles ' +
    'value values measure measures group groups system systems important trend trends period periods ' +
    'negative positive central simple complex large-scale ' +
    // generic verbs of making/communicating that recur in any narrative corpus
    'read reads reading developed develop develops developing written wrote writes sent send sends ' +
    // bare time-and-place words: when they matter, they appear in a bigram
    'century centuries decade decades era eras month months early-modern world country countries ' +
    // vague abstractions that test nothing on their own ("power", "ideas")
    'interest interests power powers idea ideas history histories earlier later ' +
    // bare qualifiers: meaningful only attached to a noun ("finite sequence",
    // "continuous function") -- the bigram survives, the naked adjective never
    // anchors a question ("where do dft and finite disagree" must not happen)
    'finite infinite discrete continuous linear nonlinear arbitrary exact approximate ' +
    'equivalent corresponding respective constant constants variable variables uniform ' +
    'maximum minimum optimal initial final original modern contemporary ' +
    // task-shaped filler: every instructional corpus is full of these
    'task tasks goal goals purpose purposes problem problems solution solutions'
  ).split(/\s+/),
);

/**
 * Is this concept id generic filler -- a unigram from the GENERIC set? Such a
 * term may still appear as a chip or inside a bigram, but it must never be
 * defined, quizzed, or woven into a checkpoint on its own.
 */
export function isGenericTerm(id: string): boolean {
  return !id.includes(' ') && GENERIC.has(id);
}

function isGenericUnigram(key: string, isBigram: boolean): boolean {
  return !isBigram && GENERIC.has(key);
}

// -- Part-of-speech: keep a checkpoint question grammatical. A thread used in
// "the link between {a} and {b}" or "what would {b} look like without {a}" must
// read as a NOUN PHRASE. A bare adjective ("ancient", "medieval") slipping in as
// a standalone concept makes the question nonsensical -- "the link between
// ancient and schools" pairs an adjective with a noun. We detect adjective-
// HEADED labels deterministically (a curated lexicon + a few high-precision
// suffixes) the same way STOP/GENERIC work, no model or NLP dependency. A label
// is fine as long as its HEAD (last word) is nominal: "ancient schools" weaves,
// the naked "ancient" never does.
const ADJECTIVES = new Set(
  (
    // time / period
    'ancient medieval mediaeval prehistoric archaic classical contemporary modern premodern colonial ' +
    'imperial feudal victorian byzantine ottoman roman greek persian ' +
    // domain qualifiers (recur constantly in encyclopedic prose, never threads alone)
    'political social economic economical cultural religious secular spiritual military naval civil ' +
    'national international transnational global worldwide regional municipal provincial federal ' +
    'eastern western northern southern rural urban suburban foreign domestic indigenous ethnic racial ' +
    'tribal linguistic legal illegal constitutional judicial legislative administrative bureaucratic ' +
    'financial commercial industrial agricultural agrarian scientific academic intellectual ' +
    'philosophical literary artistic aesthetic poetic dramatic moral ethical formal informal official ' +
    'physical chemical biological mathematical statistical theoretical practical technical mechanical ' +
    'electrical digital natural artificial organic synthetic public private personal collective communal ' +
    'medical surgical clinical genetic molecular atomic nuclear thermal optical acoustic ' +
    // size / degree / pace
    'vast huge tiny immense massive gigantic enormous minute miniature rapid gradual sudden immediate ' +
    'temporary permanent perpetual eternal mutual reciprocal primary secondary tertiary ultimate ' +
    'significant substantial considerable notable remarkable prominent dominant prevalent widespread ' +
    'ubiquitous essential fundamental crucial vital pivotal paramount inherent intrinsic implicit ' +
    'explicit apparent evident obvious distinct separate unique peculiar complicated intricate elaborate ' +
    'sophisticated advanced primitive efficient productive robust durable fragile stable unstable ' +
    'volatile flexible rigid elastic accurate precise correct incorrect valid invalid reliable ' +
    'consistent coherent relevant irrelevant appropriate suitable adequate sufficient insufficient ' +
    'beneficial harmful dangerous hazardous toxic lethal fatal deadly visible invisible transparent ' +
    'opaque vertical horizontal diagonal parallel perpendicular circular spherical cylindrical ' +
    // colour / sensory / plain descriptive
    'ancient pale bright dark vivid dull smooth rough sharp blunt heavy gentle violent silent loud ' +
    'wealthy poor noble humble sacred profane holy divine mortal'
  ).split(/\s+/),
);

// Words ending in an "adjectival" suffix that are nevertheless nouns -- the
// suffix test must not suppress them.
const ADJ_SUFFIX_NOUN_EXCEPTIONS = new Set(
  'handful mouthful spoonful armful house chorus census campus virus bonus genus focus consensus'.split(
    /\s+/,
  ),
);

/** Does this single word read as an adjective (so it can't head a noun phrase)? */
function isAdjectivalWord(word: string): boolean {
  if (ADJECTIVES.has(word)) return true;
  if (word.length <= 4 || ADJ_SUFFIX_NOUN_EXCEPTIONS.has(word)) return false;
  // High-precision suffixes: -ous (numerous, dangerous), -ful (useful), -less
  // (endless). Deliberately conservative -- -ic/-ive/-al/-ary have too many noun
  // homographs (logic, motive, ritual, summary), so those rely on the lexicon.
  return /(ous|ful|less)$/.test(word);
}

/**
 * Is the label adjective-HEADED -- i.e. its last word is an adjective, so it
 * cannot stand as a noun phrase in a checkpoint question? "ancient" and
 * "purely theoretical" fail; "ancient schools" and "schools" pass (noun head).
 */
export function isAdjectiveHeaded(label: string): boolean {
  const words = label.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return isAdjectivalWord(words[words.length - 1]);
}

function tokenize(text: string): string[] {
  return stripUrls(text)
    .toLowerCase()
    .replace(/[^a-z0-9'’-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, '').replace(/['’]s$/, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Naive singular/plural folding so "models" and "model" weave together. */
export function normalizeTerm(term: string): string {
  return term
    .split(' ')
    .map((w) => {
      if (w.length > 5 && /(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2); // presses -> press
      if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
      return w;
    })
    .join(' ');
}

interface Candidate {
  passages: Set<string>;
  surfaces: Map<string, number>;
  isBigram: boolean;
}

export function extractConcepts(passages: Passage[], query: string, max = 24): Concept[] {
  const queryTokens = new Set(tokenize(query).map(normalizeTerm));
  const candidates = new Map<string, Candidate>();

  const note = (key: string, surface: string, passageId: string, isBigram: boolean) => {
    let c = candidates.get(key);
    if (!c) {
      c = { passages: new Set(), surfaces: new Map(), isBigram };
      candidates.set(key, c);
    }
    c.passages.add(passageId);
    c.surfaces.set(surface, (c.surfaces.get(surface) ?? 0) + 1);
  };

  for (const passage of passages) {
    const tokens = tokenize(passage.text);
    for (let i = 0; i < tokens.length; i++) {
      const uni = normalizeTerm(tokens[i]);
      if (!queryTokens.has(uni)) note(uni, tokens[i], passage.id, false);
      if (i + 1 < tokens.length) {
        const bi = normalizeTerm(`${tokens[i]} ${tokens[i + 1]}`);
        // A bigram may include a query token ("language model" for query
        // "language models") as long as it is not the query itself.
        if (![...queryTokens].every((q) => bi.includes(q)) || queryTokens.size === 0) {
          note(bi, `${tokens[i]} ${tokens[i + 1]}`, passage.id, true);
        }
      }
    }
  }

  const n = passages.length;
  const minDf = n >= 14 ? 3 : 2;
  const scored: { key: string; c: Candidate; score: number }[] = [];
  for (const [key, c] of candidates) {
    const df = c.passages.size;
    if (df < minDf) continue;
    if (df > Math.max(4, n * 0.6)) continue; // ubiquitous = not discriminating
    // Multi-word terms are the most specific; generic single words are demoted
    // hard so meaningful threads win the limited concept slots. An adjective-
    // headed label is demoted the same way -- it can still surface as a chip but
    // should not win a slot over a real noun-phrase thread.
    const demoted = isGenericUnigram(key, c.isBigram) || isAdjectiveHeaded(key);
    const score = df * (c.isBigram ? 2.1 : 1) * (demoted ? 0.3 : 1);
    scored.push({ key, c, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // Prefer a bigram over the unigrams it contains when the bigram carries
  // most of the unigram's occurrences ("neural network" beats "neural").
  const corpusTextEarly = passages.map((p) => p.text).join('\n');
  const isAcronymWord = (w: string) =>
    w.length <= 5 && acronymCase(w, corpusTextEarly) === w.toUpperCase();
  const chosen: { key: string; c: Candidate }[] = [];
  for (const cand of scored) {
    if (chosen.length >= max) break;
    if (!cand.c.isBigram) {
      const swallowed = chosen.some(
        (b) => b.c.isBigram && b.key.split(' ').includes(cand.key) && b.c.passages.size >= cand.c.passages.size * 0.55,
      );
      if (swallowed) continue;
    } else {
      const dupe = chosen.some((b) => b.key === cand.key);
      if (dupe) continue;
      // "transform dft" is a window artifact of "...transform (DFT)": when a
      // bigram contains an acronym that recurs MORE on its own, the acronym is
      // the real thread and the bigram is noise.
      const fragment = cand.key.split(' ').some((w) => {
        if (!isAcronymWord(w)) return false;
        const uni = candidates.get(w);
        return !!uni && uni.passages.size >= cand.c.passages.size;
      });
      if (fragment) continue;
    }
    chosen.push(cand);
  }

  const minDf2 = n >= 14 ? 3 : 2;
  const corpusText = passages.map((p) => p.text).join('\n');
  return chosen.map(({ key, c }) => {
    let bestSurface = key;
    let bestCount = -1;
    for (const [surface, count] of c.surfaces) {
      if (count > bestCount) {
        bestCount = count;
        bestSurface = surface;
      }
    }
    bestSurface = acronymCase(bestSurface, corpusText);
    const df = c.passages.size;
    // Meaningful enough to anchor a reference card, a check, or a checkpoint:
    // a specific multi-word term, or a single word that recurs widely and is
    // not generic filler. Generic unigrams ("level") and adjective-headed labels
    // ("ancient") can still appear as chips but never get defined or quizzed --
    // an adjective can't head the noun phrase a checkpoint question needs.
    const important =
      (c.isBigram || df >= minDf2 + 1) &&
      !isGenericUnigram(key, c.isBigram) &&
      !isAdjectiveHeaded(bestSurface);
    return {
      id: key,
      label: bestSurface,
      df,
      weight: Math.log(1 + n / df),
      passageIds: [...c.passages],
      important,
    };
  });
}

/**
 * Tokenization lowercases everything, so "DFT" would display (and be asked
 * about) as "dft". When the sources themselves write a short term in capitals
 * most of the time, restore that casing for the label.
 */
function acronymCase(surface: string, corpusText: string): string {
  if (surface.length > 6 || surface.includes(' ')) return surface;
  const esc = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hits = corpusText.match(new RegExp(`\\b${esc}(?:s|es)?\\b`, 'gi')) ?? [];
  if (hits.length === 0) return surface;
  const upper = hits.filter((h) => {
    const stem = h.replace(/(?:es|s)$/i, '');
    return stem === stem.toUpperCase();
  }).length;
  return upper / hits.length >= 0.6 ? surface.toUpperCase() : surface;
}

/** Which of the given concepts appear in this passage? (id list) */
export function conceptsIn(passage: Passage, concepts: Concept[]): string[] {
  return concepts.filter((c) => c.passageIds.includes(passage.id)).map((c) => c.id);
}
