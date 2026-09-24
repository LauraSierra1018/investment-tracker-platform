const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(require.resolve('../lib/api-request.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', source)(loaded, loaded.exports);
const { createApiClient, NAVIGATION_EVENT, isPublicMarketRequest } = loaded.exports;
const never = () => new Promise(() => {});
const session = async () => ({ data: { session: { access_token: 'fixture-token' } } });

test('public market remains available with a hung session refresh', async () => {
  let authCalls = 0;
  const api = createApiClient(() => { authCalls++; return never(); }, async (_url, options) => {
    assert.equal(options.headers.has('Authorization'), false);
    return Response.json({ price: 42 });
  }, 50);
  assert.deepEqual(await api('/stocks/AAPL'), { price: 42 });
  assert.equal(authCalls, 0);
  assert.equal(isPublicMarketRequest('/portfolio'), false);
  assert.equal(isPublicMarketRequest('/stocks/AAPL', 'POST'), false);
});

test('a stalled private session times out without sending an anonymous request', async () => {
  let calls = 0;
  const api = createApiClient(never, async () => { calls++; return Response.json({}); }, 15);
  await assert.rejects(api('/portfolio'), { name: 'TimeoutError' });
  assert.equal(calls, 0);
});

test('private requests retain the existing JWT contract', async () => {
  const api = createApiClient(session, async (_url, options) => {
    assert.equal(options.headers.get('Authorization'), 'Bearer fixture-token');
    return Response.json({ positions: 2 });
  });
  assert.deepEqual(await api('/portfolio'), { positions: 2 });
});

test('deadline aborts a stalled fetch', async () => {
  let signal;
  const api = createApiClient(session, async (_url, options) => {
    signal = options.signal;
    return never();
  }, 15);
  await assert.rejects(api('/market/overview'), { name: 'TimeoutError' });
  assert.equal(signal.aborted, true);
});

test('deadline includes response body parsing', async () => {
  const api = createApiClient(session, async () => ({ ok: true, status: 200, json: never }), 15);
  await assert.rejects(api('/stocks/AAPL'), { name: 'TimeoutError' });
});

test('caller cancellation prevents starting the request', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const api = createApiClient(session, async () => { calls++; return Response.json({}); });
  await assert.rejects(api('/search?q=AAPL', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('tab navigation cancels reads and leaves mutations alone', async () => {
  global.window = new EventTarget();
  try {
    let finishWrite;
    const api = createApiClient(session, async (_url, options) => {
      if (options.method === 'POST') return new Promise(resolve => { finishWrite = () => resolve(Response.json({ saved: true })); });
      return never();
    }, 1000);
    const read = api('/stocks/AAPL');
    const write = api('/watchlist', { method: 'POST', body: '{}' });
    await new Promise(resolve => setImmediate(resolve));
    const rejected = assert.rejects(read, { name: 'AbortError' });
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
    await rejected;
    finishWrite();
    assert.deepEqual(await write, { saved: true });
  } finally { delete global.window; }
});

test('mutations are never automatically retried after a timeout', async () => {
  let calls = 0;
  const api = createApiClient(session, async () => { calls++; return never(); }, 15);
  await assert.rejects(api('/portfolio', { method: 'POST', body: '{}' }), { name: 'TimeoutError' });
  assert.equal(calls, 1);
});
