import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, isHttpError } from '../src';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function textResponse(text: string, init: ResponseInit = {}): Response {
  return new Response(text, {
    headers: { 'Content-Type': 'text/plain' },
    ...init,
  });
}

interface FetchCall {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

function lastCall(mock: ReturnType<typeof vi.fn>): FetchCall {
  const call = mock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  return { url: call[0] as string, init: call[1] as FetchCall['init'] };
}

describe('HttpClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('verb helpers', () => {
    it('get — builds GET request with baseURL', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const api = HttpClient.create({ baseURL: 'https://api.test' });

      const { data, status, statusText } = await api.get<{ ok: boolean }>('/ping');

      const { url, init } = lastCall(fetchMock);
      expect(url).toBe('https://api.test/ping');
      expect(init.method).toBe('GET');
      expect(data).toEqual({ ok: true });
      expect(status).toBe(200);
      expect(statusText).toBe('');
    });

    it('post — JSON-serializes plain objects with application/json', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));
      const api = HttpClient.create();

      await api.post('/users', { name: 'Alice' });

      const { init } = lastCall(fetchMock);
      expect(init.body).toBe(JSON.stringify({ name: 'Alice' }));
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('absolute url bypasses baseURL', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create({ baseURL: 'https://api.test' });

      await api.get('https://other.example/raw');

      expect(lastCall(fetchMock).url).toBe('https://other.example/raw');
    });
  });

  describe('params serialization', () => {
    it('skips null/undefined and empty arrays; repeats keys for arrays', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create({ baseURL: 'https://api.test' });

      await api.get('/search', {
        params: { q: 'hi', tag: ['a', 'b'], skip: null, undef: undefined, empty: [] },
      });

      expect(lastCall(fetchMock).url).toBe('https://api.test/search?q=hi&tag=a&tag=b');
    });

    it('custom paramsSerializer overrides built-in', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create({
        baseURL: 'https://api.test',
        paramsSerializer: (p) => `keys=${Object.keys(p).join(',')}`,
      });

      await api.get('/s', { params: { a: 1, b: 2 } });

      expect(lastCall(fetchMock).url).toBe('https://api.test/s?keys=a,b');
    });
  });

  describe('response parsing', () => {
    it('parses JSON from application/json', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ msg: 'hi' }));
      const api = HttpClient.create();

      const { data } = await api.get<{ msg: string }>('/');
      expect(data).toEqual({ msg: 'hi' });
    });

    it('parses text from text/*', async () => {
      fetchMock.mockResolvedValue(textResponse('plain'));
      const api = HttpClient.create();

      const { data } = await api.get<string>('/');
      expect(data).toBe('plain');
    });

    it('forces responseType=text even when content-type is JSON', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ msg: 'hi' }));
      const api = HttpClient.create();

      const { data } = await api.get<string>('/', { responseType: 'text' });
      expect(data).toBe(JSON.stringify({ msg: 'hi' }));
    });

    it('forces responseType=blob', async () => {
      fetchMock.mockResolvedValue(
        new Response('binary', { headers: { 'Content-Type': 'application/octet-stream' } }),
      );
      const api = HttpClient.create();

      const { data } = await api.get<Blob>('/', { responseType: 'blob' });
      expect(data).toBeInstanceOf(Blob);
    });

    it('forces responseType=arraybuffer', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
      const api = HttpClient.create();

      const { data } = await api.get<ArrayBuffer>('/', { responseType: 'arraybuffer' });
      expect(data).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe('errors', () => {
    it('throws HttpError on 4xx with axios-compatible shape', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' }),
      );
      const api = HttpClient.create();

      const err = await api.get('/missing').catch((e: unknown) => e);

      expect(isHttpError(err)).toBe(true);
      if (isHttpError(err)) {
        expect(err.status).toBe(404);
        expect(err.response.status).toBe(404);
        expect(err.response.statusText).toBe('Not Found');
        expect(err.response.data).toEqual({ error: 'not found' });
        expect(err.config.url).toBe('/missing');
      }
    });

    it('isHttpError narrows non-HTTP errors to false', () => {
      expect(isHttpError(new Error('boom'))).toBe(false);
      expect(isHttpError(null)).toBe(false);
      expect(isHttpError({ status: 500 })).toBe(false);
    });
  });

  describe('interceptors', () => {
    it('request interceptor can mutate headers before fetch', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      api.interceptors.request.use((config) => ({
        ...config,
        headers: { ...(config.headers as Record<string, string>), 'X-Added': '1' },
      }));

      await api.get('/');

      expect(lastCall(fetchMock).init.headers['X-Added']).toBe('1');
    });

    it('response interceptor can transform success response', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ raw: true }));
      const api = HttpClient.create();

      api.interceptors.response.use((res) => ({ ...res, data: { wrapped: res.data } }));

      const { data } = await api.get<{ wrapped: unknown }>('/');
      expect(data).toEqual({ wrapped: { raw: true } });
    });

    it('response error interceptor receives HttpError on non-2xx', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { status: 500 }));
      const api = HttpClient.create();

      const seen: number[] = [];
      api.interceptors.response.use(undefined, (err) => {
        if (isHttpError(err)) seen.push(err.status);
        return Promise.reject(err as Error);
      });

      await expect(api.get('/')).rejects.toBeDefined();
      expect(seen).toEqual([500]);
    });

    it('eject removes a registered interceptor', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      const id = api.interceptors.request.use((config) => ({
        ...config,
        headers: { ...(config.headers as Record<string, string>), 'X-Spy': 'yes' },
      }));
      api.interceptors.request.eject(id);

      await api.get('/');

      expect(lastCall(fetchMock).init.headers['X-Spy']).toBeUndefined();
    });
  });

  describe('body handling', () => {
    it('FormData passes through without JSON stringify or Content-Type override', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      const fd = new FormData();
      fd.append('k', 'v');
      await api.post('/', fd);

      const { init } = lastCall(fetchMock);
      expect(init.body).toBe(fd);
      expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('URLSearchParams passes through unchanged', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      const params = new URLSearchParams({ a: '1' });
      await api.post('/', params);

      expect(lastCall(fetchMock).init.body).toBe(params);
    });

    it('string body passes through without JSON stringify', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      await api.post('/', 'raw text');

      expect(lastCall(fetchMock).init.body).toBe('raw text');
    });

    it('ArrayBuffer passes through', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      const buf = new Uint8Array([1, 2, 3]).buffer;
      await api.post('/', buf);

      expect(lastCall(fetchMock).init.body).toBe(buf);
    });

    it('respects user-supplied Content-Type on plain objects (case-insensitive)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      await api.post('/', { a: 1 }, { headers: { 'content-type': 'application/vnd.api+json' } });

      const { init } = lastCall(fetchMock);
      expect(init.headers['content-type']).toBe('application/vnd.api+json');
      expect(init.body).toBe(JSON.stringify({ a: 1 }));
    });
  });

  describe('headers normalization', () => {
    it('accepts Headers instance', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      await api.get('/', { headers: new Headers({ 'X-Custom': 'v' }) });

      const { init } = lastCall(fetchMock);
      const keys = Object.keys(init.headers).map((k) => k.toLowerCase());
      expect(keys).toContain('x-custom');
    });

    it('accepts tuple array', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create();

      await api.get('/', { headers: [['X-Tuple', 'yes']] });

      expect(lastCall(fetchMock).init.headers['X-Tuple']).toBe('yes');
    });

    it('merges instance-level and request-level headers', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const api = HttpClient.create({ headers: { 'X-A': '1' } });

      await api.get('/', { headers: { 'X-B': '2' } });

      const { init } = lastCall(fetchMock);
      expect(init.headers['X-A']).toBe('1');
      expect(init.headers['X-B']).toBe('2');
    });
  });

  describe('timeout', () => {
    it('aborts the request after timeout elapses', async () => {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      );
      const api = HttpClient.create();

      await expect(api.get('/slow', { timeout: 10 })).rejects.toThrow(/timed out/);
    });
  });
});
