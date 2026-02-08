import dotenv from "dotenv"; // Corrected dotenv import
dotenv.config(); // Load environment variables at the very top

// It's a good practice to load environment variables from a .env file for local development
// The lines below can be removed or kept commented as dotenv is now configured above
// import *dotenv* from 'dotenv';
// dotenv.config();

import { UserData } from "../../../types.js";
import { isLinkedInDomain } from "../../../utils/prime-scraper-api-utils.js";
import { GraphUser } from "../../types.js";
import openai from "../openai.js"; // Import the shared OpenAI client

// If you are in an environment where fetch is not globally available (e.g., older Node.js versions),
// you might need to import it:
// import fetch from 'node-fetch';

// Types for the Fresh LinkedIn Profile Data API (rapidapi.com/freshdata-freshdata-default/api/fresh-linkedin-profile-data)
interface LinkedInEducation {
  school: string;
  degree: string;
  field_of_study: string;
  date_range: string;
  start_year: string;
  end_year: string;
}

interface LinkedInExperience {
  company: string;
  title: string;
  location: string;
  description: string;
  date_range: string;
  duration: string;
  start_month: number;
  start_year: number;
  end_month: number | string;
  end_year: number | string;
  is_current: boolean;
  job_type: string;
  company_linkedin_url?: string;
}

export interface CompanyInsights {
  companyName: string;
  employeeCount: number | null;
  headcountGrowth6m: number | null;
  headcountGrowth1y: number | null;
  linkedinUrl: string;
}

export interface LinkedInProfile {
  full_name: string;
  headline: string;
  about: string | null;
  city: string;
  country: string;
  location: string;
  company: string;
  company_industry: string;
  experiences: LinkedInExperience[];
  educations: LinkedInEducation[];
}

const RAPIDAPI_HOST = "fresh-linkedin-profile-data.p.rapidapi.com";

export class RapidAPICreditsExhaustedError extends Error {
  constructor(status: number, body: string) {
    super(`RapidAPI credits exhausted (HTTP ${status}): ${body}`);
    this.name = "RapidAPICreditsExhaustedError";
  }
}

export async function fetchLinkedInData(user: GraphUser) {
  console.log(`[${user.login}] Attempting to find LinkedIn URL...`);

  // First try to find LinkedIn URL in profile data
  const linkedinUrl = findLinkedInUrlInProfileData(user);
  console.log(`[${user.login}] linkedinUrl from profile data:`, linkedinUrl);

  // If not found in profile data, try Brave search with optimized query
  if (!linkedinUrl) {
    console.log(`[${user.login}] Generating optimized search query...`);
    const optimizedQuery = await generateOptimizedSearchQuery(user);
    console.log(`[${user.login}] Optimized query:`, optimizedQuery);

    const braveLinkedinUrl = await fetchLinkedInProfileUsingBrave(
      user,
      optimizedQuery
    );
    if (braveLinkedinUrl) {
      user.linkedinUrl = braveLinkedinUrl;
      console.log(
        `[${user.login}] Found LinkedIn URL via Brave: ${braveLinkedinUrl}`
      );
    } else {
      console.log(`[${user.login}] Could not find LinkedIn URL.`);
    }
  } else {
    user.linkedinUrl = linkedinUrl;
    console.log(
      `[${user.login}] Found LinkedIn URL in profile data: ${linkedinUrl}`
    );
  }

  if (user.linkedinUrl && !user.linkedinExperience) {
    console.log(`[${user.login}] Fetching LinkedIn experience...`);
    const linkedinExperience = await fetchLinkedInExperienceViaRapidAPI(
      user.linkedinUrl
    );
    user.linkedinExperience = linkedinExperience;
  }

  if (user.linkedinExperience && !user.linkedinExperienceSummary) {
    console.log(`[${user.login}] Generating LinkedIn experience summary...`);
    const linkedinExperienceSummary = await generateLinkedInExperienceSummary(
      user.linkedinExperience
    );
    user.linkedinExperienceSummary = linkedinExperienceSummary;
  }

  // Fetch company insights for founders/CEOs
  if (user.linkedinExperience && !user.currentCompanyInsights) {
    const companyInsights = await fetchCurrentEmployerInsights(user);
    user.currentCompanyInsights = companyInsights;
  }
}

// Fresh LinkedIn Profile Data API
export async function fetchLinkedInExperienceViaRapidAPI(
  url: string
): Promise<LinkedInProfile | null> {
  const apiKey = process.env.RAPIDAPI_KEY;

  if (!apiKey) {
    console.error(
      "Error: RAPIDAPI_KEY is not set. Please set this environment variable."
    );
    return null;
  }

  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  const username = match ? match[1] : url;

  const options = {
    method: "GET",
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": RAPIDAPI_HOST,
    },
  };

  try {
    const response = await fetch(
      `https://${RAPIDAPI_HOST}/enrich-lead?linkedin_url=${encodeURIComponent(url)}&include_skills=false&include_certifications=false&include_publications=false&include_honors=false&include_volunteers=false&include_projects=false&include_patents=false&include_courses=false&include_organizations=false&include_profile_status=false&include_company_public_url=true`,
      options
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Error fetching LinkedIn data for ${username}: ${response.status} ${response.statusText}`
      );
      console.error("Error response body:", errorBody);

      // Throw on credit exhaustion so the scraper can exit gracefully
      if (response.status === 402 || response.status === 429) {
        throw new RapidAPICreditsExhaustedError(response.status, errorBody);
      }
      return null;
    }

    const json = await response.json();
    if (!json.data) {
      console.error(`No data in LinkedIn response for ${username}`);
      return null;
    }

    // Extract only the fields we need
    const d = json.data;
    const profile: LinkedInProfile = {
      full_name: d.full_name || "",
      headline: d.headline || "",
      about: d.about || null,
      city: d.city || "",
      country: d.country || "",
      location: d.location || "",
      company: d.company || "",
      company_industry: d.company_industry || "",
      experiences: (d.experiences || []).map((e: any) => ({
        company: e.company || "",
        title: e.title || "",
        location: e.location || "",
        description: e.description || "",
        date_range: e.date_range || "",
        duration: e.duration || "",
        start_month: e.start_month || 0,
        start_year: e.start_year || 0,
        end_month: e.end_month || "",
        end_year: e.end_year || "",
        is_current: e.is_current || false,
        job_type: e.job_type || "",
        company_linkedin_url: e.company_linkedin_url || undefined,
      })),
      educations: (d.educations || []).map((e: any) => ({
        school: e.school || "",
        degree: e.degree || "",
        field_of_study: e.field_of_study || "",
        date_range: e.date_range || "",
        start_year: e.start_year || "",
        end_year: e.end_year || "",
      })),
    };

    return profile;
  } catch (error) {
    console.error(
      `Failed to fetch LinkedIn experience for ${username}:`,
      error
    );
    return null;
  }
}

// --- Company Insights ---

const FOUNDER_TITLE_KEYWORDS = [
  "founder",
  "co-founder",
  "cofounder",
  "ceo",
  "cto",
  "cpo",
  "coo",
  "owner",
  "building something new",
];

async function fetchCompanyByLinkedInUrl(
  companyLinkedinUrl: string
): Promise<{ companyId: string; companyName: string } | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://${RAPIDAPI_HOST}/get-company-by-linkedinurl?linkedin_url=${encodeURIComponent(companyLinkedinUrl)}`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      }
    );

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 402 || response.status === 429) {
        throw new RapidAPICreditsExhaustedError(response.status, body);
      }
      console.error(
        `[CompanyInsights] get-company-by-linkedinurl failed: ${response.status}`,
        body
      );
      return null;
    }

    const json = await response.json();
    const data = json.data;
    if (!data?.company_id) return null;

    return {
      companyId: data.company_id,
      companyName: data.company_name || "",
    };
  } catch (error) {
    if (error instanceof RapidAPICreditsExhaustedError) throw error;
    console.error("[CompanyInsights] Error fetching company by URL:", error);
    return null;
  }
}

async function fetchCompanyInsightsById(
  companyId: string
): Promise<{ employeeCount: number | null; headcountGrowth6m: number | null; headcountGrowth1y: number | null } | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://${RAPIDAPI_HOST}/get-company-insights?company_id=${encodeURIComponent(companyId)}`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      }
    );

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 402 || response.status === 429) {
        throw new RapidAPICreditsExhaustedError(response.status, body);
      }
      console.error(
        `[CompanyInsights] get-company-insights failed: ${response.status}`,
        body
      );
      return null;
    }

    const json = await response.json();
    const data = json.data;
    if (!data) return null;

    // Parse percentage strings like "133%" to numbers
    const parseGrowth = (val: string | undefined): number | null => {
      if (!val) return null;
      const num = parseInt(val.replace("%", ""), 10);
      return isNaN(num) ? null : num;
    };

    return {
      employeeCount: data.total_employees ?? null,
      headcountGrowth6m: parseGrowth(data.headcount_growth?.["6m"]),
      headcountGrowth1y: parseGrowth(data.headcount_growth?.["1y"]),
    };
  } catch (error) {
    if (error instanceof RapidAPICreditsExhaustedError) throw error;
    console.error("[CompanyInsights] Error fetching company insights:", error);
    return null;
  }
}

export async function fetchCurrentEmployerInsights(
  user: Pick<GraphUser, "login" | "linkedinExperience">
): Promise<CompanyInsights | null> {
  if (!user.linkedinExperience?.experiences) return null;

  // Find current role
  const currentExp = user.linkedinExperience.experiences.find(
    (e) => e.is_current
  );
  if (!currentExp) return null;

  // Check if title contains founder/CEO/CTO keywords
  const titleLower = currentExp.title.toLowerCase();
  const isFounderOrExec = FOUNDER_TITLE_KEYWORDS.some((kw) =>
    titleLower.includes(kw)
  );
  if (!isFounderOrExec) return null;

  // Skip "Stealth" companies
  const companyLower = currentExp.company.toLowerCase().trim();
  if (companyLower === "stealth" || companyLower.startsWith("stealth ")) {
    console.log(
      `[${user.login}] Skipping company insights for stealth company`
    );
    return null;
  }

  // Need company LinkedIn URL to fetch insights
  if (!currentExp.company_linkedin_url) {
    console.log(
      `[${user.login}] No company LinkedIn URL for ${currentExp.company}`
    );
    return null;
  }

  console.log(
    `[${user.login}] Fetching company insights for ${currentExp.company} (${currentExp.title})...`
  );

  // Step 1: Get company ID
  const companyInfo = await fetchCompanyByLinkedInUrl(
    currentExp.company_linkedin_url
  );
  if (!companyInfo) return null;

  // Step 2: Get company insights
  const insights = await fetchCompanyInsightsById(companyInfo.companyId);
  if (!insights) return null;

  const result: CompanyInsights = {
    companyName: companyInfo.companyName || currentExp.company,
    employeeCount: insights.employeeCount,
    headcountGrowth6m: insights.headcountGrowth6m,
    headcountGrowth1y: insights.headcountGrowth1y,
    linkedinUrl: currentExp.company_linkedin_url,
  };

  console.log(
    `[${user.login}] Company insights for ${result.companyName}: ${result.employeeCount} employees, 6m growth: ${result.headcountGrowth6m}%, 1y growth: ${result.headcountGrowth1y}%`
  );

  return result;
}

export async function fetchLinkedInProfileUsingOpenai(
  user: UserData
): Promise<string | null> {
  try {
    const prompt = `Find the LinkedIn profile URL for ${
      user.name || user.login
    } (Software Engineer).
  Use the following information for disambiguation if multiple profiles are found:
  ${user.email ? `- Email: ${user.email}` : ""}
  ${user.xBio || user.bio ? `- Bio hints: ${user.xBio || user.bio}` : ""}
  Return ONLY the full LinkedIn profile URL. If you cannot confidently identify the correct profile, return null.`;

    const response = await openai.responses.create({
      model: "gpt-4.1",
      tools: [
        {
          type: "web_search_preview",
          search_context_size: "medium",
          user_location: {
            type: "approximate" as const,
            country: "US",
            region: "CA",
            city: "San Francisco",
          },
        },
      ],
      input: prompt,
    });

    console.log("fetchLinkedInProfile response", response);

    const result = response.output_text?.trim() || null;
    return result === "null" ? null : result;
  } catch (error) {
    console.error(`Error fetching LinkedIn profile for ${user.login}:`, error);
    return null;
  }
}

export async function fetchLinkedInProfileUsingGemini(
  user: UserData
): Promise<string | null> {
  const promptText = `Find the LinkedIn profile URL for ${
    user.name || user.login
  } (Software Engineer).
Use the following information for disambiguation if multiple profiles are found:
${user.email ? `- Email: ${user.email}` : ""}
${user.xBio || user.bio ? `- Bio hints: ${user.xBio || user.bio}` : ""}
Return ONLY the full LinkedIn profile URL. If you cannot confidently identify the correct profile, return null.`;

  try {
    if (!process.env.GOOGLE_API_KEY) {
      console.error(
        "Error: GOOGLE_API_KEY is not set. Please set this environment variable."
      );
      return null;
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        process.env.GOOGLE_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // System instruction might not be available or needed for all Gemini models/tasks
          // If it causes issues or isn't desired for this specific profile lookup, it can be removed.
          system_instruction: {
            parts: [
              {
                text: "You are an assistant that finds LinkedIn profile URLs.",
              },
            ],
          },
          contents: [
            {
              parts: [{ text: promptText }],
            },
          ],
          tools: [
            // Ensuring the tool for web search is included
            {
              google_search: {}, // Using google_search as per the web-research.ts example
            },
          ],
          generationConfig: {
            // Adding generationConfig to try and get plain text
            response_mime_type: "text/plain",
          },
        }),
      }
    );

    console.log("fetchLinkedInProfileUsingGemini response", response);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        "Google API Error in fetchLinkedInProfileUsingGemini:",
        response.status,
        errorBody
      );
      return null; // Return null on API error
    }

    const completion = await response.json(); // Assuming response is JSON, adjust if plain text

    // Based on web-research.ts, the structure might be nested.
    // The direct text might be in response.text() if response_mime_type: "text/plain" works as expected.
    // If response is JSON (default for generateContent), then parse parts.
    let resultText = "";
    if (
      completion.candidates &&
      completion.candidates[0] &&
      completion.candidates[0].content &&
      completion.candidates[0].content.parts &&
      completion.candidates[0].content.parts[0]
    ) {
      resultText = completion.candidates[0].content.parts[0].text;
    } else if (typeof completion === "string") {
      // Fallback if response_mime_type: "text/plain" returns direct string
      resultText = completion;
    } else {
      console.error(
        "Unexpected response structure from Gemini API in fetchLinkedInProfileUsingGemini:",
        JSON.stringify(completion, null, 2)
      );
      return null;
    }

    const result = resultText.trim();

    console.log("fetchLinkedInProfile (Gemini) response raw text:", result);

    if (
      result === "null" ||
      result === "" ||
      !result.includes("linkedin.com")
    ) {
      return null;
    }
    return result;
  } catch (error) {
    console.error(
      `Error fetching LinkedIn profile with Gemini for ${user.login}:`,
      error
    );
    return null;
  }
}

// Define Perplexity response structure based on the provided snippet
interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PerplexityChoice {
  index: number;
  message: PerplexityMessage;
  finish_reason?: string; // Optional, as it might not always be present or needed
}

interface PerplexityResponse {
  id?: string; // Optional fields based on typical API responses
  model?: string;
  object?: string;
  created?: number;
  choices: PerplexityChoice[];
  usage?: unknown; // Define more specifically if needed
}

export async function fetchLinkedInProfileUsingPerplexity(
  user: UserData
): Promise<string | null> {
  const question = `Find the LinkedIn profile URL for ${
    user.name || user.login
  } (Software Engineer).
Use the following information for disambiguation if multiple profiles are found:
${user.email ? `- Email: ${user.email}` : ""}
${user.xBio || user.bio ? `- Bio hints: ${user.xBio || user.bio}` : ""}
Return ONLY the full LinkedIn profile URL as a string.`;

  const SYSTEM_PROMPT = `You are an expert assistant specialized in finding LinkedIn profile URLs using web search. You only return the URL as a string, or the string "null" if no suitable profile is found.`;

  console.log("fetchLinkedInProfileUsingPerplexity question", question);

  try {
    if (!process.env.PERPLEXITY_API_KEY) {
      console.error(
        "Error: PERPLEXITY_API_KEY is not set. Please set this environment variable."
      );
      return null;
    }

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: question,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Perplexity API Error:", response.status, errorBody);
      return null;
    }

    const completion = (await response.json()) as PerplexityResponse;
    console.log(
      "fetchLinkedInProfile (Perplexity) raw completion:",
      JSON.stringify(completion, null, 2)
    );

    if (
      completion.choices &&
      completion.choices.length > 0 &&
      completion.choices[0].message &&
      completion.choices[0].message.content
    ) {
      const resultText = completion.choices[0].message.content.trim();
      console.log("fetchLinkedInProfile (Perplexity) result text:", resultText);
      if (
        resultText.toLowerCase() === "null" ||
        !resultText.includes("linkedin.com")
      ) {
        return null;
      }
      return resultText;
    } else {
      console.error(
        "Invalid or empty response from Perplexity API:",
        completion
      );
      return null;
    }
  } catch (error) {
    console.error(
      `Error fetching LinkedIn profile with Perplexity for ${user.login}:`,
      error
    );
    return null;
  }
}

interface BraveSearchResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  query: {
    original: string;
  };
  web?: {
    results: BraveSearchResult[];
  };
}

// Global promise chain to serialize Brave API calls
let braveApiCallQueue = Promise.resolve();

// Helper function to schedule tasks on the braveApiCallQueue with a delay
async function scheduleBraveApiCall<T>(task: () => Promise<T>): Promise<T> {
  // Wait for the current end of the queue, then execute the task
  const taskPromise = braveApiCallQueue.then(task);

  // The next operation on the queue must wait for this task to settle (succeed or fail),
  // and then wait for the specified delay.
  braveApiCallQueue = taskPromise
    .catch(() => {
      // Prevent an error in one task from breaking the entire queue chain.
      // The error will still be propagated to the caller of scheduleBraveApiCall.
    })
    .then(() => new Promise((resolve) => setTimeout(resolve, 1100))); // Keep 1.1s delay for now

  return taskPromise;
}

async function withBraveRateLimitRetry(
  fetchFn: () => Promise<Response>, // The function that performs the fetch
  maxRetries: number = 3 // Reduced maxRetries as serialization should help
): Promise<Response> {
  let retryCount = 0;
  let lastError: Error | null = null;
  let firstRateLimitErrorBody: string | null = null; // Variable to store the first 429 error body

  while (retryCount <= maxRetries) {
    // <= to allow initial attempt + maxRetries
    let response: Response;
    try {
      response = await fetchFn();

      if (response.ok) {
        return response;
      }

      // Not OK, handle retryable errors
      if (
        response.status === 429 ||
        (response.status >= 500 && response.status < 600)
      ) {
        lastError = new Error(
          `Brave API request failed with status ${response.status}`
        );
        const isRateLimit = response.status === 429;
        let waitTimeMs: number;

        // Capture the body of the first 429 error
        if (isRateLimit && !firstRateLimitErrorBody) {
          try {
            firstRateLimitErrorBody = await response.text(); // Store the body
          } catch (bodyError) {
            firstRateLimitErrorBody =
              "(Failed to read error body for first 429)";
          }
        } else if (isRateLimit) {
          // For subsequent 429s, still consume the body but don't overwrite the first captured body
          try {
            await response.text();
          } catch (_) {
            /* ignore */
          }
        } else {
          // For non-429 errors that are retryable (e.g. 5xx), consume body if not already done for 429 check
          try {
            await response.text();
          } catch (_) {
            /* ignore */
          }
        }

        const resetTimestampHeader = response.headers.get("X-RateLimit-Reset");
        if (isRateLimit && resetTimestampHeader) {
          const resetTimeEpochSeconds = parseInt(resetTimestampHeader, 10);
          if (!isNaN(resetTimeEpochSeconds)) {
            const resetTimeMs = resetTimeEpochSeconds * 1000;
            const currentTimeMs = Date.now();
            const calculatedDiffWait = Math.max(
              1000,
              resetTimeMs - currentTimeMs
            );
            waitTimeMs = calculatedDiffWait + 500;
            console.log(
              `Brave API: Rate limit. Using X-RateLimit-Reset. Calculated base diff wait: ${
                Math.max(0, resetTimeMs - currentTimeMs) / 1000
              }s. Enforced diff wait: ${
                calculatedDiffWait / 1000
              }s. Total wait: ${waitTimeMs / 1000}s.`
            );
          } else {
            waitTimeMs =
              Math.pow(2, retryCount) * 1500 + (retryCount === 0 ? 2000 : 1000);
            console.log(
              `Brave API: Rate limit. X-RateLimit-Reset parse error. Fallback wait ${(
                waitTimeMs / 1000
              ).toFixed(1)}s.`
            );
          }
        } else {
          const baseFirstRetryWait = isRateLimit && retryCount === 0 ? 2000 : 0;
          waitTimeMs =
            Math.pow(2, retryCount) * 1500 +
            (isRateLimit ? 1000 : 0) +
            baseFirstRetryWait;
          console.log(
            `Brave API: Status ${
              response.status
            } (no X-RateLimit-Reset or server error). Fallback wait ${(
              waitTimeMs / 1000
            ).toFixed(1)}s.`
          );
        }

        waitTimeMs = Math.min(waitTimeMs, 30000);

        console.log(
          `Brave API: Status ${response.status}. Attempt ${retryCount + 1}/${
            maxRetries + 1
          }. Retrying in ${waitTimeMs / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
        retryCount++;
        continue;
      } else {
        // Non-retryable error status (e.g., 400, 401, 404)
        console.warn(
          `Brave API: Non-retryable status ${response.status}. Returning response to caller.`
        );
        return response; // Return the problematic response to the caller
      }
    } catch (error: any) {
      // Network error or other error during fetchFn()
      lastError = error;
      console.warn(
        `Brave API: Network error or fetchFn issue: ${error.message}. Attempt ${
          retryCount + 1
        }/${maxRetries + 1}.`
      );
      const waitTimeMs = Math.min(Math.pow(2, retryCount) * 1000 + 1000, 30000); // Base 1s + exponential
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
      retryCount++;
      continue;
    }
  }

  // All retries exhausted
  const errorMessage = `Brave API: All ${
    maxRetries + 1
  } retries failed. Last error: ${
    lastError ? lastError.message : "Unknown error after retries."
  }${
    firstRateLimitErrorBody
      ? ` First 429 error body: ${firstRateLimitErrorBody}`
      : ""
  }`;
  console.error(errorMessage);
  if (lastError) {
    // Augment the original error with the detailed message if possible
    lastError.message = errorMessage;
    throw lastError;
  }
  throw new Error(errorMessage); // Fallback error
}

export async function fetchLinkedInProfileUsingBrave(
  user: UserData,
  optimizedQuery?: string
): Promise<string | null> {
  const performFetchTask = async () => {
    const searchQuery = optimizedQuery
      ? `site:linkedin.com/in/ ${optimizedQuery}`
      : `site:linkedin.com/in/ ${user.name || user.login} ${
          user.email ? `email:${user.email}` : ""
        } ${user.xBio || user.bio || ""} (Software Engineer)`;

    try {
      if (!process.env.BRAVE_API_KEY) {
        console.error(
          "Error: BRAVE_API_KEY is not set. Please set this environment variable."
        );
        return null;
      }

      const headers: HeadersInit = {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": process.env.BRAVE_API_KEY,
      };

      const fetchLambda = () =>
        fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
            searchQuery
          )}&count=5&safesearch=moderate`,
          {
            method: "GET",
            headers,
          }
        );

      const response = await withBraveRateLimitRetry(fetchLambda);

      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch (e) {
          errorBody = "(Failed to read error body)";
        }
        console.error(
          `Brave API Error (final status ${response.status} after retry logic) for ${user.login}:`,
          errorBody
        );
        return null;
      }

      const data = (await response.json()) as BraveSearchResponse;

      if (data.web?.results) {
        for (const result of data.web.results) {
          if (result.url.includes("linkedin.com/in/")) {
            const linkedinUrl = result.url.split("?")[0];
            return linkedinUrl;
          }
        }
      }
      return null;
    } catch (error: any) {
      console.error(
        `Failed to fetch LinkedIn profile with Brave for ${user.login} after all retries:`,
        error.message
      );
      return null;
    }
  };

  // Use the new scheduleBraveApiCall helper
  return scheduleBraveApiCall(performFetchTask);
}

export async function generateLinkedInExperienceSummary(
  profile: LinkedInProfile
): Promise<string | null> {
  if (!profile) return null;

  let summary = "";

  if (profile.headline) {
    summary += `Headline: ${profile.headline}\n`;
  }
  if (profile.about) {
    summary += `About: ${profile.about.slice(0, 500)}\n`;
  }

  // Education
  if (profile.educations && profile.educations.length > 0) {
    summary += "\nEducation:\n";
    for (const edu of profile.educations) {
      const parts = [edu.degree, edu.field_of_study].filter(Boolean);
      summary += `- ${edu.school}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
      if (edu.date_range) summary += ` ${edu.date_range}`;
      summary += "\n";
    }
  }

  // Experiences (most recent first, already sorted by API)
  if (profile.experiences && profile.experiences.length > 0) {
    summary += "\nExperience:\n";
    for (const exp of profile.experiences) {
      summary += `- ${exp.title} at ${exp.company}`;
      if (exp.date_range) summary += ` (${exp.date_range})`;
      if (exp.duration) summary += ` [${exp.duration}]`;
      summary += "\n";
      if (exp.location) summary += `  Location: ${exp.location}\n`;
      if (exp.description) {
        summary += `  ${exp.description.replace(/\n+/g, " ").slice(0, 300)}\n`;
      }
    }
  }

  return summary.trim() || null;
}

export async function generateOptimizedSearchQuery(
  user: UserData
): Promise<string> {
  // Get recent repositories if available
  const recentRepos =
    user.recentRepos
      ?.slice(0, 2)
      .map((repo: { name: string }) => repo.name)
      .join(", ") || "Not provided";

  const prompt = `You are a skilled detective specializing in finding people's LinkedIn profiles of Software Engineers. Your task is to craft the perfect search query that will lead us to the correct LinkedIn profile.

You have access to various clues about the person:
- Their GitHub username and display name
- Their email address (which might contain their full name)
- Their bio and social media presence
- Their current and past roles
- Their recent repositories: ${recentRepos}

Your mission is to combine these clues into a precise search query that will help us find their LinkedIn profile. Think like a detective - what unique combinations of information would make this person stand out in a search?

IMPORTANT RULES:
1. Keep the search query extremely concise - maximum 6 words
2. Focus ONLY on name and current/most notable role
3. Ignore historical roles, minor contributions, or technical details
4. Format your response exactly as:
REASONING: [Your detective work here]
QUERY: [Your 6-word-or-less search query]

Here are some examples of how you've solved similar cases:

Case 1:
Clues:
- Name: Aman Karmani
- Email: aman@tmm1.net
- Bio: building Cursor @anysphere. full stack tinkerer and perf nerd. formerly vp of infra @github + ruby-core committer. founder @getchannels + ffmpeg committer.
- Recent Repos: cursor, anysphere

REASONING: The bio contains too much information that could confuse the search. We should focus only on their current role at Cursor and their most notable position at GitHub.
QUERY: Aman Karmani Cursor VP

case 2:
Clues:
- Name: Jeff Huber
- Recent Repos: chroma-doom, jekyll-bootstrap-boilerplate
- Bio: Not provided

REASONING: Chroma DB is a popular vector database. This might be a hint. As always when we dont have much information we add "Software Engineer" to the query.
QUERY: Jeff Huber Chroma Software Engineer

Case 3:
Clues:
- Name: JannikSt
- Email: info@jannik-straube.de
- Bio: Software Engineer
- Recent Repos: Not provided

REASONING: The GitHub username is incomplete, but we can extract their full name from the email. Their role is already concise and clear.
QUERY: Jannik Straube Software Engineer

Current Case:
Clues:
- Name: ${user.name || user.login}
- Email: ${user.email || "Not provided"}
- Bio: ${user.bio || "Not provided"}
- Company: ${user.company || "Not provided"}
- X Bio: ${user.xBio || "Not provided"}
- Recent Repos: ${recentRepos}

What's your solution, detective? Format response exactly as:
REASONING: [Your detective work here]
QUERY: [Your 6-word-or-less search query]`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });

    const result = response.choices[0]?.message?.content?.trim() || "";
    // Extract just the query part, ignoring the reasoning
    const queryMatch = result.match(/QUERY:\s*(.+)/i);
    return queryMatch ? queryMatch[1].trim() : "";
  } catch (error) {
    console.error("Error generating optimized search query:", error);
    return "";
  }
}

export function findLinkedInUrlInProfileData(user: UserData): string | null {
  // Check blog field first
  if (user.blog && isLinkedInDomain(user.blog)) {
    return user.blog;
  }

  // Check profile readme for LinkedIn URLs
  if (user.profileReadme) {
    const linkedinPatterns = [
      /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+/g,
      /https?:\/\/(?:www\.)?linkedin\.com\/profile\/[a-zA-Z0-9-]+/g,
      /https?:\/\/lnkd\.in\/[a-zA-Z0-9-]+/g,
    ];

    for (const pattern of linkedinPatterns) {
      const matches = user.profileReadme.match(pattern);
      if (matches && matches.length > 0) {
        return matches[0].split("?")[0];
      }
    }
  }

  return null;
}

// Removed example script execution block that was here
