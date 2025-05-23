import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";

async function clearDatabase() {
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log("Connected to MongoDB.");

    const db = client.db(dbName);
    const usersCol = db.collection("users");
    const edgesCol = db.collection("edges");

    console.log(
      `Attempting to delete all documents from 'users' collection in database '${dbName}'...`
    );
    const usersDeleteResult = await usersCol.deleteMany({});
    console.log(
      `Deleted ${usersDeleteResult.deletedCount} documents from 'users' collection.`
    );

    console.log(
      `Attempting to delete all documents from 'edges' collection in database '${dbName}'...`
    );
    const edgesDeleteResult = await edgesCol.deleteMany({});
    console.log(
      `Deleted ${edgesDeleteResult.deletedCount} documents from 'edges' collection.`
    );

    console.log("Database clearing process completed.");
  } catch (error) {
    console.error("Error during database clearing process:", error);
  } finally {
    await client.close();
    console.log("MongoDB connection closed.");
  }
}

clearDatabase().catch(console.error);
