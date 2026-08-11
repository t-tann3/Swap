import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSeedDatabase } from "./seed.js";
import type { Database, Order, Profile } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "db.json");

let db: Database = createSeedDatabase();
let writeChain: Promise<void> = Promise.resolve();

function migrateDb(current: Database): Database {
  for (const profile of current.profiles) {
    const p = profile as Profile;
    if (p.stripeAccountId === undefined) p.stripeAccountId = null;
    if (p.stripePayoutsReady === undefined) p.stripePayoutsReady = false;
  }
  for (const order of current.orders) {
    const o = order as Order;
    if (o.stripePaymentIntentId === undefined) o.stripePaymentIntentId = null;
    if (o.stripeTransferId === undefined) o.stripeTransferId = null;
    if (o.stripeRefundId === undefined) o.stripeRefundId = null;
    if (o.paymentStatus === undefined) o.paymentStatus = "none";
    if (o.completedReason === undefined) o.completedReason = null;
    if (o.relaiPickupVerifiedAt === undefined) o.relaiPickupVerifiedAt = null;
    if (o.relaiWebhookEventId === undefined) o.relaiWebhookEventId = null;
    if (o.pickupVerifiedVia === undefined) o.pickupVerifiedVia = null;
  }
  if (!Array.isArray(current.processedStripeEvents)) {
    current.processedStripeEvents = [];
  }
  if (!Array.isArray(current.processedRelaiEvents)) {
    current.processedRelaiEvents = [];
  }
  return current;
}

export async function initDb(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(dbPath, "utf8");
    db = migrateDb(JSON.parse(raw) as Database);
    if (!db.listings?.length) {
      db = createSeedDatabase();
      await persist();
    } else {
      await persist();
    }
  } catch {
    db = createSeedDatabase();
    await persist();
  }
}

async function persist(): Promise<void> {
  writeChain = writeChain.then(() =>
    writeFile(dbPath, JSON.stringify(db, null, 2), "utf8"),
  );
  await writeChain;
}

export function getDb(): Database {
  return db;
}

export async function mutateDb(
  mutator: (current: Database) => void,
): Promise<Database> {
  mutator(db);
  await persist();
  return db;
}

export async function resetDb(): Promise<Database> {
  db = createSeedDatabase();
  await persist();
  return db;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
