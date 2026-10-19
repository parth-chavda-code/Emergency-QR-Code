import { Router } from "express";
import bcrypt from "bcrypt";
import { rateLimit } from "express-rate-limit";
import { userModel, emailCollation } from "../models/user.js";
import { signupSchema, loginSchema } from "../validation/user.js";
import { authUser } from "../middlewares/authMiddleware.js";
import {
  createLoginSession,
  logoutEverywhere,
  recordAuthEvent,
  isDatabaseFailure,
} from "../security/authSessions.js";

// A comparison for unknown emails helps reduce password-check timing differences.
const dummyPasswordHash =
  "$2b$10$Ok0Lv.4XISvcDf4EQuFD4.nXiUClcpu6T4qSvuBlqus2P4s2SPZ0W";

const fieldMessages = {
  email: "A valid email address is required (maximum 254 characters)",
  firstName:
    "First name is required and must be 1–100 characters without control characters",
  lastName:
    "Last name is required and must be 1–100 characters without control characters",
  password:
    "Password must have at least 15 characters, use at most 72 bytes, and not be only whitespace",
};

function unavailable(res, action = "Signup") {
  return res
    .set("Retry-After", "5")
    .status(503)
    .json({
      error: `${action} temporarily unavailable. Please try again later.`,
    });
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
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "Too many login attempts. Please try again later." },
  });

  //signup
  router.post("/signup", signupLimit, async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) {
      return res
        .status(415)
        .json({ error: "Content-Type must be application/json" });
    }
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = [
        ...new Set(
          parsed.error.issues.map((issue) =>
            Object.hasOwn(fieldMessages, issue.path[0])
              ? issue.path[0]
              : "body",
          ),
        ),
      ];
      return res.status(400).json({
        error: "Invalid signup data",
        errors: fields.map((field) => ({
          field,
          message:
            fieldMessages[field] ??
            "Provide only email, firstName, lastName, and password",
        })),
      });
    }

    if (userModel.db.readyState !== 1) return unavailable(res);
    const { email, firstName, lastName, password } = parsed.data;
    try {
      if (
        await userModel
          .exists({ email })
          .collation(emailCollation)
          .maxTimeMS(5000)
      ) {
        return res.status(409).json({ error: "Email is already registered" });
      }
      // bcrypt creates a random salt; 10 controls the hashing work.
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await userModel.create({
        email,
        firstName,
        lastName,
        password: passwordHash,
      });
      return res.status(201).json({
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: user.createdAt,
        },
      });
    } catch (err) {
      // The unique database index also catches concurrent signups for the same email.
      if (err.code === 11000) {
        return res.status(409).json({ error: "Email is already registered" });
      }
      if (isDatabaseFailure(err)) {
        return unavailable(res);
      }
      return next(err);
    }
  });

  //login
  router.post("/login", loginLimit, async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) {
      return res
        .status(415)
        .json({ error: "Content-Type must be application/json" });
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid login data" });
    }
    if (userModel.db.readyState !== 1) return unavailable(res, "Login");

    const { email, password } = parsed.data;
    try {
      const user = await userModel
        .findOne({ email })
        .collation(emailCollation)
        .select("+password +loginVersion")
        .maxTimeMS(5000);

      //checks that the db has bcrypt hashed password or not
      const hasBcryptPassword =
        typeof user?.password === "string" &&
        userModel.schema.path("password").options.match.test(user.password);

      //compares the hashed password
      const matches = await bcrypt.compare(
        password,
        hasBcryptPassword ? user.password : dummyPasswordHash, //search timing side channel for dummyPasswordHash
      );
      if (!user || !hasBcryptPassword || !matches) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = await createLoginSession(user, req.app.locals.jwtSecret);
      if (!token)
        return res
          .status(401)
          .json({ error: "Login session changed. Please log in again." });
      await recordAuthEvent("auth.login", user._id);
      return res.status(200).json({
        token,
        tokenType: "Bearer",
        expiresIn: 900,
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: user.createdAt,
        },
      });
    } catch (err) {
      if (isDatabaseFailure(err)) {
        return unavailable(res, "Login");
      }
      return next(err);
    }
  });

  // No body is needed. The verified session identifies the account to sign out.
  router.post("/logout", authUser, async (req, res, next) => {
    try {
      if (!(await logoutEverywhere(req.userId, req.loginVersion))) {
        return res
          .set("WWW-Authenticate", "Bearer")
          .status(401)
          .json({ error: "Invalid or expired authentication token" });
      }
      await recordAuthEvent("auth.logout", req.userId);
      return res.status(204).end();
    } catch (err) {
      if (isDatabaseFailure(err)) return unavailable(res, "Logout");
      return next(err);
    }
  });
  return router;
}
