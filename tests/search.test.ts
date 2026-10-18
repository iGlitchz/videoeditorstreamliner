import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWeb, searchConfiguration } from '../apps/server/src/ai/search.ts';

const env = { WEB_SEARCH_API_KEY: 'test-primary', WEB_SEARCH_API_KEY_BACKUP: 'test-backup', WEB_SEARCH_TIMEOUT_MS: '1000' };
const primaryBody = { results: [{ title: 'Official documentation', url: 'https://example.org/docs', content: 'Source excerpt' }] };
const backupBody = { organic: [{ title: 'Backup documentation', link: 'https://example.org/backup', snippet: 'Backup excerpt' }] };
const fake = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => ((url: string | URL | Request, init?: RequestInit) => handler(String(url), init!)) as typeof fetch;

test('primary success authenticates server-side and normalizes results without using backup', async () => {
  const calls: string[] = [];
  const result = await searchWeb(' docs ', 5, { env, fetcher: fake((url, init) => {
    calls.push(url); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-primary');
    assert.equal(JSON.parse(init.body as string).search_depth, 'basic');
    return Response.json(primaryBody);
  }) });
  assert.equal(calls.length, 1); assert.equal(result.query, 'docs'); assert.equal(result.provider, 'tavily');
  assert.equal(result.fallbackUsed, false); assert.equal(result.sources[0]?.verificationStatus, 'unverified');
  assert.ok(!JSON.stringify(result).includes('test-primary'));
});

for (const status of [401, 403, 429, 432, 433, 500]) test(`HTTP ${status} triggers Serper fallback`, async () => {
  const result = await searchWeb('docs', 5, { env, fetcher: fake((url, init) => {
    if (url.includes('tavily')) return new Response('Never disclose this body or test-primary', { status });
    assert.equal((init.headers as Record<string, string>)['X-API-KEY'], 'test-backup');
    return Response.json(backupBody);
  }) });
  assert.equal(result.provider, 'serper'); assert.equal(result.fallbackUsed, true); assert.equal(result.warnings.length, 1);
  assert.ok(!JSON.stringify(result).includes('test-primary'));
});

for (const failure of ['network', 'malformed', 'empty']) test(`${failure} failure tries backup`, async () => {
  const result = await searchWeb('docs', 5, { env, fetcher: fake(url => {
    if (!url.includes('tavily')) return Response.json(backupBody);
    if (failure === 'network') throw new Error('Sensitive request details test-primary');
    return Response.json(failure === 'empty' ? { results: [] } : { invalid: true });
  }) });
  assert.equal(result.fallbackUsed, true); assert.equal(result.provider, 'serper');
  assert.ok(!JSON.stringify(result).includes('test-primary'));
});

test('missing primary key uses backup, missing both reports a sanitized failure', async () => {
  const result = await searchWeb('docs', 1, { env: { WEB_SEARCH_API_KEY_BACKUP: 'test-backup' }, fetcher: fake(() => Response.json(backupBody)) });
  assert.equal(result.fallbackUsed, true);
  await assert.rejects(searchWeb('docs', 1, { env: {} }), /API key is not configured/);
});

test('an actual request timeout aborts primary and then uses backup', async () => {
  const result = await searchWeb('docs', 1, { env, fetcher: fake((url, init) => {
    if (!url.includes('tavily')) return Response.json(backupBody);
    return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }) });
  assert.equal(result.fallbackUsed, true); assert.match(result.warnings[0]!, /timed out/);
});

test('explicit backup connection test never calls primary', async () => {
  const result = await searchWeb('docs', 1, { env, slot: 'backup', fetcher: fake(url => {
    assert.equal(url, 'https://google.serper.dev/search'); return Response.json(backupBody);
  }) });
  assert.equal(result.provider, 'serper'); assert.equal(result.fallbackUsed, false);
});

test('invalid URL schemes and duplicates are removed', async () => {
  const result = await searchWeb('docs', 5, { env, slot: 'primary', fetcher: fake(() => Response.json({ results: [...primaryBody.results, ...primaryBody.results, { title: 'unsafe', url: 'javascript:alert(1)' }] })) });
  assert.equal(result.sources.length, 1);
});

test('input validation, aliases, and timeouts are bounded', async () => {
  await assert.rejects(searchWeb('', 5, { env })); await assert.rejects(searchWeb('docs', 11, { env }));
  assert.throws(() => searchConfiguration({ WEB_SEARCH_TIMEOUT_MS: '0' }));
  assert.throws(() => searchConfiguration({ WEB_SEARCH_PROVIDER: 'unknown' }));
  assert.equal(searchConfiguration({ TAVILY_API_KEY: 'alias' }).primary.key, 'alias');
});

test('both providers failing returns no credentials or upstream body', async () => {
  await assert.rejects(searchWeb('docs', 5, { env, fetcher: fake(() => new Response('test-primary test-backup', { status: 401 })) }), error => {
    const message = (error as Error).message;
    return message.includes('tavily') && message.includes('serper') && !message.includes('test-primary') && !message.includes('test-backup');
  });
});
