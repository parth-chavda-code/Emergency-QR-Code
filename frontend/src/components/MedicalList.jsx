import { useRef } from "react";
import SharingToggle from "./SharingToggle.jsx";
import Icon from "./Icon.jsx";

export default function MedicalList({ category, label, singular, values, shared, onChange, onSharingChange, errors }) {
  const listRef = useRef(null);
  function add() {
    if (values.length >= 30) return;
    onChange([...values, ""]);
    requestAnimationFrame(() => listRef.current?.querySelectorAll("input")[values.length]?.focus());
  }
  return <section aria-labelledby={`${category}-title`} className={`profile-field medical-category medical-${category}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h3 id={`${category}-title`} className="font-heading text-lg font-bold">{label} <span className="ml-1 text-sm font-normal text-secondary">{values.length}/30 · Optional</span></h3>
      <SharingToggle label={label} value={shared} onChange={onSharingChange} />
    </div>
    <div ref={listRef} className="flex flex-col gap-3">
      {values.map((value, index) => <div key={index} className="medical-entry">
        <label className="sr-only" htmlFor={`${category}.${index}`}>{singular} {index + 1}</label>
        <div className="flex items-start gap-2">
          <input id={`${category}.${index}`} name={`${category}.${index}`} value={value} maxLength={500}
            aria-invalid={Boolean(errors[`${category}.${index}`])} aria-describedby={errors[`${category}.${index}`] ? `${category}.${index}-error` : undefined}
            onChange={event => onChange(values.map((entry, i) => i === index ? event.target.value : entry))}
            className="form-input min-w-0 flex-1" placeholder={`Enter ${singular.toLowerCase()}`} />
          <button type="button" onClick={() => onChange(values.filter((_, i) => i !== index))}
            aria-label={`Remove ${singular.toLowerCase()} ${index + 1}`} className="flex min-h-12 min-w-11 items-center justify-center text-primary hover:bg-wash"><Icon name="trash" /></button>
        </div>
        {errors[`${category}.${index}`] && <p id={`${category}.${index}-error`} className="mt-2 text-base text-error">{errors[`${category}.${index}`]}</p>}
      </div>)}
    </div>
    {!values.length && <p className="mb-3 text-base text-secondary">No entries added.</p>}
    {errors[category] && <p className="my-2 text-base text-error">{errors[category]}</p>}
    <button type="button" onClick={add} disabled={values.length >= 30} className="secondary-button mt-3 w-full"><Icon name="plus" className="h-4 w-4" />{values.length >= 30 ? "30-entry limit reached" : `Add ${singular.toLowerCase()}`}</button>
  </section>;
}
