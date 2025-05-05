import { readFileSync, writeFileSync } from "fs";
import { UserData } from "./types.js";

function combineJsonFiles() {
  try {
    // Read both JSON files
    const users1: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repoInteracters.json", "utf8")
    );
    const users2: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repoInteracters-1.json", "utf8")
    );

    // Combine arrays and remove duplicates based on login
    const combinedUsers = [...users1, ...users2];
    const uniqueUsers = Array.from(
      new Map(combinedUsers.map((user) => [user.login, user])).values()
    );

    // Write combined data to new file
    writeFileSync(
      "dataOutputs/repoInteracters-3.json",
      JSON.stringify(uniqueUsers, null, 2)
    );

    console.log(`Combined ${users1.length} and ${users2.length} profiles`);
    console.log(`Final unique profiles: ${uniqueUsers.length}`);
  } catch (error) {
    console.error("Error combining JSON files:", error);
  }
}

combineJsonFiles();
