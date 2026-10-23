import Icon from "./Icon.jsx";

export default function SharingToggle({ label, value, onChange }) {
  return <button type="button" role="switch" aria-checked={value} aria-label={`Share ${label.toLowerCase()} publicly`}
    onClick={() => onChange(!value)} className="sharing-toggle">
    <Icon name={value ? "globe" : "lock"} className="h-4 w-4" />
    <span>{value ? "Public" : "Private"}</span>
    <span aria-hidden="true" className={`ml-1 flex h-4 w-7 items-center rounded-full p-0.5 ${value ? "justify-end bg-white/30" : "bg-secondary/25"}`}>
      <span className="h-3 w-3 rounded-full bg-white" />
    </span>
  </button>;
}
