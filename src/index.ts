import { SqliteActor } from "sqlite-actor";
import { DurableObject } from "cloudflare:workers";
import { Heap } from "heap-js";
// @ts-ignore - Handled by your build tool (e.g. Wrangler)
import wasmModule from "sqlite-actor/sqlite-actor.wasm";

/**
 * CONFIGURATION
 */
const DIMENSIONS = 1536;

export interface Env {
  NATIVE_ACTOR: DurableObjectNamespace<NativeVectorActor>;
  OSS_ACTOR: DurableObjectNamespace<OSSVectorActor>;
}

/**
 * SHARED UTILITIES
 */
const generateVector = () => Array.from({ length: DIMENSIONS }, () => Math.random());

// Converts a number array to a Hex string representing a Float32Array BLOB (Little Endian)
// Uses Buffer for high performance (requires nodejs_compat in wrangler.toml)
const vectorToHex = (v: number[]) => {
  return Buffer.from(new Float32Array(v).buffer).toString('hex');
};




// --- ACTOR 1: NATIVE JS (The "Control" Group) ---
// Uses built-in DO SQL + JS Heap + JS Math
export class NativeVectorActor extends DurableObject<Env> {
  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Initialize table using the correct .exec() method
    this.sql.exec(`
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY, 
                embedding BLOB
            )
        `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/sync") {
      const targetAmount = parseInt(url.searchParams.get("amount") || "100");
      const start = performance.now();

      // Get current count
      const result = this.sql.exec("SELECT count(*) as count FROM items").one();
      const currentCount = Number(result.count);
      let diff = targetAmount - currentCount;
      let added = 0;
      let removed = 0;

      if (diff > 0) {
        const BATCH_SIZE = 1000; // Native is faster, larger batch ok
        for (let b = 0; b < diff; b += BATCH_SIZE) {
          const count = Math.min(BATCH_SIZE, diff - b);
          this.ctx.storage.transactionSync(() => {
            for (let i = 0; i < count; i++) {
              const vector = new Float32Array(generateVector());
              this.sql.exec("INSERT OR IGNORE INTO items (embedding) VALUES (?)", vector.buffer);
              added++;
            }
          });
        }
      } else if (diff < 0) {
        const toRemove = Math.abs(diff);
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("DELETE FROM items WHERE id IN (SELECT id FROM items LIMIT ?)", toRemove);
          removed = toRemove;
        });
      }

      return Response.json({ type: "native", current: targetAmount, added, removed, time: performance.now() - start });
    }




    if (url.pathname === "/search") {
      const k = parseInt(url.searchParams.get("k") || "5");
      const runs = parseInt(url.searchParams.get("runs") || "200");
      const query = new Float32Array(generateVector());
      const start = performance.now();

      let lastResults: any[] = [];
      for (let r = 0; r < runs; r++) {
        const heap = new Heap<{ id: number, dist: number }>((a, b) => b.dist - a.dist);
        heap.limit = k;
        const cursor = this.sql.exec("SELECT id, embedding FROM items");
        for (const row of cursor) {
          const rowVec = new Float32Array(row.embedding as ArrayBuffer);
          let distSq = 0;
          for (let i = 0; i < DIMENSIONS; i++) {
            const diff = query[i] - rowVec[i];
            distSq += diff * diff;
          }
          heap.push({ id: Number(row.id), dist: Math.sqrt(distSq) });
        }
        lastResults = heap.toArray().sort((a, b) => a.dist - b.dist);
      }

      return Response.json({
        type: "native",
        time: performance.now() - start,
        results: lastResults
      });
    }


    if (url.pathname === "/clear") {
      this.sql.exec("DELETE FROM items;");
      return new Response("Native items cleared");
    }

    return new Response("Native Actor: /write, /search, or /clear");
  }
}

// --- ACTOR 2: OSS SQLITE-ACTOR (The "Challenger") ---
// Uses your custom WASM build + sqlite-vec extensions
export class OSSVectorActor extends DurableObject<Env> {
  private dbPromise: Promise<any>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Pre-initialize WASM and database
    this.dbPromise = this.initDb();
  }

  async initDb() {
    const db = await SqliteActor.create(this.ctx.storage, { wasmModule });
    db.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(embedding float[${DIMENSIONS}]);`);
    return db;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const db = await this.dbPromise;

    if (url.pathname === "/sync") {
      const targetAmount = parseInt(url.searchParams.get("amount") || "100");
      const start = performance.now();

      // Get current count
      const result = db.query("SELECT count(*) as count FROM vec_items");
      const currentCount = Number(result[0].count);
      let diff = targetAmount - currentCount;
      let added = 0;
      let removed = 0;

      if (diff > 0) {
        // Chunkenized inserts to avoid execution timeouts in production
        const BATCH_SIZE = 500;
        for (let b = 0; b < diff; b += BATCH_SIZE) {
          const count = Math.min(BATCH_SIZE, diff - b);
          this.ctx.storage.transactionSync(() => {
            for (let i = 0; i < count; i++) {
              const vector = generateVector();
              db.execute(`INSERT INTO vec_items(embedding) VALUES (X'${vectorToHex(vector)}');`);
              added++;
            }
          });
        }
      } else if (diff < 0) {
        const toRemove = Math.abs(diff);
        this.ctx.storage.transactionSync(() => {
          db.execute(`DELETE FROM vec_items WHERE rowid IN (SELECT rowid FROM vec_items LIMIT ${toRemove});`);
          removed = toRemove;
        });
      }

      return Response.json({ type: "oss", current: targetAmount, added, removed, time: performance.now() - start });
    }




    if (url.pathname === "/search") {
      const k = parseInt(url.searchParams.get("k") || "5");
      const runs = parseInt(url.searchParams.get("runs") || "200");
      const query = generateVector();
      const hexQuery = vectorToHex(query);
      const start = performance.now();

      let results: any[] = [];
      for (let r = 0; r < runs; r++) {
        results = db.query(
          `SELECT rowid as id, distance as dist FROM vec_items WHERE embedding MATCH X'${hexQuery}' AND k = ${k}`
        );
      }

      return Response.json({
        type: "oss",
        time: performance.now() - start,
        results
      });
    }


    if (url.pathname === "/clear") {
      db.execute("DELETE FROM vec_items;");
      return new Response("OSS items cleared");
    }



    return new Response("OSS Actor: /write, /search, or /clear");
  }
}

// --- MAIN WORKER HANDLER ---
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const type = url.searchParams.get("type"); // "native" or "oss"

    if (!type || (type !== "native" && type !== "oss")) {
      return new Response("Usage: ?type=native or ?type=oss", { status: 400 });
    }

    const namespace = type === "native" ? env.NATIVE_ACTOR : env.OSS_ACTOR;
    // Use a fixed name to ensure only ONE instance of each actor class
    const id = namespace.idFromName("performance-benchmark-v1");
    const stub = namespace.get(id);

    return stub.fetch(request);
  }
} satisfies ExportedHandler<Env>;