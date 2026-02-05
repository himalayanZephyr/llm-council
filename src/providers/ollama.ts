import type { ChatMessage } from '../types.js';
import type { LLMProvider } from './types.js';

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl?: string, timeout = 120_000) {
    this.baseUrl = baseUrl ?? 'http://localhost:11434';
    this.timeout = timeout;
  }

  async chat(model: string, messages: ChatMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${body}`);
    }

    const data = await res.json();
    const content = data.message?.content;
    if (typeof content !== 'string') {
      throw new Error(`Unexpected response format from ${model}`);
    }
    return content;
  }
}
