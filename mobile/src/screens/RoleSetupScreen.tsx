import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useMarketplace } from "../marketplace/MarketplaceContext";
import type { MarketplaceRole } from "../marketplace/types";

type Persona = Extract<MarketplaceRole, "buyer" | "seller" | "admin">;

export function RoleSetupScreen() {
  const { setRoles, setActiveMode, refresh, profile } = useMarketplace();
  const [selected, setSelected] = useState<Persona | null>(null);
  const [busy, setBusy] = useState(false);

  const options: { role: Persona; title: string; body: string }[] = [
    {
      role: "buyer",
      title: "Neighbor",
      body: "Browse the pantry and pick up baskets.",
    },
    {
      role: "seller",
      title: "Pantry",
      body: "Stock the pantry and fulfill neighbor orders.",
    },
  ];
  if (profile?.adminEligible) {
    options.push({
      role: "admin",
      title: "Admin",
      body: "Operate pantry settings and platform tools.",
    });
  }

  async function onContinue() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      if (selected === "buyer" || selected === "seller") {
        await setActiveMode(selected);
      }
      await setRoles([selected]);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Swap</Text>
      <Text style={styles.title}>Choose your account type</Text>
      <Text style={styles.subtitle}>
        Pick one. Each account type has its own tools and login experience.
      </Text>

      {options.map(opt => (
        <Pressable
          key={opt.role}
          style={[styles.option, selected === opt.role && styles.optionOn]}
          onPress={() => setSelected(opt.role)}>
          <Text style={styles.optionTitle}>{opt.title}</Text>
          <Text style={styles.optionBody}>{opt.body}</Text>
        </Pressable>
      ))}

      <Pressable
        style={[styles.button, (!selected || busy) && styles.buttonDisabled]}
        onPress={() => void onContinue()}
        disabled={!selected || busy}>
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
