export interface CouncilConfig {
  provider: 'openrouter' | 'ollama';
  apiKey?: string;
  baseUrl?: string;
  models: string[];
  chairmanModel: string;
  /** Request timeout in milliseconds. Default: 120000 */
  timeout?: number;
  /** Log progress to stderr. Default: false */
  verbose?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Stage1Entry {
  model: string;
  response: string;
}

export interface Stage2Ranking {
  model: string;
  evaluation: string;
  parsed_ranking: string[];
}

export interface AggregateRanking {
  model: string;
  average_rank: number;
  rankings_count: number;
}

export interface Stage2Result {
  rankings: Stage2Ranking[];
  label_to_model: Record<string, string>;
  aggregate_rankings: AggregateRanking[];
}

export interface Stage3Result {
  model: string;
  response: string;
}

export interface CouncilResult {
  query: string;
  stage1: Stage1Entry[] | null;
  stage2: Stage2Result | null;
  stage3: Stage3Result | null;
  error: string | null;
}
