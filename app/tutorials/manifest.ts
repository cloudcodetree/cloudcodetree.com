// Hand-authored tutorials index. Each entry maps to an .mdx file under
// app/tutorials/(article)/<slug>/page.mdx. This is the list-page metadata;
// the .mdx file holds the actual (interactive) content. Separate from the
// auto-generated AI News blog on purpose.
//
// Tutorials are grouped into series. The canonical display title is
//   "<series>: <title> (Part <part> of <total>)"
// composed by fullTitle() — used for <title>/Open Graph so shared links read
// as a series. The UI shows series + part as an eyebrow and <title> as the head.

export interface Tutorial {
  slug: string;
  title: string;       // the subtitle (part-specific)
  series: string;      // shared title across the series
  part: number;        // 1-based position within the series
  excerpt: string;
  date: string;        // MM-DD-YYYY
  tags: string[];
  order: number;       // ascending = global learning-path order
  readTime: number;    // minutes
  image?: string;      // cover (site-absolute path or CDN URL)
  /** Held for review: hidden from lists/feeds/sitemap AND excluded from the
   *  build (scripts/apply-drafts.mjs renames page.mdx → page.draft.mdx).
   *  Required on purpose: a lesson that never states its status must not be
   *  publishable by omission, so the compiler asks before the gate can. */
  draft: boolean;
}

/**
 * Course-level release gate. New series stay private until their name is added
 * here deliberately; a lesson's own `draft` flag remains a second gate.
 */
export const RELEASED_TUTORIAL_SERIES = [
  'RAG from Scratch',
  'Fine-Tuning & Serving',
  'Claude Code Anywhere',
] as const;

const releasedSeries = new Set<string>(RELEASED_TUTORIAL_SERIES);

export const tutorials: Tutorial[] = [
  {
    slug: 'build-a-rag-over-your-blog',
    title: 'Build a RAG Over Your Blog',
    series: 'RAG from Scratch',
    part: 1,
    excerpt:
      'Your first hands-on AI-engineering project: retrieve answers from your own posts with embeddings + cosine search — no vector DB, no API key. ~60 lines of Python.',
    date: '06-23-2026',
    tags: ['Tutorial', 'RAG', 'Embeddings', 'Python'],
    order: 1,
    readTime: 12,
    image: '/tutorials/covers/build-a-rag-over-your-blog.png',
    draft: false,
  },
  {
    slug: 'vector-database-for-rag',
    title: 'Give Your RAG a Vector Database',
    series: 'RAG from Scratch',
    part: 2,
    excerpt:
      'Move from in-memory numpy to Chroma: embed once, persist to disk, query fast, and filter by metadata. The next step after the RAG intro.',
    date: '06-23-2026',
    tags: ['Tutorial', 'RAG', 'Vectors', 'Python'],
    order: 2,
    readTime: 10,
    image: '/tutorials/covers/vector-database-for-rag.png',
    draft: false,
  },
  {
    slug: 'chunking-strategies-for-rag',
    title: 'Chunking Strategies',
    series: 'RAG from Scratch',
    part: 3,
    excerpt:
      'Chunking is the biggest lever on RAG quality. Compare whole-document, fixed-size, and paragraph-aware+overlap chunking on the same query — with real numbers.',
    date: '06-23-2026',
    tags: ['Tutorial', 'RAG', 'Python'],
    order: 3,
    readTime: 9,
    image: '/tutorials/covers/chunking-strategies-for-rag.png',
    draft: false,
  },
  {
    slug: 'hybrid-search-for-rag',
    title: 'Hybrid Search',
    series: 'RAG from Scratch',
    part: 4,
    excerpt:
      'Vector search understands meaning; BM25 nails exact tokens. Each has a blind spot. Fuse them with Reciprocal Rank Fusion so retrieval stays correct when either one is wrong.',
    date: '06-23-2026',
    tags: ['Tutorial', 'RAG', 'Search', 'Python'],
    order: 4,
    readTime: 10,
    image: '/tutorials/covers/hybrid-search-for-rag.png',
    draft: false,
  },
  {
    slug: 'reranking-for-rag',
    title: 'Reranking',
    series: 'RAG from Scratch',
    part: 5,
    excerpt:
      'A bi-encoder retrieves fast but is fooled by negation; a cross-encoder reads query and passage together and fixes it. Retrieve wide, rerank narrow — with the recall ceiling made concrete.',
    date: '06-23-2026',
    tags: ['Tutorial', 'RAG', 'Search', 'Python'],
    order: 5,
    readTime: 10,
    image: '/tutorials/covers/reranking-for-rag.png',
    draft: false,
  },
  {
    slug: 'evaluating-rag',
    title: 'Evaluating Retrieval',
    series: 'RAG from Scratch',
    part: 6,
    excerpt:
      'Stop guessing whether a change helped. Build a golden query set, score retrieval with Hit@k and MRR, then A/B two retrievers over the same set — the capstone of the RAG track.',
    date: '06-23-2026',
    tags: ['Tutorial', 'RAG', 'Evaluation', 'Python'],
    order: 6,
    readTime: 11,
    image: '/tutorials/covers/evaluating-rag.png',
    draft: false,
  },
  {
    slug: 'fine-tuning-vs-rag',
    title: 'Fine-Tuning vs RAG',
    series: 'Fine-Tuning & Serving',
    part: 1,
    excerpt:
      'The most common AI-engineering fork: retrieve knowledge (RAG) or change the model itself (fine-tuning)? A decision framework — when each wins, when to combine them, and what fine-tuning cannot do.',
    date: '06-24-2026',
    tags: ['Tutorial', 'Fine-tuning', 'RAG'],
    order: 7,
    readTime: 8,
    image: '/tutorials/covers/fine-tuning-vs-rag.png',
    draft: false,
  },
  {
    slug: 'lora-qlora-fine-tuning',
    title: 'LoRA & QLoRA on One GPU',
    series: 'Fine-Tuning & Serving',
    part: 2,
    excerpt:
      'How parameter-efficient fine-tuning works: LoRA trains tiny adapter matrices instead of the whole model, and QLoRA adds 4-bit quantization so an 8B model fits a free Colab GPU. Concept + an official runnable notebook.',
    date: '06-24-2026',
    tags: ['Tutorial', 'Fine-tuning', 'LoRA'],
    order: 8,
    readTime: 9,
    image: '/tutorials/covers/lora-qlora-fine-tuning.png',
    draft: false,
  },
  {
    slug: 'serve-with-vllm',
    title: 'Serve a Model with vLLM',
    series: 'Fine-Tuning & Serving',
    part: 3,
    excerpt:
      'Turn a fine-tuned model into a fast, OpenAI-compatible API. Merge the LoRA adapter, start a vLLM server with one command, and call it from the OpenAI client — a drop-in for your existing code.',
    date: '06-24-2026',
    tags: ['Tutorial', 'Serving', 'vLLM'],
    order: 9,
    readTime: 8,
    image: '/tutorials/covers/serve-with-vllm.png',
    draft: false,
  },
  {
    slug: 'dev-machine-in-your-pocket',
    title: 'Your Whole Dev Machine, In Your Pocket',
    series: 'Claude Code Anywhere',
    part: 1,
    excerpt:
      'Self-host a free, secure pipeline from your phone to your real Mac with Tailscale, tmux, and one isolated Claude Code session per project. Your actual files and full toolchain — not a cloud sandbox.',
    date: '06-25-2026',
    tags: ['Tutorial', 'Claude Code', 'tmux', 'Tailscale', 'SSH'],
    order: 10,
    readTime: 12,
    image: '/tutorials/covers/dev-machine-in-your-pocket.png',
    draft: false,
  },
  {
    slug: 'dealfinder-part-01',
    title: 'Data layer, normalization & the snapshot',
    series: 'Become a Full-Stack AI Engineer',
    part: 1,
    excerpt:
      'Build the Google Shopping connector, normalize the retailer-polluted brand field, dedup the same headphones listed at two prices, and freeze the 270-item electronics snapshot the whole course runs on.',
    date: '06-29-2026',
    tags: ['Tutorial', 'DealFinder', 'Data Engineering', 'Python'],
    order: 11,
    readTime: 10,
    image: '/tutorials/covers/dealfinder-part-01.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-02',
    title: 'How LLMs actually work',
    series: 'Become a Full-Stack AI Engineer',
    part: 2,
    excerpt:
      'The LLM literacy you need before wiring a model into DealFinder: tokenization, embeddings, attention, and sampling — shown with real consumer-electronics data, not just described.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'LLMs', 'Concepts'],
    order: 12,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-02.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-03',
    title: 'Is it a good deal? — median vs. model',
    series: 'Become a Full-Stack AI Engineer',
    part: 3,
    excerpt:
      'Train a price model from scratch (the normal equation, no scikit-learn) on the electronics snapshot, then blend its residual with the naive median signal to separate a genuine budget pick from a too-good-to-be-true trap.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Machine Learning', 'Python'],
    order: 13,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-03.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-04',
    title: 'What you’ll like next — recommenders',
    series: 'Become a Full-Stack AI Engineer',
    part: 4,
    excerpt:
      'Content + collaborative recommenders over real title embeddings: "more like the Sony WH-1000XM5" returns the XM6 and other real audio.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Recommenders', 'Python'],
    order: 14,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-04.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-05',
    title: 'Semantic search that knows a deal',
    series: 'Become a Full-Stack AI Engineer',
    part: 5,
    excerpt:
      'Cosine + BM25 + RRF over the snapshot, value-reranked by the two-signal deal score so relevant AND cheap rises: Anker Q20i tops the results.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Search', 'Embeddings', 'Python'],
    order: 15,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-05.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-06',
    title: 'Messy listings into clean JSON',
    series: 'Become a Full-Stack AI Engineer',
    part: 6,
    excerpt:
      'Turn retailer-polluted titles into schema-validated specs: extract the true manufacturer from the title, with a deterministic rule fallback.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'LLMs', 'Structured Output', 'Python'],
    order: 16,
    readTime: 10,
    image: '/tutorials/covers/dealfinder-part-06.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-07',
    title: 'Live multi-source connectors',
    series: 'Become a Full-Stack AI Engineer',
    part: 7,
    excerpt:
      'Wire real marketplace APIs (eBay Browse OAuth, RapidAPI, Best Buy) behind one DealSource interface, with affiliate URLs and graceful auth.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'APIs', 'OAuth', 'Python'],
    order: 17,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-07.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-08',
    title: 'Scraping responsibly',
    series: 'Become a Full-Stack AI Engineer',
    part: 8,
    excerpt:
      'When an API is not enough: Apify actors, Shopify /products.json, and Firecrawl — plus robots.txt/ToS reality and when to scrape vs. call an API.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Scraping', 'Python'],
    order: 18,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-08.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-09',
    title: 'Tiered aggregation & resilience',
    series: 'Become a Full-Stack AI Engineer',
    part: 9,
    excerpt:
      'Query cheap/reliable sources first, early-stop at enough deduped results, and bench any source that throttles — the anti-throttle aggregator that powers the snapshot.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Resilience', 'Python'],
    order: 19,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-09.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-10',
    title: 'Fine-tune the extractor with QLoRA',
    series: 'Become a Full-Stack AI Engineer',
    part: 10,
    excerpt:
      'When prompting plateaus: the QLoRA decision framework and recipe to fine-tune the extractor on real electronics listings (anchored; runs in a GPU notebook).',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Fine-tuning', 'QLoRA'],
    order: 20,
    readTime: 10,
    image: '/tutorials/covers/dealfinder-part-10.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-11',
    title: 'The agent that ties it together',
    series: 'Become a Full-Stack AI Engineer',
    part: 11,
    excerpt:
      'A ReAct loop with text-to-SQL + deal-ranking tools and a human-in-the-loop gate answers a plain-English goal over the real catalog.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Agents', 'LangGraph', 'Python'],
    order: 21,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-11.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-12',
    title: 'Expose it as an MCP server',
    series: 'Become a Full-Stack AI Engineer',
    part: 12,
    excerpt:
      'Wrap the catalog’s tools, a resource, and a prompt as an MCP server so any client (e.g. Claude Code) can search deals and score value.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'MCP', 'Python'],
    order: 22,
    readTime: 9,
    image: '/tutorials/covers/dealfinder-part-12.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-13',
    title: 'pgvector persistence + semantic search',
    series: 'Become a Full-Stack AI Engineer',
    part: 13,
    excerpt:
      'Persist real deals to Postgres + pgvector with an HNSW cosine index, and search past listings by meaning — the same fastembed vectors from Part 5, now durable.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'pgvector', 'Postgres', 'Python'],
    order: 23,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-13.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-14',
    title: 'RAG: grounded answers over your deals',
    series: 'Become a Full-Stack AI Engineer',
    part: 14,
    excerpt:
      'Turn the pgvector retriever into a question-answering system: retrieve the real deals for a plain-English query, build a numbered context, and generate an answer that can only cite listings it was given — with a faithfulness guard that rejects invented prices.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'RAG', 'LLM', 'Python'],
    order: 24,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-14.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-15',
    title: 'Agentic RAG: retrieval as a repeated tool call',
    series: 'Become a Full-Stack AI Engineer',
    part: 15,
    excerpt:
      'Single-shot RAG (Part 14) retrieves once. Here the agent judges whether the evidence is good enough and re-queries when it is not — "cheap monitor" iterates three hops to a clean 4K-monitor DEAL, with a corpus-mined reformulator and a sufficiency gate on the deal verdicts.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'RAG', 'Agents', 'Python'],
    order: 25,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-15.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-16',
    title: 'Context engineering: the window is RAM',
    series: 'Become a Full-Stack AI Engineer',
    part: 16,
    excerpt:
      'Retrieval decides what is relevant; context engineering decides what actually goes in the window. Real token budgets over the deal context: pack to fit, order for "lost in the middle", and compact a growing multi-turn chat — with exact bge token counts.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Context', 'LLM', 'Python'],
    order: 26,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-16.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-17',
    title: 'Multi-agent: the writer/reviewer pattern',
    series: 'Become a Full-Stack AI Engineer',
    part: 17,
    excerpt:
      'One agent cannot reliably check its own work. Split the job: a recommender writes a grounded answer, an isolated reviewer adversarially checks it, and a writer fooled by the $46 Bose trap gets caught and revised — the second opinion that only isolation makes worth having.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Agents', 'LLM', 'Python'],
    order: 27,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-17.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-18',
    title: 'The web app',
    series: 'Become a Full-Stack AI Engineer',
    part: 18,
    excerpt:
      'A real search UI over the live aggregator with a live/semantic toggle and DEAL/FAIR/SUSPICIOUS badges — served by FastAPI, XSS-hardened.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'FastAPI', 'Web', 'Python'],
    order: 28,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-18.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-25',
    title: 'Safety, security & governance',
    series: 'Become a Full-Stack AI Engineer',
    part: 25,
    excerpt:
      'Defense in depth for the model surface: prompt-injection detection, PII redaction, output validation on the electronics schema, and a model card.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Safety', 'Security', 'Python'],
    order: 35,
    readTime: 10,
    image: '/tutorials/covers/dealfinder-part-25.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-23',
    title: 'Prove it works — evaluation as a discipline',
    series: 'Become a Full-Stack AI Engineer',
    part: 23,
    excerpt:
      'Golden sets, ranking metrics, LLM-as-judge and error analysis: the two-signal ranker scores precision@5 = 1.00 where median-only manages 0.40.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Evaluation', 'CI', 'Python'],
    order: 33,
    readTime: 9,
    image: '/tutorials/covers/dealfinder-part-23.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-26',
    title: 'Serve it fast and cheap',
    series: 'Become a Full-Stack AI Engineer',
    part: 26,
    excerpt:
      'The FastAPI service behind the aggregator: real routes, a semantic cache, and batching — the levers that cut latency and cost.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Serving', 'FastAPI', 'Python'],
    order: 36,
    readTime: 10,
    image: '/tutorials/covers/dealfinder-part-26.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-22',
    title: 'Experiment tracking & model registry',
    series: 'Become a Full-Stack AI Engineer',
    part: 22,
    excerpt:
      'Track every price-model run with MLflow (local file store), compare linear vs GBDT vs PyTorch on one feature contract, and register the winner.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'MLOps', 'MLflow', 'Python'],
    order: 32,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-22.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-24',
    title: 'Closing the MLOps loop',
    series: 'Become a Full-Stack AI Engineer',
    part: 24,
    excerpt:
      'Drift → retrain → eval-gate → champion/challenger promotion: the closed loop that keeps the deal model honest, built on real PSI and the eval gate.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'MLOps', 'Drift', 'Python'],
    order: 34,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-24.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-27',
    title: 'Inference optimization, for real',
    series: 'Become a Full-Stack AI Engineer',
    part: 27,
    excerpt:
      'What you can measure vs what needs a GPU: real semantic-cache hit rates, a cost-aware model cascade, and honestly-anchored quantization/vLLM references.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Inference', 'Serving', 'Python'],
    order: 37,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-27.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-28',
    title: 'Containerize and ship it',
    series: 'Become a Full-Stack AI Engineer',
    part: 28,
    excerpt:
      'A real Docker image, a CI/CD pipeline with the eval gate, and one-command infra via Terraform/OpenTofu (db + app).',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Docker', 'CICD', 'Python'],
    order: 38,
    readTime: 9,
    image: '/tutorials/covers/dealfinder-part-28.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-30',
    title: 'Observability, cost & ops',
    series: 'Become a Full-Stack AI Engineer',
    part: 30,
    excerpt:
      'Trace requests, attribute real API/LLM cost (FinOps), and watch for drift with PSI — the ops layer that keeps the deal engine honest.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Observability', 'FinOps', 'Python'],
    order: 40,
    readTime: 10,
    image: '/tutorials/covers/dealfinder-part-30.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-37',
    title: 'Case study + system-design interview',
    series: 'Become a Full-Stack AI Engineer',
    part: 37,
    excerpt:
      'Turn the finished, deployed DealFinder into career capital: a portfolio case study with real metrics, resume bullets, and a mock system-design interview on the real architecture.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Career', 'System Design'],
    order: 47,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-37.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-36',
    title: 'Ship & operate the real system',
    series: 'Become a Full-Stack AI Engineer',
    part: 36,
    excerpt:
      'e2e tests that actually run, a real load profile, chaos-proven graceful degradation, and a production runbook — operating the deployed DealFinder for real.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Testing', 'SRE', 'Python'],
    order: 46,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-36.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-19',
    title: 'Dataset engineering',
    series: 'Become a Full-Stack AI Engineer',
    part: 19,
    excerpt:
      'Turn the frozen snapshot into a labeled, leakage-safe dataset: two-signal labels, grouped splits by query, and honest class-imbalance handling.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Machine Learning', 'Python'],
    order: 29,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-19.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-21',
    title: 'ML & DL breadth',
    series: 'Become a Full-Stack AI Engineer',
    part: 21,
    excerpt:
      'Beyond the linear baseline: gradient-boosted fair prices, a price-drop forecaster, and a real PyTorch training loop — with the honest MAE deltas.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Machine Learning', 'Python'],
    order: 31,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-21.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-20',
    title: 'Pipelines & orchestration',
    series: 'Become a Full-Stack AI Engineer',
    part: 20,
    excerpt:
      'Turn the snapshot pipeline into a real Prefect flow with retries, caching, a data contract, and a dbt-style good-deals view.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Orchestration', 'Prefect', 'Python'],
    order: 30,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-20.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-33',
    title: 'Saved searches & the suggestions worker',
    series: 'Become a Full-Stack AI Engineer',
    part: 33,
    excerpt:
      'A deterministic periodic job that watches saved searches and notifies on genuinely new deals — Part 5 retrieval + the Part 3 deal score, diffed against last-seen.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Workers', 'Notifications', 'Python'],
    order: 43,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-33.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-35',
    title: 'Security & compliance at scale',
    series: 'Become a Full-Stack AI Engineer',
    part: 35,
    excerpt:
      'Multi-tenant hardening that extends Part 25: a sliding-window rate limiter, GDPR export/delete, and abuse detection — importing the safety modules, not re-implementing them.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Security', 'Compliance', 'Python'],
    order: 45,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-35.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-29',
    title: 'Cloud & Kubernetes',
    series: 'Become a Full-Stack AI Engineer',
    part: 29,
    excerpt:
      'Take the container to a cluster: applyable K8s manifests against a managed Postgres, with a Secret template, HPA, TLS ingress (SSE-aware), and secrets management.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Kubernetes', 'Cloud', 'DevOps'],
    order: 39,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-29.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-31',
    title: 'The web front end',
    series: 'Become a Full-Stack AI Engineer',
    part: 31,
    excerpt:
      'A real React/Vite SPA that streams results over SSE, renders DEAL/FAIR/SUSPICIOUS badges live, and signs in with Supabase — built clean with tsc + vite.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'React', 'Frontend', 'TypeScript'],
    order: 41,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-31.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-32',
    title: 'Auth & accounts',
    series: 'Become a Full-Stack AI Engineer',
    part: 32,
    excerpt:
      'Verify Supabase JWTs in FastAPI, attach the user, and gate features by role — a real auth layer with six offline-tested cases.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Auth', 'FastAPI', 'Python'],
    order: 42,
    readTime: 11,
    image: '/tutorials/covers/dealfinder-part-32.png',
    draft: true,
  },
  {
    slug: 'dealfinder-part-34',
    title: 'Payments & SaaS mechanics',
    series: 'Become a Full-Stack AI Engineer',
    part: 34,
    excerpt:
      'Stripe Checkout, signature-verified webhooks, and usage metering with plan gating — free 25 vs pro 1000 searches — all offline-tested with real crypto.',
    date: '06-30-2026',
    tags: ['Tutorial', 'DealFinder', 'Payments', 'Stripe', 'SaaS'],
    order: 44,
    readTime: 12,
    image: '/tutorials/covers/dealfinder-part-34.png',
    draft: true,
  },
];

/**
 * Fixed, canonical part count for a series — the "of N" total. Some series
 * (notably DealFinder) have a locked syllabus whose total is larger than the
 * number of built entries below; unbuilt parts have no manifest entry yet
 * (numbering gaps are expected during construction). For series without an
 * override, the total is derived from the number of entries (seriesTotal).
 */
export const SERIES_TOTAL_OVERRIDE: Record<string, number> = {
  'Become a Full-Stack AI Engineer': 37,
};

/** One-line description of each series, shown in the course header. */
export const SERIES_INFO: Record<string, { blurb: string }> = {
  'RAG from Scratch': {
    blurb:
      'Build retrieval from the ground up — embeddings, a vector DB, chunking, hybrid search, reranking, and evaluation — one locally-tested step at a time.',
  },
  'Fine-Tuning & Serving': {
    blurb:
      'Change the model itself: when to fine-tune vs. retrieve, how LoRA/QLoRA work, and how to serve the result behind an OpenAI-compatible API.',
  },
  'Become a Full-Stack AI Engineer': {
    blurb:
      'Build a real AI deal-finder end to end — data, LLM literacy, an ML scoring model, retrieval, an agent, and shipping it — the capstone that ties every skill together.',
  },
};

/**
 * Total parts in a tutorial's series — the canonical override when set
 * (e.g. DealFinder = 37, a fixed syllabus), otherwise the
 * number of built entries.
 */
export function seriesTotal(series: string): number {
  return (
    SERIES_TOTAL_OVERRIDE[series] ??
    tutorials.filter((t) => t.series === series).length
  );
}

/** All parts of a series, in reading order. */
export function seriesParts(series: string): Tutorial[] {
  return tutorials.filter((t) => t.series === series).sort((a, b) => a.part - b.part);
}

/** Canonical display title: "Series: Subtitle (Part N of M)". */
export function fullTitle(t: Tutorial): string {
  return `${t.series}: ${t.title} (Part ${t.part} of ${seriesTotal(t.series)})`;
}

/** Public only after both the course and the individual lesson are released. */
export function isTutorialPublished(tutorial: Tutorial): boolean {
  return releasedSeries.has(tutorial.series) && !tutorial.draft;
}

export const publishedTutorials: Tutorial[] = tutorials.filter(isTutorialPublished);

/** Beta builds show every draft; production and ordinary local builds stay gated. */
export const siteTutorials: Tutorial[] = process.env.NEXT_PUBLIC_CONTENT_PREVIEW === '1'
  ? tutorials.map((tutorial) => ({ ...tutorial, draft: false }))
  : publishedTutorials;
