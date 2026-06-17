# Tessera — learn from the sources themselves

A web app **and a desktop app (Windows/Linux, Tauri + Rust)** in the spirit of
learn-anything.xyz, with one inversion: instead of handing you a directory of links and wishing
you luck, it **researches a topic live, pulls verbatim excerpts from real sources, and weaves
them into a feed** — side by side with a markdown notebook where *you* write the synthesis.

The philosophy (the reason this app exists): the app **never summarizes**. Every card is a
quotation linked to its origin. What Tessera adds is the *weave* — the connections between
excerpts. A card's learning objective is not the isolated fact it carries but the threads it
ties to the material around it. The form lives *in* the material and is constructed from it
(Aristotle's form-in-matter), not handed down finished from outside it (Plato's transcendent
form). The questioning checkpoints — where *you* write the connection — are the Socratic part.
The mosaic metaphor in the name: no tessera is the picture; the picture is how they sit together.

## Run it

```bash
npm install
npm run dev        # web — http://localhost:5173
npm run typecheck
```

No API keys, no backend. All research runs in the browser against CORS-friendly public APIs.

### Desktop app (Windows / Linux)

The desktop shell is **Tauri 2**: the same UI in a native window, plus a **Rust core**
(`src-tauri/`) that does what a browser can't — talk to *any* model server without CORS, with
API keys that never enter webview code. Requirements: [Rust](https://rustup.rs) and, on Linux,
the WebKitGTK packages from the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
(`libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, …). Then:

```bash
npm run app:dev     # dev window (compiles the Rust core on first run)
npm run app:build   # release build; run `npx tauri icon <png>` once to bundle installers
```

The Rust crate is written wasm32-friendly (pure async HTTP, no platform calls) — it is the seam
where the engine migrates to Rust/WebAssembly piece by piece, so the web build can eventually
share the same core.

### Plug in a model (optional, the Odysseus pattern)

Settings (⚙, top right) → **Connection model**. Pick a **bundled in-browser model** that
downloads once and then runs fully client-side via WebGPU — three tiers (Small · Llama 3.2 1B,
Medium · Qwen2.5 1.5B, Large · Gemma 2 2B) — or run your own weights locally with **Ollama**
(`ollama pull llama3.2`) or any **OpenAI-compatible** server (LM Studio, llama.cpp, vLLM), or
plug an **Anthropic / OpenAI API key**. The model has exactly one job: it reads the seed
sources and builds the **study map** (which neighboring concepts to gather real material for,
and why). It never writes a word you study — every card stays a verbatim excerpt. With no model
configured, a built-in heuristic branches instead; everything still works.

## Startup flow

On first visit (and any time via **Retune preferences** on the home screen) a 3-step flow asks
how you *think* you learn: which source materials you reach for, how a topic should open
(ground-up / balanced / into the debate), and how often you want weave checkpoints. The answers
**warm-start** the source-type bandit as a *low-confidence prior* (2 phantom pulls per arm) and
configure the loom — then evidence takes over. What you actually clip, open, and weave outweighs
the questionnaire within a session or two, and the home screen's **"How you learn"** panel shows
that evolving picture openly. People misjudge how they retain; the seed shapes only the first
session.

## Mastery ladder

Sources are **not** a flat pool of snippets. Each excerpt gets a *depth rung* — Foundation /
Mechanism / In practice / Frontier — read off the source's own structure (section heading, source
type, definitional density, position in the document), in `weave/depth.ts`. The loom tracks a live
**mastery stage** (how much of the topic's recurring structure you've surfaced, grounded, and
*woven*) and curates each card to sit ~half a rung **ahead** of it — an encyclopedia's "Criticism"
section or a paper's abstract *waits* until the foundations it presupposes are in place. Completing
a weave checkpoint is the strongest signal and literally advances the stage. This is the engine's
Iceberg-layer ladder (L0→L4), re-derived from real documents instead of authored layers. Wikipedia
extraction now samples across the *whole* article (lead, body, late sections) so every rung has
material. The header shows your current stage; each card shows its rung; the feed announces when
you step up ("You've worked the mechanism material — stepping up to in practice").

## How a session works

0. **Branch out** — searching only the main idea gathers sources that *mention* it; a learner
   asking about AI actually wants how it works, the concepts preceding it, the technology inside
   it. So after the seed research, Tessera builds a **study map** — neighboring threads, each
   labeled by its relation to the idea (*prerequisite / mechanism / component / application /
   foundation / frontier / adjacent*, the iceberg's axes) — and researches every branch with the
   same real providers. The **branch-out reach** slider (0→1, on the home screen) gates how far
   the map may wander: focused = only what the idea presupposes and contains; far = history,
   debates, neighboring fields. A configured model builds the map by reading the seed excerpts;
   otherwise the heuristic uses the corpus's own recurring terms. The session's map is always
   visible (header → **Study map**), and every branch card names why it was gathered. At the
   **Balanced** reach and above, a short **context on-ramp** opens the session with the lead-up the
   idea sits within (the causes before a war, the prior course before its sequel) — ranked by
   immediacy at low reach, widening to the most vital threads as reach climbs — then hands off into
   the trunk.

1. **Research** — the query fans out in parallel to:
   - Wikipedia (encyclopedia, section-level passages, CC BY-SA)
   - Wikibooks (textbook passages)
   - Crossref (paper abstracts — the authors' own words, DOI-linked)
   - Hacker News/Algolia (discussion comments — where pushback lives)
   - Open Library (books with real first sentences, as "go deeper" doors)
   - Wiktionary (definitions, used **only** when no corpus passage defines a recurring term —
     the corpus grounds its own vocabulary first)
   - YouTube — a **curated, verified** library of trustworthy intro/explainer videos (3Blue1Brown,
     Crash Course, Kurzgesagt, TED-Ed, Veritasium …) matched to the topic and embedded whole; it
     is baked in, so it needs no key and works offline. The desktop app can additionally search
     YouTube live (a YouTube Data API key) and pull short transcript snippets, best-effort.
   Each provider is best-effort with a timeout; the feed is built from whatever returns.
2. **Weave** — TF-IDF-style extraction of the concepts that recur *across* sources (a term one
   source uses is its vocabulary; a term many independent sources share is the topic's actual
   structure). Passage↔passage connections are scored by shared concepts; thread kinds
   (*defines / extends / contrasts / applies / questions*) are detected from the text's own
   rhetorical cues. Fully deterministic and inspectable — no model in the loop.
3. **Feed** — the Loom plans one card at a time (see engine mapping below). Each card shows:
   the verbatim excerpt (serif, woven terms highlighted), full attribution + "Read at source",
   a *reason it was chosen now*, and clickable threads back to earlier cards.
4. **Notebook** — markdown editor + preview beside the feed. "Clip to notes" inserts the quote
   with citation. Every ~6 cards a **weave checkpoint** asks how two recurring concepts relate
   — one click puts both quotes in your notes under a "My connection:" prompt that the app
   deliberately leaves blank. Export as `.md`. Autosaved to localStorage per topic.
   Accessibility: every gate (checkpoint or check) has a **skip for now** — the feed reopens
   with no penalty and no credit. Every passage card has **⚑ Report source** — a reported
   source leaves the current weave and is never gathered again on this device.
5. **Totality views** — the concept strip lights up terms as you meet them; the weave map is
   the corpus's own co-occurrence graph, lit as you read.

## Design lineage

The feed planner adapts a two-axis learning engine's ideas, re-keyed for source passages:

| engine (Stage B/C)             | tessera                                            |
| ------------------------------ | -------------------------------------------------- |
| KU prerequisite graph          | concept co-occurrence across real sources          |
| online `nextCard` planning     | `Loom.next()` — one card at a time vs. live state  |
| technique interleave caps      | source-type interleave (no 3 alike in a row)       |
| novelty injection              | each card should open 1–3 new concepts, no floods  |
| spaced "due" reviews           | hot undefined terms pull their grounding forward   |
| Iceberg layers L0→L4           | passage depth rungs + live mastery stage targeting |
| boss-fight checks              | weave checkpoints (the learner writes the link)    |
| `seedPreferences` onboarding   | 3-step startup flow → bandit prior + loom config   |
| bandit reward = learning gain  | reward = clips + source-opens + checkpoints, dwell |
|                                | hard-capped at a small share (`weave/bandit.ts`)   |
| per-card "why this" reasons    | per-card reasons ("builds on X from card 3")       |

The bandit (UCB + EWMA, persisted) only *nudges* ordering toward source types you actively
engage with; it can never override the weave constraints — exactly as the engine's bandit
could never cross pedagogical slots.

## Layout

`src/research/` providers + fan-out · `src/weave/` terms, connections, loom, bandit ·
`src/state/` session hook + localStorage · `src/ui/` query screen, split session screen
(resizable divider, stacks under 880px), cards, notebook, concept strip, weave map.

## TODO / next

- More providers: Stack Exchange (right-site detection), arXiv (needs a proxy: no CORS),
  Project Gutenberg full-text, news APIs for live topics.
- Cross-session spaced review of *your own* checkpoint notes (FSRS port from the engine).
- Shareable weaves (export the corpus + ordering, not just notes).
- Smarter concept extraction (noun-phrase chunking; current bigram TF-IDF occasionally
  admits a generic adjective).

## Developer tooling

The whole feed is driven by one set of weights in `src/weave/weights.ts`. In a dev build
(`npm run dev`) press **Esc** to open the **weave-tuning panel** — sliders for every knob that
**replay the current feed instantly** (no re-research), with live cohesion metrics. **✦ Auto-tune**
runs a separable **CMA-ES** optimizer over those weights against a feed-quality objective
(coverage, connection, cohesion, variety, novelty, ladder spacing, …) and applies the best it
finds. Tuned values persist locally and drive real sessions. The panel is stripped from
production builds.

## Tech stack

React 19 · TypeScript · Vite 6 · Tauri 2 (a Rust core for CORS-free model + video transport, with
API keys that never touch webview code) · WebLLM (in-browser models via WebGPU). No backend —
everything runs on the client.

## License

[MIT](LICENSE) © Kihea
