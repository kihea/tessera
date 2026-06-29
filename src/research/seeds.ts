// Curated seed works: a SHORT list of canonical papers per broad field, used
// SPARINGLY. Discovery is organic everywhere else (search relevance, citation
// harvesting); seeds only guarantee that the handful of works a field is
// actually built on cannot be missed when the query is broad ("artificial
// intelligence" -- whose Wikipedia article does not even cite "Attention Is
// All You Need"). Seeds are titles only: each one still resolves through the
// same verified OpenAlex lookup as any harvested citation, so the card carries
// the authors' own verbatim abstract or it does not appear at all.

const SEEDS: { match: RegExp; titles: string[] }[] = [
  {
    match:
      /\b(ai|artificial intelligence|machine learning|deep learning|neural net\w*|llms?|large language models?|transformers?|language models?|nlp|natural language|gpt|chatbots?|generative)\b/i,
    titles: [
      'Attention Is All You Need',
      'ImageNet Classification with Deep Convolutional Neural Networks',
      'Language Models are Few-Shot Learners',
      'Computing Machinery and Intelligence',
    ],
  },
  {
    match: /\b(fourier|signal processing|spectral analysis|fft|wavelets?)\b/i,
    titles: [
      'An Algorithm for the Machine Calculation of Complex Fourier Series',
      'Communication in the Presence of Noise',
    ],
  },
  {
    match: /\b(information theory|entropy|communication theory|data compression|coding theory)\b/i,
    titles: ['A Mathematical Theory of Communication'],
  },
];

/** Canonical titles for the first field the query matches, if any. */
export function seedTitlesFor(query: string): string[] {
  for (const seed of SEEDS) {
    if (seed.match.test(query)) return seed.titles;
  }
  return [];
}
