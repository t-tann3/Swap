import { MongoClient, type Db as MongoDb, type AnyBulkWriteOperation } from "mongodb";

import { createSeedDatabase } from "./seed.js";
import { log } from "./logger.js";
import { DEFAULT_PATRON_CAP, defaultPantrySettings } from "./pantry.js";
import type {
  Basket,
  Database,
  Favorite,
  Listing,
  Order,
  Pantry,
  PantryInvite,
  PantryMembership,
  PantryPatron,
  PantrySettings,
  Profile,
  StockAdjustment,
} from "./types.js";

const DB_NAME = process.env.MONGODB_DB_NAME?.trim() || "swap";

let client: MongoClient | null = null;
let mongo: MongoDb | null = null;
/** In-memory working set kept in sync with MongoDB. */
let db: Database = createSeedDatabase();
/** Serialize reloads + writes so concurrent mutates cannot clobber each other. */
let writeChain: Promise<void> = Promise.resolve();

function mongoUri(): string {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error(
      "MONGODB_URI is required. Set it in server/.env (MongoDB Atlas connection string).",
    );
  }
  return uri;
}

function migrateDb(current: Database): Database {
  for (const profile of current.profiles) {
    const p = profile as Profile;
    if (p.stripeAccountId === undefined) p.stripeAccountId = null;
    if (p.stripePayoutsReady === undefined) p.stripePayoutsReady = false;
    if (p.patronCap === undefined) p.patronCap = null;
    if (p.isPantrySeller === undefined) p.isPantrySeller = false;
    if (p.pantryBlocked === undefined) p.pantryBlocked = false;
    if (p.adminOptOut === undefined) p.adminOptOut = false;
    if (!Array.isArray(p.pushDevices)) p.pushDevices = [];
  }
  for (const listing of current.listings) {
    const l = listing as Listing & { compartmentSize?: unknown };
    delete l.compartmentSize;
    if (l.imageUrl === undefined) l.imageUrl = null;
    if (l.stockQty === undefined) l.stockQty = 1;
    if (l.maxPerOrder === undefined) l.maxPerOrder = 1;
    if (l.createdByUserId === undefined) l.createdByUserId = l.sellerUserId;
  }
  for (const order of current.orders) {
    const o = order as Order & { compartmentSize?: unknown };
    delete o.compartmentSize;
    if (!Array.isArray(o.items) || o.items.length === 0) {
      o.items = [
        {
          listingId: o.listingId,
          quantity: 1,
          title: "Item",
        },
      ];
    }
    if (o.dropOffPhotoUrl === undefined) o.dropOffPhotoUrl = null;
    if (o.stripePaymentIntentId === undefined) o.stripePaymentIntentId = null;
    if (o.stripeTransferId === undefined) o.stripeTransferId = null;
    if (o.stripeRefundId === undefined) o.stripeRefundId = null;
    if (o.paymentStatus === undefined) o.paymentStatus = "none";
    if (o.completedReason === undefined) o.completedReason = null;
    if (o.relaiPickupVerifiedAt === undefined) o.relaiPickupVerifiedAt = null;
    if (o.relaiWebhookEventId === undefined) o.relaiWebhookEventId = null;
    if (o.pickupVerifiedVia === undefined) o.pickupVerifiedVia = null;
    if (o.sellerAcceptDeadlineAt === undefined) o.sellerAcceptDeadlineAt = null;
    if (o.sellerDropOffDeadlineAt === undefined) o.sellerDropOffDeadlineAt = null;
    if (o.transferLastError === undefined) o.transferLastError = null;
    if (o.paymentStatusBeforeDispute === undefined) {
      o.paymentStatusBeforeDispute = null;
    }
    if (o.stripeDisputeId === undefined) o.stripeDisputeId = null;
    if (o.disputeStatus === undefined) o.disputeStatus = null;
    if (o.adminHold === undefined) o.adminHold = false;
    if (o.platformDisputeReason === undefined) o.platformDisputeReason = null;
    if (o.platformDisputeOpenedBy === undefined) {
      o.platformDisputeOpenedBy = null;
    }
    if (o.platformDisputeOpenedAt === undefined) {
      o.platformDisputeOpenedAt = null;
    }
    if (o.acceptedByUserId === undefined) o.acceptedByUserId = null;
    if (o.acceptedByName === undefined) o.acceptedByName = null;
    if (o.droppedOffByUserId === undefined) o.droppedOffByUserId = null;
    if (o.droppedOffByName === undefined) o.droppedOffByName = null;
    if (o.cancelledReason === undefined) o.cancelledReason = null;
  }
  for (const adj of current.stockAdjustments ?? []) {
    if (adj.actorUserId === undefined) adj.actorUserId = adj.sellerUserId;
  }
  if (!Array.isArray(current.pantries)) current.pantries = [];
  if (!Array.isArray(current.pantryMemberships)) current.pantryMemberships = [];
  if (!Array.isArray(current.pantryInvites)) current.pantryInvites = [];
  if (!Array.isArray(current.pantryPatrons)) current.pantryPatrons = [];
  for (const pantry of current.pantries) {
    const row = pantry as Pantry;
    if (row.patronAllowlistEnabled === undefined) {
      row.patronAllowlistEnabled = false;
    }
  }
  for (const m of current.pantryMemberships) {
    const row = m as PantryMembership;
    if (row.firstName === undefined) row.firstName = null;
    if (row.lastName === undefined) row.lastName = null;
    if (row.phone === undefined) row.phone = null;
  }
  for (const invite of current.pantryInvites) {
    const row = invite as PantryInvite;
    if (row.firstName === undefined) row.firstName = null;
    if (row.lastName === undefined) row.lastName = null;
    if (row.phone === undefined) row.phone = null;
  }
  if (!Array.isArray(current.baskets)) {
    current.baskets = [];
  }
  if (!current.pantrySettings) {
    current.pantrySettings = defaultPantrySettings();
  } else {
    const ps = current.pantrySettings as PantrySettings & {
      autoAcceptOrders?: boolean;
    };
    delete ps.autoAcceptOrders;
    if (ps.hardReserveEnabled === undefined) ps.hardReserveEnabled = true;
    if (ps.defaultPatronCap === undefined) {
      ps.defaultPatronCap = DEFAULT_PATRON_CAP;
    }
    if (ps.basketHoldTtlMinutes === undefined) {
      ps.basketHoldTtlMinutes = 120;
    }
    if (ps.lowStockThreshold === undefined) {
      ps.lowStockThreshold = 3;
    }
  }
  if (!Array.isArray(current.stockAdjustments)) {
    current.stockAdjustments = [];
  }
  // One-time: legacy baskets soft-held stock. Clear them before hard-reserve
  // so checkout does not skip a consume that was never performed.
  if (!current.pantrySettings.hardReserveEnabled) {
    const ts = new Date().toISOString();
    for (const basket of current.baskets) {
      if (basket.items.length > 0) {
        basket.items = [];
        basket.updatedAt = ts;
      }
    }
    current.pantrySettings = {
      ...current.pantrySettings,
      hardReserveEnabled: true,
      updatedAt: ts,
    };
  }
  if (!Array.isArray(current.processedStripeEvents)) {
    current.processedStripeEvents = [];
  }
  if (!Array.isArray(current.processedRelaiEvents)) {
    current.processedRelaiEvents = [];
  }
  return current;
}

function stripMongoId<T extends object>(doc: T): T {
  const copy = { ...doc } as T & { _id?: unknown };
  delete copy._id;
  return copy;
}

async function loadFromMongo(database: MongoDb): Promise<Database | null> {
  const [
    profiles,
    listings,
    orders,
    favorites,
    baskets,
    pantrySettingsDocs,
    stockAdjustments,
    pantries,
    pantryMemberships,
    pantryInvites,
    pantryPatrons,
    stripeEvents,
    relaiEvents,
  ] = await Promise.all([
    database.collection("profiles").find({}).toArray(),
    database.collection("listings").find({}).toArray(),
    database.collection("orders").find({}).toArray(),
    database.collection("favorites").find({}).toArray(),
    database.collection("baskets").find({}).toArray(),
    database.collection("pantrySettings").find({}).toArray(),
    database.collection("stockAdjustments").find({}).toArray(),
    database.collection("pantries").find({}).toArray(),
    database.collection("pantryMemberships").find({}).toArray(),
    database.collection("pantryInvites").find({}).toArray(),
    database.collection("pantryPatrons").find({}).toArray(),
    database.collection("processedStripeEvents").find({}).toArray(),
    database.collection("processedRelaiEvents").find({}).toArray(),
  ]);

  const pantryDoc = pantrySettingsDocs[0] as PantrySettings | undefined;
  const loaded: Database = {
    profiles: profiles.map(d => stripMongoId(d as unknown as Profile)),
    listings: listings.map(d => stripMongoId(d as unknown as Listing)),
    orders: orders.map(d => stripMongoId(d as unknown as Order)),
    favorites: favorites.map(d => stripMongoId(d as unknown as Favorite)),
    baskets: baskets.map(d => stripMongoId(d as unknown as Basket)),
    pantrySettings: pantryDoc
      ? stripMongoId(pantryDoc)
      : defaultPantrySettings(),
    stockAdjustments: stockAdjustments.map(d =>
      stripMongoId(d as unknown as StockAdjustment),
    ),
    pantries: pantries.map(d => stripMongoId(d as unknown as Pantry)),
    pantryMemberships: pantryMemberships.map(d =>
      stripMongoId(d as unknown as PantryMembership),
    ),
    pantryInvites: pantryInvites.map(d =>
      stripMongoId(d as unknown as PantryInvite),
    ),
    pantryPatrons: pantryPatrons.map(d =>
      stripMongoId(d as unknown as PantryPatron),
    ),
    processedStripeEvents: stripeEvents.map(e => String(e._id)),
    processedRelaiEvents: relaiEvents.map(e => String(e._id)),
  };

  const hasData =
    loaded.profiles.length > 0 ||
    loaded.listings.length > 0 ||
    loaded.orders.length > 0 ||
    loaded.favorites.length > 0;

  return hasData ? migrateDb(loaded) : null;
}

/**
 * Upsert all rows and delete docs no longer present.
 * Avoids wipe-then-insert gaps that can lose orders under concurrent writers.
 */
async function syncKeyedCollection<T extends Record<string, unknown>>(
  database: MongoDb,
  name: string,
  rows: T[],
  getId: (row: T) => string,
): Promise<void> {
  const col = database.collection(name);
  const ids = rows.map(getId);
  if (ids.length === 0) {
    await col.deleteMany({});
    return;
  }
  await col.deleteMany({ _id: { $nin: ids as never[] } });
  const ops: AnyBulkWriteOperation[] = rows.map(row => {
    const id = getId(row);
    const doc = { ...row, _id: id };
    return {
      replaceOne: {
        filter: { _id: id as never },
        replacement: doc as never,
        upsert: true,
      },
    };
  });
  await col.bulkWrite(ops, { ordered: false });
}

async function persistToMongo(current: Database): Promise<void> {
  if (!mongo) {
    throw new Error("MongoDB is not connected.");
  }
  const database = mongo;

  await Promise.all([
    syncKeyedCollection(database, "profiles", current.profiles as unknown as Record<string, unknown>[], p =>
      String(p.userId),
    ),
    syncKeyedCollection(database, "listings", current.listings as unknown as Record<string, unknown>[], l =>
      String(l.id),
    ),
    syncKeyedCollection(database, "orders", current.orders as unknown as Record<string, unknown>[], o =>
      String(o.id),
    ),
    syncKeyedCollection(
      database,
      "favorites",
      current.favorites as unknown as Record<string, unknown>[],
      f => `${f.userId}:${f.listingId}`,
    ),
    syncKeyedCollection(
      database,
      "baskets",
      (current.baskets ?? []) as unknown as Record<string, unknown>[],
      b => String(b.userId),
    ),
    syncKeyedCollection(
      database,
      "pantrySettings",
      [current.pantrySettings ?? defaultPantrySettings()] as unknown as Record<
        string,
        unknown
      >[],
      s => String(s.id ?? "default"),
    ),
    syncKeyedCollection(
      database,
      "stockAdjustments",
      (current.stockAdjustments ?? []) as unknown as Record<string, unknown>[],
      a => String(a.id),
    ),
    syncKeyedCollection(
      database,
      "pantries",
      (current.pantries ?? []) as unknown as Record<string, unknown>[],
      p => String(p.id),
    ),
    syncKeyedCollection(
      database,
      "pantryMemberships",
      (current.pantryMemberships ?? []) as unknown as Record<string, unknown>[],
      m => String(m.id),
    ),
    syncKeyedCollection(
      database,
      "pantryInvites",
      (current.pantryInvites ?? []) as unknown as Record<string, unknown>[],
      i => String(i.id),
    ),
    syncKeyedCollection(
      database,
      "pantryPatrons",
      (current.pantryPatrons ?? []) as unknown as Record<string, unknown>[],
      p => String(p.id),
    ),
    syncKeyedCollection(
      database,
      "processedStripeEvents",
      current.processedStripeEvents.map(id => ({ _id: id })),
      e => String(e._id),
    ),
    syncKeyedCollection(
      database,
      "processedRelaiEvents",
      current.processedRelaiEvents.map(id => ({ _id: id })),
      e => String(e._id),
    ),
  ]);
}

async function reloadIntoMemory(): Promise<void> {
  if (!mongo) return;
  const latest = await loadFromMongo(mongo);
  if (latest) {
    db = latest;
  }
}

export async function initDb(): Promise<void> {
  client = new MongoClient(mongoUri());
  await client.connect();
  mongo = client.db(DB_NAME);

  // Indexes for common lookups
  await Promise.all([
    mongo.collection("orders").createIndex({ buyerUserId: 1 }),
    mongo.collection("orders").createIndex({ sellerUserId: 1 }),
    mongo.collection("orders").createIndex({ status: 1 }),
    mongo.collection("listings").createIndex({ status: 1 }),
    mongo.collection("favorites").createIndex({ userId: 1 }),
    mongo.collection("pantries").createIndex({ ownerUserId: 1 }),
    mongo.collection("pantryMemberships").createIndex({ userId: 1 }),
    mongo.collection("pantryMemberships").createIndex({ pantryId: 1 }),
    mongo.collection("pantryInvites").createIndex({ email: 1, status: 1 }),
    mongo.collection("pantryPatrons").createIndex({ pantryId: 1, email: 1 }),
    mongo.collection("pantryPatrons").createIndex({ email: 1, status: 1 }),
  ]);

  const existing = await loadFromMongo(mongo);
  if (existing) {
    db = existing;
    log.info("mongo_connected", {
      dbName: DB_NAME,
      listings: db.listings.length,
      orders: db.orders.length,
    });
  } else {
    db = migrateDb(createSeedDatabase());
    await persistToMongo(db);
    log.info("mongo_seeded", {
      dbName: DB_NAME,
      listings: db.listings.length,
    });
  }
}

/**
 * Run `task` after any in-flight write finishes.
 * The chain itself is kept settled so one rejected task (e.g. a validation
 * error thrown by a mutator) cannot poison every later write.
 */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Pull the latest documents from Mongo into memory (serialized). */
export async function refreshDb(): Promise<Database> {
  await enqueueWrite(() => reloadIntoMemory());
  return db;
}

export function getDb(): Database {
  return db;
}

/**
 * Apply an in-memory mutation and persist to Mongo.
 * Reloads from Mongo first so a stale process cannot wipe newer orders.
 */
export async function mutateDb(
  mutator: (current: Database) => void,
): Promise<Database> {
  await enqueueWrite(async () => {
    await reloadIntoMemory();
    const beforeOrders = db.orders.length;
    try {
      mutator(db);
    } catch (err) {
      // A rejected mutation may have edited memory before it threw.
      await reloadIntoMemory();
      throw err;
    }
    await persistToMongo(db);
    if (db.orders.length !== beforeOrders) {
      log.info("orders_persisted", {
        before: beforeOrders,
        after: db.orders.length,
      });
    }
  });
  return db;
}

/** Lightweight connectivity probe for /health. */
export async function getMongoPing(): Promise<void> {
  if (!mongo) {
    throw new Error("MongoDB is not connected.");
  }
  await mongo.command({ ping: 1 });
}

export async function resetDb(): Promise<Database> {
  await enqueueWrite(async () => {
    db = migrateDb(createSeedDatabase());
    await persistToMongo(db);
  });
  return db;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function closeDb(): Promise<void> {
  await writeChain;
  if (client) {
    await client.close();
    client = null;
    mongo = null;
  }
}
