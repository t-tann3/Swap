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
  email: string;
  onBack: () => void;
}

export function VerifyCodeScreen({ email, onBack }: Props) {
  const { verifyCode, sendCode, lastError, clearError } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (code.trim().length < 6 || busy) return;
    clearError();
    setBusy(true);
    try {
      await verifyCode(email, code);
    } catch {
      // lastError is set in AuthContext
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    clearError();
    setBusy(true);
    try {
      await sendCode(email);
    } catch {
      // lastError is set in AuthContext
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Swap</Text>
      <Text style={styles.subtitle}>Enter the code sent to</Text>
      <Text style={styles.email}>{email}</Text>

      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="6-digit code"
        value={code}
        onChangeText={setCode}
        editable={!busy}
      />

      {lastError ? (
        <Text style={styles.error}>
          {lastError.code ? `[${lastError.code}] ` : ""}
          {lastError.message}
        </Text>
      ) : null}

      <Pressable
        style={[
          styles.button,
          (code.trim().length < 6 || busy) && styles.buttonDisabled,
        ]}
        onPress={onSubmit}
        disabled={code.trim().length < 6 || busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Verify & sign in</Text>
        )}
      </Pressable>

      <Pressable onPress={onResend} disabled={busy} style={styles.linkBtn}>
        <Text style={styles.link}>Resend code</Text>
      </Pressable>
      <Pressable onPress={onBack} disabled={busy} style={styles.linkBtn}>
        <Text style={styles.link}>Use a different email</Text>
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
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#5c6370",
  },
  email: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 24,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 20,
    letterSpacing: 4,
    marginBottom: 12,
    textAlign: "center",
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
  linkBtn: {
    marginTop: 16,
    alignItems: "center",
  },
  link: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "500",
  },
});
