import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { connectDB, disconnectDB } from "../backend/db.js";
import { userModel } from "../backend/models/user.js";
import { eprofileModel } from "../backend/models/emergency_profile.js";
import { signupSchema } from "../backend/validation/user.js";
import { prepareProfileStorage } from "../backend/security/profileStorage.js";
import { validateEncryptionKey } from "../backend/security/profileEncryption.js";

// Deliberately do not load the application's .env or accept dbconnection here.
export function stagingSeedConfig(env) {
  const uri = env.STAGING_MONGODB_URI?.trim();
  if (typeof uri !== "string" || !/^mongodb(?:\+srv)?:\/\/[^\s/]+\/emergency_qr_staging(?:\?[^\s]*)?$/.test(uri)) {
    throw new Error("STAGING_MONGODB_URI must explicitly target emergency_qr_staging");
  }
  const key = validateEncryptionKey(env.STAGING_PROFILE_ENCRYPTION_KEY);
  const password = env.STAGING_SEED_PASSWORD;
  signupSchema.parse({ email: "demo.owner@example.test", firstName: "Demo", lastName: "Owner", password });
  return { uri, key, password };
}

export const syntheticProfiles = [
  { email: "demo.owner@example.test", firstName: "Demo", lastName: "Owner",
    profile: { displayName: "Demo Profile — Fictional", dob: "1994-08-14", bloodType: "O+",
      allergies: ["Example allergy — fictional test entry"],
      medicalCondition: ["Example condition — fictional test entry"],
      medications: ["Example medication — fictional test entry"],
      additionalInformation: "SYNTHETIC TEST DATA ONLY.\nNot a real person or medical record.",
      sharingConsent: { displayName: true, age: true, bloodType: true, allergies: true,
        medicalCondition: true, medications: true, additionalInformation: true } } },
  { email: "demo.private@example.test", firstName: "Private", lastName: "Demo",
    profile: { displayName: "Private Demo — Fictional", dob: "1990-01-10",
      additionalInformation: "Private fictional information. This must not appear in public previews." } },
];

export async function seedStaging(env) {
  const { uri, key, password } = stagingSeedConfig(env);
  try {
    await connectDB(uri);
    const db = mongoose.connection.db;
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Transaction-capable database required");
    // Refuse populated databases, including non-project collections. Never reset data.
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) {
      if (name.startsWith("system.")) continue;
      if (await db.collection(name).findOne({}, { projection: { _id: 1 } })) {
        throw new Error("Staging database must be empty; no data was replaced");
      }
    }
    const hash = await bcrypt.hash(password, 12);
    await mongoose.connection.transaction(async session => {
      for (const fixture of syntheticProfiles) {
        const [user] = await userModel.create([{ email: fixture.email, firstName: fixture.firstName,
          lastName: fixture.lastName, password: hash }], { session });
        const _id = new mongoose.Types.ObjectId();
        await eprofileModel.create([{ _id, userId: user._id,
          ...prepareProfileStorage(_id, fixture.profile, key) }], { session });
      }
    });
    console.log("Synthetic staging accounts created: demo.owner@example.test and demo.private@example.test");
    console.log("Sign in with STAGING_SEED_PASSWORD. Generate and download QR stickers through the app.");
  } finally { await disconnectDB(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedStaging(process.env).catch(() => {
    // Never print driver/Zod errors: they can contain credentials or private values.
    console.error("Staging seed failed. Check the dedicated database name, empty database, transaction support, encryption key, and password. No reset or deletion was performed.");
    process.exitCode = 1;
  });
}
