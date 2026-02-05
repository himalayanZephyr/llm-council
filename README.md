# llm-council

A TypeScript library that implements the [LLM Council](https://github.com/karpathy/llm-council) pattern — query multiple LLMs, have them peer-review each other, and synthesize a final answer.

```
                            ┌─────────────┐
                            │  User Query │
                            └──────┬──────┘
                                   │
  ┌────────────────────────────────┼────────────────────────────────┐
  │  STAGE 1: RESPOND              │                     [parallel] │
  │                                │                                │
  │          ┌─────────────────────┼─────────────────────┐          │
  │          │                     │                     │          │
  │          ▼                     ▼                    ▼          │
  │   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐     │
  │   │   Model A   │      │   Model B   │      │   Model C   │     │
  │   │  answers    │      │  answers    │      │  answers    │     │
  │   │  the query  │      │  the query  │      │  the query  │     │
  │   └──────┬──────┘      └──────┬──────┘      └──────┬──────┘     │
  │          │                    │                    │            │
  │          ▼                    ▼                   ▼            │
  │     Response A           Response B           Response C        │
  │                                                                 │
  └───────────────────────────────┬───────────────────────────────--┘
                                  │
                                  ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  STAGE 2: PEER RANK               [anonymized] [parallel]     │
  │                                                               │
  │   Each model ranks ALL responses (including its own,          │
  │   unknowingly — identities are hidden as A, B, C)             │
  │                                                               │
  │   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐   │
  │   │   Model A   │      │   Model B   │      │   Model C   │   │
  │   │             │      │             │      │             │   │
  │   │ ranks A,B,C │      │ ranks A,B,C │      │ ranks A,B,C │   │
  │   │ (anonymous) │      │ (anonymous) │      │ (anonymous) │   │
  │   └──────┬──────┘      └──────┬──────┘      └──────┬──────┘   │
  │          │                    │                    │          │
  │          ▼                    ▼                   ▼          │
  │       Rankings ────────► Aggregate ◄──────── Rankings        │
  │                          Rankings                             │
  └───────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  STAGE 3: SYNTHESIZE                                          │
  │                                                               │
  │            ┌───────────────────────────────┐                  │
  │            │     ★ Chairman Model ★       │                  │
  │            │                               │                  │
  │            │  receives all responses       │                  │
  │            │  + all peer rankings          │                  │
  │            │                               │                  │
  │            │  synthesizes one final        │                  │
  │            │  comprehensive answer         │                  │
  │            └───────────────┬───────────────┘                  │
  │                            │                                  │
  └────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
                     ┌─────────────────┐
                     │  Final Answer   │
                     └─────────────────┘
```

## Install

```bash
npm install llm-council
```

Requires Node.js >= 18.

## Quick Start

### With OpenRouter

```typescript
import { LLMCouncil } from 'llm-council';

const council = new LLMCouncil({
  provider: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY!,
  models: [
    'openai/gpt-4o',
    'anthropic/claude-sonnet-4-5-20250929',
    'google/gemini-2.0-flash-001',
  ],
  chairmanModel: 'anthropic/claude-sonnet-4-5-20250929',
  verbose: true,
});

const result = await council.run('What is quantum computing?');
console.log(JSON.stringify(result, null, 2));
```

### With Ollama

```typescript
import { LLMCouncil } from 'llm-council';

const council = new LLMCouncil({
  provider: 'ollama',
  models: ['llama3', 'mistral', 'gemma2'],
  chairmanModel: 'llama3',
  timeout: 300_000, // 5 min — local models need more time for large prompts
  verbose: true,
});

const result = await council.run('What is quantum computing?');
console.log(JSON.stringify(result, null, 2));
```

## How It Works

The council runs three stages sequentially:

| Stage | What Happens |
|-------|-------------|
| **Stage 1 — Respond** | All council models independently answer the query in parallel. |
| **Stage 2 — Rank** | Each model peer-reviews all Stage 1 responses. Identities are anonymized (Response A, B, C...) to prevent bias. Each model produces a ranked list. Aggregate rankings are computed. |
| **Stage 3 — Synthesize** | A designated chairman model receives all responses and all rankings, then produces a single synthesized final answer. |

## Output Format

`council.run()` returns a `CouncilResult`:

```json
{
  "query": "What is quantum computing?",
  "stage1": [
    { "model": "openai/gpt-4o", "response": "..." },
    { "model": "anthropic/claude-sonnet-4-5-20250929", "response": "..." },
    { "model": "google/gemini-2.0-flash-001", "response": "..." }
  ],
  "stage2": {
    "rankings": [
      {
        "model": "openai/gpt-4o",
        "evaluation": "Full evaluation text with reasoning...",
        "parsed_ranking": ["Response B", "Response C", "Response A"]
      }
    ],
    "label_to_model": {
      "Response A": "openai/gpt-4o",
      "Response B": "anthropic/claude-sonnet-4-5-20250929",
      "Response C": "google/gemini-2.0-flash-001"
    },
    "aggregate_rankings": [
      { "model": "anthropic/claude-sonnet-4-5-20250929", "average_rank": 1.33, "rankings_count": 3 },
      { "model": "google/gemini-2.0-flash-001", "average_rank": 2.0, "rankings_count": 3 },
      { "model": "openai/gpt-4o", "average_rank": 2.67, "rankings_count": 3 }
    ]
  },
  "stage3": {
    "model": "anthropic/claude-sonnet-4-5-20250929",
    "response": "The chairman's synthesized final answer..."
  },
  "error": null
}
```

### Error Handling

If a stage fails (e.g. rate limiting, timeout), completed stages are preserved and the `error` field describes what went wrong:

```json
{
  "query": "...",
  "stage1": [ ... ],
  "stage2": { ... },
  "stage3": null,
  "error": "Stage 3 failed: OpenRouter API error (429): rate limited"
}
```

### Verbose Logging

Enable `verbose: true` to get progress logs on stderr:

```
[llm-council] Starting council with 3 models
[llm-council] Stage 1: Collecting responses...
[llm-council]   Querying mistral:7b...
[llm-council]   Querying qwen2.5-coder:3b...
[llm-council]   mistral:7b responded (1842 chars)
[llm-council]   qwen2.5-coder:3b responded (1518 chars)
[llm-council] Stage 1 complete: 2/2 succeeded in 45.3s
[llm-council] Stage 2: Peer ranking (anonymized)...
[llm-council]   Anonymized 2 responses: Response A, Response B
[llm-council]   mistral:7b ranked: Response B > Response A
[llm-council] Stage 2 complete: 2/2 ranked in 38.1s
[llm-council]   mistral:7b: avg rank 1.5
[llm-council] Stage 3: Chairman (mistral:7b) synthesizing...
[llm-council] Stage 3 complete in 22.0s (2048 chars)
[llm-council] Council complete in 105.4s
```

Logs go to `stderr` so they don't pollute JSON on `stdout`:

```bash
npm run example 2>/dev/null   # JSON only, no logs
```

## API

### `new LLMCouncil(config)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `provider` | `'openrouter' \| 'ollama'` | Yes | Which LLM backend to use. |
| `apiKey` | `string` | OpenRouter only | Your OpenRouter API key. |
| `baseUrl` | `string` | No | Override the provider URL. Defaults to `https://openrouter.ai/api/v1` or `http://localhost:11434`. |
| `models` | `string[]` | Yes | List of model IDs for the council. |
| `chairmanModel` | `string` | Yes | Model ID for the Stage 3 synthesizer. |
| `timeout` | `number` | No | Request timeout in ms. Default: `120000`. |
| `verbose` | `boolean` | No | Log progress to stderr. Default: `false`. |

### `council.run(query): Promise<CouncilResult>`

Runs all three stages and returns the full result. On failure, completed stages are preserved and `error` is set.

### Exported Utilities

```typescript
import { parseRanking, calculateAggregateRankings } from 'llm-council';
```

- **`parseRanking(text)`** — Extracts the ranked response labels from a model's evaluation text.
- **`calculateAggregateRankings(rankings, labelToModel)`** — Computes average rank per model across all evaluators.

### Exported Types

```typescript
import type {
  CouncilConfig,
  CouncilResult,
  ChatMessage,
  Stage1Entry,
  Stage2Ranking,
  Stage2Result,
  Stage3Result,
  AggregateRanking,
  LLMProvider,
} from 'llm-council';
```

## Development

```bash
npm install           # install dependencies
npm run build         # compile to dist/ (ESM + CJS + types)
npm test              # run tests
npm run test:watch    # run tests in watch mode
npm run example       # run the Ollama example locally
```

## Credits

Based on [LLM Council](https://github.com/karpathy/llm-council) by Andrej Karpathy.

## License

MIT
