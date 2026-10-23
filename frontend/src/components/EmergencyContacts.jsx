import { useRef } from "react";
import FormField from "./FormField.jsx";
import SharingToggle from "./SharingToggle.jsx";
import Icon from "./Icon.jsx";

export default function EmergencyContacts({ values, shared, onChange, onSharingChange, errors }) {
  const listRef = useRef(null);
  function change(index, field, value) {
    onChange(values.map((contact, i) => i === index ? { ...contact, [field]: value } : contact));
  }
  function add() {
    if (values.length >= 5) return;
    onChange([...values, { name: "", phone: "", relation: "" }]);
    requestAnimationFrame(() => listRef.current?.querySelectorAll("fieldset")[values.length]?.querySelector("input")?.focus());
  }
  return <section aria-labelledby="contacts-title" className="profile-section owner-contacts-section">
    <div className="section-heading"><h2 id="contacts-title" tabIndex={-1} className="flex flex-wrap items-center gap-2"><span className="owner-section-number">03</span>Emergency contacts <span className="text-base font-normal text-secondary">{values.length}/5</span></h2>
      <SharingToggle label="Emergency contacts" value={shared} onChange={onSharingChange} />
    </div>
    <p className="mb-5 text-base leading-6 text-secondary">Optional, up to five contacts. Making this category public shares every contact, including contacts you add later. You may save without any contacts.</p>
    <div ref={listRef} className="flex flex-col gap-4">
      {values.map((contact, index) => <fieldset key={index} className="profile-field owner-contact-field min-w-0">
        <legend className="field-label px-1">Contact {index + 1}</legend>
        <div className="mb-4 flex justify-end"><button type="button" aria-label={`Remove contact ${index + 1}`}
          onClick={() => onChange(values.filter((_, i) => i !== index))} className="text-link min-h-10"><Icon name="trash" className="h-4 w-4" />Remove contact</button></div>
        <div className="grid gap-4 xl:grid-cols-3">
          <FormField label={`Contact ${index + 1} name`} name={`emergencyContact.${index}.name`} value={contact.name}
            onChange={event => change(index, "name", event.target.value)} error={errors[`emergencyContact.${index}.name`]} autoComplete="off" />
          <FormField label={`Contact ${index + 1} phone`} name={`emergencyContact.${index}.phone`} type="tel" value={contact.phone}
            onChange={event => change(index, "phone", event.target.value)} error={errors[`emergencyContact.${index}.phone`]}
            placeholder="+919876543210" hint="Include + and the country code." autoComplete="off" />
          <FormField label={`Contact ${index + 1} relationship`} name={`emergencyContact.${index}.relation`} value={contact.relation} required={false}
            onChange={event => change(index, "relation", event.target.value)} error={errors[`emergencyContact.${index}.relation`]} placeholder="e.g. Friend" autoComplete="off" />
        </div>
      </fieldset>)}
    </div>
    {!values.length && <p className="text-base text-secondary">No contacts added.</p>}
    {errors.emergencyContact && <p className="my-2 text-base text-error">{errors.emergencyContact}</p>}
    <button type="button" onClick={add} disabled={values.length >= 5} className="secondary-button mt-4 w-full"><Icon name="plus" />{values.length >= 5 ? "Five-contact limit reached" : "Add emergency contact"}</button>
  </section>;
}
