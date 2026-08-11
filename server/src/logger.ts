type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: err.message,
      errStack: err.stack,
    };
  }
  return { errMessage: String(err) };
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    service: "swap-server",
    msg: message,
    ...fields,
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const log = {
  debug: (message: string, fields?: LogFields) =>
    emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) =>
    emit("error", message, fields),
};

/** Structured error capture; optionally POSTs to ERROR_WEBHOOK_URL. */
export async function captureException(
  err: unknown,
  context: LogFields = {},
): Promise<void> {
  log.error("exception", { ...serializeError(err), ...context });
  const url = process.env.ERROR_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        service: "swap-server",
        ...serializeError(err),
        ...context,
      }),
    });
  } catch (hookErr) {
    log.warn("error_webhook_failed", serializeError(hookErr));
  }
}
