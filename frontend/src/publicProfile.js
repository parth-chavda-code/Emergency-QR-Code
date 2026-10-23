import { bloodTypes, sharingCategories } from "./profileForm.js";

const validText = (value, max) => typeof value === "string" && value.trim().length > 0
  && [...value].length <= max && !/\p{Cc}/u.test(value);

// Used by both the owner preview and the public page. Never accept private fields.
export function readPublicProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)
    || Object.keys(profile).some(key => !Object.hasOwn(sharingCategories, key))) throw new Error("Invalid public profile");
  const result = {};
  for (const [key, value] of Object.entries(profile)) {
    if (key === "displayName" && !validText(value, 100)) throw new Error("Invalid name");
    if (key === "age" && (!Number.isSafeInteger(value) || value < 0 || value > 9999)) throw new Error("Invalid age");
    if (key === "bloodType" && !bloodTypes.includes(value)) throw new Error("Invalid blood type");
    if (["allergies", "medicalCondition", "medications"].includes(key)
      && (!Array.isArray(value) || value.length > 30 || value.some(entry => !validText(entry, 500)))) throw new Error("Invalid medical entries");
    if (key === "additionalInformation" && (typeof value !== "string" || !value.trim()
      || value.length > 1000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value))) throw new Error("Invalid additional information");
    if (key === "emergencyContact") {
      if (!Array.isArray(value) || value.length > 5 || value.some(contact => !contact
        || !validText(contact.name, 100) || typeof contact.phone !== "string" || !/^\+[1-9]\d{1,14}$/.test(contact.phone)
        || (contact.relation !== undefined && !validText(contact.relation, 100)))) throw new Error("Invalid contacts");
      result[key] = value.map(({ name, phone, relation }) => ({ name, phone, ...(relation ? { relation } : {}) }));
    } else result[key] = value;
  }
  return result;
}

export const hasPublicInformation = profile => Object.values(profile).some(value => Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : true);
