import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { SearchResponse } from '@studio/shared';
import { db } from './db/index.js';
import { projects, sections, researchSources } from './db/schema.js';
import { integrationStatus, searchWeb } from './ai/search.js';

export function validateResearchScope(projectId: string, sectionId: string | null) {
  if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
  if (sectionId && !db.select({ id: sections.id }).from(sections).where(and(eq(sections.id, sectionId), eq(sections.projectId, projectId))).get()) throw Object.assign(new Error('Section does not belong to this project'), { statusCode: 404 });
}

export function saveResearch(projectId: string, sectionId: string | null, result: SearchResponse) {
  validateResearchScope(projectId, sectionId);
  const sources = result.sources.map(source => ({ ...source, id: crypto.randomUUID(), projectId, sectionId, query: result.query }));
  if (sources.length) db.transaction(tx => { tx.insert(researchSources).values(sources).run(); });
  return { ...result, sources };
}

export function researchContext(projectId: string, sectionId: string | null) {
  const whole = sectionId && db.select({ scope: sections.scope }).from(sections).where(eq(sections.id, sectionId)).get()?.scope === 'whole';
  return db.select().from(researchSources).where(and(eq(researchSources.projectId, projectId), whole ? undefined : sectionId ? eq(researchSources.sectionId, sectionId) : isNull(researchSources.sectionId))).orderBy(desc(researchSources.retrievedAt)).limit(10).all();
}

export async function registerResearch(app: FastifyInstance) {
  app.get('/api/integrations', async () => integrationStatus());
  app.post('/api/search/test', async request => {
    const { slot } = z.object({ slot: z.enum(['primary', 'backup']).optional() }).parse(request.body ?? {});
    const result = await searchWeb('Remotion official documentation', 1, { slot });
    return { ok: true, provider: result.provider, fallbackUsed: result.fallbackUsed, resultCount: result.sources.length, warnings: result.warnings };
  });
  app.post('/api/projects/:id/research/search', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { query, sectionId, maxResults } = z.object({ query: z.string().trim().min(1).max(1000), sectionId: z.string().uuid().nullable().default(null), maxResults: z.number().int().min(1).max(10).default(5) }).parse(request.body);
    validateResearchScope(id, sectionId);
    return saveResearch(id, sectionId, await searchWeb(query, maxResults));
  });
  app.get('/api/projects/:id/research', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { sectionId } = z.object({ sectionId: z.string().uuid().optional() }).parse(request.query);
    validateResearchScope(id, sectionId ?? null);
    return researchContext(id, sectionId ?? null);
  });
}
