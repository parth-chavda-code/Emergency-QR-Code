import { useEffect, useRef, useState } from "react";
import { login } from "../api.js";
import { validateLogin } from "../validation.js";
import FormField from "../components/FormField.jsx";
import Icon from "../components/Icon.jsx";

export default function Login({ email = "", notice, onSuccess }) {
  const [values, setValues] = useState({ email, password: "" });
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
    setErrors(current => ({ ...current, [name]: undefined }));
    setFailure("");
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const invalid = validateLogin(values);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      event.currentTarget.elements.namedItem(Object.keys(invalid)[0]).focus();
      return;
    }
    submitting.current = true;
    setPending(true); setFailure("");
    try {
      const session = await login(values);
      if (!mounted.current) return;
      setValues(current => ({ ...current, password: "" }));
      onSuccess(session);
    } catch (error) {
      if (!mounted.current) return;
      setFailure(error.message);
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-10 sm:py-14">
    <section aria-labelledby="login-title" className="auth-card">
      <div className="status-strip"><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 bg-success" />ACCOUNT ACCESS</span><Icon name="lock" className="h-3.5 w-3.5" /></div>
      <div className="p-6 sm:p-9">
        <div className="mb-7 flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center bg-primary text-white"><Icon name="qr" className="h-8 w-8" /></span>
          <div><p className="eyebrow mb-1 text-primary">Your emergency information</p>
            <h1 id="login-title" className="font-heading text-3xl font-bold tracking-tight">Welcome back</h1></div>
        </div>
        <p className="mb-7 text-base text-secondary">Sign in to manage your emergency profile.</p>
        {notice && <p role="status" className="mb-5 border-l-3 border-success bg-success/7 p-4 text-base text-success">{notice}</p>}
        <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-5">
          <fieldset disabled={pending} className="contents">
            <FormField label="Email" name="email" type="email" value={values.email} onChange={change}
              error={errors.email} autoComplete="username" autoCapitalize="none" spellCheck={false}
              placeholder="you@example.com" maxLength={254} icon="mail" />
            <FormField label="Password" name="password" type="password" value={values.password} onChange={change}
              error={errors.password} autoComplete="current-password" placeholder="Enter your password" />
            {failure && <p role="alert" ref={messageRef} tabIndex={-1} className="form-alert">{failure}</p>}
            <button type="submit" className="primary-button mt-1">
              {pending ? "Signing in…" : "Sign in"}{!pending && <Icon name="arrow" />}
            </button>
          </fieldset>
        </form>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 bg-wash p-4">
          <p className="text-base text-secondary">New to Emergency QR?</p>
          <a href="#/signup" className="text-link">Create an account <span aria-hidden="true">→</span></a>
        </div>
        <div className="mt-6 flex items-start gap-2 text-base leading-5 text-secondary">
          <Icon name="info" className="mt-0.5 h-4 w-4" />
          <p>Scanning someone’s QR? You don’t need an account to view the information they’ve chosen to share.</p>
        </div>
      </div>
    </section>
    <p className="mt-5 flex items-center justify-center gap-2 text-sm text-secondary"><Icon name="shield" className="h-4 w-4 text-success" />Private by default. Shared on your terms.</p>
  </div>;
}
