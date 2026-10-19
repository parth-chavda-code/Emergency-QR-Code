import mongoose from "mongoose";
import { emailSchema, nameSchema } from "../validation/user.js";

export const emailCollation = { locale: "en", strength: 2 };

function hidePassword(doc, value) {
  delete value.password;
  delete value.loginVersion;
  delete value.__v;
  return value;
}

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: (value) => emailSchema.safeParse(value).success,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
      validate: (value) => nameSchema.safeParse(value).success,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      validate: (value) => nameSchema.safeParse(value).success,
    },
    password: {
      type: String,
      required: true,
      select: false,
      // Accept the stored bcrypt format, never a plain password.
      match: /^\$2[ab]\$\d{2}\$[./A-Za-z0-9]{53}$/,
    },
    // Logout increases this number, invalidating every older login session.
    loginVersion: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
      select: false,
    },
  },
  {
    autoIndex: true,
    bufferCommands: false,
    strict: "throw",
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { transform: hidePassword },
    toObject: { transform: hidePassword },
  },
);

// Also prevent case variants from duplicating an email stored by older code.
userSchema.index(
  { email: 1 },
  {
    unique: true,
    collation: emailCollation,
    name: "email_unique_case_insensitive",
  },
);

export const userModel = mongoose.model("User", userSchema);
