import { z } from 'zod';

export const searchProviderSchema = z.enum(['tavily', 'serper']);
export const searchSourceSchema = z.object({
  title: z.string(), url: z.string().url(), excerpt: z.string(),
  publicationDate: z.string().nullable(), retrievedAt: z.string(),
  provider: searchProviderSchema, verificationStatus: z.literal('unverified'),
});
export const searchResponseSchema = z.object({
  query: z.string(), provider: searchProviderSchema, fallbackUsed: z.boolean(),
  warnings: z.array(z.string()), sources: z.array(searchSourceSchema),
});
export type SearchProviderName = z.infer<typeof searchProviderSchema>;
export type SearchSource = z.infer<typeof searchSourceSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ResearchSource = SearchSource & { id: string; projectId: string; sectionId: string | null; query: string };
export type IntegrationStatus = {
  search: { primary: { provider: SearchProviderName; configured: boolean }; backup: { provider: SearchProviderName; configured: boolean }; timeoutMs: number };
  ai: { openrouter: boolean; ollama: boolean };
  assets: { pexels: boolean; pixabay: boolean; runware: boolean; connected: false };
};
