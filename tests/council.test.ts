import { describe, it, expect, vi } from 'vitest';
import {
  LLMCouncil,
  parseRanking,
  calculateAggregateRankings,
} from '../src/index.js';
import type { LLMProvider } from '../src/providers/types.js';

// ── parseRanking ─────────────────────────────────────────────

describe('parseRanking', () => {
  it('parses a well-formatted FINAL RANKING block', () => {
    const text = `
Response A is good because...
Response B lacks detail...

FINAL RANKING:
1. Response B
2. Response A
3. Response C
`;
    expect(parseRanking(text)).toEqual([
      'Response B',
      'Response A',
      'Response C',
    ]);
  });

  it('falls back to mention order when no FINAL RANKING header', () => {
    const text = `I think Response C was best, then Response A, then Response B.`;
    expect(parseRanking(text)).toEqual([
      'Response C',
      'Response A',
      'Response B',
    ]);
  });

  it('returns empty array when no responses mentioned', () => {
    expect(parseRanking('No useful output here')).toEqual([]);
  });

  it('deduplicates fallback mentions', () => {
    const text = `Response A is great. Response A was the best. Response B was ok.`;
    expect(parseRanking(text)).toEqual(['Response A', 'Response B']);
  });

  it('parses FINAL RANKING with bare letters (1. A, 2. B)', () => {
    const text = `Some evaluation...\n\nFINAL RANKING:\n1. B\n2. A\n3. C\n`;
    expect(parseRanking(text)).toEqual([
      'Response B',
      'Response A',
      'Response C',
    ]);
  });

  it('parses numbered list without FINAL RANKING header', () => {
    const text = `My ranking:\n1. Response C\n2. Response A\n3. Response B`;
    expect(parseRanking(text)).toEqual([
      'Response C',
      'Response A',
      'Response B',
    ]);
  });

  it('parses A > B > C ranking pattern', () => {
    const text = `Overall I think the ranking is B > A > C`;
    expect(parseRanking(text)).toEqual([
      'Response B',
      'Response A',
      'Response C',
    ]);
  });
});

// ── calculateAggregateRankings ───────────────────────────────

describe('calculateAggregateRankings', () => {
  const labelToModel: Record<string, string> = {
    'Response A': 'model-1',
    'Response B': 'model-2',
    'Response C': 'model-3',
  };

  it('computes average ranks and sorts ascending', () => {
    const rankings = [
      {
        model: 'model-1',
        evaluation: '',
        parsed_ranking: ['Response C', 'Response A', 'Response B'],
      },
      {
        model: 'model-2',
        evaluation: '',
        parsed_ranking: ['Response A', 'Response C', 'Response B'],
      },
      {
        model: 'model-3',
        evaluation: '',
        parsed_ranking: ['Response C', 'Response B', 'Response A'],
      },
    ];

    const result = calculateAggregateRankings(rankings, labelToModel);

    // Response C: ranks 1,2,1 = avg 1.33
    expect(result[0].model).toBe('model-3');
    expect(result[0].average_rank).toBeCloseTo(1.33, 1);

    // Response A: ranks 2,1,3 = avg 2
    expect(result[1].model).toBe('model-1');
    expect(result[1].average_rank).toBe(2);

    // Response B: ranks 3,3,2 = avg 2.67
    expect(result[2].model).toBe('model-2');
    expect(result[2].average_rank).toBeCloseTo(2.67, 1);
  });

  it('handles a single ranker', () => {
    const rankings = [
      {
        model: 'model-1',
        evaluation: '',
        parsed_ranking: ['Response B', 'Response A'],
      },
    ];
    const result = calculateAggregateRankings(rankings, labelToModel);
    expect(result[0].model).toBe('model-2');
    expect(result[0].average_rank).toBe(1);
    expect(result[0].rankings_count).toBe(1);
  });
});

// ── LLMCouncil.run (integration with mock provider) ─────────

describe('LLMCouncil.run', () => {
  function createMockProvider(): LLMProvider {
    const responses: Record<string, string[]> = {};

    return {
      async chat(model: string, messages) {
        if (!responses[model]) responses[model] = [];
        const callIndex = responses[model].length;

        const userContent = messages[messages.length - 1].content;
        const isRanking = userContent.includes('IMPORTANT: Your final ranking');
        const isChairman = userContent.includes('You are the Chairman');

        let reply: string;
        if (isChairman) {
          reply = `As chairman, here is my synthesis of all responses.`;
        } else if (isRanking) {
          reply = `Response A is solid. Response B is also good.\n\nFINAL RANKING:\n1. Response B\n2. Response A`;
        } else {
          reply = `This is ${model}'s answer to: ${userContent}`;
        }

        responses[model].push(reply);
        return reply;
      },
    };
  }

  it('runs all 3 stages and returns structured result', async () => {
    const provider = createMockProvider();

    // Construct council with a hack: override the private provider
    const council = new LLMCouncil({
      provider: 'ollama',
      models: ['model-a', 'model-b'],
      chairmanModel: 'model-a',
    });

    // Replace the provider with mock
    (council as any).provider = provider;

    const result = await council.run('What is 2+2?');

    // No error
    expect(result.error).toBeNull();

    // Stage 1: both models responded
    expect(result.stage1).toHaveLength(2);
    expect(result.stage1![0].model).toBe('model-a');
    expect(result.stage1![1].model).toBe('model-b');

    // Stage 2: rankings exist
    expect(result.stage2!.rankings).toHaveLength(2);
    expect(result.stage2!.label_to_model['Response A']).toBe('model-a');
    expect(result.stage2!.label_to_model['Response B']).toBe('model-b');
    expect(result.stage2!.aggregate_rankings.length).toBeGreaterThan(0);

    // Stage 3: chairman synthesized
    expect(result.stage3!.model).toBe('model-a');
    expect(result.stage3!.response).toContain('chairman');

    // Top-level
    expect(result.query).toBe('What is 2+2?');
  });

  it('returns error in result if all stage 1 models fail', async () => {
    const council = new LLMCouncil({
      provider: 'ollama',
      models: ['model-a'],
      chairmanModel: 'model-a',
    });

    (council as any).provider = {
      chat: async () => {
        throw new Error('connection refused');
      },
    };

    const result = await council.run('hello');
    expect(result.error).toContain('Stage 1 failed');
    expect(result.error).toContain('All models failed');
    expect(result.stage1).toBeNull();
    expect(result.stage2).toBeNull();
    expect(result.stage3).toBeNull();
  });

  it('returns partial results when stage 3 fails', async () => {
    const council = new LLMCouncil({
      provider: 'ollama',
      models: ['model-a', 'model-b'],
      chairmanModel: 'model-a',
    });

    let callCount = 0;
    (council as any).provider = {
      chat: async (model: string, messages: any[]) => {
        callCount++;
        const content = messages[messages.length - 1].content;
        if (content.includes('You are the Chairman')) {
          throw new Error('OpenRouter API error (429): rate limited');
        }
        if (content.includes('IMPORTANT: Your final ranking')) {
          return 'FINAL RANKING:\n1. Response B\n2. Response A';
        }
        return `Answer from ${model}`;
      },
    };

    const result = await council.run('hello');
    expect(result.error).toContain('Stage 3 failed');
    expect(result.error).toContain('429');
    expect(result.stage1).toHaveLength(2);
    expect(result.stage2).not.toBeNull();
    expect(result.stage3).toBeNull();
  });

  it('requires apiKey for openrouter provider', () => {
    expect(
      () =>
        new LLMCouncil({
          provider: 'openrouter',
          models: ['m1'],
          chairmanModel: 'm1',
        }),
    ).toThrow('apiKey is required');
  });
});
