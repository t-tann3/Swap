import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "../auth/AuthContext";

interface Props {
  onCodeSent: (email: string) => void;
}

export function SignInScreen({ onCodeSent }: Props) {
  const { sendCode, lastError, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (!email.trim() || busy) return;
    clearError();
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      await sendCode(normalized);
      onCodeSent(normalized);
    } catch {
      // lastError is set in AuthContext
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Swap</Text>
      <Text style={styles.subtitle}>Sign in with your email</Text>

      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        editable={!busy}
      />

      {lastError ? (
        <Text style={styles.error}>
          {lastError.code ? `[${lastError.code}] ` : ""}
          {lastError.message}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, (!email.trim() || busy) && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={!email.trim() || busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Send code</Text>
        )}
      </Pressable>

      <Text style={styles.hint}>
        Sandbox tip: use a Relai portal test end-user email and its fixed code.
      </Text>
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
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#5c6370",
    marginBottom: 24,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
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
  error: {
    color: "#b42318",
    marginBottom: 12,
  },
  hint: {
    marginTop: 16,
    color: "#5c6370",
    fontSize: 13,
    lineHeight: 18,
  },
});
