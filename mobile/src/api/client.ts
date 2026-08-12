import { getRelai } from "../relai/client";
import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function ensureAccessToken(): Promise<string> {
  const relai = getRelai();
  if (!relai.auth.isSignedIn) {
    throw new ApiError(401, "unauthorized", "Not signed in.");
  }

  // Marketplace API verifies the bearer with Relai /me. Refresh first so we
  // don't send an expired access token after the SDK has been idle.
  const refreshed = await relai.auth.refresh();
  const token = relai.auth.accessToken;
  if (!refreshed || !token) {
    throw new ApiError(
      401,
      "unauthorized",
      "Relai session expired. Sign out and sign in again.",
    );
  }
  return token;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = false, headers, ...rest } = init;

  const doFetch = async (retried: boolean): Promise<T> => {
    const finalHeaders: Record<string, string> = {
      Accept: "application/json",
      ...(headers as Record<string, string> | undefined),
    };

    if (auth) {
      const token = await ensureAccessToken();
      finalHeaders.Authorization = `Bearer ${token}`;
      if (rest.body && !finalHeaders["Content-Type"]) {
        finalHeaders["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: finalHeaders,
    });

    const text = await response.text();
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ApiError(
          response.status,
          "invalid_json",
          `API returned non-JSON (${response.status}) for ${path}. Check API_BASE_URL (${API_BASE_URL}).`,
        );
      }
    }

    if (
      auth &&
      !retried &&
      response.status === 401 &&
      getRelai().auth.isSignedIn
    ) {
      const refreshed = await getRelai().auth.refresh();
      if (refreshed) {
        return doFetch(true);
      }
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        String(body.code ?? "error"),
        String(body.message ?? `Request failed (${response.status})`),
      );
    }

    return body as T;
  };

  return doFetch(false);
}
