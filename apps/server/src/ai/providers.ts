import { z } from 'zod';

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };
export interface AIProvider {
  chat(turns: ChatTurn[], model: string, options?: { temperature?: number; maxTokens?: number; json?: boolean | Record<string, unknown> }): Promise<string>;
  listModels(): Promise<{ id: string; name: string }[]>;
  testConnection(): Promise<boolean>;
}

const modelList = z.object({ data: z.array(z.object({ id: z.string(), name: z.string().optional() })) });
export class OpenRouterProvider implements AIProvider {
  constructor(private key: string) {}
  private headers() { return { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost', 'X-Title': 'YouTube Studio' }; }
  async listModels() {
    const res = await fetch('https://openrouter.ai/api/v1/models', { headers: this.headers(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`OpenRouter models failed (${res.status})`);
    return modelList.parse(await res.json()).data.map((m) => ({ id: m.id, name: m.name ?? m.id }));
  }
  async chat(turns: ChatTurn[], model: string, options: { temperature?: number; maxTokens?: number; json?: boolean | Record<string, unknown> } = {}) {
    if (!model) throw new Error('Choose an OpenRouter model first.');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: this.headers(), signal: AbortSignal.timeout(120000), body: JSON.stringify({ model, messages: turns, temperature: options.temperature, max_tokens: options.maxTokens }) });
    if (!res.ok) throw new Error(`OpenRouter request failed (${res.status})`);
    const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).parse(await res.json());
    return parsed.choices[0]!.message.content;
  }
  async testConnection() {
    // The public models endpoint does not validate API-key authentication.
    const res = await fetch('https://openrouter.ai/api/v1/key', { headers: this.headers(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`OpenRouter authentication failed (${res.status})`);
    return true;
  }
}

const ollamaList = z.object({ models: z.array(z.object({ name: z.string() })) });
export class OllamaProvider implements AIProvider {
  constructor(private baseUrl: string) {}
  async listModels() {
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) }); if (!res.ok) throw new Error(`Ollama unavailable (${res.status})`);
    return ollamaList.parse(await res.json()).models.map((m) => ({ id: m.name, name: m.name }));
  }
  async chat(turns: ChatTurn[], model: string, options: { temperature?: number; maxTokens?: number; json?: boolean | Record<string, unknown> } = {}) {
    if (!model) throw new Error('Choose an Ollama model first.');
    const res = await fetch(`${this.baseUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120000), body: JSON.stringify({ model, messages: turns, stream: false, ...(options.json ? { format: typeof options.json === 'object' ? options.json : 'json' } : {}), options: { temperature: options.temperature, num_predict: options.maxTokens } }) });
    if (!res.ok) throw new Error(`Ollama request failed (${res.status})`);
    return z.object({ message: z.object({ content: z.string() }) }).parse(await res.json()).message.content;
  }
  async testConnection() { await this.listModels(); return true; }
}

export function providerFor(name: string): AIProvider | null {
  if (name === 'openrouter' && process.env.OPENROUTER_API_KEY?.trim()) return new OpenRouterProvider(process.env.OPENROUTER_API_KEY.trim());
  if (name === 'ollama') return new OllamaProvider(process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434');
  return null;
}
