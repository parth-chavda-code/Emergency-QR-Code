export const sharingCategories = {
  displayName: "Display name", age: "Calculated age", bloodType: "Blood type",
  allergies: "Allergies", medicalCondition: "Medical conditions",
  medications: "Medications", additionalInformation: "Additional information", emergencyContact: "Emergency contacts",
};
export const medicalCategories = ["allergies", "medicalCondition", "medications"];
export const bloodTypes = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function emptyProfile() {
  return { displayName: "", dob: "", bloodType: "", allergies: [], medicalCondition: [], medications: [], additionalInformation: "",
    emergencyContact: [], sharingConsent: Object.fromEntries(Object.keys(sharingCategories).map(key => [key, false])) };
}

export function profileToForm(profile) {
  if (!profile) return emptyProfile();
  return { displayName: profile.displayName, dob: profile.dob, bloodType: profile.bloodType ?? "",
    ...Object.fromEntries(medicalCategories.map(key => [key, [...profile[key]]])),
    additionalInformation: profile.additionalInformation === undefined ? "" : profile.additionalInformation,
    emergencyContact: profile.emergencyContact.map(({ name, phone, relation }) => ({ name, phone, relation: relation ?? "" })),
    sharingConsent: Object.fromEntries(Object.keys(sharingCategories).map(key => [key, key === "additionalInformation" && profile.sharingConsent[key] === undefined ? false : profile.sharingConsent[key]])) };
}

export function profilePayload(form) {
  return { displayName: form.displayName.trim(), dob: form.dob,
    ...(form.bloodType ? { bloodType: form.bloodType } : {}),
    ...Object.fromEntries(medicalCategories.map(key => [key, form[key].map(value => value.trim())])),
    additionalInformation: form.additionalInformation.trim(),
    emergencyContact: form.emergencyContact.map(({ name, phone, relation }) => ({
      name: name.trim(), phone: phone.trim(), ...(relation.trim() ? { relation: relation.trim() } : {}),
    })),
    sharingConsent: Object.fromEntries(Object.keys(sharingCategories).map(key => [key, form.sharingConsent[key]])) };
}

// Send only edited fields, plus the revision of the version the owner edited.
export function profileChanges(form, saved) {
  const current = profilePayload(form);
  const original = profilePayload(profileToForm(saved));
  const changes = { revision: saved.revision };
  for (const key of ["displayName", "dob", "bloodType", ...medicalCategories, "additionalInformation", "emergencyContact"]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(original[key])) changes[key] = current[key] ?? null;
  }
  const consent = {};
  for (const key of Object.keys(sharingCategories)) {
    if (current.sharingConsent[key] !== original.sharingConsent[key]) consent[key] = current.sharingConsent[key];
  }
  if (Object.keys(consent).length) changes.sharingConsent = consent;
  return changes;
}

export function validDob(value, today = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value <= today.toISOString().slice(0, 10);
}

// Owner-only age display. The public API still calculates shared age on the server.
export function ownerAge(dob, today = new Date()) {
  if (!validDob(dob, today)) return null;
  const [year, month, day] = dob.split("-").map(Number);
  return today.getUTCFullYear() - year - Number(today.getUTCMonth() + 1 < month
    || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day));
}

function nameError(value, required = true) {
  const name = value.trim();
  if (!name && required) return "Enter a name.";
  if ([...name].length > 100 || /\p{Cc}/u.test(name)) return "Use at most 100 characters without control characters.";
}

export function validateProfile(form, today = new Date()) {
  const errors = {};
  const displayError = nameError(form.displayName);
  if (displayError) errors.displayName = displayError;
  if (!validDob(form.dob, today)) errors.dob = "Enter a valid date of birth that is not in the future.";
  if (form.bloodType && !bloodTypes.includes(form.bloodType)) errors.bloodType = "Select a listed blood type or Not specified.";
  for (const key of medicalCategories) {
    if (form[key].length > 30) errors[key] = "Use at most 30 entries in this category.";
    form[key].forEach((value, index) => {
      if (!value.trim() || value.trim().length > 500 || /\p{Cc}/u.test(value.trim())) {
        errors[`${key}.${index}`] = "Enter 1–500 characters without control characters, or remove this entry.";
      }
    });
  }
  if (typeof form.additionalInformation !== "string" || form.additionalInformation.trim().length > 1000
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(form.additionalInformation)) {
    errors.additionalInformation = "Use at most 1,000 characters without unsupported control characters.";
  }
  if (form.emergencyContact.length > 5) errors.emergencyContact = "Use at most five contacts.";
  form.emergencyContact.forEach((contact, index) => {
    for (const field of ["name", "relation"]) {
      const message = nameError(contact[field], field === "name");
      if (message) errors[`emergencyContact.${index}.${field}`] = message;
    }
    if (!/^\+[1-9]\d{1,14}$/.test(contact.phone.trim())) {
      errors[`emergencyContact.${index}.phone`] = "Enter an international phone number, such as +919876543210.";
    }
  });
  for (const key of Object.keys(sharingCategories)) {
    if (typeof form.sharingConsent[key] !== "boolean") errors.body = "Please check your sharing choices.";
  }
  const { sharingConsent, ...privateData } = profilePayload(form);
  if (new TextEncoder().encode(JSON.stringify(privateData)).length > 64000) {
    errors.body = "Your profile is too large. Shorten some entries before saving.";
  }
  return errors;
}

// Reject incomplete or malformed responses instead of treating missing consent as private.
export function readProfileResponse(data) {
  const profile = data?.profile;
  try {
    if (!profile || typeof profile.id !== "string" || !Number.isSafeInteger(profile.revision)
      || profile.revision < 1 || !profile.sharingConsent) throw new Error();
    const form = profileToForm(profile);
    if (Object.keys(validateProfile(form)).length) throw new Error();
    return { ...profilePayload(form), id: profile.id, revision: profile.revision };
  } catch { throw new Error("Invalid profile response"); }
}
