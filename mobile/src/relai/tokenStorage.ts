import type { TokenPair, TokenStorage } from "@relai-team/access-sdk";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@swap/relai-session";

/**
 * Sync TokenStorage backed by AsyncStorage.
 * Call `hydrate()` once at startup before creating RelaiClient so restarts
 * restore the session into memory first.
 */
export class PersistentTokenStorage implements TokenStorage {
  private tokens: TokenPair | null = null;

  async hydrate(): Promise<void> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      this.tokens = null;
      return;
    }
    try {
      this.tokens = JSON.parse(raw) as TokenPair;
    } catch {
      this.tokens = null;
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  }

  get(): TokenPair | null {
    return this.tokens;
  }

  set(tokens: TokenPair): void {
    this.tokens = tokens;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  }

  clear(): void {
    this.tokens = null;
    void AsyncStorage.removeItem(STORAGE_KEY);
  }
}

export const tokenStorage = new PersistentTokenStorage();
