import { useState } from "react";
import Icon from "./Icon.jsx";

export default function FormField({ label, name, type = "text", value, onChange, error, hint, icon, labelAction, required = true, ...props }) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  return <div className="min-w-0">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={name} className="field-label">{label}</label>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold tracking-wider text-secondary">{required ? "REQUIRED" : "OPTIONAL"}</span>{labelAction}</div>
    </div>
    <div className="relative">
      <input id={name} name={name} type={isPassword && visible ? "text" : type}
        value={value} onChange={onChange} required={required} aria-invalid={Boolean(error)}
        aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined}
        className={`form-input ${isPassword || icon ? "pr-12" : ""}`} {...props} />
      {isPassword ? <button type="button" onClick={() => setVisible(!visible)}
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-secondary hover:text-ink">
        <Icon name={visible ? "eyeOff" : "eye"} />
      </button> : icon && <Icon name={icon} className="pointer-events-none absolute right-4 top-3.5 text-secondary" />}
    </div>
    {hint && <p id={hintId} className="mt-2 text-sm leading-5 text-secondary">{hint}</p>}
    {error && <p id={errorId} className="mt-2 text-base font-medium text-error">{error}</p>}
  </div>;
}
