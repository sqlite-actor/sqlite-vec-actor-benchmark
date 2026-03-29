# sqlite-actor Vector Benchmark

A performance comparison between `sqlite-actor` (OSS WASM-based SQLite with `sqlite-vec` extensions) and a Native JS baseline (Cloudflare Durable Objects SQL + JS Math).

## Performance Results (1536 Dimensions)

### Local Development (Internal Timing)
Measured using `wrangler dev` to isolate search logic performance.

| Vector Count | Native JS (ms) | sqlite-actor (ms) | Speedup |
| :--- | :--- | :--- | :--- |
| 1000 | 15.8ms | 0.0ms | **Infinityx** |
| 2000 | 33.8ms | 0.2ms | **169x** |
| 5000 | 117.2ms | 0.8ms | **146x** |

### Production (End-to-End Timing)
Measured from a client script hitting a deployed Worker (set the `WORKER_URL` environment variable to target a remote instance). These results include network round-trip time.

| Actor | Scale | Write Latency | Search Latency |
| :--- | :--- | :--- | :--- |
| **Native JS** | 10,000 | 352ms | 388ms |
| **sqlite-actor** | 10,000 | 3284ms | **137ms** |

**Result**: Even with network overhead, `sqlite-actor` provides a **2.8x speedup** for 10k vectors end-to-end.

---

## Scripts & Usage

### 1. `npm run bench`
**File**: `scripts/bench.ts`  
This is the primary iterative benchmark. It cycles through multiple dataset sizes (500 to 10k) and calculates the average search time using high-precision internal iterations (50 runs per request) to overcome production timer jitter.

**How to run**:
```bash
# Locally
npm run bench
# Against Production
WORKER_URL=https://your-worker.workers.dev npm run bench
```

### 2. `scripts/test-10k.ts`
**File**: `scripts/test-10k.ts`  
A one-shot performance test that scales the database to exactly 10,000 vectors and measures a single "real-world" search from the client's perspective. It reports both write (sync) and search latency.

**How to run**:
```bash
npx tsx scripts/test-10k.ts
```

---

## Architecture

- **Native JS Actor**: Uses Durable Objects built-in `sql.exec` for storage and performs manual L2 Distance calculations in a JS loop using a Max-Heap for Top-K extraction.
- **OSS Actor**: Integrates the `sqlite-actor` WASM engine with `sqlite-vec`. It uses Hex-encoded BLOBs (`X'...'`) and `f32` buffers to bypass JSON parsing overhead, achieving near-native vector math performance within the Worker.

## Development

1. **Install**: `npm install`
2. **Local Dev**: `npm run dev`
3. **Deploy**: `npm run deploy`
