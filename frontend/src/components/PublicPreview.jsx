import Icon from "./Icon.jsx";
import { sharingCategories } from "../profileForm.js";

export default function PublicPreview({ preview }) {
  return <section className="profile-section" aria-labelledby="public-preview-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="public-preview-title" className="flex items-center gap-2 font-heading text-xl font-bold"><Icon name="eye" />What visitors will see</h2>
      <a href="#/profile" className="text-link">Edit sharing choices <Icon name="arrow" className="h-4 w-4" /></a>
    </div>
    <p className="mb-6 mt-3 border-b border-line pb-4 text-base leading-6 text-secondary">This preview uses your saved sharing choices. Saved profile changes update what visitors see through your active QR.</p>
    {!preview.hasSharedInformation ? <div className="profile-field py-8 text-center">
      <Icon name="lock" className="mx-auto mb-3 h-7 w-7 text-secondary" />
      <h3 className="font-heading text-lg font-bold">Nothing is public yet.</h3>
      <p className="my-4 text-base leading-6 text-secondary">Choose at least one field or category to share, then save your profile.</p>
      <a href="#/profile" className="secondary-button">Edit profile</a>
    </div> : <dl className="space-y-4">
      {Object.entries(sharingCategories).map(([key, label]) => {
        const value = preview.publicProfile[key];
        if (value === undefined || (Array.isArray(value) && !value.length)) return null;
        return <div key={key} className="profile-field">
          <dt className="mb-2 text-sm font-bold uppercase tracking-wide text-secondary">{label}</dt>
          <dd className="break-words text-base leading-6">
            {key === "emergencyContact" ? <ul className="space-y-3">{value.map((contact, index) => <li key={index} className="rounded-xl border border-line bg-white p-3">
              <p className="font-bold">{contact.name}</p>{contact.relation && <p className="text-secondary">{contact.relation}</p>}
              <a href={`tel:${contact.phone}`} className="text-link min-h-11 break-all">{contact.phone}</a>
            </li>)}</ul> : Array.isArray(value) ? <ul className="list-disc space-y-2 pl-5">{value.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
              : key === "age" ? `${value} ${value === 1 ? "year" : "years"}` : <span className={key === "displayName" ? "font-heading text-xl font-bold" : key === "additionalInformation" ? "whitespace-pre-wrap" : ""}>{value}</span>}
          </dd>
        </div>;
      })}
    </dl>}
    <p className="mt-6 flex items-start gap-2 text-sm leading-5 text-secondary"><Icon name="lock" className="mt-0.5 h-4 w-4" />Your date of birth and private categories are never shown here. Information is entered by you and is not medically verified.</p>
  </section>;
}
