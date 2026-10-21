import { useEffect, useRef, useState } from "react";
import { signup } from "../api.js";
import { validateSignup } from "../validation.js";
import FormField from "../components/FormField.jsx";
import Icon from "../components/Icon.jsx";

const privacyNotes = [
  ["lock", "Private by default", "Your medical information and emergency contacts start private. You choose which whole categories to share."],
  ["shield", "Your date of birth stays private", "When you create your profile, you can choose to share your calculated age. Your date of birth is never public."],
  ["refresh", "You stay in control", "Change your sharing choices anytime. Revoke or replace your QR when you need to."],
];

export default function Signup({ onSuccess }) {
  const [values, setValues] = useState({ firstName: "", lastName: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const messageRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (failure) messageRef.current?.focus(); }, [failure]);

  function change(event) {
    const { name, value } = event.target;
    setValues(current => ({ ...current, [name]: value }));
    setErrors(current => ({ ...current, [name]: undefined,
      ...(name === "password" ? { confirmPassword: undefined } : {}) }));
    setFailure("");
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const invalid = validateSignup(values);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      event.currentTarget.elements.namedItem(Object.keys(invalid)[0]).focus();
      return;
    }
    submitting.current = true;
    setPending(true); setFailure("");
    try {
      await signup(values);
      if (!mounted.current) return;
      setValues(current => ({ ...current, password: "", confirmPassword: "" }));
      onSuccess(values.email.trim().toLowerCase());
    } catch (error) {
      if (!mounted.current) return;
      setFailure(error.message);
      setErrors(error.fields || {});
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <div className="mx-auto w-full max-w-6xl px-5 py-9 sm:px-8 sm:py-12">
    <div className="mb-8">
      <p className="eyebrow mb-3 flex items-center gap-2 text-primary"><Icon name="shield" className="h-4 w-4" />Get started with Emergency QR</p>
      <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Create your account</h1>
      <p className="mt-3 text-base text-secondary sm:text-lg">Prepare your emergency information. Choose what you share.</p>
    </div>
    <div className="grid items-start gap-7 lg:grid-cols-[0.85fr_1.15fr] lg:gap-9">
      <aside aria-labelledby="privacy-title" className="order-2 lg:order-1">
        <div className="bg-panel p-6 sm:p-7">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center bg-primary text-white"><Icon name="shield" className="h-6 w-6" /></span>
            <div><p className="eyebrow mb-1 text-primary">Built around your choices</p><h2 id="privacy-title" className="font-heading text-xl font-bold">Your information, your control</h2></div>
          </div>
          <div className="flex flex-col gap-3">
            {privacyNotes.map(([icon, title, description]) => <div key={title} className="flex items-start gap-3 bg-white p-4">
              <Icon name={icon} className="mt-0.5 text-success" /><div><h3 className="font-heading text-sm font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{description}</p></div>
            </div>)}
          </div>
        </div>
        <div className="mt-5 flex items-start gap-3 bg-ink p-5 text-white">
          <Icon name="qr" className="mt-1 text-green-300" /><div>
            <h3 className="font-heading text-sm font-bold">A simpler way to share</h3>
            <p className="mt-2 text-sm leading-6 text-slate-200">An active QR lets others read your shared emergency information without signing in. An internet connection is needed.</p>
          </div>
        </div>
      </aside>
      <section aria-labelledby="signup-title" className="auth-card order-1 lg:order-2">
        <div className="status-strip"><span>ACCOUNT DETAILS</span><span className="flex items-center gap-1.5"><Icon name="lock" className="h-3 w-3" />PRIVATE SIGNUP</span></div>
        <div className="p-6 sm:p-8">
          <h2 id="signup-title" className="font-heading text-xl font-bold">Start with the essentials</h2>
          <p className="mb-7 mt-2 text-sm leading-6 text-secondary">Create your account first. Your emergency profile comes next.</p>
          <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-5">
            <fieldset disabled={pending} className="contents">
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="First name" name="firstName" value={values.firstName} onChange={change}
                  error={errors.firstName} autoComplete="given-name" placeholder="e.g. Priya" icon="user" />
                <FormField label="Last name" name="lastName" value={values.lastName} onChange={change}
                  error={errors.lastName} autoComplete="family-name" placeholder="e.g. Sharma" icon="user" />
              </div>
              <FormField label="Email" name="email" type="email" value={values.email} onChange={change}
                error={errors.email} autoComplete="username" autoCapitalize="none" spellCheck={false}
                placeholder="you@example.com" maxLength={254} icon="mail" />
              <FormField label="Password" name="password" type="password" value={values.password} onChange={change}
                error={errors.password} autoComplete="new-password" placeholder="Create a long, unique password"
                hint="Use at least 15 characters and at most 72 bytes. Some characters use more than one byte. A long, unique passphrase works well; no uppercase, number, or symbol is required." />
              <FormField label="Confirm password" name="confirmPassword" type="password" value={values.confirmPassword} onChange={change}
                error={errors.confirmPassword} autoComplete="new-password" placeholder="Enter your password again" />
              {failure && <p role="alert" ref={messageRef} tabIndex={-1} className="form-alert">{failure}</p>}
              <button type="submit" className="primary-button mt-1">
                {pending ? "Creating your account…" : "Create account"}{!pending && <Icon name="arrow" />}
              </button>
            </fieldset>
          </form>
          <p className="mt-6 text-center text-sm text-secondary">Already have an account? <a href="#/login" className="text-link ml-1">Sign in</a></p>
          <div className="mt-6 flex items-start gap-2 border-t border-line pt-5 text-xs leading-5 text-secondary">
            <Icon name="lock" className="mt-0.5 h-4 w-4 text-success" /><p>Creating an account does not make your emergency information public. You choose what to share when setting up your profile.</p>
          </div>
        </div>
      </section>
    </div>
  </div>;
}
