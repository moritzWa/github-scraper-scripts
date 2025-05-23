import { Octokit } from "@octokit/core";
import { normalizeLocation } from "../../../utils/location.js";
import { withRateLimitRetry } from "../../../utils/prime-scraper-api-utils.js";
import {
  fetchProfileReadme,
  fetchRecentRepositories,
  fetchWebsiteContent,
  fetchXProfileMetadata,
} from "../../../utils/profile-data-fetchers.js";

export async function fetchBasicUserData(
  octokit: Octokit,
  username: string,
  depth: number
) {
  const userData = await withRateLimitRetry(() =>
    octokit.request("GET /users/{username}", {
      username,
    })
  );

  return {
    _id: userData.data.login,
    login: userData.data.login,
    profileUrl: userData.data.html_url || "",
    createdAt: userData.data.created_at,
    followers: userData.data.followers,
    following: userData.data.following,
    name: userData.data.name || null,
    bio: userData.data.bio || null,
    company: userData.data.company || null,
    blog: userData.data.blog || null,
    location: userData.data.location || null,
    normalizedLocation: normalizeLocation(userData.data.location) || null,
    email: userData.data.email || null,
    twitter_username: userData.data.twitter_username || null,
    xUrl: null,
    xBio: null,
    xName: null,
    xLocation: null,
    public_repos: userData.data.public_repos,
    contributions: null,
    profileReadme: null,
    websiteContent: null,
    recentRepositories: null,
    depth,
    repoInteractionScraped: [],
  };
}

export async function fetchAdditionalUserData(
  username: string,
  userData: any,
  octokit: Octokit
) {
  const [profileReadme, websiteContent, xProfile, recentRepositories] =
    await Promise.all([
      fetchProfileReadme(username),
      userData.blog
        ? fetchWebsiteContent(userData.blog)
        : Promise.resolve(null),
      userData.twitter_username
        ? fetchXProfileMetadata(userData.twitter_username)
        : Promise.resolve(null),
      fetchRecentRepositories(username, octokit),
    ]);

  return {
    profileReadme,
    websiteContent,
    xProfile,
    recentRepositories,
  };
}
