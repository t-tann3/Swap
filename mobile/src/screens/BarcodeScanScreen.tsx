import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from "react-native-vision-camera";

import { apiRequest } from "../api/client";
import type { ListingCategory } from "../marketplace/categories";
import type { SellStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<SellStackParamList, "BarcodeScan">;

type CatalogProduct = {
  barcode: string;
  title: string;
  description: string;
  category: ListingCategory;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
  source: string;
};

export function BarcodeScanScreen({ navigation }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const lastScanRef = useRef<string>("");
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const lookup = useCallback(
    async (raw: string) => {
      const code = raw.replace(/\D/g, "");
      if (code.length < 8 || code.length > 14) {
        setError("Enter or scan an 8–14 digit barcode (UPC/EAN).");
        return;
      }
      if (lockedRef.current) return;
      lockedRef.current = true;
      setCameraActive(false);
      setBusy(true);
      setError(null);
      try {
        const product = await apiRequest<CatalogProduct>(
          `/api/products/barcode/${encodeURIComponent(code)}`,
          { auth: true },
        );
        navigation.navigate("SellHome", {
          draft: {
            title: product.title,
            description: product.description,
            category: product.category,
            imageUrl: product.imageUrl,
            barcode: product.barcode,
          },
        });
      } catch (err) {
        lockedRef.current = false;
        setCameraActive(true);
        setError(err instanceof Error ? err.message : "Lookup failed");
      } finally {
        setBusy(false);
      }
    },
    [navigation],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ["ean-13", "ean-8", "upc-a", "upc-e"],
    onCodeScanned: codes => {
      if (busy || lockedRef.current || !cameraActive) return;
      const value = codes[0]?.value?.trim();
      if (!value || value === lastScanRef.current) return;
      lastScanRef.current = value;
      void lookup(value);
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Scan barcode</Text>
      <Text style={styles.help}>
        Point the camera at a UPC/EAN on the package. You can also type digits
        or use a USB/Bluetooth scanner in the field below.
      </Text>

      {hasPermission && device ? (
        <View style={styles.cameraWrap}>
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={cameraActive && !busy}
            codeScanner={codeScanner}
            torch={torch ? "on" : "off"}
            enableZoomGesture
          />
          <View style={styles.reticle} pointerEvents="none" />
          <Pressable
            style={styles.torchBtn}
            onPress={() => setTorch(v => !v)}
            disabled={busy}>
            <Text style={styles.torchText}>
              {torch ? "Light off" : "Light on"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.cameraFallback}>
          <Text style={styles.fallbackText}>
            {hasPermission
              ? "No back camera available here (simulator often has none). Enter the barcode below, or try on a device."
              : "Camera permission is needed for live scan. You can still type a barcode."}
          </Text>
          {!hasPermission ? (
            <Pressable
              style={styles.secondary}
              onPress={() => void requestPermission()}>
              <Text style={styles.secondaryText}>Allow camera</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <Text style={styles.label}>Or enter barcode</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 012345678905"
        keyboardType="number-pad"
        value={manualCode}
        onChangeText={setManualCode}
        editable={!busy}
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => void lookup(manualCode)}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.primary, busy && styles.disabled]}
        disabled={busy}
        onPress={() => void lookup(manualCode)}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>Look up product</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f5f7",
    padding: 20,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  help: {
    fontSize: 14,
    color: "#5c6370",
    lineHeight: 20,
    marginBottom: 16,
  },
  cameraWrap: {
    height: 300,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111",
    marginBottom: 16,
  },
  reticle: {
    position: "absolute",
    left: "10%",
    right: "10%",
    top: "32%",
    bottom: "32%",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    borderRadius: 12,
  },
  torchBtn: {
    position: "absolute",
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  torchText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13,
  },
  cameraFallback: {
    minHeight: 140,
    borderRadius: 16,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  fallbackText: {
    textAlign: "center",
    color: "#4b5563",
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    color: "#111827",
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  error: {
    color: "#b91c1c",
    marginBottom: 10,
    fontSize: 14,
  },
  primary: {
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  secondary: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryText: {
    fontWeight: "600",
    color: "#111827",
  },
  disabled: {
    opacity: 0.6,
  },
});
