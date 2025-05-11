// It's a good practice to load environment variables from a .env file for local development
// import *dotenv* from 'dotenv';
// dotenv.config();

// If you are in an environment where fetch is not globally available (e.g., older Node.js versions),
// you might need to import it:
// import fetch from 'node-fetch';

interface Geo {
  country: string;
  city: string;
  full: string;
  countryCode: string;
}

interface Language {
  name: string;
  proficiency: string;
}

interface DateInfo {
  year: number;
  month: number;
  day: number;
}

interface LogoInfo {
  url: string;
  width: number;
  height: number;
}

interface Education {
  start: DateInfo;
  end: DateInfo;
  fieldOfStudy: string;
  degree: string;
  grade: string;
  schoolName: string;
  description: string;
  activities: string;
  url: string;
  schoolId: string;
  logo: LogoInfo[] | LogoInfo | null; // Can be an array or single object based on some APIs, or null
}

interface MultiLocaleText {
  [locale: string]: string;
}

interface Position {
  companyId: number | null; // Microsoft example has 1035, Waitlist has 76446298
  companyName: string;
  companyUsername: string;
  companyURL: string;
  companyLogo: string | null;
  companyIndustry: string;
  companyStaffCountRange: string;
  title: string;
  multiLocaleTitle: MultiLocaleText;
  multiLocaleCompanyName: MultiLocaleText;
  location: string;
  description: string;
  employmentType: string;
  start: DateInfo;
  end: DateInfo | null; // Current positions might not have an end date
}

interface Skill {
  name: string;
  passedSkillAssessment: boolean;
  endorsementsCount?: number; // Optional as per "Data Analysis"
}

interface Honor {
  title: string;
  description: string;
  issuer: string;
  issuerLogo: string;
  issuedOn: DateInfo;
}

interface LinkedInProfile {
  id: number;
  urn: string;
  username: string;
  firstName: string;
  lastName: string;
  isPremium: boolean;
  headline: string;
  geo: Geo;
  languages: Language[];
  educations: Education[];
  position: Position[];
  fullPositions: Position[]; // Assuming same structure as Position for now
  skills: Skill[];
  honors: Honor[];
  projects: Record<string, unknown>; // Or a more specific type if structure is known
  supportedLocales: Array<{ country: string; language: string }>;
  multiLocaleFirstName: MultiLocaleText;
  multiLocaleLastName: MultiLocaleText;
  multiLocaleHeadline: MultiLocaleText;
}

const RAPIDAPI_HOST = "linkedin-data-api.p.rapidapi.com";
const EXAMPLE_API_KEY = "0d3445840fmshb924d806f5383bdp122411jsn444d71ae4cf7"; // Replace with your key

// $175/month for up to 50k requests
async function fetchLinkedInExperienceViaRapidAPI(
  username: string
): Promise<LinkedInProfile | null> {
  const apiKey = process.env.RAPIDAPI_KEY || EXAMPLE_API_KEY;

  if (apiKey === EXAMPLE_API_KEY) {
    console.warn(
      "Warning: Using example RapidAPI key. Please set your RAPIDAPI_KEY environment variable for reliable use."
    );
  }
  if (!apiKey) {
    console.error(
      "Error: RAPIDAPI_KEY is not set. Please set this environment variable."
    );
    return null;
  }

  const options = {
    method: "GET",
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": RAPIDAPI_HOST,
    },
  };

  try {
    const response = await fetch(
      `https://${RAPIDAPI_HOST}/?username=${username}`,
      options
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Error fetching LinkedIn data for ${username}: ${response.status} ${response.statusText}`
      );
      console.error("Error response body:", errorBody);
      return null;
    }

    const data: LinkedInProfile = await response.json();
    return data;
  } catch (error) {
    console.error(
      `Failed to fetch LinkedIn experience for ${username}:`,
      error
    );
    return null;
  }
}

// Script execution part
(async () => {
  // The username is derived from the URL: and https://www.linkedin.com/in/banisgh/
  const targetUsername = "banisgh";

  console.log(
    `Fetching LinkedIn profile data for username (RapidAPI): ${targetUsername}...`
  );
  const profileDataRapidAPI = await fetchLinkedInExperienceViaRapidAPI(
    targetUsername
  );

  if (profileDataRapidAPI) {
    console.log("Successfully fetched LinkedIn Profile Data (RapidAPI):");
    console.log(JSON.stringify(profileDataRapidAPI, null, 2));
  } else {
    console.log(
      `Could not fetch LinkedIn profile data via RapidAPI for ${targetUsername}.`
    );
  }
})();

// To run this script, you might need ts-node:
// ... existing code ...
