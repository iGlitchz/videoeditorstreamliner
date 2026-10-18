import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../apps/web/src/lib/api.ts';

test('empty DELETE and POST requests have no JSON content-type', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const method of ['DELETE', 'POST', 'GET']) {
      globalThis.fetch = async (_url, init) => {
        assert.equal(new Headers(init?.headers).has('Content-Type'), false);
        assert.equal(init?.body, undefined);
        return new Response(null, { status: 204 });
      };
      assert.equal(await request('/test', { method }), undefined);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('JSON bodies use JSON content-type and preserve custom headers', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Content-Type'), 'application/json');
      assert.equal(headers.get('X-Test'), 'preserved');
      return Response.json({ ok: true });
    };
    assert.deepEqual(await request('/test', { method: 'POST', body: '{}', headers: new Headers({ 'X-Test': 'preserved' }) }), { ok: true });
  } finally { globalThis.fetch = originalFetch; }
});

test('multipart uploads leave content-type boundary generation to fetch', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init?.headers).has('Content-Type'), false);
      assert.ok(init?.body instanceof FormData);
      return Response.json({ ok: true });
    };
    await request('/test', { method: 'POST', body: new FormData() });
  } finally { globalThis.fetch = originalFetch; }
});
