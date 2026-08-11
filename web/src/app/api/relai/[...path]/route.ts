import type { NextRequest } from "next/server";

/**
 * Same-origin proxy for Relai Access API.
 * Browsers block direct calls to access.relai.us (no CORS for localhost).
 * Mobile RN is unaffected; web RelaiClient uses baseUrl=/api/relai.
 */
const RELAI_API = "https://access.relai.us/api/v1";

const DROP_REQ = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // Let undici negotiate encoding with Relai; don't forward the browser's Accept-Encoding.
  "accept-encoding",
]);

/** Node fetch decompresses bodies; never forward these or the browser double-decodes. */
const DROP_RES = new Set([
  ...DROP_REQ,
  "content-encoding",
  "content-length",
]);

async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const targetPath = path.join("/");
  const url = `${RELAI_API}/${targetPath}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROP_REQ.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(url, init);
  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RES.has(key.toLowerCase())) {
      outHeaders.set(key, value);
    }
  });

  // Fetch Response forbids a body on 204/205/304 — Relai auth/revoke returns 204.
  const status = upstream.status;
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, {
      status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  }

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
