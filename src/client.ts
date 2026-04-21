/**
 * HttpClient — fetch-based HTTP client equivalent to Axios.
 *
 * Features:
 *   - All HTTP verbs: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
 *   - Request & response interceptors (same chain model as Axios)
 *   - Axios-compatible error shape: error.response.status / error.response.data
 *   - Smart query-param serialisation (arrays, nulls, booleans)
 *   - Timeout via AbortController
 *   - XHR-based upload() with onProgress callback
 *   - HttpClient.create() static factory for isolated instances
 *   - Works in both browser and Node.js 20+
 */

// ─── Config types ────────────────────────────────────────────────────────────

/** How to parse the response body. When omitted, Content-Type sniffing is used. */
export type HttpResponseType = 'json' | 'text' | 'blob' | 'arraybuffer';

export interface HttpConfig {
  /** Base URL prepended to every relative request URL. */
  baseURL?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Default headers merged into every request. Accepts any HeadersInit form. */
  headers?: HeadersInit;
  /** Send cookies cross-origin. Equivalent to axios `withCredentials`. */
  withCredentials?: boolean;
  /** Force response parsing; falls back to Content-Type sniffing when omitted. */
  responseType?: HttpResponseType;
  /**
   * Custom query-string serialiser — equivalent to Axios `paramsSerializer`.
   * Receives the raw params object, must return a query string WITHOUT a leading `?`.
   * Falls back to the built-in serialiser when omitted.
   *
   * @example
   * // Replicate the existing axios.config.ts serialiser exactly:
   * paramsSerializer: (params) => {
   *   const sp = new URLSearchParams();
   *   for (const [key, value] of Object.entries(params)) {
   *     if (value == null) continue;
   *     if (Array.isArray(value)) { value.forEach(v => sp.append(key, String(v))); }
   *     else { sp.append(key, String(value)); }
   *   }
   *   return sp.toString();
   * }
   */
  paramsSerializer?: (params: Record<string, unknown>) => string;
}

export interface RequestConfig extends HttpConfig {
  method?: string;
  url?: string;
  /** Query params — serialised the same way as Axios paramsSerializer. */
  params?: Record<string, unknown>;
  /** Request body — objects are JSON-serialised; FormData is sent as-is. */
  data?: unknown;
  /** External AbortSignal for manual cancellation. */
  signal?: AbortSignal;
}

/** Shorthand for request config without method / url / data — used by verb helpers. */
export type RequestOptions = Omit<RequestConfig, 'method' | 'url' | 'data'>;

// ─── Response type ────────────────────────────────────────────────────────────

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: RequestConfig;
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class HttpError<T = unknown> extends Error {
  readonly isHttpError = true as const;
  readonly status: number;
  readonly config: RequestConfig;
  /** Axios-compatible: error.response.data, error.response.status */
  readonly response: {
    readonly data: T;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
  };

  constructor(message: string, response: HttpResponse<T>, config: RequestConfig) {
    super(message);
    this.name = 'HttpError';
    this.status = response.status;
    this.config = config;
    this.response = {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }
}

/** Type-guard — narrows `unknown` to `HttpError`. */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

// ─── Interceptor types ────────────────────────────────────────────────────────

type RequestFulfilled = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
type ResponseFulfilled = (response: HttpResponse) => HttpResponse | Promise<HttpResponse>;
type InterceptorRejected = (error: unknown) => unknown | Promise<unknown>;

interface RequestInterceptorEntry {
  onFulfilled?: RequestFulfilled;
  onRejected?: InterceptorRejected;
}

interface ResponseInterceptorEntry {
  onFulfilled?: ResponseFulfilled;
  onRejected?: InterceptorRejected;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Normalise any HeadersInit to a plain record so merging and interceptors work uniformly. */
function toHeaderRecord(input?: HeadersInit): Record<string, string> {
  if (!input) return {};
  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    const out: Record<string, string> = {};
    input.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(input)) {
    return Object.fromEntries(input) as Record<string, string>;
  }
  return { ...(input as Record<string, string>) };
}

/** Case-insensitive Content-Type presence check. */
function hasContentType(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
}

/** Serialize params exactly like Axios: skip nulls/undefined/empty arrays; repeat keys for arrays. */
function serializeParams(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      for (const item of value) {
        sp.append(key, String(item));
      }
    } else {
      sp.append(key, String(value));
    }
  }
  const query = sp.toString();
  return query ? `?${query}` : '';
}

/** Prepare headers and body from request config data. Supports every BodyInit variant. */
function buildRequestBody(
  data: unknown,
  baseHeaders: Record<string, string>,
): { body: BodyInit | undefined; headers: Record<string, string> } {
  if (data === undefined || data === null) {
    return { body: undefined, headers: baseHeaders };
  }
  // Native body types — pass through; browser/fetch sets Content-Type where appropriate.
  if (
    (typeof FormData !== 'undefined' && data instanceof FormData) ||
    (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) ||
    (typeof Blob !== 'undefined' && data instanceof Blob) ||
    (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream) ||
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data) ||
    typeof data === 'string'
  ) {
    return { body: data as BodyInit, headers: baseHeaders };
  }
  // Plain object → JSON. Only default Content-Type when caller hasn't set one.
  const headers = hasContentType(baseHeaders)
    ? baseHeaders
    : { ...baseHeaders, 'Content-Type': 'application/json' };
  return { body: JSON.stringify(data), headers };
}

/** Parse a Fetch Response body — explicit responseType wins, else Content-Type sniffing. */
async function parseResponseBody<T>(
  fetchResponse: Response,
  responseType?: HttpResponseType,
): Promise<T> {
  if (responseType === 'json') {
    return fetchResponse.json() as Promise<T>;
  }
  if (responseType === 'text') {
    return fetchResponse.text() as Promise<unknown> as Promise<T>;
  }
  if (responseType === 'blob') {
    return fetchResponse.blob() as Promise<unknown> as Promise<T>;
  }
  if (responseType === 'arraybuffer') {
    return fetchResponse.arrayBuffer() as Promise<unknown> as Promise<T>;
  }
  const contentType = fetchResponse.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    return fetchResponse.json() as Promise<T>;
  }
  if (contentType.startsWith('text/')) {
    return fetchResponse.text() as Promise<unknown> as Promise<T>;
  }
  return fetchResponse.blob() as Promise<unknown> as Promise<T>;
}

// ─── HttpClient ────────────────────────────────────────────────────────────────

export class HttpClient {
  private readonly instanceConfig: HttpConfig;
  private readonly requestInterceptors: RequestInterceptorEntry[] = [];
  private readonly responseInterceptors: ResponseInterceptorEntry[] = [];

  constructor(config: HttpConfig = {}) {
    this.instanceConfig = config;
  }

  /** Create an isolated instance with its own config and interceptors. */
  static create(config: HttpConfig = {}): HttpClient {
    return new HttpClient(config);
  }

  // ── Interceptors API (mirrors Axios) ───────────────────────────────────────

  get interceptors() {
    return {
      request: {
        use: (onFulfilled?: RequestFulfilled, onRejected?: InterceptorRejected): number => {
          this.requestInterceptors.push({ onFulfilled, onRejected });
          return this.requestInterceptors.length - 1;
        },
        eject: (id: number): void => {
          this.requestInterceptors[id] = {};
        },
      },
      response: {
        use: (onFulfilled?: ResponseFulfilled, onRejected?: InterceptorRejected): number => {
          this.responseInterceptors.push({ onFulfilled, onRejected });
          return this.responseInterceptors.length - 1;
        },
        eject: (id: number): void => {
          this.responseInterceptors[id] = {};
        },
      },
    };
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private buildUrl(
    url: string,
    params?: Record<string, unknown>,
    requestSerializer?: HttpConfig['paramsSerializer'],
  ): string {
    const base = this.instanceConfig.baseURL ?? '';
    const fullUrl = url.startsWith('http') ? url : `${base}${url}`;
    if (!params) {
      return fullUrl;
    }
    // Request-level serialiser > instance-level serialiser > built-in
    const serialize = requestSerializer ?? this.instanceConfig.paramsSerializer ?? serializeParams;
    const query = serialize(params);
    return query ? `${fullUrl}?${query.replace(/^\?/, '')}` : fullUrl;
  }

  private async runRequestInterceptors(config: RequestConfig): Promise<RequestConfig> {
    let current = config;
    for (const interceptor of this.requestInterceptors) {
      try {
        if (interceptor.onFulfilled) {
          current = await interceptor.onFulfilled(current);
        }
      } catch (error) {
        if (interceptor.onRejected) {
          current = (await interceptor.onRejected(error)) as RequestConfig;
        } else {
          throw error;
        }
      }
    }
    return current;
  }

  private async runResponseSuccessInterceptors(response: HttpResponse): Promise<HttpResponse> {
    let current = response;
    for (const interceptor of this.responseInterceptors) {
      if (interceptor.onFulfilled) {
        try {
          current = await interceptor.onFulfilled(current);
        } catch (error) {
          return this.runResponseErrorInterceptors(error);
        }
      }
    }
    return current;
  }

  private async runResponseErrorInterceptors(error: unknown): Promise<never> {
    let current: unknown = error;
    for (const interceptor of this.responseInterceptors) {
      if (interceptor.onRejected) {
        try {
          current = await interceptor.onRejected(current);
        } catch (innerError) {
          current = innerError;
        }
      }
    }
    throw current;
  }

  // ── Core request ───────────────────────────────────────────────────────────

  async request<T = unknown>(config: RequestConfig): Promise<HttpResponse<T>> {
    const merged: RequestConfig = {
      ...this.instanceConfig,
      ...config,
      headers: {
        ...toHeaderRecord(this.instanceConfig.headers),
        ...toHeaderRecord(config.headers),
      },
    };

    const resolved = await this.runRequestInterceptors(merged);

    const {
      method = 'GET',
      url = '',
      params,
      data,
      timeout,
      headers,
      signal: externalSignal,
      withCredentials,
      responseType,
    } = resolved;

    const fullUrl = this.buildUrl(url, params, resolved.paramsSerializer);
    const controller = new AbortController();
    const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    const signal = externalSignal ?? controller.signal;

    const baseHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...toHeaderRecord(headers),
    };
    const { body, headers: finalHeaders } = buildRequestBody(data, baseHeaders);

    let fetchResponse: Response;
    try {
      fetchResponse = await fetch(fullUrl, {
        method,
        headers: finalHeaders,
        body,
        signal,
        credentials: withCredentials ? 'include' : 'same-origin',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(timeout ? `Request timed out after ${timeout}ms` : 'Request was aborted');
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    const responseData = await parseResponseBody<T>(fetchResponse, responseType);
    const httpResponse: HttpResponse<T> = {
      data: responseData,
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
      headers: fetchResponse.headers,
      config: resolved,
    };

    if (!fetchResponse.ok) {
      const httpError = new HttpError<T>(
        `Request failed with status ${fetchResponse.status}`,
        httpResponse,
        resolved,
      );
      return this.runResponseErrorInterceptors(httpError) as Promise<HttpResponse<T>>;
    }

    return this.runResponseSuccessInterceptors(httpResponse) as Promise<HttpResponse<T>>;
  }

  // ── Convenience methods ────────────────────────────────────────────────────

  get<T = unknown>(url: string, config?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  put<T = unknown>(url: string, data?: unknown, config?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }

  patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, data });
  }

  delete<T = unknown>(
    url: string,
    config?: Omit<RequestConfig, 'method' | 'url'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  head<T = unknown>(url: string, config?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'HEAD', url });
  }

  options<T = unknown>(url: string, config?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, method: 'OPTIONS', url });
  }

  // ── XHR-based upload (supports onProgress) ─────────────────────────────────

  /**
   * Upload FormData with real-time progress reporting.
   * Auth headers are applied via the same request interceptor chain.
   */
  async upload<T = unknown>(
    url: string,
    formData: FormData,
    onProgress?: (percent: number) => void,
    config?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    // Run request interceptors first so auth headers are included in XHR
    const merged: RequestConfig = {
      ...this.instanceConfig,
      ...(config ?? {}),
      headers: {
        ...toHeaderRecord(this.instanceConfig.headers),
        ...toHeaderRecord(config?.headers),
      },
      method: 'POST',
      url,
      data: formData,
    };

    const resolved = await this.runRequestInterceptors(merged);
    const fullUrl = this.buildUrl(url, resolved.params, resolved.paramsSerializer);
    const resolvedHeaders = toHeaderRecord(resolved.headers);

    return new Promise<HttpResponse<T>>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
      }

      xhr.addEventListener('load', () => {
        void this.handleXhrLoad<T>(xhr, resolved).then(resolve).catch(reject);
      });

      xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

      if (resolved.timeout) {
        xhr.timeout = resolved.timeout;
        xhr.addEventListener('timeout', () => reject(new Error('Upload timed out')));
      }

      xhr.open('POST', fullUrl);

      if (resolved.responseType === 'blob' || resolved.responseType === 'arraybuffer') {
        xhr.responseType = resolved.responseType;
      }

      for (const [headerKey, headerValue] of Object.entries(resolvedHeaders)) {
        // Skip Content-Type — browser must set it with the FormData boundary
        if (headerKey.toLowerCase() !== 'content-type') {
          xhr.setRequestHeader(headerKey, headerValue);
        }
      }

      xhr.send(formData);
    });
  }

  private async handleXhrLoad<T>(
    xhr: XMLHttpRequest,
    config: RequestConfig,
  ): Promise<HttpResponse<T>> {
    const contentType = xhr.getResponseHeader('Content-Type') ?? '';
    let parsedData: T;
    if (xhr.responseType === 'blob' || xhr.responseType === 'arraybuffer') {
      parsedData = xhr.response as T;
    } else if (config.responseType === 'text') {
      parsedData = xhr.responseText as unknown as T;
    } else if (config.responseType === 'json' || contentType.includes('application/json')) {
      parsedData = (xhr.responseText ? JSON.parse(xhr.responseText) : null) as T;
    } else {
      parsedData = xhr.responseText as unknown as T;
    }

    const xhrResponse: HttpResponse<T> = {
      data: parsedData,
      status: xhr.status,
      statusText: xhr.statusText,
      headers: new Headers({ 'content-type': contentType }),
      config,
    };

    if (xhr.status >= 200 && xhr.status < 300) {
      return this.runResponseSuccessInterceptors(xhrResponse as HttpResponse) as Promise<
        HttpResponse<T>
      >;
    }

    const xhrError = new HttpError<T>(
      `Upload failed with status ${xhr.status}`,
      xhrResponse,
      config,
    );
    return this.runResponseErrorInterceptors(xhrError) as Promise<HttpResponse<T>>;
  }
}
