import { useState } from "react";
import { stickerStyles, selectedDownloadsRequested } from "../qrStickers.js";
import Icon from "./Icon.jsx";

export default function QrStickerPicker({ images, disabled, onSelectionChange, onDownloadState }) {
  const [selected, setSelected] = useState(["red"]);
  const [requested, setRequested] = useState([]);
  const [surface, setSurface] = useState("light");
  function choose(id) {
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    setSelected(next);
    onSelectionChange();
    onDownloadState(selectedDownloadsRequested(next, requested));
  }
  function markDownloaded(ids) {
    const next = [...new Set([...requested, ...ids])];
    setRequested(next); onDownloadState(selectedDownloadsRequested(selected, next));
  }
  function downloadSelected() {
    for (const id of selected) {
      const link = document.createElement("a");
      link.href = images[id]; link.download = `emergency-qr-${id}.png`;
      document.body.appendChild(link); link.click(); link.remove();
    }
    markDownloaded(selected);
  }
  return <div className="qr-sticker-picker my-5">
    <h4 className="font-heading text-lg font-bold">Choose your sticker designs</h4>
    <p className="mt-2 text-sm leading-6 text-secondary">Select one, two, or all three. Every design uses the same QR link.</p>
    <label className="mt-4 block text-sm font-semibold" htmlFor="sticker-surface">Preview background</label>
    <select id="sticker-surface" className="form-input mt-2" value={surface} onChange={event => setSurface(event.target.value)}>
      <option value="light">Light grey</option><option value="dark">Dark charcoal</option><option value="bright">Bright coral</option>
    </select>
    <p className="mt-2 text-sm leading-6 text-secondary">The background is for preview only. It won’t appear in your download.</p>
    <div className="mt-4 space-y-4">{stickerStyles.map(style => <div key={style.id} className="rounded-xl border border-line bg-white p-3">
      <label className="mb-3 flex min-h-11 items-center gap-3 font-semibold"><input type="checkbox" checked={selected.includes(style.id)} disabled={disabled} onChange={() => choose(style.id)} className="h-5 w-5 accent-primary" />{style.name}{style.id === "red" && <span className="text-sm font-normal text-secondary">Default</span>}</label>
      <div className={`qr-sticker-surface qr-sticker-surface-${surface}`}><img src={images[style.id]} alt={`${style.name} pending emergency QR sticker`} className="block h-auto w-full" /></div>
      {selected.includes(style.id) && <a className={`secondary-button mt-3 w-full ${disabled ? "pointer-events-none opacity-60" : ""}`} href={images[style.id]} download={`emergency-qr-${style.id}.png`} aria-disabled={disabled} onClick={event => { if (disabled) { event.preventDefault(); return; } markDownloaded([style.id]); }}><Icon name="download" />Download {style.name} (PNG)</a>}
    </div>)}</div>
    <button type="button" className="secondary-button mt-4 w-full" disabled={disabled || !selected.length} onClick={downloadSelected}><Icon name="download" />Download selected designs ({selected.length})</button>
    <p className="mt-3 text-sm leading-6 text-secondary">Your browser may block multiple downloads. Use the individual buttons if a file is missing. Check that every selected PNG is saved and opens correctly before confirming below.</p>
    <p role="status" className="mt-2 text-sm leading-6 text-secondary">{!selected.length ? "Select at least one design."
      : selectedDownloadsRequested(selected, requested) ? "Downloads requested for all selected designs. You can confirm your saved copies below."
        : `Still to download: ${stickerStyles.filter(style => selected.includes(style.id) && !requested.includes(style.id)).map(style => style.name).join(", ")}.`}</p>
    <p className="mt-3 text-sm leading-6 text-secondary">Keep the QR’s white margin intact. Test a printed sample with your phone before using the sticker. Replacing or revoking this QR affects every design.</p>
  </div>;
}
