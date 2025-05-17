import { Readability } from "@mozilla/readability";
import { config } from "dotenv";
import { JSDOM, VirtualConsole } from "jsdom";
import { MongoClient } from "mongodb";
import puppeteer from "puppeteer";
import { DbGraphUser } from "./types.js";

config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";
const userIds = ["cassanof", "steebchen"];
const MAX_CONTENT_LENGTH = 7500;

async function fetchRawWebsiteContent(
  url: string
): Promise<{ readability: string; fallback: string }> {
  if (!url) return { readability: "", fallback: "" };
  let cleanUrl = url.trim();
  if (!cleanUrl.startsWith("http")) cleanUrl = "https://" + cleanUrl;

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (compatible; PrimeIntellectBot/1.0;)");
  await page.goto(cleanUrl, { waitUntil: "networkidle2", timeout: 30000 });
  const html = await page.content();
  await browser.close();

  const doc = new JSDOM(html, {
    url: cleanUrl,
    runScripts: "outside-only",
    resources: "usable",
    virtualConsole: new VirtualConsole().sendTo(console, {
      omitJSDOMErrors: true,
    }),
    pretendToBeVisual: false,
  });

  // Readability extraction
  const reader = new Readability(doc.window.document);
  const article = reader.parse();
  let readabilityContent = article
    ? `${article.title}\n\n${article.textContent}`
    : "";
  readabilityContent = readabilityContent
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_LENGTH);

  // Fallback: all visible text from <body>
  const body = doc.window.document.body;
  body
    .querySelectorAll("script, style, nav, footer, aside")
    .forEach((el) => el.remove());
  let fallbackContent = body.textContent || "";
  fallbackContent = `${doc.window.document.title}\n\n${fallbackContent
    .replace(/\s+/g, " ")
    .trim()}`.slice(0, MAX_CONTENT_LENGTH);

  return { readability: readabilityContent, fallback: fallbackContent };
}

async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection<DbGraphUser>("users");

  for (const userId of userIds) {
    const user = await usersCol.findOne({ _id: userId });
    if (!user) {
      console.error(`User ${userId} not found.`);
      continue;
    }
    const website = user.blog;
    if (!website) {
      console.error(`User ${userId} has no website/blog field.`);
      continue;
    }
    console.log(
      `\n==============================\nFetching website for user ${userId}: ${website}`
    );
    try {
      const { readability, fallback } = await fetchRawWebsiteContent(website);
      console.log("\n--- Readability Extraction ---");
      console.log(`Length: ${readability.length}`);
      console.log(readability);
      console.log("\n--- Fallback Extraction (all visible text) ---");
      console.log(`Length: ${fallback.length}`);
      console.log(fallback);
    } catch (e) {
      console.error("Error fetching or parsing website:", e);
    }
    console.log("\n==============================\n");
  }
  await client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
