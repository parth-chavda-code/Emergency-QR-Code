import { useEffect, useRef, useState } from "react";
import { getPublicEmergency, publicTokenFromPath } from "../publicEmergencyApi.js";
import Icon from "../components/Icon.jsx";

const medicalSections = [
  ["allergies", "Allergies", "warning"],
  ["medicalCondition", "Medical conditions", "medical"],
  ["medications", "Medications", "medical"],
];

export default function PublicEmergency() {
  const [result, setResult] = useState({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const titleRef = useRef(null);
  const mainRef = useRef(null);
  const token = publicTokenFromPath(window.location.pathname);

  useEffect(() => {
    document.title = "Emergency information · Emergency QR";
    let active = true;
    let controller;
    let generation = 0;
    function clear() {
      generation++; controller?.abort();
      if (active) setResult({ state: "loading" });
    }
    async function load() {
      clear();
      if (document.visibilityState === "hidden") return;
      const version = generation;
      controller = new AbortController();
      const next = await getPublicEmergency(token, controller.signal);
      if (active && version === generation) { setNow(Date.now()); setResult(next); }
    }
    function visibility() { if (document.visibilityState === "hidden") clear(); else void load(); }
    function restore(event) { if (event.persisted) void load(); }
    void load();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", restore);
    return () => {
      active = false; generation++; controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", restore);
    };
  }, [token, attempt]);

  useEffect(() => { if (result.state !== "loading") titleRef.current?.focus({ preventScroll: true }); }, [result.state]);
  useEffect(() => {
    if (result.state !== "limited" || !result.retryAt || result.retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now(); setNow(current);
      if (current >= result.retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [result]);

  const profile = result.state === "available" ? result.profile : null;
  const wait = result.state === "limited" ? Math.max(0, Math.ceil((result.retryAt - now) / 1000)) : 0;
  const title = profile ? profile.displayName ?? "Emergency information"
    : result.state === "unavailable" ? "Emergency profile unavailable"
      : result.state === "error" ? "We couldn’t load this information"
        : result.state === "limited" ? "Too many requests" : "Loading emergency information…";

  const hasContacts = Boolean(profile?.emergencyContact?.length);
  const guidelines = [
    ["Call for emergency help.", "Call 112, share your location, and follow the call handler’s instructions."],
    ["Share this page.", "Show the owner’s shared information to arriving emergency responders."],
    ...(hasContacts ? [["Notify an emergency contact.", "After requesting emergency help, call a listed contact or ask another bystander."]] : []),
    ["Stay nearby if safe.", "Keep access clear for responders and respect the person’s privacy."],
  ];

  return <div className="public-emergency flex min-h-dvh flex-col">
    <a href="#emergency-main" onClick={event => { event.preventDefault(); mainRef.current?.focus(); }} className="skip-link">Skip to emergency information</a>
    <header className="border-b border-line bg-white/95">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3"><span className="public-brand-icon"><Icon name="qr" className="h-6 w-6" /></span><span className="font-heading text-lg font-bold">Emergency QR</span></div>
        <span className="public-view-badge">Public view</span>
        {profile && <span className="public-active-status"><span aria-hidden="true" className="public-active-dot" />Emergency profile active</span>}
      </div>
    </header>
    <main ref={mainRef} id="emergency-main" tabIndex={-1} className="profile-page mx-auto w-full max-w-7xl flex-1 px-5 py-6 sm:px-8 sm:py-9">
      <section aria-labelledby="emergency-help-title" className="public-help-banner mb-6">
        <div className="flex items-start gap-3 sm:gap-4">
          <span className="public-help-icon"><Icon name="phone" className="h-6 w-6" /></span>
          <div><p className="text-xs font-bold uppercase tracking-wider">Immediate help · India</p>
            <h2 id="emergency-help-title" className="mt-1 font-heading text-xl font-bold sm:text-2xl">Need urgent help?</h2>
            <p className="mt-2 text-base leading-6">Call 112 in India. Don’t delay the call to read this profile.</p>
          </div>
        </div>
        <a href="tel:112" className="public-emergency-call"><Icon name="phone" /><span>Call Emergency — 112</span></a>
      </section>
      <section className="profile-section public-identity mb-6">
        <div className="public-identity-layout">
          <div className="min-w-0">
            <h1 ref={titleRef} tabIndex={-1} className="break-words font-heading text-3xl font-bold tracking-tight focus:outline-none sm:text-4xl">{title}</h1>
            {profile && <><p className="public-owner-badge mt-3">Owner-provided information</p></>}
          </div>
          {profile && <dl className="public-stats">
            {profile.bloodType && <div className="public-stat public-blood"><Icon name="blood" className="h-6 w-6" /><div><dt>Blood type</dt><dd>{profile.bloodType}</dd></div></div>}
            {profile.age !== undefined && <div className="public-stat"><Icon name="calendar" className="h-6 w-6" /><div><dt>Calculated age</dt><dd>{profile.age} <span className="text-base font-normal text-secondary">{profile.age === 1 ? "year" : "years"}</span></dd></div></div>}
          </dl>}
        </div>
        {profile ? <div className="public-information-note mt-6"><span className="public-notice-icon"><Icon name="warning" /></span><div>
          <p><strong>Information is provided by the owner</strong> and is not medically verified.</p>
        </div></div> : <div role="status" className="mt-4 text-base leading-7 text-secondary">
          {result.state === "loading" ? <p>Please wait while we load the shared information.</p>
            : result.state === "unavailable" ? <p>This link cannot show emergency information. It may be inactive or no longer available.</p>
              : result.state === "limited" ? <p>Please wait before trying again.</p>
                : <p>Check your connection and try again.</p>}
          {["error", "limited"].includes(result.state) && <button type="button" disabled={wait > 0} onClick={() => setAttempt(value => value + 1)} className="primary-button mt-5 sm:w-auto">{wait > 0 ? `Try again in ${wait} seconds` : "Try again"}</button>}
        </div>}
      </section>
      {profile && <div className="public-detail-grid">
        {hasContacts && <section aria-labelledby="public-contacts-title" className="profile-section public-contacts">
          <h2 id="public-contacts-title" className="mb-5 flex items-center gap-3 font-heading text-xl font-bold"><span className="section-icon bg-rose-50 text-primary"><Icon name="phone" /></span>Emergency contacts</h2>
          <ul className="space-y-4">{profile.emergencyContact.map((contact, index) => <li key={index} className="public-contact-card">
            <h3 className="break-words font-heading text-lg font-bold">{contact.name}</h3>
            {contact.relation && <p className="mt-1 break-words text-base text-secondary">{contact.relation}</p>}
            <p className="my-4 break-all border-t border-line pt-4 text-base font-semibold">{contact.phone}</p>
            <a href={`tel:${contact.phone}`} className="primary-button"><Icon name="phone" /><span className="min-w-0 break-words">Call {contact.name}</span></a>
          </li>)}</ul>
        </section>}
        <div className="public-medical-sections">
          {medicalSections.map(([key, label, icon]) => profile[key]?.length > 0 && <section key={key} aria-labelledby={`public-${key}-title`} className={`public-medical-card public-${key}`}>
            <div className="public-medical-header">
              <h2 id={`public-${key}-title`} className="flex min-w-0 items-center gap-3 font-heading text-xl font-bold"><span className="section-icon"><Icon name={icon} /></span>{label}</h2>
              <span className="public-entry-count">{profile[key].length} {profile[key].length === 1 ? "entry" : "entries"}</span>
            </div>
            <ul className="space-y-3 p-5 sm:p-7">{profile[key].map((entry, index) => <li key={index} className="public-medical-entry"><span aria-hidden="true" className="public-entry-dot" /><span className="min-w-0 break-words text-base leading-7">{entry}</span></li>)}</ul>
          </section>)}
          {profile.additionalInformation && <section aria-labelledby="public-additional-information-title" className="public-medical-card public-additionalInformation">
            <div className="public-medical-header"><h2 id="public-additional-information-title" className="flex items-center gap-3 font-heading text-xl font-bold"><span className="section-icon"><Icon name="info" /></span>Additional information</h2></div>
            <p className="whitespace-pre-wrap break-words p-5 text-base leading-7 sm:p-7">{profile.additionalInformation}</p>
          </section>}
        </div>
        <section aria-labelledby="public-guidelines-title" className="profile-section public-guidelines">
          <div className="mb-5 flex items-start gap-3"><span className="section-icon bg-rose-50 text-primary"><Icon name="info" /></span><div><h2 id="public-guidelines-title" className="font-heading text-xl font-bold">What to do next</h2><p className="mt-1 text-sm text-secondary">For anyone helping</p></div></div>
          <p className="public-guidelines-callout">Urgent help needed? Call 112 first. Don’t delay to read this profile.</p>
          <ol className="public-guideline-list">{guidelines.map(([heading, body], index) => <li key={heading}><span aria-hidden="true" className="public-step-number">{index + 1}</span><p><strong className="block">{heading}</strong> {body}</p></li>)}</ol>
          <p className="mt-5 border-t border-line pt-4 text-sm leading-6 text-secondary">Missing details do not mean there are no allergies, conditions, or medications.</p>
        </section>
      </div>}
    </main>
    <footer className="border-t border-line bg-white/90 px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl text-center text-sm leading-6">
        <p className="text-secondary">Emergency QR shares information. It does not provide medical advice or replace emergency services.</p></div>
    </footer>
  </div>;
}
