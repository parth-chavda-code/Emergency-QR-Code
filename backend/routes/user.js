import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { userModel, emailCollation } from "../models/user.js";
import { signupSchema } from "../validation/user.js";
import { hashPassword, HashCapacityError } from "../security/password.js";

const fieldMessages = {
  email: "A valid email address is required (maximum 254 characters)",
  firstName: "First name is required and must be 1–100 characters without control characters",
  lastName: "Last name is required and must be 1–100 characters without control characters",
  password: "Password must be 15–128 characters and must not be only whitespace",
};
const databaseFailures = new Set([
  "MongooseServerSelectionError", "MongoServerSelectionError", "MongoNetworkError",
  "MongoNetworkTimeoutError", "MongoTopologyClosedError", "MongoNotConnectedError",
  "MongoOperationTimeoutError",
]);

function unavailable(res) {
  return res.set("Retry-After", "5").status(503)
    .json({ error: "Signup temporarily unavailable. Please try again later." });
}

export function createUserRouter() {
  const router = Router();
  // Each app instance owns its limiter. No proxy headers are trusted by default.
  const signupLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Forwarded headers are intentionally ignored until a trusted proxy is configured.
    validate: { xForwardedForHeader: false },
    message: { error: "Too many signup attempts. Please try again later." },
  });

  router.post("/signup", signupLimit, async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) =>
        Object.hasOwn(fieldMessages, issue.path[0]) ? issue.path[0] : "body"))];
      return res.status(400).json({
        error: "Invalid signup data",
        errors: fields.map((field) => ({
          field,
          message: fieldMessages[field] ?? "Provide only email, firstName, lastName, and password",
        })),
      });
    }

    if (userModel.db.readyState !== 1) return unavailable(res);
    const { email, firstName, lastName, password } = parsed.data;
    try {
      if (await userModel.exists({ email }).collation(emailCollation).maxTimeMS(5000)) {
        return res.status(409).json({ error: "Email is already registered" });
      }
      const passwordHash = await hashPassword(password);
      const user = await userModel.create({ email, firstName, lastName, password: passwordHash });
      return res.status(201).json({
        user: {
          id: user._id.toString(), email: user.email,
          firstName: user.firstName, lastName: user.lastName, createdAt: user.createdAt,
        },
      });
    } catch (err) {
      // The unique database index also catches concurrent signups for the same email.
      if (err.code === 11000) {
        return res.status(409).json({ error: "Email is already registered" });
      }
      if (err instanceof HashCapacityError || databaseFailures.has(err.name)
          || err.code === 50 || userModel.db.readyState !== 1) {
        return unavailable(res);
      }
      return next(err);
    }
  });
  return router;
}
