import type { ChatMessage } from '../types.js';
import type { LLMProvider } from './types.js';

export class OpenRouterProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(apiKey: string, baseUrl?: string, timeout = 120_000) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://openrouter.ai/api/v1';
    this.timeout = timeout;
  }

  async chat(model: string, messages: ChatMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter API error (${res.status}): ${body}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error(`Unexpected response format from ${model}`);
    }
    return content;
  }
}
