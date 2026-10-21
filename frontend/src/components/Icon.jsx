const paths = {
  qr: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v3m0 6v3m-9-3h3m6 6v3m9-9h-3",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  lock: "M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3m-4 5v2",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2H4Z",
  mail: "M3 5h18v14H3zM3 5l9 7 9-7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  eyeOff: "m3 3 18 18M10 5a11 11 0 0 1 2 0c6 0 10 7 10 7a22 22 0 0 1-4 4M6 6a22 22 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1m-7-8a3 3 0 0 0 4 4",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  info: "M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  check: "m5 12 4 4L19 6",
  refresh: "M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3",
};

export default function Icon({ name, className = "", ...props }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`h-5 w-5 shrink-0 ${className}`} {...props}>
    <path d={paths[name] || paths.info} />
  </svg>;
}
