import { useEffect, useRef, useState } from "react";
import { getProfile, createProfile, updateProfile } from "../api.js";
import { bloodTypes, emptyProfile, medicalCategories, ownerAge, profileChanges, profileToForm, sharingCategories, validateProfile } from "../profileForm.js";
import FormField from "../components/FormField.jsx";
import SharingToggle from "../components/SharingToggle.jsx";
import MedicalList from "../components/MedicalList.jsx";
import EmergencyContacts from "../components/EmergencyContacts.jsx";
import Icon from "../components/Icon.jsx";

// Owner-only reference for resolving conflicts. This is never a public preview.
function DraftReference({ values }) {
  const rows = [["Display name", values.displayName], ["Date of birth (always private)", values.dob],
    ["Blood type", values.bloodType], ...medicalCategories.map(key => [sharingCategories[key], values[key].join("; ")]),
    ["Emergency contacts", values.emergencyContact.map(contact => [contact.name, contact.phone, contact.relation].filter(Boolean).join(" · ")).join("; ")],
    ["Additional information", values.additionalInformation],
    ["Public categories", Object.entries(sharingCategories).filter(([key]) => values.sharingConsent[key]).map(([, label]) => label).join(", ") || "None"]];
  return <dl className="mt-4 space-y-3 text-base">{rows.map(([label, value]) => <div key={label} className="border-t border-line pt-2">
    <dt className="font-bold">{label}</dt><dd className="mt-1 break-words text-secondary">{value || "Not specified"}</dd>
  </div>)}</dl>;
}

export default function Profile({ token, onSessionEnd, onDirtyChange, signOutPending }) {
  const [form, setForm] = useState(emptyProfile);
  const [saved, setSaved] = useState(null);
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState(undefined);
  const [previousDraft, setPreviousDraft] = useState(null);
  const alertRef = useRef(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const dirty = ready && JSON.stringify(form) !== JSON.stringify(profileToForm(saved));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (failure) alertRef.current?.focus(); }, [failure]);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setFailure("");
    getProfile(token, controller.signal).then(profile => {
      if (!active) return;
      setSaved(profile); setForm(profileToForm(profile)); setReady(true);
    }).catch(error => {
      if (!active) return;
      if (error.status === 401) onSessionEnd(error.message);
      else setFailure(error.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [token, onSessionEnd, loadAttempt]);

  function change(key, value) {
    setForm(current => ({ ...current, [key]: value }));
    setErrors({}); setNotice("");
  }
  function share(key, value) {
    setForm(current => ({ ...current, sharingConsent: { ...current.sharingConsent, [key]: value } }));
    setNotice("");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy.current || conflict || !ready) return;
    const invalid = validateProfile(form);
    setErrors(invalid); setFailure(""); setNotice("");
    if (Object.keys(invalid).length) {
      const first = event.currentTarget.elements.namedItem(Object.keys(invalid)[0]);
      if (first?.focus) first.focus();
      else setFailure(invalid.body || "Please check the highlighted fields.");
      return;
    }
    const changes = saved ? profileChanges(form, saved) : null;
    if (changes && Object.keys(changes).length === 1) {
      setForm(profileToForm(saved)); setNotice("There are no changes to save."); return;
    }
    busy.current = true; setWorking(true);
    try {
      const profile = saved ? await updateProfile(token, changes) : await createProfile(token, form);
      if (!mounted.current) return;
      setSaved(profile); setForm(profileToForm(profile)); setLatest(undefined);
      setNotice("Profile saved successfully.");
    } catch (error) {
      if (!mounted.current) return;
      if (error.status === 401) onSessionEnd(error.message);
      else {
        setFailure(error.message);
        if (error.status === 409) { setConflict(true); setLatest(undefined); }
      }
    } finally { busy.current = false; if (mounted.current) setWorking(false); }
  }

  async function reviewSaved() {
    if (busy.current) return;
    busy.current = true; setWorking(true); setFailure(""); setNotice("");
    try {
      const profile = await getProfile(token);
      if (!mounted.current) return;
      setLatest(profile); setConflict(true);
    } catch (error) {
      if (!mounted.current) return;
      if (error.status === 401) onSessionEnd(error.message);
      else setFailure(error.message);
    } finally { busy.current = false; if (mounted.current) setWorking(false); }
  }

  function loadLatest() {
    // Loading the saved version is explicit; retain the old draft for reference.
    setPreviousDraft(structuredClone(form));
    setSaved(latest); setForm(profileToForm(latest)); setLatest(undefined);
    setConflict(false); setErrors({}); setFailure("");
    setNotice("Saved version loaded. Your previous draft is kept below for reference on this page only.");
  }

  const age = ownerAge(form.dob);
  const disabled = working || signOutPending;
  return <div className="profile-page owner-profile-page mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Your emergency profile</h1>
        <p className="mt-3 text-secondary">Keep your information up to date. Choose what others can see.</p>
      </div>
      <p className={`profile-status ${dirty ? "profile-status-unsaved" : ""}`} role="status">{loading ? "Loading…" : !ready ? "Unable to load" : working ? "Please wait…" : dirty ? "Unsaved changes" : saved ? "Saved profile" : "New profile"}</p>
    </div>
    <div className="privacy-banner mb-7 flex items-start gap-4 p-5 text-base leading-6">
      <span className="section-icon bg-sky-100 text-sky-800"><Icon name="shield" /></span><div>
        <p><strong>Private by default.</strong> Public means anyone holding your active QR link can read that category.</p>
        <p className="mt-1 text-secondary">Your date of birth always stays private. Sharing choices apply only when you save; changes then affect existing active QR links.</p>
      </div>
    </div>
    {failure && <div ref={alertRef} tabIndex={-1} role="alert" className="form-alert mb-6">
      <p>{failure}</p>
      {!ready && !loading && <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="secondary-button mt-3">Retry loading profile</button>}
    </div>}
    {notice && <p role="status" className="mb-6 border-l-3 border-success bg-success/7 p-4 text-base text-success">{notice}</p>}
    {ready && <>
      {(conflict || failure) && <section aria-labelledby="review-title" className="mb-6 border border-line bg-white p-5">
        <h2 id="review-title" className="font-heading font-bold">Review the saved version</h2>
        <p className="mt-2 text-base leading-6 text-secondary">Your draft has not been replaced. Check what is saved before continuing. Nothing is merged or saved automatically.</p>
        <button type="button" onClick={reviewSaved} disabled={disabled} className="secondary-button mt-3">{working ? "Please wait…" : "Check saved version"}</button>
        {latest !== undefined && <div className="mt-4 border-t border-line pt-4">
          {latest ? <details><summary className="cursor-pointer font-bold">Latest saved profile · Only visible to you</summary><DraftReference values={profileToForm(latest)} /></details>
            : <p className="text-base">No saved profile was found.</p>}
          <p className="my-3 text-base text-secondary">Loading this version keeps your current draft below for reference. Copy any edits you still want, then save again.</p>
          <button type="button" onClick={loadLatest} disabled={disabled} className="secondary-button">{latest ? "Load saved version" : "Start a new profile"}</button>
        </div>}
      </section>}
      <div>
        <form onSubmit={submit} noValidate aria-busy={working} className="owner-profile-layout">
          <fieldset disabled={disabled} className="contents">
            <div className="owner-profile-fields">
            <section aria-labelledby="basic-title" className="profile-section">
              <div className="section-heading"><h2 id="basic-title" className="flex items-center gap-3"><span className="owner-section-number">01</span>Basic details</h2><span className="owner-optional-badge">Identity</span></div>
              <div className="space-y-6">
                <div className="profile-field">
                  <FormField label="Display name" name="displayName" value={form.displayName} onChange={event => change("displayName", event.target.value)}
                    labelAction={<SharingToggle label="Display name" value={form.sharingConsent.displayName} onChange={value => share("displayName", value)} />}
                    error={errors.displayName} hint="Use the name you want people to see if you share it. Maximum 100 characters." autoComplete="off" />
                </div>
                <div className="profile-field grid gap-5 sm:grid-cols-2">
                  <div><p className="mb-3 flex items-center gap-1.5 text-sm font-bold text-success"><Icon name="lock" className="h-4 w-4" />Always private</p>
                    <FormField label="Date of birth" name="dob" type="date" value={form.dob} onChange={event => change("dob", event.target.value)}
                      error={errors.dob} min="0001-01-01" max={new Date().toISOString().slice(0, 10)} hint="Your date of birth is never shown to QR visitors." autoComplete="off" />
                  </div>
                  <div className="border-t border-line pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><span className="field-label">Calculated age</span>
                    <SharingToggle label="Calculated age" value={form.sharingConsent.age} onChange={value => share("age", value)} /></div>
                    <p className="rounded-xl border border-line bg-white px-4 py-3 font-heading text-xl font-bold">{age === null ? "—" : `${age} ${age === 1 ? "year" : "years"}`}</p>
                    <p className="mt-2 text-base text-secondary">You can share your age separately. It is calculated again when someone opens your QR.</p>
                  </div>
                </div>
                <div className="profile-field"><div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="bloodType" className="field-label">Blood type <span className="ml-1 font-normal text-secondary">Optional</span></label>
                  <SharingToggle label="Blood type" value={form.sharingConsent.bloodType} onChange={value => share("bloodType", value)} /></div>
                  <select id="bloodType" name="bloodType" value={form.bloodType} onChange={event => change("bloodType", event.target.value)} className="form-input" aria-describedby="blood-type-hint">
                    <option value="">Not specified</option>{bloodTypes.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                  <p id="blood-type-hint" className="mt-2 text-base text-secondary">Leave this unspecified if you don’t know. Don’t guess.</p>
                  {errors.bloodType && <p className="mt-2 text-base text-error">{errors.bloodType}</p>}
                </div>
              </div>
            </section>
            <section aria-labelledby="medical-title" className="profile-section">
              <div className="section-heading"><h2 id="medical-title" className="flex items-center gap-3"><span className="owner-section-number">02</span>Medical information</h2><span className="owner-optional-badge">Optional</span></div>
              <div className="owner-sharing-notice mb-5"><span className="owner-sharing-notice-icon"><Icon name="warning" /></span><p><strong>Making a category public shares every entry in it,</strong> including entries you add later. <strong>Sharing changes take effect when you save.</strong></p></div>
              <div className="space-y-5">{medicalCategories.map((category, index) => <MedicalList key={category} category={category} label={sharingCategories[category]}
                singular={["Allergy", "Condition", "Medication"][index]} values={form[category]} shared={form.sharingConsent[category]}
                onChange={value => change(category, value)} onSharingChange={value => share(category, value)} errors={errors} />)}</div>
              <div className="profile-field medical-category medical-additionalInformation mt-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="additionalInformation" className="owner-additional-label font-heading text-lg font-bold">Additional information</label>
                  <SharingToggle label="Additional information" value={form.sharingConsent.additionalInformation} onChange={value => share("additionalInformation", value)} />
                </div>
                <textarea id="additionalInformation" name="additionalInformation" rows={4} maxLength={1000}
                  value={form.additionalInformation} onChange={event => change("additionalInformation", event.target.value)}
                  aria-invalid={Boolean(errors.additionalInformation)}
                  aria-describedby={`additional-information-hint additional-information-count${errors.additionalInformation ? " additional-information-error" : ""}`}
                  className="form-input resize-y" />
                <p id="additional-information-hint" className="mt-2 text-sm leading-6 text-secondary">Optional. Add other information you would like someone helping you to know.</p>
                <p id="additional-information-count" className="mt-1 text-right text-sm text-secondary">{form.additionalInformation.length} / 1,000 characters</p>
                {errors.additionalInformation && <p id="additional-information-error" className="mt-2 text-base text-error">{errors.additionalInformation}</p>}
              </div>
            </section>
            <EmergencyContacts values={form.emergencyContact} shared={form.sharingConsent.emergencyContact}
              onChange={value => change("emergencyContact", value)} onSharingChange={value => share("emergencyContact", value)} errors={errors} />
            </div>
        <aside aria-labelledby="sharing-title" className="owner-profile-sidebar">
          <section className="profile-section">
          <h2 id="sharing-title" className="flex items-center gap-2 border-b border-line pb-4 font-heading text-xl font-bold"><Icon name="shield" className="h-4 w-4" />Sharing choices</h2>
          <p className="mt-2 text-sm font-bold text-primary">{dirty || !saved ? "Unsaved choices" : "Saved choices"}</p>
          <ul className="my-5 space-y-2"><li className="sharing-summary-row"><span>Date of birth</span><span className="sharing-badge text-secondary"><Icon name="lock" className="h-3.5 w-3.5" />Always private</span></li>{Object.entries(sharingCategories).map(([key, label]) => <li key={key} className="sharing-summary-row">
            <span>{label}</span><span className={`sharing-badge ${form.sharingConsent[key] ? "bg-green-50 text-success" : "text-secondary"}`}><Icon name={form.sharingConsent[key] ? "globe" : "lock"} className="h-3.5 w-3.5" />{form.sharingConsent[key] ? "Public" : "Private"}</span>
          </li>)}</ul>
          <p className="text-base font-bold">{Object.values(form.sharingConsent).filter(Boolean).length} {Object.values(form.sharingConsent).filter(Boolean).length === 1 ? "category" : "categories"} public</p>
          <p className="mt-3 text-sm leading-5 text-secondary">This lists your choices, not a visitor preview. Unsaved choices do not change what QR visitors see.</p>
          </section>
          <section className="profile-section owner-qr-card" aria-labelledby="owner-qr-title">
            <span className="owner-qr-icon"><Icon name="qr" className="h-8 w-8" /></span>
            <h2 id="owner-qr-title" className="mt-4 font-heading text-xl font-bold">Your emergency QR</h2>
            <p className="mt-2 text-sm leading-6 text-secondary">Review what visitors will see and manage your QR.</p>
            <a href="#/qr" className="secondary-button mt-4">Manage your QR <Icon name="arrow" /></a>
          </section>
        </aside>
            <div className="profile-section owner-save-area flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="font-heading text-xl font-bold">Save emergency profile</h2><p className="mt-1 text-base leading-6 text-secondary">You can save with every category private and all optional fields empty. Saved changes update any active QR link.</p></div>
              <button type="submit" disabled={conflict || (Boolean(saved) && !dirty)} className="primary-button sm:w-auto sm:shrink-0"><Icon name="check" />{working ? "Saving…" : "Save profile"}</button>
            </div>
          </fieldset>
        </form>

      </div>
      {previousDraft && <details className="profile-section mt-6"><summary className="cursor-pointer font-heading font-bold">Your previous unsaved draft · Private reference</summary>
        <p className="mt-3 text-base text-secondary">Kept only on this page. It is cleared when you sign out, your session ends, or you refresh. These values are not automatically saved.</p><DraftReference values={previousDraft} />
      </details>}
    </>}
  </div>;
}
