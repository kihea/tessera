// Curated, verified library of trustworthy INTRODUCTORY YouTube videos, mapped
// to the big-ticket topics a general user searches (AI, calculus, evolution,
// philosophy, the world wars, ...). Baked into the bundle: KEYLESS and
// FETCH-FREE, so it works in BOTH the web and desktop builds -- the reliable
// backbone next to the live, desktop-only YouTube feed. Each match is embedded
// WHOLE (no clipping); the card's verbatim text is the creator's own title.
// Every videoId below was verified via YouTube oEmbed at curation time.
//
// This file is generated (see gen-baked.cjs in git history) but is plain data
// -- edit by hand to add/remove videos.

import type { Passage, SourceDoc } from '../types';
import { freshId, queryTokens } from './net';

export interface BakedVideo {
  videoId: string;
  channel: string;
  title: string;
  topics: string[];
  minutes: number | null;
}

export const BAKED_VIDEOS: BakedVideo[] = [
  { videoId: "aircAruvnKk", channel: "3Blue1Brown", title: "But what is a neural network? | Deep learning chapter 1", topics: ["neural networks","deep learning","how neural networks work","neurons weights and biases","handwritten digit recognition"], minutes: 19 },
  { videoId: "IHZwWFHWa-w", channel: "3Blue1Brown", title: "Gradient descent, how neural networks learn | Deep Learning Chapter 2", topics: ["gradient descent","how neural networks learn","machine learning training","cost function","backpropagation intuition"], minutes: 21 },
  { videoId: "wjZofJX0v4M", channel: "3Blue1Brown", title: "Transformers, the tech behind LLMs | Deep Learning Chapter 5", topics: ["transformers","large language models","how GPT works","what is a GPT","generative ai"], minutes: 27 },
  { videoId: "O5nskjZ_GoI", channel: "CrashCourse", title: "Early Computing: Crash Course Computer Science #1", topics: ["history of computing","how computers work","computer science basics","early computers","difference engine"], minutes: 12 },
  { videoId: "gI-qXk7XojA", channel: "CrashCourse", title: "Boolean Logic & Logic Gates: Crash Course Computer Science #3", topics: ["boolean logic","logic gates","AND OR NOT","transistors","how computers compute"], minutes: 11 },
  { videoId: "fa8k8IQ1_X0", channel: "Kurzgesagt – In a Nutshell", title: "A.I. – Humanity's Final Invention?", topics: ["artificial intelligence","artificial superintelligence","future of ai","ai safety","what is ai"], minutes: 17 },
  { videoId: "R9OHn5ZF4Uo", channel: "CGP Grey", title: "AI Can't Explain How AI Works", topics: ["how machines learn","machine learning","ai interpretability","neural networks black box","training algorithms"], minutes: 9 },
  { videoId: "Cgxsv1riJhI", channel: "TED", title: "How computers learn to recognize objects instantly | Joseph Redmon", topics: ["computer vision","object detection","how computers see","image recognition","neural networks in practice"], minutes: 8 },
  { videoId: "6hfOvs8pY1k", channel: "TED-Ed", title: "What's an algorithm? - David J. Malan", topics: ["what is an algorithm","algorithms","problem solving","computer science fundamentals","step by step instructions"], minutes: 5 },
  { videoId: "J8hzJxb0rpc", channel: "TED-Ed", title: "What is the world wide web? - Twila Camp", topics: ["world wide web","how the internet works","web vs internet","hyperlinks","web pages"], minutes: 4 },
  { videoId: "aD_yi5VjF78", channel: "Khan Academy", title: "Packet, routers, and reliability | Internet 101 | Computer Science | Khan Academy", topics: ["how the internet works","packets","routers","internet reliability","data transmission"], minutes: 6 },
  { videoId: "A5w-dEgIU1M", channel: "Veritasium", title: "The Equation That Beat Wall Street", topics: ["mathematical models","black-scholes equation","math in the real world","quantitative modeling","physics and finance"], minutes: 31 },
  { videoId: "WUvTyaaNkzM", channel: "3Blue1Brown", title: "The essence of calculus", topics: ["what is calculus","derivatives and integrals","area of a circle","fundamental theorem of calculus","intuition behind calculus"], minutes: 17 },
  { videoId: "9vKqVkMQHKk", channel: "3Blue1Brown", title: "The paradox of the derivative | Chapter 2, Essence of calculus", topics: ["what is a derivative","instantaneous rate of change","slope of a curve","dx and dt","limits intuition"], minutes: 17 },
  { videoId: "YG15m2VwSjA", channel: "3Blue1Brown", title: "Visualizing the chain rule and product rule | Chapter 4, Essence of calculus", topics: ["chain rule","product rule","differentiation rules","why derivative rules work","visual calculus"], minutes: 13 },
  { videoId: "rfG8ce4nNh0", channel: "3Blue1Brown", title: "Integration and the fundamental theorem of calculus | Chapter 8, Essence of calculus", topics: ["integration","fundamental theorem of calculus","area under a curve","antiderivatives","integrals vs derivatives"], minutes: 21 },
  { videoId: "fNk_zzaMoSs", channel: "3Blue1Brown", title: "Vectors | Chapter 1, Essence of linear algebra", topics: ["what is a vector","vectors geometrically","vector addition","scalar multiplication","linear algebra basics"], minutes: 10 },
  { videoId: "kYB8IZa5AuE", channel: "3Blue1Brown", title: "Linear transformations and matrices | Chapter 3, Essence of linear algebra", topics: ["linear transformations","what is a matrix","matrices transform space","matrix multiplication intuition","basis vectors"], minutes: 11 },
  { videoId: "PFDu9oVAE-g", channel: "3Blue1Brown", title: "Eigenvectors and eigenvalues | Chapter 14, Essence of linear algebra", topics: ["eigenvectors","eigenvalues","what are eigenvectors","diagonalization intuition","linear algebra"], minutes: 17 },
  { videoId: "zeJD6dqJ5lo", channel: "3Blue1Brown", title: "But what is the Central Limit Theorem?", topics: ["central limit theorem","normal distribution","bell curve","why gaussian","mean and variance"], minutes: 31 },
  { videoId: "8idr1WZ1A7Q", channel: "3Blue1Brown", title: "Binomial distributions | Probabilities of probabilities, part 1", topics: ["binomial distribution","probability basics","what is probability","estimating probabilities","bayesian thinking"], minutes: 14 },
  { videoId: "HZGCoVF3YvM", channel: "3Blue1Brown", title: "Bayes theorem, the geometry of changing beliefs", topics: ["bayes theorem","conditional probability","updating beliefs","prior and posterior","probability intuition"], minutes: 15 },
  { videoId: "lG4VkPoG3ko", channel: "3Blue1Brown", title: "The medical test paradox, and redesigning Bayes' rule", topics: ["bayes rule","medical test accuracy","false positives","conditional probability","likelihood ratios"], minutes: 21 },
  { videoId: "sxYrzzy3cq8", channel: "TED-Ed", title: "How statistics can be misleading - Mark Liddell", topics: ["misleading statistics","simpson's paradox","data interpretation","averages and aggregation","statistical reasoning"], minutes: 4 },
  { videoId: "spUNpyF58BY", channel: "3Blue1Brown", title: "But what is the Fourier Transform? A visual introduction.", topics: ["fourier transform","frequency decomposition","signals and waves","what is fourier","math of sound"], minutes: 20 },
  { videoId: "YompsDlEdtc", channel: "TED-Ed", title: "How many ways are there to prove the Pythagorean theorem? - Betty Fei", topics: ["pythagorean theorem","mathematical proof","geometry","euclid garfield einstein proofs","what is a proof"], minutes: 5 },
  { videoId: "SjSHVDfXHQ4", channel: "TED", title: "The magic of Fibonacci numbers | Arthur Benjamin | TED", topics: ["fibonacci numbers","golden ratio","patterns in math","why math is beautiful","number sequences"], minutes: 6 },
  { videoId: "Zrv1EDIqHkY", channel: "Veritasium", title: "The Oldest Unsolved Problem in Math", topics: ["perfect numbers","unsolved problems","number theory","what makes math hard","open questions in math"], minutes: 23 },
  { videoId: "ZM8ECpBuQYE", channel: "CrashCourse", title: "Motion in a Straight Line: Crash Course Physics #1", topics: ["motion","kinematics","velocity and acceleration","displacement","classical mechanics intro"], minutes: 10 },
  { videoId: "kKKM8Y-u7ds", channel: "CrashCourse", title: "Newton's Laws: Crash Course Physics #5", topics: ["newton's laws of motion","force","inertia","action and reaction","mass vs weight"], minutes: 10 },
  { videoId: "Xc4xYacTu-E", channel: "Vsauce", title: "Which Way Is Down?", topics: ["gravity","weight vs mass","free fall","spacetime","center of mass"], minutes: 26 },
  { videoId: "1rLWVZVWfdY", channel: "minutephysics", title: "Why is Relativity Hard? | Special Relativity Chapter 1", topics: ["special relativity","einstein","relativity of motion","frames of reference","speed of light"], minutes: 8 },
  { videoId: "bHIhgxav9LY", channel: "Veritasium", title: "The Biggest Misconception About Electricity", topics: ["electricity","electromagnetism","electric fields","how circuits work","energy flow"], minutes: 14 },
  { videoId: "4i1MUWJoI0U", channel: "CrashCourse", title: "Thermodynamics: Crash Course Physics #23", topics: ["thermodynamics","heat and temperature","laws of thermodynamics","entropy","perpetual motion"], minutes: 10 },
  { videoId: "p7bzE1E5PMY", channel: "udiprod", title: "Visualization of Quantum Physics (Quantum Mechanics)", topics: ["quantum mechanics","wave function","wave-particle duality","probability","quantum visualization"], minutes: 5 },
  { videoId: "TQKELOE9eY4", channel: "TED-Ed", title: "What is the Heisenberg Uncertainty Principle? - Chad Orzel", topics: ["heisenberg uncertainty principle","quantum mechanics","position and momentum","wave-particle duality","measurement"], minutes: 5 },
  { videoId: "JhHMJCUmq28", channel: "Kurzgesagt – In a Nutshell", title: "Quantum Computers Explained – Limits of Human Technology", topics: ["quantum computing","qubits","superposition","quantum tunneling","limits of computing"], minutes: 7 },
  { videoId: "FSyAehMdpyI", channel: "CrashCourse", title: "The Nucleus: Crash Course Chemistry #1", topics: ["atoms","atomic nucleus","protons and neutrons","isotopes","atomic structure"], minutes: 10 },
  { videoId: "xazQRcSCRaY", channel: "TED-Ed", title: "The 2,400-year search for the atom - Theresa Doud", topics: ["history of the atom","atomic theory","dalton","electrons","atomic model"], minutes: 5 },
  { videoId: "fPnwBITSmgU", channel: "TED-Ed", title: "The genius of Mendeleev's periodic table - Lou Serico", topics: ["periodic table","mendeleev","elements","periodic trends","predicting elements"], minutes: 4 },
  { videoId: "QXT4OVM4vXI", channel: "CrashCourse", title: "Atomic Hook-Ups - Types of Chemical Bonds: Crash Course Chemistry #22", topics: ["chemical bonding","covalent bonds","ionic bonds","electronegativity","molecules"], minutes: 10 },
  { videoId: "UL1jmJaUkaQ", channel: "CrashCourse", title: "Stoichiometry - Chemistry for Massive Creatures: Crash Course Chemistry #6", topics: ["chemical reactions","stoichiometry","the mole","balancing equations","reactants and products"], minutes: 11 },
  { videoId: "hOfRN0KihOU", channel: "Kurzgesagt – In a Nutshell", title: "How Evolution works", topics: ["evolution","natural selection","mutation","how species change","survival of the fittest"], minutes: 11 },
  { videoId: "aTftyFboC_M", channel: "CrashCourse", title: "Natural Selection - Crash Course Biology #14", topics: ["natural selection","evolution","adaptation","fitness","darwin"], minutes: 12 },
  { videoId: "cj8dDTHGJBY", channel: "CrashCourse", title: "Eukaryopolis - The City of Animal Cells: Crash Course Biology #4", topics: ["cells","organelles","nucleus","mitochondria","animal cell structure"], minutes: 11 },
  { videoId: "L0k-enzoeOM", channel: "CrashCourse", title: "Mitosis: Splitting Up is Complicated - Crash Course Biology #12", topics: ["mitosis","cell division","cell cycle","chromosomes","how cells copy themselves"], minutes: 10 },
  { videoId: "8kK2zwjRV0M", channel: "CrashCourse", title: "DNA Structure and Replication: Crash Course Biology #10", topics: ["dna","double helix","base pairs","dna replication","nucleotides"], minutes: 12 },
  { videoId: "CBezq1fFUEA", channel: "CrashCourse", title: "Heredity: Crash Course Biology #9", topics: ["heredity","genetics","mendel","dominant and recessive genes","inheritance"], minutes: 13 },
  { videoId: "sjE-Pkjp3u4", channel: "CrashCourse", title: "The History of Life on Earth - Crash Course Ecology #1", topics: ["history of life","ecology","mass extinctions","geologic time","origin of life"], minutes: 11 },
  { videoId: "zQGOcOUBi6s", channel: "Kurzgesagt – In a Nutshell", title: "The Immune System Explained I – Bacteria Infection", topics: ["immune system","white blood cells","bacteria infection","how the body fights germs","antibodies"], minutes: 7 },
  { videoId: "uU_4uA6-zcE", channel: "TED-Ed", title: "How do nerves work? - Elliot Krane", topics: ["nerves","neurons","nervous system","electrical signals","how the body senses"], minutes: 5 },
  { videoId: "qPix_X-9t7E", channel: "CrashCourse", title: "The Nervous System, Part 1: Crash Course Anatomy & Physiology #8", topics: ["nervous system","neurons","central nervous system","brain and spinal cord","glial cells"], minutes: 11 },
  { videoId: "H6u0VBqNBQ8", channel: "Kurzgesagt – In a Nutshell", title: "The Origin of Consciousness – How Unaware Things Became Aware", topics: ["consciousness","awareness","the brain","mind","evolution of consciousness"], minutes: 10 },
  { videoId: "xvjK-4NXRsM", channel: "TED-Ed", title: "What happens when you have a concussion? - Clifford Robbins", topics: ["concussion","brain injury","the brain","head trauma","neuroscience basics"], minutes: 5 },
  { videoId: "ruM4Xxhx32U", channel: "TED-Ed", title: "How the heart actually pumps blood - Edmond Hui", topics: ["heart","circulatory system","how blood pumps","ventricles","human anatomy"], minutes: 5 },
  { videoId: "FN3MFhYPWWo", channel: "TED-Ed", title: "How do your kidneys work? - Emma Bryce", topics: ["kidneys","filtration","human anatomy","waste removal","nephron"], minutes: 4 },
  { videoId: "YnCJU6PaCio", channel: "CrashCourse", title: "What Is Sociology?: Crash Course Sociology #1", topics: ["what is sociology","sociological perspective","social sciences","origins of sociology","studying society"], minutes: 9 },
  { videoId: "bSycdIx-C48", channel: "CrashCourse", title: "How We Make Memories: Crash Course Psychology #13", topics: ["how memory works","short-term and long-term memory","encoding and recall","working memory","mnemonics"], minutes: 11 },
  { videoId: "yOgAbKJGrTA", channel: "TED-Ed", title: "How memories form and how we lose them - Catharine Young", topics: ["how memories form","memory loss","long-term potentiation","synapses","forgetting"], minutes: 5 },
  { videoId: "qG2SwE_6uVM", channel: "CrashCourse", title: "How to Train a Brain: Crash Course Psychology #11", topics: ["classical conditioning","operant conditioning","pavlov","skinner box","reinforcement"], minutes: 10 },
  { videoId: "WuyPuH9ojCE", channel: "TED-Ed", title: "How stress affects your brain - Madhumita Murgia", topics: ["how stress affects the brain","chronic stress","cortisol","hippocampus","stress and memory"], minutes: 4 },
  { videoId: "wuhJ-GkRRQc", channel: "CrashCourse", title: "Psychological Disorders: Crash Course Psychology #28", topics: ["psychological disorders","mental illness","what is a disorder","dsm-5","biopsychosocial model"], minutes: 10 },
  { videoId: "ZwMlHkWKDwM", channel: "CrashCourse", title: "Depressive and Bipolar Disorders: Crash Course Psychology #30", topics: ["depression","bipolar disorder","mood disorders","causes of depression","mental health"], minutes: 10 },
  { videoId: "f_OPjYQovAE", channel: "TED-Ed", title: "The science of falling in love - Shannon Odell", topics: ["science of love","brain and attraction","dopamine and bonding","attachment","neuroscience of relationships"], minutes: 5 },
  { videoId: "n3Xv_g3g-mA", channel: "Kurzgesagt – In a Nutshell", title: "Loneliness", topics: ["loneliness","social isolation","mental health","loneliness and health","why we feel lonely"], minutes: 10 },
  { videoId: "3ez10ADR_gM", channel: "CrashCourse", title: "Intro to Economics: Crash Course Econ #1", topics: ["what is economics","scarcity","opportunity cost","micro vs macroeconomics","tradeoffs"], minutes: 11 },
  { videoId: "g9aDizJpd_s", channel: "CrashCourse", title: "Supply and Demand: Crash Course Economics #4", topics: ["supply and demand","market equilibrium","prices","how markets work","demand curve"], minutes: 11 },
  { videoId: "T8-85cZRI9o", channel: "CrashCourse", title: "Inflation and Bubbles and Tulips: Crash Course Economics #7", topics: ["inflation","deflation","why prices rise","economic bubbles","cost of living"], minutes: 10 },
  { videoId: "Dugn51K_6WA", channel: "CrashCourse", title: "Money and Finance: Crash Course Economics #11", topics: ["what is money","functions of money","currency","finance and lending","interest"], minutes: 11 },
  { videoId: "emyi4z-O0ls", channel: "TED-Ed", title: "How to outsmart the Prisoner's Dilemma - Lucas Husted", topics: ["prisoners dilemma","game theory","cooperation vs defection","nash equilibrium","strategic decision making"], minutes: 5 },
  { videoId: "1A_CAkYt3GY", channel: "CrashCourse", title: "What is Philosophy?: Crash Course Philosophy #1", topics: ["what is philosophy","branches of philosophy","metaphysics","epistemology","ethics","value theory"], minutes: 9 },
  { videoId: "NKEhdsnKKHs", channel: "CrashCourse", title: "How to Argue - Philosophical Reasoning: Crash Course Philosophy #2", topics: ["how to argue","logic","deductive arguments","premises and conclusions","philosophical reasoning","valid arguments"], minutes: 9 },
  { videoId: "kXhJ3hHK9hQ", channel: "CrashCourse", title: "The Meaning of Knowledge: Crash Course Philosophy #7", topics: ["epistemology","what is knowledge","justified true belief","belief vs knowledge","gettier problem","justification"], minutes: 9 },
  { videoId: "FOoffXFpAlU", channel: "CrashCourse", title: "Metaethics: Crash Course Philosophy #32", topics: ["metaethics","moral realism","cultural relativism","moral subjectivism","right and wrong","moral truth"], minutes: 9 },
  { videoId: "PrvtOWEXDIQ", channel: "CrashCourse", title: "Aristotle & Virtue Theory: Crash Course Philosophy #38", topics: ["virtue ethics","aristotle","golden mean","character and virtue","eudaimonia","how to live well"], minutes: 9 },
  { videoId: "-a739VjqdSI", channel: "CrashCourse", title: "Utilitarianism: Crash Course Philosophy #36", topics: ["utilitarianism","greatest good","jeremy bentham","john stuart mill","consequentialism","act vs rule utilitarianism"], minutes: 9 },
  { videoId: "1RWOpQXTltA", channel: "TED-Ed", title: "Plato's Allegory of the Cave - Alex Gendler", topics: ["plato","allegory of the cave","the republic","appearance vs reality","theory of forms","enlightenment of the mind"], minutes: 5 },
  { videoId: "vNDYUlxNIAA", channel: "TED-Ed", title: "This tool will help improve your critical thinking - Erick Wilberding", topics: ["socratic method","critical thinking","asking questions","socrates","examining beliefs","reasoning"], minutes: 5 },
  { videoId: "sohXPx_XZ6Y", channel: "CrashCourse", title: "Mesopotamia: Crash Course World History #3", topics: ["mesopotamia","ancient civilizations","fertile crescent","first cities","early empires","code of hammurabi"], minutes: 12 },
  { videoId: "oPf27gAup9U", channel: "CrashCourse", title: "The Roman Empire. Or Republic. Or...Which Was It?: Crash Course World History #10", topics: ["roman empire","roman republic","julius caesar","ancient rome","augustus","fall of the republic"], minutes: 12 },
  { videoId: "NnoFj2cMRLY", channel: "CrashCourse", title: "The Enlightenment: Crash Course European History #18", topics: ["the enlightenment","voltaire","rousseau","kant","reason and progress","enlightenment thinkers"], minutes: 10 },
  { videoId: "lTTvKwCylFY", channel: "CrashCourse", title: "The French Revolution: Crash Course World History #29", topics: ["french revolution","declaration of the rights of man","reign of terror","napoleon","ancien regime","revolution"], minutes: 12 },
  { videoId: "zhL5DCizj5c", channel: "CrashCourse", title: "Coal, Steam, and The Industrial Revolution: Crash Course World History #32", topics: ["industrial revolution","steam engine","industrialization","factories","coal","economic change"], minutes: 11 },
  { videoId: "_XPZQ0LAlR4", channel: "CrashCourse", title: "Archdukes, Cynicism, and World War I: Crash Course World History #36", topics: ["world war 1","wwi causes","trench warfare","archduke franz ferdinand","alliances","total war"], minutes: 12 },
  { videoId: "Q78COTwT7nE", channel: "CrashCourse", title: "World War II: Crash Course World History #38", topics: ["world war 2","wwii","battle of stalingrad","european theater","axis and allies","total war"], minutes: 13 },
];

// Gather a generous pool; the Loom decides how many actually surface, capped by
// the auto-tunable weights.maxVideoCards.
const POOL_SIZE = 6;

/**
 * Match a query to curated intro videos by keyword/topic overlap and return
 * them as WHOLE-video embed passages. Keyless and offline -- works everywhere.
 */
export function searchBakedVideos(query: string): { docs: SourceDoc[]; passages: Passage[] } {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return { docs: [], passages: [] };
  const qset = new Set(tokens);

  const scored = BAKED_VIDEOS.map((v) => {
    // Word-level matching (not substring), so "evolution" never matches inside
    // "revolution" and a stray token can't latch onto an unrelated title.
    const hayWords = new Set(`${v.title} ${v.topics.join(' ')}`.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []);
    const hits = tokens.filter((t) => hayWords.has(t)).length;
    // A topic is a "phrase" match only when EVERY meaningful word of it appears
    // in the query (so "supply and demand" needs both, not just "supply").
    let phrase = 0;
    for (const topic of v.topics) {
      const tw = queryTokens(topic);
      if (tw.length > 0 && tw.every((w) => qset.has(w))) phrase += 1;
    }
    return { v, score: hits + 3 * phrase, hits, phrase };
  }).filter((x) => x.phrase > 0 || x.hits >= 2 || (x.hits >= 1 && tokens.length === 1));

  scored.sort((a, b) => b.score - a.score);

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const { v } of scored.slice(0, POOL_SIZE)) {
    const url = `https://www.youtube.com/watch?v=${v.videoId}`;
    const doc: SourceDoc = {
      id: freshId('ytb'),
      provider: 'YouTube',
      sourceType: 'video',
      title: v.title,
      url,
      author: v.channel,
    };
    docs.push(doc);
    passages.push({
      id: freshId('ytb-p'),
      docId: doc.id,
      text: v.title, // verbatim creator title; the embedded video IS the source
      anchorUrl: url,
      index: 0,
      embed: { videoId: v.videoId, startSec: 0 }, // whole video, no clipping
    });
  }
  return { docs, passages };
}
