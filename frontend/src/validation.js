const passwordBytes = value => new TextEncoder().encode(value).length;

function validateEmail(value) {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (email.length > 254 || email.split("@")[0].length > 64
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
}

export function validateLogin(values) {
  const errors = {};
  const emailError = validateEmail(values.email);
  if (emailError) errors.email = emailError;
  if (!values.password.length) errors.password = "Enter your password.";
  else if (passwordBytes(values.password) > 72) errors.password = "Password must use at most 72 bytes. Some characters use more than one byte.";
  return errors;
}

export function validateSignup(values) {
  const errors = validateLogin(values);
  for (const field of ["firstName", "lastName"]) {
    const name = values[field].trim();
    if (!name) errors[field] = `Enter your ${field === "firstName" ? "first" : "last"} name.`;
    else if ([...name].length > 100 || /\p{Cc}/u.test(name)) errors[field] = "Use 1–100 characters without control characters.";
  }
  if (!errors.password && ([...values.password].length < 15 || !/\S/u.test(values.password))) {
    errors.password = "Use at least 15 characters, with something other than spaces.";
  }
  if (!values.confirmPassword) errors.confirmPassword = "Enter your password again.";
  else if (values.confirmPassword !== values.password) errors.confirmPassword = "The passwords don't match.";
  return errors;
}
