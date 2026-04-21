# @syncsoft/tiny-fetch

> Tiny, zero-dependency, axios-compatible HTTP client built on `fetch`.

[![npm version](https://img.shields.io/npm/v/@syncsoft/tiny-fetch)](https://www.npmjs.com/package/@syncsoft/tiny-fetch)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@syncsoft/tiny-fetch)](https://bundlephobia.com/package/@syncsoft/tiny-fetch)
[![types](https://img.shields.io/npm/types/@syncsoft/tiny-fetch)](https://www.npmjs.com/package/@syncsoft/tiny-fetch)
[![license](https://img.shields.io/npm/l/@syncsoft/tiny-fetch)](./LICENSE)

- **Zero runtime dependencies**
- **~2.5 KB** min+gzip (vs axios ~13.5 KB)
- **Axios-compatible** — drop-in for most use cases (`response.data`, `error.response.data/status`, interceptors)
- **First-class TypeScript** — types ship with the package, no `@types/*` needed
- Request / response **interceptors** (same model as axios)
- **Timeouts** via `AbortController`
- **Upload progress** via XHR (since `fetch` can't report upload progress)
- **Forced response parsing** with `responseType: 'json' | 'text' | 'blob' | 'arraybuffer'`
- Works in **browsers** and **Node.js 20+**

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [API](#api)
  - [Creating an instance](#creating-an-instance)
  - [Config](#config)
  - [Verb helpers](#verb-helpers)
  - [Response shape](#response-shape)
  - [Errors](#errors)
- [Interceptors](#interceptors)
- [Recipes](#recipes)
  - [File upload with progress](#file-upload-with-progress)
  - [Binary responses](#binary-responses)
  - [Cancellation](#cancellation)
  - [Custom params serialization](#custom-params-serialization)
- [Migration from axios](#migration-from-axios)
- [Browser & Node support](#browser--node-support)
- [License](#license)

---

## Install

```sh
npm install @syncsoft/tiny-fetch
# or
yarn add @syncsoft/tiny-fetch
# or
pnpm add @syncsoft/tiny-fetch
```

No peer dependencies. No `@types/*` to install. Node 20+ or any modern browser.

---

## Quick start

```ts
import { HttpClient } from '@syncsoft/tiny-fetch';

const api = HttpClient.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  headers: { 'X-Client': 'my-app' },
});

type User = { id: string; name: string };

const { data } = await api.get<User[]>('/users');
//      ^? User[]
```

---

## API

### Creating an instance

```ts
import { HttpClient } from '@syncsoft/tiny-fetch';

const api = HttpClient.create(config?: HttpConfig);
```

Each instance has isolated config and its own interceptor chain.

### Config

`HttpConfig` (applies at instance level; `RequestConfig` extends it with per-call fields):

| Field              | Type                                          | Description                                                                                                       |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `baseURL`          | `string`                                      | Prepended to relative request URLs.                                                                               |
| `timeout`          | `number`                                      | Milliseconds before the request is aborted via `AbortController`.                                                 |
| `headers`          | `HeadersInit`                                 | Default headers merged into every request. Accepts a plain record, a `Headers` instance, or `[string, string][]`. |
| `withCredentials`  | `boolean`                                     | Send cookies cross-origin (maps to `credentials: 'include'`).                                                     |
| `responseType`     | `'json' \| 'text' \| 'blob' \| 'arraybuffer'` | Force response body parser. When omitted, parsing is inferred from the `Content-Type` header.                     |
| `paramsSerializer` | `(params: Record<string, unknown>) => string` | Replace the built-in query-string serializer.                                                                     |

Per-request only (`RequestConfig`):

| Field    | Type                      | Description                                                                       |
| -------- | ------------------------- | --------------------------------------------------------------------------------- |
| `method` | `string`                  | HTTP method. Verb helpers set this automatically.                                 |
| `url`    | `string`                  | Relative or absolute URL.                                                         |
| `params` | `Record<string, unknown>` | Query parameters. Arrays expand to repeated keys; `null`/`undefined` are skipped. |
| `data`   | `unknown`                 | Request body. See [body handling](#body-handling) below.                          |
| `signal` | `AbortSignal`             | External cancellation signal.                                                     |

#### Body handling

The `data` field is passed through unchanged for every native `BodyInit` type:

- `FormData` — browser sets `Content-Type` with multipart boundary
- `URLSearchParams` — browser sets `application/x-www-form-urlencoded`
- `Blob` / `File` — `Content-Type` comes from `blob.type`
- `ArrayBuffer` / typed arrays (`Uint8Array`, etc.)
- `ReadableStream`
- `string`

Anything else (plain objects, arrays) is `JSON.stringify`'d and sent with `Content-Type: application/json`. A caller-supplied `Content-Type` is always respected.

### Verb helpers

```ts
api.get<T>(url, config?)
api.post<T>(url, data?, config?)
api.put<T>(url, data?, config?)
api.patch<T>(url, data?, config?)
api.delete<T>(url, config?)
api.head<T>(url, config?)
api.options<T>(url, config?)

api.request<T>(config)            // low-level escape hatch
api.upload<T>(url, formData, onProgress?, config?)  // XHR-based upload with progress
```

All return `Promise<HttpResponse<T>>`.

### Response shape

```ts
interface HttpResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: RequestConfig;
}
```

### Errors

Non-2xx responses throw an `HttpError`. The shape mirrors axios:

```ts
import { isHttpError } from '@syncsoft/tiny-fetch';

try {
  await api.get('/users/99');
} catch (err) {
  if (isHttpError(err)) {
    err.status; // 404
    err.response.status; // 404      ← axios-compatible
    err.response.data; // parsed body
    err.response.headers; // Headers
    err.config; // RequestConfig
  }
}
```

`isHttpError(error)` is the type guard — use it instead of `instanceof` across bundler/realm boundaries.

---

## Interceptors

Same model as axios: `use(onFulfilled?, onRejected?)` returns an id; `eject(id)` removes.

### Attach an auth token

```ts
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (!token) return config;
  return {
    ...config,
    headers: { ...config.headers, Authorization: `Bearer ${token}` },
  };
});
```

### Redirect to /login on 401 / 403

```ts
import { isHttpError } from '@syncsoft/tiny-fetch';

api.interceptors.response.use(undefined, (error) => {
  if (isHttpError(error) && (error.status === 401 || error.status === 403)) {
    if (typeof window !== 'undefined') window.location.href = '/login';
  }
  return Promise.reject(error);
});
```

### Retry with exponential backoff

Retry is intentionally **not** built in — it's ten lines with interceptors:

```ts
export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 2 ** i * 500));
    }
  }
  throw new Error('unreachable');
}

const { data } = await retry(() => api.get('/flaky'));
```

---

## Recipes

### File upload with progress

`fetch` cannot report upload progress. `upload()` uses `XMLHttpRequest` under the hood, runs request interceptors (so auth headers still apply), and exposes a progress callback.

```ts
const form = new FormData();
form.append('file', file);
form.append('name', 'report.pdf');

const { data } = await api.upload<{ url: string }>('/files', form, (percent) =>
  console.log(`${percent}%`),
);
```

### Binary responses

```ts
const { data } = await api.get<Blob>('/report.pdf', { responseType: 'blob' });
const url = URL.createObjectURL(data);
```

### Cancellation

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);

try {
  await api.get('/slow', { signal: controller.signal });
} catch (err) {
  // AbortError
}
```

### Custom params serialization

Built-in serializer matches axios defaults (skip null/undefined, repeat arrays). Override per-request or per-instance:

```ts
import qs from 'qs';

const api = HttpClient.create({
  baseURL: '...',
  paramsSerializer: (params) => qs.stringify(params, { arrayFormat: 'brackets' }),
});
```

---

## Migration from axios

Most code works with a minimal import/create swap:

```diff
- import axios from 'axios';
- const api = axios.create({ baseURL: '...' });
+ import { HttpClient } from '@syncsoft/tiny-fetch';
+ const api = HttpClient.create({ baseURL: '...' });

  const { data } = await api.get<User[]>('/users');
```

| axios                                    | tiny-fetch                               |
| ---------------------------------------- | ---------------------------------------- |
| `axios.create(config)`                   | `HttpClient.create(config)`              |
| `response.data`                          | `response.data` ✓                        |
| `error.response.data / .status`          | `error.response.data / .status` ✓        |
| `axios.isAxiosError(e)`                  | `isHttpError(e)`                         |
| `instance.interceptors.request.use(...)` | same ✓                                   |
| `CancelToken`                            | `AbortSignal` (pass via `config.signal`) |
| `responseType`                           | same ✓                                   |
| `paramsSerializer`                       | same ✓                                   |
| `transformRequest` / `transformResponse` | use interceptors                         |

### Known gaps vs axios

tiny-fetch is intentionally small. If you need these, reach for axios (or add them on top):

- **Node HTTP agents / proxy config** — use `undici.Agent` or an HTTPS proxy-aware fetch
- **Auto CSRF / XSRF token attachment** — trivial to add as a request interceptor
- **Automatic retry / backoff** — see [recipe above](#retry-with-exponential-backoff)
- **`maxContentLength` / `maxRedirects`** — not exposed

---

## Browser & Node support

- **Browsers** — any that implement `fetch`, `AbortController`, `FormData`, and `XMLHttpRequest` (all evergreen browsers)
- **Node.js** — 20+ (native `fetch`). Upload progress (`upload()`) is browser-only since Node doesn't have `XMLHttpRequest`; use `request()` with a `ReadableStream` body instead.

Build target: ES2020. Ships ESM **and** CommonJS with proper `exports` conditions.

---

## License

[MIT](./LICENSE) © Abbosbek
