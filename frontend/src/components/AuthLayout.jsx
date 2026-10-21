import { useRef } from "react";
import Icon from "./Icon.jsx";

export default function AuthLayout({ page, signedIn, onNavigate, children }) {
  const mainRef = useRef(null);
  return <div className="flex min-h-dvh flex-col">
    <a href="#main" onClick={event => { event.preventDefault(); mainRef.current?.focus(); }} className="skip-link">Skip to content</a>
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <a href="#/login" onClick={onNavigate} aria-label="Emergency QR home" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center bg-primary text-white"><Icon name="qr" className="h-6 w-6" /></span>
          <span className="font-heading text-lg font-bold tracking-tight sm:text-xl">EMERGENCY QR</span>
        </a>
        <div className="hidden items-center gap-2 border border-green-800/15 bg-success/7 px-3 py-2 text-success lg:flex">
          <Icon name="shield" className="h-4 w-4" /><span className="eyebrow text-[10px]">Your information. Your choice.</span>
        </div>
        {!signedIn && <nav aria-label="Account" className="flex gap-1">
          {[['login', 'Sign in'], ['signup', 'Create account']].map(([value, label]) =>
            <a key={value} href={`#/${value}`} onClick={onNavigate} aria-current={page === value ? "page" : undefined}
              className={`px-3 py-2 font-heading text-xs font-bold uppercase tracking-wider sm:text-sm ${page === value ? "bg-panel text-ink" : "text-secondary hover:bg-wash"}`}>
              {label}
            </a>)}
        </nav>}
      </div>
    </header>
    <main id="main" ref={mainRef} className="flex flex-1 flex-col" tabIndex={-1}>{children}</main>
    <footer className="mt-auto border-t border-primary/15 bg-primary/5 px-5 py-4">
      <p className="mx-auto flex max-w-4xl items-start justify-center gap-2 text-center text-xs leading-5 text-secondary">
        <Icon name="info" className="mt-0.5 h-4 w-4 text-primary" />
        <span>Emergency QR is an information-sharing tool. It does not provide medical advice or replace emergency services.</span>
      </p>
    </footer>
  </div>;
}
