// Query typing: is the learner asking about a PERSON, an EVENT, a PHILOSOPHY,
// or a general TOPIC? The answer steers what kinds of real material the engine
// gathers (expand.ts) -- a person wants reporting and assessment across eras, an
// event wants every angle and its aftermath, a philosophy wants its rivals and
// criticisms laid out at length. We never write content; we only decide what to
// go and find. Best-effort and conservative: anything unclear stays 'topic',
// which is exactly today's behavior.

import type { Passage, SourceDoc } from '../types';

export type QueryType = 'person' | 'event' | 'philosophy' | 'topic';

// The encyclopedic lead sentence is the tell: "X is an American politician...",
// "The Y was a war fought...", "Z is a school of thought...". We read it off the
// seed corpus rather than guessing from the bare string.
const PERSON_ROLE =
  /\b(?:is|was|are|were)\s+(?:an?\s+|the\s+)?(?:[a-z]+\s+){0,4}(politician|philosopher|writer|author|scientist|physicist|chemist|biologist|astronomer|artist|composer|president|monarch|king|queen|emperor|empress|general|economist|mathematician|poet|musician|singer|actor|actress|director|leader|theologian|psychologist|sociologist|activist|painter|sculptor|novelist|playwright|journalist|engineer|inventor|entrepreneur|athlete|footballer|statesman|stateswoman|diplomat|revolutionary|theorist|historian|critic|saint|prophet|monk|priest|pope|explorer|pioneer)\b/i;
const PERSON_BORN = /\(\s*(?:born\b|b\.\s|\d{1,2}\s+\w+\s+\d{3,4}\b)|\bwas born\b|\bborn\s+(?:on\s+|in\s+)?\d/i;

const EVENT_NOUN =
  /\b(?:was|were|is|began|broke out)\s+(?:an?\s+|the\s+)?(?:[a-z]+\s+){0,4}(war|battle|revolution|election|crisis|massacre|treaty|rebellion|uprising|insurrection|disaster|pandemic|epidemic|plague|scandal|conflict|campaign|siege|invasion|coup|protest|riot|strike|earthquake|flood|famine|genocide|assassination|expedition|conference|summit|trial|movement|reformation|renaissance|depression|recession|boom)\b/i;

const PHILOSOPHY_KW =
  /\b(philosophy|ideology|doctrine|school of thought|schools of thought|ethics|metaphysics|epistemology|ontology|worldview|belief system|theology|moral theory|political theory|philosophical|tenets|the view that|the position that|the thesis that)\b/i;

/** Pull the most encyclopedic lead text we have, for the "is/was a ..." tell. */
function leadText(passages: Passage[], docs: Map<string, SourceDoc>): string {
  const score = (p: Passage) => {
    const t = docs.get(p.docId)?.sourceType;
    return (t === 'encyclopedia' ? 4 : t === 'reference' ? 3 : t === 'textbook' ? 2 : 1) - p.index * 0.1;
  };
  return [...passages]
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3)
    .map((p) => p.text)
    .join(' ')
    .slice(0, 1200);
}

export function classifyQuery(
  query: string,
  passages: Passage[],
  docs: Map<string, SourceDoc>,
): QueryType {
  const lead = leadText(passages, docs);
  const q = query.trim();

  // Person: an encyclopedic role or a birth marker in the lead.
  if (PERSON_ROLE.test(lead) || PERSON_BORN.test(lead)) return 'person';

  // Event: an event noun in the lead, or a year in the query alongside one.
  if (EVENT_NOUN.test(lead)) return 'event';
  if (/\b(1[0-9]\d{2}|20\d{2})\b/.test(q) && EVENT_NOUN.test(lead + ' ' + q)) return 'event';

  // Philosophy / ideology: an "-ism" head, or the doctrine vocabulary.
  if (/\b[a-z]{4,}ism\b/i.test(q) && !/\b(?:tourism|baptism|organism|mechanism|metabolism|prism|schism)\b/i.test(q))
    return 'philosophy';
  if (PHILOSOPHY_KW.test(lead) || PHILOSOPHY_KW.test(q)) return 'philosophy';

  return 'topic';
}
