const WORKER_URL = process.env.WORKER_URL || "http://localhost:8787";

async function runTest() {
    console.log(`\n🚀 Scaling to 10,000 vectors on ${WORKER_URL}...\n`);

    const types = ["native", "oss"] as const;
    const results: Record<string, { write: number, search: number }> = {
        native: { write: 0, search: 0 },
        oss: { write: 0, search: 0 }
    };

    for (const type of types) {
        console.log(`--- Testing ${type.toUpperCase()} ---`);
        
        // 1. Sync to 10,000 (Client-side timing)
        const writeStart = performance.now();
        console.log(`Syncing to 10,000 vectors...`);
        const writeRes = await fetch(`${WORKER_URL}/sync?type=${type}&amount=10000`);
        if (!writeRes.ok) {
            console.error(`Sync failed: ${await writeRes.text()}`);
            continue;
        }
        const writeData = await writeRes.json();
        results[type].write = performance.now() - writeStart;
        console.log(`Sync Complete: ${JSON.stringify(writeData)} (${results[type].write.toFixed(2)}ms client-side)`);

        // 2. Search Top-5 (Client-side timing)
        // Using runs=1 for a true "interactive" end-to-end feel
        const searchStart = performance.now();
        console.log(`Performing Top-5 search...`);
        const searchRes = await fetch(`${WORKER_URL}/search?type=${type}&k=5&runs=1`);
        if (!searchRes.ok) {
            console.error(`Search failed: ${await searchRes.text()}`);
            continue;
        }
        const searchData = await searchRes.json();
        results[type].search = performance.now() - searchStart;
        console.log(`Search Complete: ${results[type].search.toFixed(2)}ms client-side`);
        console.log(`Top result distance: ${searchData.results[0]?.dist}\n`);
    }

    console.table([
        { Actor: "Native JS", "Write (ms)": results.native.write.toFixed(2), "Search (ms)": results.native.search.toFixed(2) },
        { Actor: "sqlite-actor", "Write (ms)": results.oss.write.toFixed(2), "Search (ms)": results.oss.search.toFixed(2) }
    ]);
    
    const speedup = (results.native.search / results.oss.search).toFixed(1);
    console.log(`\n🏁 End-to-End Search Speedup: ${speedup}x`);
}

runTest().catch(console.error);
