import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runPipeline() {
  try {
    console.log("Starting ideal users pipeline...");

    // Step 1: Scrape profiles
    console.log("\n=== Step 1: Scraping GitHub profiles ===");
    await execAsync("npx ts-node src/prime-profile-link-scraper.ts");

    // Step 2: Rate users
    console.log("\n=== Step 2: Rating users ===");
    await execAsync("npx ts-node src/rate-ideal-users.ts");

    console.log("\n=== Pipeline completed successfully! ===");
  } catch (error) {
    console.error("Error running pipeline:", error);
  }
}

// Run the pipeline
runPipeline().catch(console.error);
