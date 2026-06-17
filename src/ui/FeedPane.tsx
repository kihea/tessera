import { useEffect, useMemo, useRef } from 'react';
import type { Session } from '../state/session';
import type { FeedCard } from '../types';
import { isGate } from '../types';
import { CardView } from './CardView';

interface Props {
  session: Session;
  registerEl: (cardId: string, el: HTMLElement | null) => void;
  onJump: (cardId: string) => void;
}

export function FeedPane({ session, registerEl, onJump }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { cards, completedGates, onCardVisible, onCardHidden } = session;

  // Reveal cards only up to (and including) the first uncleared gate. Anything
  // after a locked checkpoint / check stays hidden until it is answered.
  const { visible, lockedBy } = useMemo(() => {
    const out: FeedCard[] = [];
    let locked: FeedCard | null = null;
    for (const card of cards) {
      out.push(card);
      if (isGate(card) && !completedGates.has(card.id)) {
        locked = card;
        break;
      }
    }
    return { visible: out, lockedBy: locked };
  }, [cards, completedGates]);

  const cardsById = useMemo(() => {
    const m = new Map<string, { card: FeedCard; index: number }>();
    cards.forEach((card, index) => m.set(card.id, { card, index }));
    return m;
  }, [cards]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.cardId;
          if (!id) continue;
          const hit = cardsById.get(id);
          if (!hit) continue;
          if (entry.isIntersecting && !seen.has(id)) {
            seen.add(id);
            onCardVisible(hit.card, hit.index);
          } else if (!entry.isIntersecting && seen.has(id)) {
            seen.delete(id);
            onCardHidden(hit.card);
          }
        }
      },
      { root, threshold: 0.4 },
    );
    for (const el of root.querySelectorAll<HTMLElement>('[data-card-id]')) io.observe(el);
    return () => io.disconnect();
  }, [cardsById, visible, onCardVisible, onCardHidden]);

  return (
    <div className="feed-pane" ref={containerRef}>
      {visible.map((card) => (
        <div
          key={card.id}
          data-card-id={card.id}
          className="feed-slot"
          ref={(el) => registerEl(card.id, el)}
        >
          <CardView card={card} session={session} onJump={onJump} />
        </div>
      ))}
      {lockedBy && (
        <div className="lock-notice" aria-live="polite">
          <span className="lock-ico">🔒</span>
          {lockedBy.kind === 'checkpoint'
            ? 'Locked — write your connection above to keep going.'
            : 'Locked — answer the check above to keep going.'}
        </div>
      )}
    </div>
  );
}
