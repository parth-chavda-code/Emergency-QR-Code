import mongoose from "mongoose";
import { userModel } from "./models/user.js";
import { eprofileModel } from "./models/emergency_profile.js";
import { qrCredentialModel } from "./models/qr_credential.js";
import { authSessionModel } from "./models/auth_session.js";
import { auditEventModel } from "./models/audit_event.js";

mongoose.set("bufferCommands", false);

export async function connectDB(databaseUri) {
  await mongoose.connect(databaseUri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
    autoIndex: true,
  });
  // Never delete data here. Wait for database rules before HTTP accepts requests.
  await Promise.all(
    [
      userModel,
      eprofileModel,
      qrCredentialModel,
      authSessionModel,
      auditEventModel,
    ].map((model) => model.init()),
  );
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

// Never log a URI or driver error contents.
mongoose.connection.on("error", () => {
  console.error("Database connection error");
});
