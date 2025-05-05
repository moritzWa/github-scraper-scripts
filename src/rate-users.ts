import { config } from "dotenv";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import OpenAI from "openai";
import { UserData } from "./types.js";

// Load environment variables
config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function cleanProfileReadme(readme: string | null): string {
  if (!readme) return "N/A";

  // Remove the default GitHub template text
  const defaultTemplateRegex =
    /<!--\n\*\*.*?\*\* is a ✨ _special_ ✨ repository.*?-->/s;
  let cleaned = readme.replace(defaultTemplateRegex, "").trim();

  // Remove common GitHub stats widgets if they're the only content
  const statsWidgetRegex =
    /\[!\[.*?\]\(https:\/\/github-readme-stats\.vercel\.app\/api.*?\)\]/g;
  cleaned = cleaned.replace(statsWidgetRegex, "").trim();

  // Remove empty lines and normalize spacing
  cleaned = cleaned.replace(/\n\s*\n/g, "\n").trim();

  return cleaned || "N/A";
}

function logPrompt(user: UserData, prompt: string) {
  const logEntry = `
=== Prompt for user: ${user.login} ===
${prompt}
=====================================
`;
  appendFileSync("dataOutputs/prompt-logs.txt", logEntry);
}

export async function rateUser(
  user: UserData
): Promise<{ reasoning: string; score: number; role: string }> {
  const cleanedReadme = cleanProfileReadme(user.profileReadme);

  const prompt = `Rate this GitHub user's fit for Prime Intellect, a decentralized GPU/AI training platform.

Available Roles:
1. Full-Stack Engineer: FastAPI, NextJS, Linux, distributed systems, protocols
2. SRE/Infra Engineer: Cloud platforms, K8s, compute cluster management
3. AI Agent Engineer: Agent frameworks, DevRel
4. AI Scientist: ML engineering, large-scale training, MLOps

User Profile:
Name: ${user.name || user.login}
Bio: ${user.bio || "N/A"}
${user.twitter_username ? `X: ${user.twitter_username}` : ""}
${user.xBio ? `X Bio: ${user.xBio}` : ""}
${
  user.websiteContent
    ? `Website Content: ${user.websiteContent.slice(0, 1000)}...`
    : ""
}
${
  cleanedReadme !== "N/A"
    ? `Profile Readme: ${cleanedReadme.slice(0, 400)}...`
    : ""
}
Company: ${user.company || "N/A"}
Location: ${user.location || "N/A"} 
${user.xLocation ? `X Location: ${user.xLocation}` : ""}
Stats: ${user.followers} followers, ${user.public_repos || 0} repos
Recent Repos: ${
    user.recentRepositories
      ?.slice(0, 10)
      .map(
        (repo) =>
          `${repo.name} (${repo.language || "Unknown"}) - ${
            repo.description?.slice(0, 10) || ""
          }⭐${repo.stargazers_count}`
      )
      .join(", ") || "N/A"
  }

Scoring Rules:
- Score 0: Companies/projects or unrelated field
- Score 1-100: Based on AI/cloud/distributed systems/and protocol experience
- Higher scores for:
  * Senior-level experience in AI/ML, especially in privacy, federated learning, or large-scale training [+25-35]
  * Senior experience with distributed systems and protocols, especially in blockchain or P2P networks [+20-30]
  * Experience at elite/top-tier AI companies: big tech [+5], research institutions/startups [+10], or ai startups [+20]
- Bonus for:
  * Senior-level experience with both high-level (Python) and low-level (Rust/C) languages [+5-15]
  * Strong interest in [+15-20] or even experience with [+20-30] decentralized AI or crypto/protocols.
  * Based in San Francisco [+20] or major tech hubs (Switzerland, Austria, Germany, etc.) [+5-10]
  * Senior experience with infrastructure and deployment [+10-20]
  * Notable research or engineering achievements in privacy-preserving ML or federated learning [+10-20]
— Very Low Ratings for:
  * Academic or big tech experience only (for ex. researcher at tiktok, Microsoft, Meta, etc.). We need startup hustlers.
  * Mention that they worked as a Engineering Manager, PM, CPO, Head of Product, or other non-technical IC roles. [-10 to -30]

Role-Specific Scoring:
- AI Scientist: Focus on senior ML/AI research experience, especially in privacy or federated learning
- SRE/Infra: Focus on senior distributed systems, protocols, and deployment experience
- Full-Stack: Focus on crypto senior protocol development and system architecture
- AI Agent: Focus on senior AI frameworks and developer tools experience

Remember to be an extremely harsh critic. Focus on startup people, discount academics (-10). Only rate the most elite/outliner candidates for our position at Prime Intellect above 70 etc.

Example REASONING:
- Senior decentralized AI eng (25) + P2P protocol design (25) + YC startup CTO (15) + SF location (20) + high activity >4000 (15) = 100
- Privacy ML research (20) + distributed systems lead (20) + AI startup exp (20) + Berlin location (10) + moderate activity (5) = 75
- K8s/cloud eng (15) + basic protocol work (10) + mid-level infra (15) + low activity (5) = 45
- Junior Python/ML (5) + only academic experience (-10) + no distributed/infra exp (0) = 0
- PM/Management background (0) + no technical exp (0) = 0

In your reasoning, do NOT give points for anything that is not evident in the user's profile.

Format response exactly as:
REASONING: [mimic caclulation like Example above here. Use the same format with numbers in parenthesis]
SCORE: [1-100]
ROLE: [Full-Stack Engineer|SRE/Infra Engineer|AI Agent Engineer|AI Scientist|Multiple Matches|No Match]`;

  // Log the prompt before making the API call
  logPrompt(user, prompt);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    });

    const response = completion.choices[0].message.content;
    const lines = response?.split("\n") || [];

    const reasoning =
      lines
        .find((l: string) => l.startsWith("REASONING:"))
        ?.replace("REASONING:", "")
        .trim() || "";
    const score = parseInt(
      lines
        .find((l: string) => l.startsWith("SCORE:"))
        ?.replace("SCORE:", "")
        .trim() || "0"
    );
    const role =
      lines
        .find((l: string) => l.startsWith("ROLE:"))
        ?.replace("ROLE:", "")
        .trim() || "No Match";

    // Log the response as well
    appendFileSync(
      "dataOutputs/prompt-logs.txt",
      `Response:
REASONING: ${reasoning}
SCORE: ${score}
ROLE: ${role}
=====================================\n`
    );

    return { reasoning, score, role };
  } catch (error) {
    console.error(`Error rating user ${user.login}:`, error);
    appendFileSync(
      "dataOutputs/prompt-logs.txt",
      `Error processing user: ${error}
=====================================\n`
    );
    return { reasoning: "Error processing user", score: 0, role: "No Match" };
  }
}

async function processUsers() {
  try {
    // Clear the log file at the start of processing
    writeFileSync(
      "dataOutputs/prompt-logs.txt",
      "=== Starting new rating session ===\n"
    );

    // Read the existing users
    const users: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repointeracters-3.json", "utf8")
    );
    console.log(`Loaded ${users.length} users from repointeracters-3.json`);

    // Filter users that need rating
    const usersToProcess = users.filter(
      (user) => !user.llmRoleMatchRatingScore
    );
    console.log(`${usersToProcess.length} users need rating`);

    // Process users in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < usersToProcess.length; i += BATCH_SIZE) {
      const batch = usersToProcess.slice(i, i + BATCH_SIZE);
      console.log(
        `\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(
          usersToProcess.length / BATCH_SIZE
        )}`
      );

      // Process batch in parallel
      await Promise.all(
        batch.map(async (user) => {
          console.log(`Processing user: ${user.login}`);
          const rating = await rateUser(user);
          user.llmRoleMatchRatingScore = rating;
          console.log(`Rating for ${user.login}:`, rating);
        })
      );

      // Save after each batch to avoid losing progress
      writeFileSync(
        "dataOutputs/repointeracters-3.json",
        JSON.stringify(users, null, 2)
      );
      console.log(
        `Saved updated data for batch ${Math.floor(i / BATCH_SIZE) + 1}`
      );
    }

    console.log("\nCompleted processing all users!");
  } catch (error) {
    console.error("Error processing users:", error);
  }
}

async function overrideAllRatings() {
  try {
    // Clear the log file at the start of processing
    writeFileSync(
      "dataOutputs/prompt-logs.txt",
      "=== Starting rating override session ===\n"
    );

    // Read the existing users
    const users: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repointeracters-3.json", "utf8")
    );
    console.log(`Loaded ${users.length} users from repointeracters-3.json`);

    // Process all users in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      console.log(
        `\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(
          users.length / BATCH_SIZE
        )}`
      );

      // Process batch in parallel
      await Promise.all(
        batch.map(async (user) => {
          console.log(`Processing user: ${user.login}`);
          const rating = await rateUser(user);
          user.llmRoleMatchRatingScore = rating;
          console.log(`Rating for ${user.login}:`, rating);
        })
      );

      // Save after each batch to avoid losing progress
      writeFileSync(
        "dataOutputs/repointeracters-3.json",
        JSON.stringify(users, null, 2)
      );
      console.log(
        `Saved updated data for batch ${Math.floor(i / BATCH_SIZE) + 1}`
      );
    }

    console.log("\nCompleted overriding all ratings!");
  } catch (error) {
    console.error("Error overriding ratings:", error);
  }
}

// Run the script if it's the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  // Check if --override flag is present
  const shouldOverride = process.argv.includes("--override");
  if (shouldOverride) {
    console.log("Running rating override for all users...");
    overrideAllRatings().catch(console.error);
  } else {
    console.log("Running normal rating process for new users...");
    processUsers().catch(console.error);
  }
}
