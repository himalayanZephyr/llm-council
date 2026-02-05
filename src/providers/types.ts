import type { ChatMessage } from '../types.js';

export interface LLMProvider {
  chat(model: string, messages: ChatMessage[]): Promise<string>;
}
