/**
 * Test script to analyze scoring accuracy issues and validate fixes.
 *
 * Tests what data is shown to the LLM vs what's available,
 * and experiments with prompt/data changes to improve accuracy.
 *
 * Run: npx tsx src/graph-scraper/scripts/test-scoring-accuracy.ts
 */
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import {
  computeProfileBonus,
  computeStagnationBonus,
  computeTotalScore,
} from "../../config/company.js";
import { DbGraphUser } from "../types.js";

dotenv.config();

// ── helpers ──────────────────────────────────────────────────────────────
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`  PASS: ${msg}`);
  }
}

let failures = 0;
let testCount = 0;

function section(name: string) {
  testCount++;
  console.log(`\n── ${name} ──`);
}

// ── Test 1: computeProfileBonus ──────────────────────────────────────────
section("computeProfileBonus");

assert(computeProfileBonus() === 0, "undefined profile -> 0");
assert(computeProfileBonus({}) === 0, "empty profile -> 0");
assert(
  computeProfileBonus({ twitter_username: "foo" }) === 3,
  "twitter only -> 3"
);
assert(
  computeProfileBonus({ followers: 200 }) === 2,
  "200 followers (no twitter) -> 2"
);
assert(
  computeProfileBonus({ followers: 199 }) === 0,
  "199 followers -> 0 (threshold is >=200)"
);
assert(
  computeProfileBonus({ followers: 500, following: 1 }) === 3,
  "500 followers / 1 following -> 2 (followers) + 1 (ratio) = 3"
);
assert(
  computeProfileBonus({ twitter_username: "x", followers: 38612, following: 397 }) === 6,
  "antfu-like profile: twitter + 38k followers + ratio 97 -> max 6"
);
// antfu's actual data: twitter_username is NULL on GitHub
assert(
  computeProfileBonus({ twitter_username: null, followers: 38612, following: 397 }) === 3,
  "antfu actual: no twitter on GH + 38k followers + ratio -> only 3 (misses +3 twitter)"
);

// ── Test 2: computeStagnationBonus ───────────────────────────────────────
section("computeStagnationBonus");

assert(computeStagnationBonus(null) === 0, "no insights -> 0");
assert(
  computeStagnationBonus(
    { foundedYear: 2024, employeeCount: 3, headcountGrowth6m: 0, headcountGrowth1y: 0 },
    null,
    true
  ) === 0,
  "founder at 1yr old company -> 0 (too young)"
);
assert(
  computeStagnationBonus(
    { foundedYear: 2020, employeeCount: 3, headcountGrowth6m: -5, headcountGrowth1y: -10 },
    null,
    true
  ) === 6,
  "founder at 5yr old shrinking 3-person company -> max 6"
);
assert(
  computeStagnationBonus(
    { foundedYear: 2020, employeeCount: 5, headcountGrowth6m: -5, headcountGrowth1y: -10 },
    null,
    false
  ) === 3,
  "employee at shrinking small company -> max 3"
);
assert(
  computeStagnationBonus(
    { foundedYear: 2023, employeeCount: 50, headcountGrowth6m: 20, headcountGrowth1y: 50 },
    null,
    true
  ) === 0,
  "founder at growing 50-person company -> 0"
);

// ── Test 3: computeTotalScore scenarios ──────────────────────────────────
section("computeTotalScore edge cases");

// antfu: all criteria + bonus
const antfuCriteria: Record<string, number> = {
  startup_experience: 0, ai_agent_experience: 1, productivity_software: 1,
  financial_services: 0, education: 0, location: 0, builder_signal: 1,
  company_pedigree: 2, seniority_fit: 3, experience_level: 3,
  hireability: 3, role_fit: 2, tech_stack_fit: 3,
};
const antfuProfile = { twitter_username: null as string | null, followers: 38612, following: 397 };
const antfuScore = computeTotalScore(antfuCriteria, antfuProfile);
console.log(`  antfu current score: ${antfuScore} (criteria + profile bonus, no stagnation)`);
assert(antfuScore === 36, "antfu scores 36 with current criteria (confirmed low)");

// If builder_signal were correctly 3 instead of 1:
const antfuFixed = { ...antfuCriteria, builder_signal: 3 };
const antfuFixedScore = computeTotalScore(antfuFixed, antfuProfile);
console.log(`  antfu with builder_signal=3: ${antfuFixedScore}`);
assert(antfuFixedScore === 40, "builder_signal 3 adds +4 (weight 2x), score -> 40");

// If antfu also had twitter detected:
const antfuWithTwitter = computeTotalScore(
  antfuFixed,
  { ...antfuProfile, twitter_username: "antaborz" }
);
console.log(`  antfu with builder=3 + twitter: ${antfuWithTwitter}`);
assert(antfuWithTwitter === 43, "adding twitter bonus pushes to 43");

// ── Test 4: What data does the LLM actually see? ────────────────────────
section("LLM prompt data analysis (from DB)");

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const db = client.db(process.env.MONGODB_DB);
const usersCol = db.collection<DbGraphUser>("users");

// Check what data exists vs what LLM sees
const testUsers = ["antfu", "AJNandi", "habanzu", "LitMSCTBB", "mnida"];
for (const uid of testUsers) {
  const u = await usersCol.findOne({ _id: uid });
  if (!u) { console.log(`  ${uid}: NOT IN DB`); continue; }

  const hasLinkedin = !!u.linkedinUrl;
  const hasLinkedinExp = !!(u.linkedinExperience?.experiences?.length);
  const hasWebResearch = !!(u.webResearchInfoOpenAI);
  const hasBio = !!(u.bio);
  const hasProfileReadme = !!(u.profileReadme);
  const hasWebsite = !!(u.websiteContent);
  const hasXBio = !!(u.xBio);
  const repoCount = u.recentRepositories?.length ?? 0;
  const topRepoStars = u.recentRepositories
    ?.map((r: any) => r.stargazers_count || 0)
    .sort((a: number, b: number) => b - a)
    .slice(0, 3) ?? [];

  console.log(`\n  ${uid} (score: ${u.rating}):`);
  console.log(`    LinkedIn: ${hasLinkedin ? u.linkedinUrl : "MISSING"}`);
  console.log(`    LinkedIn exp: ${hasLinkedinExp ? u.linkedinExperience!.experiences.length + " roles" : "NONE"}`);
  console.log(`    Web research: ${hasWebResearch ? "yes" : "MISSING"}`);
  console.log(`    GitHub bio: ${hasBio ? `"${u.bio!.substring(0, 80)}"` : "MISSING"}`);
  console.log(`    Profile README: ${hasProfileReadme ? "yes" : "MISSING"}`);
  console.log(`    Website: ${hasWebsite ? "yes (" + u.websiteContent!.length + " chars)" : "MISSING"}`);
  console.log(`    X bio: ${hasXBio ? `"${u.xBio!.substring(0, 80)}"` : "MISSING"}`);
  console.log(`    Followers: ${u.followers} | Following: ${u.following} | Twitter: ${u.twitter_username || "null"}`);
  console.log(`    Repos in DB: ${repoCount} | Top stars: [${topRepoStars.join(", ")}]`);

  // What the LLM prompt currently SHOWS vs what's AVAILABLE but HIDDEN:
  const shownToLLM: string[] = [];
  const hiddenFromLLM: string[] = [];

  // Shown
  if (u.name || u.xName) shownToLLM.push("name");
  if (u.company) shownToLLM.push("company");
  if (u.xBio) shownToLLM.push("X bio");
  if (u.websiteContent) shownToLLM.push("website content");
  if (u.linkedinExperienceSummary) shownToLLM.push("LinkedIn summary");
  if (u.currentCompanyInsights) shownToLLM.push("company insights");
  if (u.webResearchInfoOpenAI) shownToLLM.push("web research");
  if (repoCount > 0) shownToLLM.push(`3 repos (no stars)`);

  // Hidden (available but not in prompt)
  if (u.bio) hiddenFromLLM.push(`bio: "${u.bio.substring(0, 60)}"`);
  if (u.profileReadme) hiddenFromLLM.push(`profile README (${u.profileReadme.length} chars)`);
  if (u.followers) hiddenFromLLM.push(`${u.followers} GitHub followers`);
  if (topRepoStars[0] > 0) hiddenFromLLM.push(`top repo: ${topRepoStars[0]} stars`);

  console.log(`    SHOWN to LLM: [${shownToLLM.join(", ")}]`);
  console.log(`    HIDDEN from LLM: [${hiddenFromLLM.join(", ")}]`);
}

// ── Test 5: LinkedIn match rate analysis ─────────────────────────────────
section("LinkedIn match rate for processed users");

const linkedinStats = await usersCol.aggregate([
  { $match: { status: "processed", rating: { $exists: true } } },
  {
    $group: {
      _id: null,
      total: { $sum: 1 },
      hasLinkedin: { $sum: { $cond: [{ $and: [{ $ne: ["$linkedinUrl", null] }, { $gt: [{ $strLenCP: { $ifNull: ["$linkedinUrl", ""] } }, 0] }] }, 1, 0] } },
      hasLinkedinExp: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$linkedinExperience.experiences", []] } }, 0] }, 1, 0] } },
      hasWebResearch: { $sum: { $cond: [{ $and: [{ $ne: ["$webResearchInfoOpenAI", null] }, { $gt: [{ $strLenCP: { $ifNull: ["$webResearchInfoOpenAI", ""] } }, 0] }] }, 1, 0] } },
      hasBio: { $sum: { $cond: [{ $and: [{ $ne: ["$bio", null] }, { $gt: [{ $strLenCP: { $ifNull: ["$bio", ""] } }, 0] }] }, 1, 0] } },
    },
  },
]).toArray();

if (linkedinStats.length > 0) {
  const s = linkedinStats[0];
  console.log(`  Total processed with rating: ${s.total}`);
  console.log(`  Has LinkedIn URL: ${s.hasLinkedin} (${Math.round(s.hasLinkedin / s.total * 100)}%)`);
  console.log(`  Has LinkedIn experience: ${s.hasLinkedinExp} (${Math.round(s.hasLinkedinExp / s.total * 100)}%)`);
  console.log(`  Has web research: ${s.hasWebResearch} (${Math.round(s.hasWebResearch / s.total * 100)}%)`);
  console.log(`  Has GitHub bio: ${s.hasBio} (${Math.round(s.hasBio / s.total * 100)}%)`);
}

// ── Test 6: Score impact of missing LinkedIn ─────────────────────────────
section("Score impact: users WITH vs WITHOUT LinkedIn");

const withLinkedin = await usersCol.aggregate([
  { $match: { status: "processed", rating: { $exists: true }, linkedinUrl: { $ne: null } } },
  { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
]).toArray();

const withoutLinkedin = await usersCol.aggregate([
  { $match: { status: "processed", rating: { $exists: true }, $or: [{ linkedinUrl: null }, { linkedinUrl: { $exists: false } }] } },
  { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
]).toArray();

if (withLinkedin.length && withoutLinkedin.length) {
  console.log(`  WITH LinkedIn: ${withLinkedin[0].count} users, avg score ${Math.round(withLinkedin[0].avg)}`);
  console.log(`  WITHOUT LinkedIn: ${withoutLinkedin[0].count} users, avg score ${Math.round(withoutLinkedin[0].avg)}`);
  console.log(`  Gap: ${Math.round(withLinkedin[0].avg - withoutLinkedin[0].avg)} points`);
}

// ── Test 7: How LinkedIn URLs are found ──────────────────────────────────
section("LinkedIn discovery method analysis");

// Check how many users have LinkedIn in their GitHub profile vs Brave search
const linkedinFromGithub = await usersCol.countDocuments({
  status: "processed",
  linkedinUrl: { $ne: null },
  // Users who have linkedin in their blog/bio/website fields
  $or: [
    { blog: { $regex: /linkedin\.com/i } },
    { bio: { $regex: /linkedin\.com/i } },
  ],
});

const totalWithLinkedin = await usersCol.countDocuments({
  status: "processed",
  linkedinUrl: { $ne: null, $exists: true },
});

console.log(`  LinkedIn from GitHub profile fields: ~${linkedinFromGithub}`);
console.log(`  LinkedIn from Brave search: ~${totalWithLinkedin - linkedinFromGithub}`);
console.log(`  Total with LinkedIn: ${totalWithLinkedin}`);

await client.close();

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(60)}`);
console.log(`Tests complete. ${failures} failures.`);
if (failures > 0) process.exit(1);
