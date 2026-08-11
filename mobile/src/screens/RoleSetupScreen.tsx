import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { MarketplaceRole } from "../marketplace/types";

export function RoleSetupScreen() {
  const { setRoles } = useMarketplace();
  const [selected, setSelected] = useState<MarketplaceRole[]>([]);
  const [busy, setBusy] = useState(false);

  function toggle(role: MarketplaceRole) {
    setSelected(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role],
    );
  }

  async function onContinue() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      await setRoles(selected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Swap</Text>
      <Text style={styles.title}>How will you use Swap?</Text>
      <Text style={styles.subtitle}>
        Pick one or both. You can change this later in Account.
      </Text>

      <Pressable
        style={[styles.option, selected.includes("buyer") && styles.optionOn]}
        onPress={() => toggle("buyer")}>
        <Text style={styles.optionTitle}>Buyer</Text>
        <Text style={styles.optionBody}>Browse listings and buy items.</Text>
      </Pressable>

      <Pressable
        style={[styles.option, selected.includes("seller") && styles.optionOn]}
        onPress={() => toggle("seller")}>
        <Text style={styles.optionTitle}>Seller</Text>
        <Text style={styles.optionBody}>Post items for others to buy.</Text>
      </Pressable>

      <Pressable
        style={[
          styles.button,
          (selected.length === 0 || busy) && styles.buttonDisabled,
        ]}
        onPress={onContinue}
        disabled={selected.length === 0 || busy}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
    justifyContent: "center",
    padding: 24,
  },
  brand: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#5c6370",
    marginBottom: 24,
    lineHeight: 21,
  },
  option: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  optionOn: {
    borderColor: "#111827",
  },
  optionTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 4,
  },
  optionBody: {
    fontSize: 14,
    color: "#5c6370",
  },
  button: {
    marginTop: 12,
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
