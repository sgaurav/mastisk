// ============================================================
// Mastisk — sample knowledge graph
// (a personal LLM-maintained wiki, 24/7 agents)
// ============================================================

window.MASTISK_DATA = {
  user: { name: "Anand", initials: "AK" },

  agents: [
    { id: "scout",     name: "Scout",     role: "Crawls feeds, X, blogs, RSS",        status: "active",  load: 0.62, color: "amber" },
    { id: "listener",  name: "Listener",  role: "Transcribes podcasts + YouTube",      status: "active",  load: 0.81, color: "violet" },
    { id: "compiler",  name: "Compiler",  role: "Compiles raw → wiki, builds backlinks", status: "active", load: 0.44, color: "emerald" },
    { id: "linter",    name: "Linter",    role: "Health checks, broken links, contradictions", status: "idle", load: 0.05, color: "blue" },
    { id: "synthesizer", name: "Synthesizer", role: "Cross-source synthesis, themes",  status: "active",  load: 0.33, color: "rose" },
  ],

  // Ticker of agent operations (the "24/7" feel)
  feed: [
    { t: "2m",  agent: "scout",     verb: "clipped",   obj: "Karpathy — \"LLM Wiki, revisited\"",       kind: "blog",     touched: 7 },
    { t: "6m",  agent: "listener",  verb: "transcribed", obj: "Dwarkesh × Sutton — Continual learning", kind: "podcast",  touched: 12 },
    { t: "11m", agent: "compiler",  verb: "merged",    obj: "World Models ↔ Predictive Coding",         kind: "concept",  touched: 4 },
    { t: "18m", agent: "synthesizer", verb: "drafted", obj: "Synthesis: 5 takes on RL + LLMs",          kind: "synthesis",touched: 9 },
    { t: "27m", agent: "scout",     verb: "watched",   obj: "Lex × Hassabis — Project Astra (1h 42m)",  kind: "youtube",  touched: 14 },
    { t: "41m", agent: "linter",    verb: "fixed",     obj: "3 broken backlinks in /concepts",          kind: "system",   touched: 3 },
    { t: "1h",  agent: "compiler",  verb: "wrote",     obj: "Test-time compute (new entity page)",      kind: "concept",  touched: 6 },
    { t: "1h",  agent: "scout",     verb: "queued",    obj: "12 new items from Hacker News digest",     kind: "system",   touched: 0 },
    { t: "2h",  agent: "synthesizer", verb: "linked", obj: "Mamba ↔ State-space models ↔ S4",          kind: "concept",  touched: 5 },
    { t: "3h",  agent: "listener",  verb: "transcribed", obj: "Latent Space — RL renaissance",          kind: "podcast",  touched: 8 },
  ],

  // Today's digest — what was produced overnight
  digest: {
    date: "Mon · Apr 20",
    summary: "Heavy week for RL-on-LLMs. Three threads converge: test-time compute (DeepMind, OpenAI, Anthropic posts), continual learning (Sutton on Dwarkesh), and mechanistic interpretability of reasoning traces. 47 sources read, 14 wiki pages updated, 3 new concept clusters formed.",
    counters: [
      { label: "Sources read",  value: 47 },
      { label: "Pages touched", value: 31 },
      { label: "New concepts",  value: 6  },
      { label: "Open questions", value: 4 },
    ],
    threads: [
      {
        title: "Test-time compute is the new scaling axis",
        body: "Three papers and two podcasts this week argue training-time scaling is plateauing while inference-time search/verification is wide open. The wiki now has a new page on this with backlinks to o-series, AlphaProof, and process reward models.",
        sources: 5,
        links: ["Test-time compute", "Process reward models", "AlphaProof", "o-series"],
      },
      {
        title: "Sutton: \"LLMs are a dead end\"",
        body: "Dwarkesh's interview drew strong reactions. Synthesizer drafted a 4-take comparison page (Sutton vs. Karpathy vs. LeCun vs. Hassabis). The strongest disagreement is over whether next-token prediction admits continual learning.",
        sources: 4,
        links: ["Continual learning", "Bitter Lesson", "World models"],
      },
      {
        title: "Open question: what does \"agent memory\" actually mean?",
        body: "The wiki has 7 pages using the phrase with three incompatible definitions. Linter flagged it. Worth a 30-min read + decision on canonical definition.",
        sources: 7,
        links: ["Agent memory", "Context engineering", "MemGPT"],
      },
    ],
    queue: [
      "Anthropic — \"Project Vend\" retrospective (clipped 14m ago)",
      "Lex × Hassabis — Project Astra (transcribing now, 38%)",
      "Latent Space — RL renaissance (queued)",
      "Andrej's gist v3 (queued)",
    ],
  },

  // Sidebar tree
  vault: [
    { kind: "section", label: "Today" },
    { kind: "page", id: "digest",   label: "Daily Digest",  glyph: "◐", badge: "47" },
    { kind: "page", id: "queue",    label: "Reading queue", glyph: "≡", badge: "12" },
    { kind: "page", id: "feed",     label: "Agent feed",    glyph: "◇", badge: "live" },

    { kind: "section", label: "Wiki" },
    { kind: "folder", label: "Concepts", count: 184, children: [
      { kind: "page", id: "ttc",        label: "Test-time compute", glyph: "▲", hot: true },
      { kind: "page", id: "ssm",        label: "State-space models", glyph: "▲" },
      { kind: "page", id: "rl-llm",     label: "RL + LLMs", glyph: "▲", hot: true },
      { kind: "page", id: "world",      label: "World models", glyph: "▲" },
      { kind: "page", id: "mech",       label: "Mech interp", glyph: "▲" },
    ]},
    { kind: "folder", label: "Entities", count: 312, children: [
      { kind: "page", id: "karpathy",   label: "Andrej Karpathy", glyph: "●" },
      { kind: "page", id: "sutton",     label: "Richard Sutton", glyph: "●" },
      { kind: "page", id: "anthropic",  label: "Anthropic", glyph: "■" },
      { kind: "page", id: "deepmind",   label: "DeepMind", glyph: "■" },
    ]},
    { kind: "folder", label: "Sources", count: 1247, children: [
      { kind: "page", id: "dwarkesh",   label: "Dwarkesh × Sutton", glyph: "◊" },
      { kind: "page", id: "wiki-gist",  label: "karpathy/llm-wiki.md", glyph: "◊" },
    ]},
    { kind: "folder", label: "Synthesis", count: 38, children: [
      { kind: "page", id: "syn-rl",     label: "RL + LLMs: 5 takes", glyph: "✦" },
      { kind: "page", id: "syn-mem",    label: "What is agent memory?", glyph: "✦" },
    ]},

    { kind: "section", label: "System" },
    { kind: "page", id: "graph",        label: "Graph view",   glyph: "✱" },
    { kind: "page", id: "agents",       label: "Agents",       glyph: "◯", badge: "5" },
    { kind: "page", id: "ingest",       label: "Sources & ingest", glyph: "↧" },
    { kind: "page", id: "lint",         label: "Lint & health", glyph: "✓", badge: "3" },
  ],

  // Recent / pinned
  pinned: [
    { id: "ttc",   label: "Test-time compute" },
    { id: "rl-llm", label: "RL + LLMs" },
    { id: "syn-rl", label: "RL + LLMs: 5 takes" },
  ],

  // The article being read (Test-time compute)
  article: {
    id: "ttc",
    kind: "Concept",
    title: "Test-time compute",
    aka: ["Inference-time scaling", "Search at inference"],
    updated: "12 minutes ago by Compiler",
    confidence: 0.86,
    readingTime: "7 min",
    sources: 11,
    backlinks: 23,
    forwardlinks: 17,
    summary: "A scaling axis that trades extra compute at inference time — typically via search, sampling, or verification — for higher capability without training a larger model. Empirically validated by the o-series of models and AlphaProof; theoretical grounding via process reward models and verifier-generator gaps.",
    sections: [
      {
        h: "TL;DR",
        body: "Instead of scaling parameters or data, you scale the *number of forward passes per query* — through best-of-N, MCTS, self-consistency, or verifier-guided search. Cheap models with lots of test-time compute can match expensive models with little. The frontier in 2025–26 is figuring out *what* to spend that compute on.",
        kind: "callout",
      },
      {
        h: "Mechanism",
        body: "Three families dominate: <span class=\"link\" data-target=\"sampling\">parallel sampling</span> with majority vote or learned verifier; <span class=\"link\" data-target=\"mcts\">tree search</span> over partial generations (MCTS-style); and <span class=\"link\" data-target=\"refine\">iterative refinement</span> where a model critiques and edits its own draft. Each family has a different scaling curve — parallel sampling plateaus quickly; tree search keeps paying off; refinement is bounded by the critique signal.",
      },
      {
        h: "Empirical evidence",
        body: "The clearest demo is <span class=\"link\" data-target=\"o-series\">OpenAI's o-series</span>, where allowing minutes-long reasoning lifts MATH and competition coding scores by 20+ points without changing the base model. <span class=\"link\" data-target=\"alphaproof\">DeepMind's AlphaProof</span> shows the same for formal math: a small Gemini policy paired with a Lean verifier matched IMO-medalist level given a day of compute per problem.",
      },
      {
        h: "Why it matters",
        body: "If inference-time scaling holds, the economic shape of the field changes. Smaller, cheaper base models become viable substrates; the differentiator is the *search procedure* and the *verifier*. This is also where <span class=\"link\" data-target=\"rl-llm\">RL on LLMs</span> re-enters: process reward models trained on traces let you prune the search tree.",
      },
      {
        h: "Open questions",
        body: "(1) Are there domains where search doesn't help — e.g. tasks without checkable ground truth? (2) How do you learn a verifier without a stronger generator? (3) Does test-time compute scale across modalities, or is it text-only?",
        kind: "open",
      },
    ],
    related: [
      { id: "rl-llm",  label: "RL + LLMs",                 weight: 0.92 },
      { id: "prm",     label: "Process reward models",      weight: 0.88 },
      { id: "alphaproof", label: "AlphaProof",              weight: 0.74 },
      { id: "o-series", label: "o-series (OpenAI)",         weight: 0.71 },
      { id: "mcts",    label: "MCTS in language models",    weight: 0.65 },
      { id: "verifier-gap", label: "Verifier-generator gap", weight: 0.61 },
    ],
    sourceList: [
      { kind: "blog",    title: "Karpathy — \"Test-time compute is underrated\"", date: "Apr 12" },
      { kind: "paper",   title: "Snell et al. — Scaling LLM Test-Time Compute", date: "Aug 2024" },
      { kind: "podcast", title: "Latent Space — Inference scaling, ep. 184",   date: "Mar 28" },
      { kind: "youtube", title: "Yannic Kilcher — o1 deep-dive",                 date: "Sep 2024" },
      { kind: "blog",    title: "DeepMind — AlphaProof technical post",          date: "Jul 2024" },
    ],
  },
};
