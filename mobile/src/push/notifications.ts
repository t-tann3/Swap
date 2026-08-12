import messaging from "@react-native-firebase/messaging";
import { Platform } from "react-native";

import { apiRequest } from "../api/client";

type PushPlatform = "ios" | "android";

function currentPlatform(): PushPlatform | null {
  if (Platform.OS === "ios" || Platform.OS === "android") return Platform.OS;
  return null;
}

/** Ask OS permission, get FCM token, and register it with Swap API. */
export async function registerForPushNotifications(): Promise<void> {
  const platform = currentPlatform();
  if (!platform) return;

  await messaging().registerDeviceForRemoteMessages();

  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;
  if (!enabled) return;

  const token = await messaging().getToken();
  if (!token) return;

  await apiRequest("/api/me/push-token", {
    auth: true,
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });
}

/** Best-effort remove this device token before sign-out. */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const token = await messaging().getToken();
    if (!token) return;
    await apiRequest("/api/me/push-token", {
      auth: true,
      method: "DELETE",
      body: JSON.stringify({ token }),
    });
  } catch {
    // Ignore — session may already be gone.
  }
}

/** Keep API in sync when FCM rotates the token. */
export function subscribePushTokenRefresh(): () => void {
  return messaging().onTokenRefresh(token => {
    const platform = currentPlatform();
    if (!platform) return;
    void apiRequest("/api/me/push-token", {
      auth: true,
      method: "POST",
      body: JSON.stringify({ token, platform }),
    }).catch(() => {
      // Retry happens on next sign-in / app launch.
    });
  });
}
