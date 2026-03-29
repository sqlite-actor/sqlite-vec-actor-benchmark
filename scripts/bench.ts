// @ts-ignore
const WORKER_URL = (typeof process !== 'undefined' && process.env.WORKER_URL) || "http://localhost:8787"; // Local Dev URL

async function runBenchmark() {
    const sizes = [500, 1000, 5000, 10000];

    const results: any[] = [];


    console.log(`🚀 Starting sqlite-actor vs Native JS Benchmark at ${WORKER_URL}...`);

    for (const amount of sizes) {
        console.log(`\n--- Testing Dataset Size: ${amount} vectors ---`);

      // Sync Native Dataset (Add/Remove as needed)
      console.log(`Syncing Native to ${amount} vectors...`);
      const nativeSync = await fetch(`${WORKER_URL}/sync?type=native&amount=${amount}`).then(r => r.json());
      console.log(`Native Sync: ${JSON.stringify(nativeSync)}`);

      // Sync OSS Dataset (Add/Remove as needed)
      console.log(`Syncing OSS to ${amount} vectors...`);
      const ossSync = await fetch(`${WORKER_URL}/sync?type=oss&amount=${amount}`).then(r => r.json());
      console.log(`OSS Sync: ${JSON.stringify(ossSync)}`);


        // 2. Search Data (Average of 5 runs for stability)
        console.log(`Searching (Top-5)...`);
        const searchRuns = 50;
        const nativeResults = [];
        const ossResults = [];

        for (let i = 0; i < 5; i++) {
          const resNative = await fetch(`${WORKER_URL}/search?type=native&k=5&runs=${searchRuns}`).then(r => r.json());
          const resOSS = await fetch(`${WORKER_URL}/search?type=oss&k=5&runs=${searchRuns}`).then(r => r.json());
          
          // Divide by searchRuns to get the single-run average
          nativeResults.push(resNative.time / searchRuns);
          ossResults.push(resOSS.time / searchRuns);
        }


        const avgNative = nativeResults.reduce((a, b) => a + b, 0) / nativeResults.length;
        const avgOSS = ossResults.reduce((a, b) => a + b, 0) / ossResults.length;

        results.push({
            "Vector Count": amount,
            "Native JS (ms)": avgNative.toFixed(2),
            "sqlite-actor (ms)": avgOSS.toFixed(2),
            "Speedup": `${(avgNative / avgOSS).toFixed(1)}x`
        });
        
        console.table([results[results.length - 1]]);
    }

    console.log("\n✅ Benchmark Complete!");
    console.table(results);

    // Output Markdown for README
    console.log("\n### Copy-Paste for README.md:\n");
    console.log("| Vector Count | Native JS (ms) | sqlite-actor (ms) | Speedup |");
    console.log("| :--- | :--- | :--- | :--- |");
    results.forEach(r => {
        console.log(`| ${r["Vector Count"]} | ${r["Native JS (ms)"]}ms | **${r["sqlite-actor (ms)"]}ms** | ${r["Speedup"]} |`);
    });
}

runBenchmark().catch(console.error);