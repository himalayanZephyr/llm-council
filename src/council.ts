import type {
  CouncilConfig,
  CouncilResult,
  Stage1Entry,
  Stage2Ranking,
  Stage2Result,
  Stage3Result,
  AggregateRanking,
} from './types.js';
import type { LLMProvider } from './providers/types.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { OllamaProvider } from './providers/ollama.js';
import { buildRankingPrompt, buildChairmanPrompt } from './prompts.js';

export class LLMCouncil {
  private provider: LLMProvider;
  private models: string[];
  private chairmanModel: string;
  private verbose: boolean;

  constructor(config: CouncilConfig) {
    this.models = config.models;
    this.chairmanModel = config.chairmanModel;
    this.verbose = config.verbose ?? false;

    if (config.provider === 'openrouter') {
      if (!config.apiKey) {
        throw new Error('apiKey is required for the openrouter provider');
      }
      this.provider = new OpenRouterProvider(
        config.apiKey,
        config.baseUrl,
        config.timeout,
      );
    } else {
      this.provider = new OllamaProvider(config.baseUrl, config.timeout);
    }
  }

  private log(message: string): void {
    if (this.verbose) {
      console.error(`[llm-council] ${message}`);
    }
  }

  async run(query: string): Promise<CouncilResult> {
    this.log(`Starting council with ${this.models.length} models`);
    const t0 = Date.now();

    const result: CouncilResult = {
      query,
      stage1: null,
      stage2: null,
      stage3: null,
      error: null,
    };

    try {
      result.stage1 = await this.stage1(query);
    } catch (err) {
      result.error = `Stage 1 failed: ${err instanceof Error ? err.message : String(err)}`;
      this.log(result.error);
      return result;
    }

    try {
      result.stage2 = await this.stage2(query, result.stage1);
    } catch (err) {
      result.error = `Stage 2 failed: ${err instanceof Error ? err.message : String(err)}`;
      this.log(result.error);
      return result;
    }

    try {
      result.stage3 = await this.stage3(query, result.stage1, result.stage2.rankings);
    } catch (err) {
      result.error = `Stage 3 failed: ${err instanceof Error ? err.message : String(err)}`;
      this.log(result.error);
      return result;
    }

    this.log(`Council complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return result;
  }

  private async stage1(query: string): Promise<Stage1Entry[]> {
    this.log('Stage 1: Collecting responses...');
    const t0 = Date.now();

    const results = await Promise.allSettled(
      this.models.map(async (model) => {
        this.log(`  Querying ${model}...`);
        const response = await this.provider.chat(model, [
          { role: 'user', content: query },
        ]);
        this.log(`  ${model} responded (${response.length} chars)`);
        return { model, response };
      }),
    );

    const entries: Stage1Entry[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        entries.push(result.value);
      } else {
        this.log(`  ${this.models[i]} failed: ${result.reason}`);
      }
    }

    if (entries.length === 0) {
      throw new Error('All models failed to respond in Stage 1');
    }

    this.log(
      `Stage 1 complete: ${entries.length}/${this.models.length} succeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    return entries;
  }

  private async stage2(
    query: string,
    stage1: Stage1Entry[],
  ): Promise<Stage2Result> {
    this.log('Stage 2: Peer ranking (anonymized)...');
    const t0 = Date.now();

    const labelToModel: Record<string, string> = {};
    const anonymized = stage1.map((entry, i) => {
      const label = `Response ${String.fromCharCode(65 + i)}`;
      labelToModel[label] = entry.model;
      return { label, text: entry.response };
    });

    this.log(
      `  Anonymized ${stage1.length} responses: ${Object.keys(labelToModel).join(', ')}`,
    );
    const prompt = buildRankingPrompt(query, anonymized);

    const results = await Promise.allSettled(
      this.models.map(async (model) => {
        this.log(`  ${model} is ranking...`);
        const evaluation = await this.provider.chat(model, [
          { role: 'user', content: prompt },
        ]);
        const parsed = parseRanking(evaluation);
        if (parsed.length > 0) {
          this.log(`  ${model} ranked: ${parsed.join(' > ')}`);
        } else {
          const snippet = evaluation.slice(-200).replace(/\n/g, ' ').trim();
          this.log(`  ${model} ranking could not be parsed. Tail: "${snippet}"`);
        }
        return { model, evaluation, parsed_ranking: parsed };
      }),
    );

    const rankings: Stage2Ranking[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        rankings.push(result.value);
      } else {
        this.log(`  ${this.models[i]} failed to rank: ${result.reason}`);
      }
    }

    const aggregateRankings = calculateAggregateRankings(
      rankings,
      labelToModel,
    );

    this.log(
      `Stage 2 complete: ${rankings.length}/${this.models.length} ranked in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    for (const r of aggregateRankings) {
      this.log(`  ${r.model}: avg rank ${r.average_rank}`);
    }

    return {
      rankings,
      label_to_model: labelToModel,
      aggregate_rankings: aggregateRankings,
    };
  }

  private async stage3(
    query: string,
    stage1: Stage1Entry[],
    stage2Rankings: Stage2Ranking[],
  ): Promise<Stage3Result> {
    this.log(`Stage 3: Chairman (${this.chairmanModel}) synthesizing...`);
    const t0 = Date.now();

    const prompt = buildChairmanPrompt(query, stage1, stage2Rankings);
    const response = await this.provider.chat(this.chairmanModel, [
      { role: 'user', content: prompt },
    ]);

    this.log(
      `Stage 3 complete in ${((Date.now() - t0) / 1000).toFixed(1)}s (${response.length} chars)`,
    );
    return { model: this.chairmanModel, response };
  }
}

export function parseRanking(text: string): string[] {
  // Strategy 1: Look for "FINAL RANKING:" header with "Response X" labels
  const finalRankingIdx = text.indexOf('FINAL RANKING:');
  if (finalRankingIdx !== -1) {
    const section = text.slice(finalRankingIdx);
    const matches = section.match(/\d+\.\s*Response [A-Z]/g);
    if (matches && matches.length > 0) {
      return matches.map((m) => m.replace(/^\d+\.\s*/, ''));
    }
    // "FINAL RANKING:" found but with bare letters: "1. A" or "1. B"
    const bareMatches = section.match(/\d+\.\s*[A-Z](?:\s|$|,|\.)/g);
    if (bareMatches && bareMatches.length > 0) {
      return bareMatches.map(
        (m) => `Response ${m.replace(/^\d+\.\s*/, '').trim().replace(/[,.]$/, '')}`,
      );
    }
  }

  // Strategy 2: Numbered list with "Response X" anywhere in the text
  const numberedResponses = text.match(/\d+\.\s*Response [A-Z]/g);
  if (numberedResponses && numberedResponses.length > 0) {
    return numberedResponses.map((m) => m.replace(/^\d+\.\s*/, ''));
  }

  // Strategy 3: "Response X" mentions in order (deduplicated)
  const mentions = text.match(/Response [A-Z]/g);
  if (mentions && mentions.length > 0) {
    return [...new Set(mentions)];
  }

  // Strategy 4: Ranking patterns like "A > B > C" or "A, B, C"
  const gtPattern = text.match(/\b([A-Z])\s*>\s*([A-Z])(?:\s*>\s*([A-Z]))*/g);
  if (gtPattern) {
    const letters = gtPattern[0].split('>').map((s) => s.trim());
    if (letters.every((l) => /^[A-Z]$/.test(l))) {
      return letters.map((l) => `Response ${l}`);
    }
  }

  return [];
}

export function calculateAggregateRankings(
  rankings: Stage2Ranking[],
  labelToModel: Record<string, string>,
): AggregateRanking[] {
  const modelRanks: Record<string, number[]> = {};

  for (const ranking of rankings) {
    for (let i = 0; i < ranking.parsed_ranking.length; i++) {
      const label = ranking.parsed_ranking[i];
      const model = labelToModel[label];
      if (model) {
        if (!modelRanks[model]) modelRanks[model] = [];
        modelRanks[model].push(i + 1); // 1-indexed rank
      }
    }
  }

  const aggregates: AggregateRanking[] = Object.entries(modelRanks).map(
    ([model, ranks]) => ({
      model,
      average_rank:
        Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 100) /
        100,
      rankings_count: ranks.length,
    }),
  );

  return aggregates.sort((a, b) => a.average_rank - b.average_rank);
}
