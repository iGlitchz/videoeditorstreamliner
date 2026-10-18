import { z } from 'zod';
import { searchProviderSchema, type SearchProviderName, type SearchResponse, type SearchSource, type IntegrationStatus } from '@studio/shared';

type Environment = Record<string, string | undefined>;
type SearchProvider = { name: SearchProviderName; key: string };
const keyFor = (env: Environment, name: SearchProviderName) => (env[name === 'tavily' ? 'TAVILY_API_KEY' : 'SERPER_API_KEY'] ?? '').trim();
export function searchConfiguration(env: Environment = process.env) {
  const primaryName = searchProviderSchema.parse(env.WEB_SEARCH_PROVIDER || 'tavily');
  const backupName = searchProviderSchema.parse(env.WEB_SEARCH_BACKUP_PROVIDER || 'serper');
  const primary = { name: primaryName, key: (env.WEB_SEARCH_API_KEY ?? '').trim() || keyFor(env, primaryName) };
  const backup = { name: backupName, key: (env.WEB_SEARCH_API_KEY_BACKUP ?? '').trim() || keyFor(env, backupName) };
  const timeoutMs = z.coerce.number().int().min(1000).max(30000).parse(env.WEB_SEARCH_TIMEOUT_MS || '12000');
  return { primary, backup, timeoutMs };
}

export function integrationStatus(): IntegrationStatus {
  const { primary, backup, timeoutMs } = searchConfiguration();
  return {
    search: { primary: { provider: primary.name, configured: !!primary.key }, backup: { provider: backup.name, configured: !!backup.key }, timeoutMs },
    ai: { openrouter: !!process.env.OPENROUTER_API_KEY?.trim(), ollama: true },
    assets: { pexels: !!process.env.PEXELS_API_KEY?.trim(), pixabay: !!process.env.PIXABAY_API_KEY?.trim(), runware: !!process.env.RUNWARE_API_KEY?.trim(), connected: false },
  };
}

const tavilyResponse = z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string().optional(), published_date: z.string().nullable().optional() })) });
const serperResponse = z.object({ organic: z.array(z.object({ title: z.string(), link: z.string(), snippet: z.string().optional(), date: z.string().nullable().optional() })).default([]) });
const publicUrl = (value: string) => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};

async function searchProvider(provider: SearchProvider, query: string, maxResults: number, timeoutMs: number, fetcher: typeof fetch): Promise<SearchSource[]> {
  if (!provider.key) throw new Error(`${provider.name}: API key is not configured.`);
  const tavily = provider.name === 'tavily';
  let response: Response;
  try {
    response = await fetcher(tavily ? 'https://api.tavily.com/search' : 'https://google.serper.dev/search', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(tavily ? { Authorization: `Bearer ${provider.key}` } : { 'X-API-KEY': provider.key }) },
      body: JSON.stringify(tavily ? { query, max_results: maxResults, search_depth: 'basic', auto_parameters: false, include_answer: false, include_raw_content: false } : { q: query, num: maxResults }),
    });
  } catch {
    // Never relay fetch errors, provider bodies, request headers, or keys to logs/UI.
    throw new Error(`${provider.name}: connection failed or timed out.`);
  }
  if (!response.ok) {
    const reason = [401, 403].includes(response.status) ? 'authentication rejected' : [429, 432, 433].includes(response.status) ? 'rate limit or search quota exceeded' : 'request failed';
    throw new Error(`${provider.name}: ${reason} (HTTP ${response.status}).`);
  }
  try {
    const payload = await response.json();
    const items = tavily ? tavilyResponse.parse(payload).results.map(r => ({ title: r.title, url: r.url, excerpt: r.content ?? '', publicationDate: r.published_date ?? null })) : serperResponse.parse(payload).organic.map(r => ({ title: r.title, url: r.link, excerpt: r.snippet ?? '', publicationDate: r.date ?? null }));
    const retrievedAt = new Date().toISOString();
    const seen = new Set<string>();
    return items.filter(r => publicUrl(r.url) && !seen.has(r.url) && !!seen.add(r.url)).slice(0, maxResults).map(r => ({ ...r, title: r.title.slice(0, 500), excerpt: r.excerpt.slice(0, 5000), provider: provider.name, retrievedAt, verificationStatus: 'unverified' as const }));
  } catch { throw new Error(`${provider.name}: returned an invalid search response.`); }
}

export async function searchWeb(query: string, maxResults = 5, options: { env?: Environment; fetcher?: typeof fetch; slot?: 'primary' | 'backup' } = {}): Promise<SearchResponse> {
  const input = z.object({ query: z.string().trim().min(1).max(1000), maxResults: z.number().int().min(1).max(10) }).parse({ query, maxResults });
  const { primary, backup, timeoutMs } = searchConfiguration(options.env);
  const warnings: string[] = [];
  const candidates = options.slot ? [options.slot === 'primary' ? primary : backup] : [primary, backup];
  for (const [index, provider] of candidates.entries()) {
    if (!provider.key) { warnings.push(`${provider.name}: API key is not configured.`); continue; }
    try {
      const sources = await searchProvider(provider, input.query, input.maxResults, timeoutMs, options.fetcher ?? fetch);
      if (!sources.length && index < candidates.length - 1 && candidates[index + 1]?.key) { warnings.push(`${provider.name}: no usable results; trying backup.`); continue; }
      return { query: input.query, provider: provider.name, sources, fallbackUsed: !options.slot && index > 0, warnings };
    } catch (error) { warnings.push((error as Error).message); }
  }
  throw Object.assign(new Error(`Web search unavailable. ${warnings.join(' ')}`), { statusCode: 503 });
}
