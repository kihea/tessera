# A.woke (tessera) — Round 3 roadmap

Goal: enterprise-level quality. Two themes: (1) make the **feed deliver coherent, connected
curation WITHOUT the deep model / iceberg flag** (raise the heuristic floor; also raise the
model-on ceiling), and (2) a **modern UI/UX overhaul**. Iterate each to enterprise level.

Status legend: ☐ todo · ◐ in progress · ☑ done

---

## 1. Feed engine — connection quality (TOP PRIORITY)

**Diagnosis (confirmed in code).** `searchGraph.relevance()` (`src/state/graphStore.ts`) ranks
neighbours as:

```
0.45·cos  +  0.35·salience  +  0.2·max(0,linkInt)  −  0.3·max(0,−linkInt)
```

`cos` is the embedding (deep-model) term. **With embeddings off it is 0, so connection collapses to
`salience` alone** — the bare fraction of a neighbour's passages shared with the seed. That is the
"vastly unconnected" floor, and why one high-frequency cluster (the user's "video games") dominates
every feed: nothing else discriminates. The deep model wasn't *connecting* better, it was *carrying
the whole signal*.

- ☐ **1a. Embedding-free relevance signals.** Add, behind the same `relevance()`, signals that work
  with zero vectors: lexical overlap of concept *contexts* (TF-IDF / Jaccard over the words each
  concept actually appears with), **PMI-style co-occurrence** (so generic high-df concepts stop
  dominating — penalize by global frequency), and **hypernym/taxonomic proximity** (shared is-a
  parents = real D1/D3 relation). Blend so the no-model floor is genuinely coherent.
- ☐ **1b. Precision on D1/D2 connections** (per user). Tighten signed `intensity` (D2 attribute
  axis) computation in `connections.ts`/`mergeIntoGraph`; make is-a/idea-form (D1) links first-class
  in traversal, not just forms. Consider redrafting the attribute-attachment heuristic.
- ☐ **1c. Seed scoring.** `searchGraph` seed selection leans on label/provenance/token match; make it
  more robust for multi-word and technical queries so expansion starts from the right place.
- ☐ **1d. Raise the ceiling too.** Keep the embedding path, but ensure heuristic + embedding signals
  *compose* (floor never worse than today with vectors on).
- ☐ **1e. Make it flag-indifferent.** The good experience must not depend on `dev.iceberg` /
  `dev.embeddings`. Verify parity with flags off.

## 2. Feed engine — timeline regression
- ☐ **2.** Timeline is "nowhere to be found." The Map⇄Timeline toggle gates on ≥3 dated **D5**
  concepts spanning ≥15y. Re-check the gate against the current dimension distribution; loosen if the
  D5-only + dated + span filter is too strict so historical topics reliably show it.

## 3. Whiteboard
- ☑ **3a. Link crash.** `onNodeUp` nested `setBoard` inside the `setLinkFrom` updater (impure updater
  → React 19 / StrictMode crash on connect). Fixed: compute link from current state, no nesting.
- ☐ **3b. Click-to-add.** Click empty board → add a node there and **focus the input** so the user
  can type immediately.

## 4. UI/UX overhaul (modern, enterprise) — via ui-ux-pro-max  ← NEXT FOCUS

**Decisions (locked):** light/dark = **separate themes** (not a global toggle — each lives in the
theme picker); keep A.woke's calm scholarly identity (NOT the generator's "vibrant block" style);
academic type pairing available if wanted (Crimson Pro / Atkinson Hyperlegible). Apply the
ui-ux-pro-max a11y checklist throughout: contrast ≥4.5:1, visible focus rings, `cursor-pointer`,
150–300ms transitions, `prefers-reduced-motion`, responsive 375/768/1024/1440.

- ☐ **4a. Light/dark as separate themes.** Refactor `styles.css` so colour lives in per-theme CSS-var
  blocks (`[data-theme="…"]`), and ship light + dark theme entries in the picker (existing
  Standard/Alexandria/Terminal keep their identity). Foundation for everything below.
- ☐ **4b. Tabs.** A real, reusable tab component (notebook Write/Preview/Board, settings, feed).
- ☐ **4c. Sidebars.** Settings: section-nav sidebar (Sources/Appearance/Algorithm/Developer) +
  bottom padding so **Save isn't eclipsed**. Feed: a sidebar with the knowledge-graph / mind-map and
  navigation.
- ☐ **4d. Feed card declutter.** Clearer hierarchy, fewer competing controls per card, calmer
  organization centred on knowledge-graph / mind-map.
- ☐ **4e. Weave-checkpoint truncation.** Text spills out; truncate with a "back to the original card"
  link.
- ☐ **4f. Flags alignment.** Report / clip-to-notes flags left/right aligned.
- ☐ **4g. Export controls.** Modern menu (md / json), robust.

## 5. Shader theme
- ☐ **5.** (Decision: a **new "Fluid" theme** — leave Standard/Alexandria/Terminal untouched.) Wrap
  the provided fluid raymarch fragment shader in a WebGL canvas background; wire `iTime`/`iResolution`;
  add as the 4th selectable theme with a translucent dark-glass UI tuned for it. Respect
  `prefers-reduced-motion`; pause offscreen.

## 6. Code hygiene (opportunistic)
- ☐ `graphStore.ts` `edgeKey` uses a literal `\0` delimiter → tools treat the file as binary
  (Grep can't read it). Swap for a printable, collision-free delimiter (ids are base36) when touching
  the file. Low risk (transient in-memory key, never persisted).
