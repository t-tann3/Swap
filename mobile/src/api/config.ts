import { API_BASE_URL as ENV_API_BASE_URL } from "@env";

/** Node marketplace API. iOS Simulator can use localhost. */
export const API_BASE_URL =
  ENV_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:4000";
