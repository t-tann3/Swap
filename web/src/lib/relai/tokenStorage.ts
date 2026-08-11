import type { TokenPair, TokenStorage } from "@relai-team/access-sdk";

const STORAGE_KEY = "swap.relai.session";

export class LocalTokenStorage implements TokenStorage {
  private tokens: TokenPair | null = null;

  hydrate(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      this.tokens = raw ? (JSON.parse(raw) as TokenPair) : null;
    } catch {
      this.tokens = null;
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  get(): TokenPair | null {
    return this.tokens;
  }

  set(tokens: TokenPair): void {
    this.tokens = tokens;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    }
  }

  clear(): void {
    this.tokens = null;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }
}

export const tokenStorage = new LocalTokenStorage();
