import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db/index.js';
import { assets, shotNotes } from './db/schema.js';
import { bad, getProject } from './timeline.js';

export async function registerWorkspace(app: FastifyInstance) {
  app.patch('/api/projects/:id/assets/:assetId', async request => {
    const { id, assetId } = z.object({ id: z.string().uuid(), assetId: z.string().uuid() }).parse(request.params); getProject(id);
    const input = z.object({ selected: z.boolean() }).parse(request.body);
    const asset = db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, id))).get();
    if (!asset || asset.deleted) bad('Media not found', 404);
    return db.update(assets).set(input).where(eq(assets.id, assetId)).returning().get();
  });
  app.delete('/api/projects/:id/assets/:assetId', async (request, reply) => {
    const { id, assetId } = z.object({ id: z.string().uuid(), assetId: z.string().uuid() }).parse(request.params); getProject(id);
    const asset = db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, id))).get();
    if (!asset) bad('Media not found', 404);
    db.update(assets).set({ selected: false, deleted: true }).where(eq(assets.id, assetId)).run();
    return reply.code(204).send();
  });
  app.get('/api/projects/:id/shots', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id);
    return db.select().from(shotNotes).where(eq(shotNotes.projectId, id)).all();
  });
  app.put('/api/projects/:id/shots/:key', async request => {
    const { id, key } = z.object({ id: z.string().uuid(), key: z.string().regex(/^[a-z0-9-]{1,80}$/) }).parse(request.params); getProject(id);
    const { note } = z.object({ note: z.string().max(3000) }).parse(request.body);
    return db.transaction(() => {
      db.delete(shotNotes).where(and(eq(shotNotes.projectId, id), eq(shotNotes.key, key))).run();
      return db.insert(shotNotes).values({ projectId: id, key, note }).returning().get();
    });
  });
}
