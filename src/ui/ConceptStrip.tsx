import { useMemo } from 'react';
import type { Corpus, FeedCard } from '../types';

type Status = 'unseen' | 'seen' | 'grounded';

export function ConceptStrip({
  corpus,
  cards,
  viewedCardIds,
  onConceptClick,
}: {
  corpus: Corpus;
  cards: FeedCard[];
  viewedCardIds: Set<string>;
  onConceptClick: (conceptId: string) => void;
}) {
  const statuses = useMemo(() => {
    const map = new Map<string, Status>();
    for (const concept of corpus.concepts) map.set(concept.id, 'unseen');
    for (const card of cards) {
      if (!viewedCardIds.has(card.id)) continue;
      if (card.kind === 'passage') {
        for (const id of card.concepts) {
          const concept = corpus.concepts.find((c) => c.id === id);
          const grounded = concept?.definedByPassage === card.passage.id;
          map.set(id, grounded ? 'grounded' : map.get(id) === 'grounded' ? 'grounded' : 'seen');
        }
      } else if (card.kind === 'definition' || card.kind === 'formula') {
        map.set(card.conceptId, 'grounded');
      }
    }
    return map;
  }, [corpus, cards, viewedCardIds]);

  const sorted = useMemo(
    () => [...corpus.concepts].sort((a, b) => b.df - a.df),
    [corpus],
  );

  return (
    <div className="concept-strip" title="The threads of this topic — lit as you encounter them">
      {sorted.map((c) => (
        <button
          key={c.id}
          className={`concept-chip ${statuses.get(c.id)}`}
          onClick={() => onConceptClick(c.id)}
          title={`appears in ${c.df} excerpts${statuses.get(c.id) === 'grounded' ? ' · grounded' : ''}`}
        >
          {c.label}
          <span className="df">{c.df}</span>
        </button>
      ))}
    </div>
  );
}
