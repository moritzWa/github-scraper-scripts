import { config } from "dotenv";
import { OpenAI } from "openai";
import { UserData } from "../types.js";

config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const webResearchInfoPrompt = (user: UserData) =>
  `In a few bullet points tell me more about the background and skills of ${
    user.name
  } (Software Engineer). ${user.xBio || user.bio ? "Their bio reads:" : ""} ${
    user.xBio ? user.xBio : user.bio ? user.bio : ""
  }${
    user.blog ? `Blog is: ${user.blog}` : ""
  }. If you can't identify the person based on the above information, just say "No additional information found." Focus on previous company experience, interests, and current role. No need for complete sentences. Max 250 words.`;

async function getWebResearchInfo(user: UserData) {
  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search_preview",
          search_context_size: "medium", // balanced context and cost
        },
      ],
      input: webResearchInfoPrompt(user),
    });

    return response.output_text;
  } catch (error) {
    console.error("Error performing web research:", error);
    return "No additional information found.";
  }
}

const getUserName = (user: UserData) =>
  `${user.name || user.login} ${user.xName ? `(${user.xName})` : ""}`;

const RatingPrompt = (
  webResearchInfo: string,
  user: UserData
) => `I'm hiring for several roles for my series A Founders Fund-backed decentralised AI training startup.

We are reviewing GitHub profiles and making educated guesses (using a point system) about how good of a fit these engineers are.
1. Bio & Location: We'll use the github bio, readme, and twitter profile information to learn about their background and interest. 
2. Repositories: There are often helpful to asses if a user has shown interest in topics related to our company or is a potential cultural fit. 
4. Web Research: We want young, startup hustlers, NOT big-tech-wagies or academics, people that are excited about startups, crypto, and LLMs, ideally people that are already living in SF or likely to move there.
5. Role Fit: We are hiring for Full-Stack, SRE/Infra, AI Agent Engineers. Give negative points for Investors, Eng Managers, PMs, designers, etc. 

Help me output a final score between -100 and 100 for the user.

Example 1: 
---
GitHub Profile:
Name: Xiangyi Li
Company: AI Consultant
Location: New York
Recent Repos:
- deep-learning-papers (Collection of academic ML papers)
- tensorflow-experiments (Research implementations)
- consulting-projects (Enterprise ML solutions)
Web Research: Principal Research Scientist at Meta AI (2010-2022). PhD in Computer Science from Stanford (2005). Previously Research Staff at IBM Watson. Currently independent consultant for AI companies on ML/AI implementation. Published 10+ papers in top ML conferences.

REASONING CALCULATION: Same country, but not in SF (-10), purely academic (-10), big tech background (-15), likely older than 30 and thus less hard working (-20), senior management/consulting focus (-10), no startup (-10) or crypto experience (-15), displayed intellectual interest in AI (+5)
SCORE: -50
---
Example 2:
---
GitHub Profile:
Name: Jannik St
Company: @PrimeIntellect-ai
Location: San Francisco
Recent Repos: 
- python-nomad (Client library Hashicorp Nomad)
- AI-Scientist (The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery 🧑‍🔬)
- kinema (Holistic rescheduling system for Kubernetes to optimize cluster utilization)
- react-big-calendar (gcal/outlook like calendar component
Web Research: Founded vystem.io (acquired 2023), a WebRTC-based video platform scaling to 10K+ concurrent users. MS in Information Systems from TU Munich, thesis on Kubernetes scheduling. Previously at IBM in USA/Germany dual program. Strong background in distributed systems, cloud infrastructure, and AI compute orchestration. Currently building decentralized AI training infrastructure at Prime Intellect.

REASONING CALCULATION: SF-based (+20), prev co-founder of startup and now at Prime Intellect i.e. ai startup (+20), displayed interest in Agentic AI (AI Scientist), decentralized AI (current role at Prime) (+20), and infra (Kubernetes cluster utilization) (+20)
SCORE: 85
---
Example 3: 
---
GitHub Profile:
Name: Mitchell Catoen
Company: @Phantom
Location: San Francisco
Recent Repos:
- self-custody (Building self-custody for the masses)
- ai-research-platform (AI-enabled research platform)
- lms-ranking (Google LMS ranking systems)
Web Research: Staff Software Engineer at Phantom building self-custody solutions. Previously co-founded Phonic (acquired by Infillion), an AI-enabled research platform for qualitative research at scale. Built ranking systems at Google under LMS team. Mechatronics & Robotics background from Waterloo. YC W20 alum.

REASONING CALCULATION: SF-based (+20), YC founder with successful exit (+25), building self-custody/crypto infrastructure (+20), AI platform experience (+15), elite tech background (Google + Waterloo) (+10)
SCORE: 90
---
Engineer in question:
Name: ${getUserName(user)}
${user.company ? `Company: ${user.company}` : ""}
${user.location ? `Location: ${user.location}` : ""}
Recent Repos: ${
  user.recentRepositories
    ?.slice(0, 3)
    .map(
      (repo) =>
        `- ${repo.name}${repo.description ? ` (${repo.description})` : ""}`
    )
    .join("\n") || ""
}
Web Research: ${webResearchInfo}
----
Format response exactly as:
REASONING CALCULATION: [mimic caclulation like Example above here. Use the same format with numbers in parenthesis]
SCORE: [between -100 and 100]
`;

// Export a new async function rateUserV2 that takes a UserData object and returns a Promise<{ reasoning: string; score: number }>
export async function rateUserV2(
  user: UserData
): Promise<{ reasoning: string; score: number; webResearchInfo: string }> {
  const webResearchInfo = await getWebResearchInfo(user);
  const ratingPrompt = RatingPrompt(webResearchInfo, user);
  const ratingResult = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: ratingPrompt }],
  });
  const response = ratingResult.choices[0]?.message?.content || "";
  const reasoningMatch = response.match(/REASONING CALCULATION: (.*)/);
  const scoreMatch = response.match(/SCORE: (\d+)/);
  return {
    reasoning: reasoningMatch
      ? reasoningMatch[1].trim()
      : "No reasoning provided",
    score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
    webResearchInfo: webResearchInfo,
  };
}
