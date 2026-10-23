import mongoose from "mongoose";
import { loadConfig } from "../backend/config.js";

// Explicit one-time reset. Never called by ordinary server startup.
if (
  process.argv.length !== 3 ||
  process.argv[2] !== "--reset-prototype-profiles"
) {
  console.error(
    "No changes made. To delete disposable prototype profiles, pass --reset-prototype-profiles.",
  );
  process.exitCode = 1;
} else {
  let client;
  try {
    const { databaseUri } = loadConfig();
    client = new mongoose.mongo.MongoClient(databaseUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
    await client.connect();
    const db = client.db();
    const usersBefore = await db
      .collection("users")
      .countDocuments({}, { maxTimeMS: 5000 });
    const exists = await db
      .listCollections({ name: "emergencyprofiles" }, { nameOnly: true })
      .hasNext();
    if (exists) {
      const count = await db
        .collection("emergencyprofiles")
        .countDocuments({}, { maxTimeMS: 5000 });
      await db.collection("emergencyprofiles").drop();
      console.log(
        `Removed prototype emergencyprofiles collection (${count} records).`,
      );
    } else {
      console.log("Prototype emergencyprofiles collection is already absent.");
    }
    const usersAfter = await db
      .collection("users")
      .countDocuments({}, { maxTimeMS: 5000 });
    if (usersBefore !== usersAfter)
      throw new Error("User count changed during reset");
    console.log(`User records preserved (${usersAfter}).`);
    await client.close();
    client = undefined;
    const { connectDB, disconnectDB } = await import("../backend/db.js");
    try {
      await connectDB(databaseUri);
    } finally {
      await disconnectDB();
    }
    console.log("Milestone 2 collections and indexes initialized.");
  } catch {
    console.error(
      "Setup failed. Check configuration and database availability. Driver details are hidden; inspect collection counts before retrying.",
    );
    process.exitCode = 1;
  } finally {
    await client?.close();
  }
}
