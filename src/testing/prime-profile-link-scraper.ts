import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import fs from "fs";
import { UserData } from "../types.js";
import { withRateLimitRetry } from "../utils/prime-scraper-api-utils.js";
import {
  fetchProfileReadme,
  fetchRecentRepositories,
  fetchWebsiteContent,
  fetchXProfileMetadata,
} from "../utils/profile-data-fetchers.js";
import { teamMembers } from "../variables.js";
import { normalizeLocation } from "../utils/location.js";

// Load environment variables
dotenv.config();

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });

// Extract username from GitHub URL
function extractUsername(url: string): string {
  // Remove trailing slash if present
  const cleanUrl = url.endsWith("/") ? url.slice(0, -1) : url;

  // Extract username from URL
  const parts = cleanUrl.split("/");
  return parts[parts.length - 1];
}

async function scrapeProfile(url: string): Promise<UserData | null> {
  try {
    // Extract username from URL
    const username = extractUsername(url);
    console.log(`Scraping profile for ${username} (from ${url})...`);

    // Fetch user data from GitHub API
    const userData = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}", {
        username,
      })
    );

    // Fetch additional profile data
    const [profileReadme, recentRepositories, websiteContent, xProfile] =
      await Promise.all([
        fetchProfileReadme(username),
        fetchRecentRepositories(username, octokit),
        userData.data.blog
          ? fetchWebsiteContent(userData.data.blog)
          : Promise.resolve(null),
        userData.data.twitter_username
          ? fetchXProfileMetadata(userData.data.twitter_username)
          : Promise.resolve(null),
      ]);

    // Normalize location
    const normalizedLocation = normalizeLocation(userData.data.location);

    // Create user profile object
    const userProfile: UserData = {
      login: userData.data.login,
      profileUrl: userData.data.html_url || "",
      createdAt: userData.data.created_at,
      followers: userData.data.followers,
      following: userData.data.following ?? 0,
      contributions: null,
      name: userData.data.name || null,
      bio: userData.data.bio || null,
      company: userData.data.company || null,
      blog: userData.data.blog || null,
      location: userData.data.location || null,
      normalizedLocation,
      email: userData.data.email || null,
      twitter_username: userData.data.twitter_username || null,
      xUrl: userData.data.twitter_username
        ? `https://x.com/${userData.data.twitter_username}`
        : null,
      xBio: xProfile?.bio || null,
      xName: xProfile?.name || null,
      xLocation: xProfile?.location || null,
      public_repos: userData.data.public_repos,
      repoInteractionScraped: [
        {
          scrapedFromUrl: url,
          interactionTypes: ["manual"],
        },
      ],
      profileReadme: profileReadme || null,
      websiteContent: websiteContent || null,
      recentRepositories: recentRepositories || [],
    };

    console.log(`Successfully scraped profile for ${username}`);
    return userProfile;
  } catch (error) {
    console.error(`Error scraping profile for ${url}:`, error);
    return null;
  }
}

async function scrapeAllProfiles() {
  const idealUsers: UserData[] = [];

  for (const url of teamMembers) {
    const userProfile = await scrapeProfile(url);
    if (userProfile) {
      idealUsers.push(userProfile);
    }
  }

  // Save to idealUsers.json
  fs.writeFileSync(
    "dataOutputs/idealUsers.json",
    JSON.stringify(idealUsers, null, 2)
  );

  console.log(`Saved ${idealUsers.length} profiles to idealUsers.json`);
}

// Run the scraper
scrapeAllProfiles()
  .then(() => console.log("Profile scraping completed!"))
  .catch(console.error);
