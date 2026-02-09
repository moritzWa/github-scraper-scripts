import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import path from "path";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { companyConfig, computeTotalScore } from "../../config/company.js";
import { UserData } from "../../types.js";
import { fetchRecentRepositories } from "../../utils/profile-data-fetchers.js";
import { DbGraphUser } from "../types.js";
import openai from "./openai.js";

config();

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const getUserName = (user: UserData) =>
  `${user.name || user.login} ${user.xName ? `(${user.xName})` : ""}`;

// Helper function to format relative time
function formatRelativeTime(
  dateString: string | null | undefined
): string | null {
  if (!dateString) {
    return null;
  }
  try {
    const pushedDate = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - pushedDate.getTime();

    // Check for invalid date
    if (isNaN(diffMs)) {
      return null; // Or some indicator of invalid date
    }

    const diffYears = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
    const diffMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44)); // Approx
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffYears > 0) {
      return `${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
    } else if (diffMonths > 0) {
      return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
    } else if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    } else {
      return "today"; // Or 'less than a day ago'
    }
  } catch (e) {
    console.error("Error formatting relative time:", e);
    return null; // Return null on error
  }
}

export const EngineerArchetypes = companyConfig.engineerArchetypes;

// Function to format the dynamic part of the prompt for a user
const formatEngineerInQuestion = (
  user: UserData,
  webResearchInfoOpenAI: string | null,
  webResearchInfoGemini: string | null
) => {
  const reposText = user.recentRepositories
    ?.slice(0, 3)
    .map((repo) => {
      const repoName = `${repo.is_fork ? "[Fork] " : ""}${repo.name}${
        repo.description ? ` (${repo.description.slice(0, 100)})` : ""
      }`;
      const relativeTime = formatRelativeTime(repo.last_pushed_at);
      const timeInfo = relativeTime ? ` (pushed ${relativeTime})` : "";
      const langInfo = repo.language ? ` [${repo.language}]` : "";
      return `- ${repoName}${langInfo}${timeInfo}`;
    })
    .join("\n");

  // Build location string from all available sources
  const locationParts = [
    user.location,
    user.normalizedLocation?.city,
    user.normalizedLocation?.country,
    user.xLocation,
  ].filter(Boolean);
  const locationStr = locationParts.length > 0
    ? [...new Set(locationParts)].join(", ")
    : null;

  // Group profile information together
  const profileSections = [
    `Name: ${getUserName(user)}`,
    user.company ? `Company: ${user.company}` : null,
    locationStr ? `Location: ${locationStr}` : null,
    user.xBio ? `X Profile Bio: ${user.xBio}` : null,
    user.websiteContent
      ? `Website Content:\n${user.websiteContent.slice(0, 2000)}${
          user.websiteContent.length > 2000 ? "..." : ""
        }`
      : null,
  ].filter(Boolean);

  // Group technical information together
  const technicalSections = [
    reposText ? `Recent Repos:\n${reposText}` : null,
    user.linkedinExperienceSummary
      ? `Linkedin Summary:\n${user.linkedinExperienceSummary}`
      : null,
  ].filter(Boolean);

  // Company insights for founders/CEOs
  const companyInsightsSections = user.currentCompanyInsights
    ? [
        `Current Company Insights (from LinkedIn data):`,
        `  Company: ${user.currentCompanyInsights.companyName}`,
        user.currentCompanyInsights.employeeCount != null
          ? `  Employee Count: ${user.currentCompanyInsights.employeeCount}`
          : null,
        user.currentCompanyInsights.headcountGrowth1y != null
          ? `  1Y Headcount Growth: ${user.currentCompanyInsights.headcountGrowth1y}%`
          : null,
        user.currentCompanyInsights.headcountGrowth6m != null
          ? `  6M Headcount Growth: ${user.currentCompanyInsights.headcountGrowth6m}%`
          : null,
      ].filter(Boolean)
    : [];

  // Group research information together
  const researchSections = [
    webResearchInfoOpenAI
      ? `Web Research (OpenAI): ${webResearchInfoOpenAI}`
      : null,
    webResearchInfoGemini
      ? `Web Research (Gemini): ${webResearchInfoGemini}`
      : null,
  ].filter(Boolean);

  // Combine all sections with appropriate spacing
  const sections = [
    ...profileSections,
    ...technicalSections,
    ...companyInsightsSections,
    ...researchSections,
  ].join("\n");

  return `Engineer in question:\n${sections}\n----`;
};

// Build the criteria text from config
function buildCriteriaText(): string {
  return companyConfig.criteria
    .map((c) => {
      const tierLines = Object.entries(c.tiers)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([tier, desc]) => `  ${tier}: ${desc}`)
        .join("\n");
      return `${c.key} (${c.label}):\n${tierLines}`;
    })
    .join("\n\n");
}

// Build the rating prompt from company config, injecting archetypes and criteria
const RatingPrompt = companyConfig.ratingPrompt
  .replace("{ARCHETYPES}", EngineerArchetypes.join(", "))
  .replace("{CRITERIA}", buildCriteriaText());

// Build structured output schema dynamically from criteria config.
// Each criterion gets a reasoning field BEFORE the score field,
// so the model reasons about the evidence before committing to a score.
function buildRatingSchema() {
  const criteriaShape: Record<string, z.ZodTypeAny> = {};
  for (const c of companyConfig.criteria) {
    criteriaShape[c.key] = z.object({
      reasoning: z
        .string()
        .describe(
          `Brief evidence-based justification for ${c.label} score (1-2 sentences)`
        ),
      score: z.number().describe(`Tier score (0-3) for ${c.label}`),
    });
  }

  return z.object({
    engineer_archetype: z
      .array(z.string())
      .describe("Chosen archetype(s) from the provided list"),
    location: z
      .string()
      .describe(
        'Best estimate of current city/region and country, e.g. "New York, US" or "Unknown"'
      ),
    criteria_assessments: z
      .object(criteriaShape)
      .describe("Assessment for each criterion: reasoning first, then score"),
  });
}

const RatingResponseSchema = buildRatingSchema();

interface WebResearchResult {
  promptText: string;
  researchResult: string | null;
}

export async function rateUserV3(
  user: UserData,
  webResearchInfo: {
    openAI: WebResearchResult;
    gemini: WebResearchResult | null;
  }
): Promise<{
  reasoning: string | undefined;
  score: number;
  criteriaScores: Record<string, number>;
  criteriaReasonings: Record<string, string>;
  engineerArchetype: string[];
  inferredLocation?: string;
  webResearchInfoOpenAI?: string;
  webResearchInfoGemini?: string;
  webResearchPromptText: string;
  ratedAt: Date;
}> {
  // Generate the dynamic part of the prompt
  const engineerInQuestionContent = formatEngineerInQuestion(
    user,
    webResearchInfo.openAI.researchResult || "",
    webResearchInfo.gemini?.researchResult || ""
  );

  const ratingPromptContent = RatingPrompt + engineerInQuestionContent;

  // Log the full prompt
  const logDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  const logFile = path.join(
    logDir,
    `rating-prompts-${new Date().toISOString().split("T")[0]}.txt`
  );
  fs.appendFileSync(
    logFile,
    `\n\n${"=".repeat(80)}\n=== Full Rating Prompt for ${
      user.login
    } at ${new Date().toISOString()} ===\n${"=".repeat(80)}\n${ratingPromptContent}\n`
  );

  console.log(`[${user.login}] Sending rating prompt to OpenAI...`);
  const ratingResult = await openai.beta.chat.completions.parse({
    model: "gpt-4.1",
    messages: [{ role: "user", content: ratingPromptContent }],
    response_format: zodResponseFormat(RatingResponseSchema, "engineer_rating"),
  });
  console.log(`[${user.login}] Received rating from OpenAI.`);

  const parsed = ratingResult.choices[0]?.message?.parsed;
  if (!parsed) {
    console.error(`[${user.login}] Failed to parse structured response`);
    return {
      reasoning: undefined,
      score: 0,
      criteriaScores: {},
      criteriaReasonings: {},
      engineerArchetype: ["None"],
      webResearchInfoOpenAI: webResearchInfo.openAI.researchResult || undefined,
      webResearchInfoGemini: webResearchInfo.gemini?.researchResult || undefined,
      webResearchPromptText: webResearchInfo.openAI.promptText,
      ratedAt: new Date(),
    };
  }

  // Validate archetypes against allowed list
  let parsedArchetypes = parsed.engineer_archetype.filter((s) =>
    EngineerArchetypes.includes(s)
  );
  if (parsedArchetypes.length === 0) {
    parsedArchetypes = ["Other"];
  }

  // Extract per-criterion scores and reasonings
  const criteriaScores: Record<string, number> = {};
  const criteriaReasonings: Record<string, string> = {};
  const assessments = parsed.criteria_assessments as Record<
    string,
    { reasoning: string; score: number }
  >;
  for (const [key, val] of Object.entries(assessments)) {
    criteriaScores[key] = val.score;
    criteriaReasonings[key] = val.reasoning;
  }

  // Compute score as simple sum of tier values
  const score = computeTotalScore(criteriaScores);

  // Build combined reasoning string from per-criterion reasonings
  const combinedReasoning = Object.entries(criteriaReasonings)
    .map(([key, reasoning]) => `${key}=${criteriaScores[key]}: ${reasoning}`)
    .join(" | ");

  const inferredLocation =
    parsed.location && parsed.location.toLowerCase() !== "unknown"
      ? parsed.location
      : undefined;

  console.log(
    `[${user.login}] Criteria scores:`,
    criteriaScores,
    `-> total score: ${score}`
  );

  return {
    reasoning: combinedReasoning || undefined,
    score,
    criteriaScores,
    criteriaReasonings,
    engineerArchetype: parsedArchetypes,
    inferredLocation,
    webResearchInfoOpenAI: webResearchInfo.openAI.researchResult || undefined,
    webResearchInfoGemini: webResearchInfo.gemini?.researchResult || undefined,
    webResearchPromptText: webResearchInfo.openAI.promptText,
    ratedAt: new Date(),
  };
}

// SCRIPT
// TODO this is partly duplicated in re-rate-users.ts
async function rateAllProcessedUsers() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB;
  const BATCH_SIZE = 10;

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");
    const ONLY_RATE_NEW_USERS = true;

    const query: any = {
      status: "processed",
    };

    if (ONLY_RATE_NEW_USERS) {
      query.rating = { $exists: false };
      query.ratedAt = { $exists: false };
    }

    const processedUsers = await usersCol.find(query).toArray();

    console.log(`Found ${processedUsers.length} processed users to rate`);

    for (let i = 0; i < processedUsers.length; i += BATCH_SIZE) {
      const batch = processedUsers.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch of ${batch.length} users (starting from index ${i})`
      );

      await Promise.all(
        batch.map(async (user) => {
          try {
            console.log(`[${user._id}] Starting rating process.`);

            let recentRepositories = user.recentRepositories;
            if (!recentRepositories) {
              console.log(
                `[${user._id}] Fetching recent repositories for ${user.profileUrl}`
              );
              recentRepositories = await fetchRecentRepositories(
                user._id,
                octokit
              );
              console.log(`[${user._id}] Fetched recent repositories.`);
              if (recentRepositories) {
                console.log(
                  `[${user._id}] Updating user with recent repositories in DB...`
                );
                await usersCol.updateOne(
                  { _id: user._id },
                  { $set: { recentRepositories } }
                );
                console.log(
                  `[${user._id}] Updated user with recent repositories in DB.`
                );
              }
            }

            const userData: UserData = {
              ...user,
              login: user._id,
              repoInteractionScraped: [],
              recentRepositories: recentRepositories || null,
            };

            console.log(`[${user._id}] Calling rateUserV3...`);
            const ratingData = await rateUserV3(userData, {
              openAI: {
                promptText: "",
                researchResult: "",
              },
              gemini: null,
            });
            console.log(`[${user._id}] Received data from rateUserV3.`);
            console.log(`[${user._id}] Updating user rating in DB...`);
            await usersCol.updateOne(
              { _id: user._id },
              {
                $set: {
                  rating: ratingData.score,
                  ratingReasoning: ratingData.reasoning,
                  criteriaScores: ratingData.criteriaScores,
                  criteriaReasonings: ratingData.criteriaReasonings,
                  webResearchInfoOpenAI: ratingData.webResearchInfoOpenAI,
                  webResearchInfoGemini: ratingData.webResearchInfoGemini,
                  webResearchPromptText: ratingData.webResearchPromptText,
                  engineerArchetype: ratingData.engineerArchetype,
                  inferredLocation: ratingData.inferredLocation,
                  ratedAt: new Date(),
                },
              }
            );
            console.log(`[${user._id}] Updated user rating in DB.`);

            console.log(
              `[${user._id}] Successfully rated https://github.com/${user._id} with score: ${ratingData.score}`
            );
          } catch (error) {
            console.error(
              `[${user._id}] Error rating user ${user._id}:`,
              error
            );
            // Continue with the next user in the batch
          }
        })
      );
      console.log(`Finished processing batch (starting from index ${i})`);
    }

    console.log("Finished rating all processed users");
  } catch (error) {
    console.error("Error in rating job:", error);
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  rateAllProcessedUsers().catch(console.error);
}
