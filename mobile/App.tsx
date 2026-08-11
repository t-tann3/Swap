import { StripeProvider } from "@stripe/stripe-react-native";
import { useEffect, useState } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { API_BASE_URL } from "./src/api/config";
import { AuthProvider } from "./src/auth/AuthContext";
import { MarketplaceProvider } from "./src/marketplace/MarketplaceContext";
import { RootNavigator } from "./src/navigation/RootNavigator";

function App() {
  const [publishableKey, setPublishableKey] = useState(
    // Replaced as soon as /api/payments/config returns a real pk_.
    "pk_test_51PlaceholderSwapUntilConfigLoads0000000000000000000",
  );

  useEffect(() => {
    let cancelled = false;
    const loadKey = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/payments/config`);
        const body = (await res.json()) as { publishableKey?: string | null };
        if (!cancelled && body.publishableKey?.startsWith("pk_")) {
          setPublishableKey(body.publishableKey);
        }
      } catch {
        // Payments stay off until server is configured.
      }
    };
    void loadKey();
    // Retry after launch so a late API start still wires the Stripe key.
    const retry = setTimeout(() => void loadKey(), 2500);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <StripeProvider publishableKey={publishableKey}>
        <AuthProvider>
          <MarketplaceProvider>
            <RootNavigator />
          </MarketplaceProvider>
        </AuthProvider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}

export default App;
