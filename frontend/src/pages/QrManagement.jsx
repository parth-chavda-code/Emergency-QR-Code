import { useCallback, useEffect, useRef, useState } from "react";
import { createStickerImages } from "../qrStickers.js";
import QrStickerPicker from "../components/QrStickerPicker.jsx";
import { activateQr, getPublicPreview, getQrStatus, issueQr, revokeQr } from "../qrApi.js";
import PublicPreview from "../components/PublicPreview.jsx";
import Icon from "../components/Icon.jsx";

export default function QrManagement({ token, visible, onSessionEnd, onDirtyChange, signOutPending }) {
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [issued, setIssued] = useState(null);
  const [image, setImage] = useState("");
  const [imageError, setImageError] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const [savedCopy, setSavedCopy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const alertRef = useRef(null);
  const confirmRef = useRef(null);
  const returnFocus = useRef(null);
  const pending = status?.pending;
  const active = status?.active;
  const hasLink = pending && issued?.credential.id === pending.id;
  const canConfirmCopy = !hasLink || Boolean(image && downloadRequested);
  const riskOfLosingDownload = Boolean(hasLink && !savedCopy);
  const disabled = loading || Boolean(working) || needsReview || signOutPending;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(riskOfLosingDownload); return () => onDirtyChange(false); }, [riskOfLosingDownload, onDirtyChange]);
  useEffect(() => { if (visible && failure) alertRef.current?.focus(); }, [failure, visible]);
  useEffect(() => { if (confirm) confirmRef.current?.focus(); }, [confirm]);
  // A saved-copy confirmation belongs to one particular pending QR.
  useEffect(() => { setSavedCopy(false); setDownloadRequested(false); }, [pending?.id]);
  useEffect(() => {
    if (!riskOfLosingDownload) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [riskOfLosingDownload]);

  const refresh = useCallback(async (signal, preserveNotice = false) => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setFailure(""); setConfirm(null);
    setSavedCopy(false); setDownloadRequested(false);
    if (!preserveNotice) setNotice("");
    try {
      const [newPreview, newStatus] = await Promise.all([getPublicPreview(token, signal), getQrStatus(token, signal)]);
      if (!mounted.current || signal?.aborted) return;
      setPreview(newPreview); setStatus(newStatus); setNeedsReview(false);
      setIssued(current => current?.credential.id === newStatus.pending?.id ? current : null);
    } catch (error) {
      if (!mounted.current || signal?.aborted) return;
      if (error.status === 401) onSessionEnd(error.message);
      else { setFailure(error.message); setNeedsReview(true); }
    } finally { busy.current = false; if (mounted.current && !signal?.aborted) setLoading(false); }
  }, [token, onSessionEnd]);

  useEffect(() => {
    if (!visible) return;
    // Do not cancel a mutation or discard an issued link when switching tabs.
    void refresh();
  }, [visible, refresh]);

  useEffect(() => {
    let current = true;
    setImage(""); setImageError(false); setDownloadRequested(false); setSavedCopy(false);
    if (issued) createStickerImages(issued.qrUrl).then(url => {
      if (current) setImage(url);
    }).catch(() => { if (current) setImageError(true); });
    return () => { current = false; };
  }, [issued, renderAttempt]);

  async function perform(action) {
    if (busy.current || disabled || !status || !preview) return;
    const target = confirm;
    let changed = false;
    busy.current = true; setWorking(action); setFailure(""); setNotice("");
    try {
      if (action === "generate") {
        const result = await issueQr(token, preview.profileRevision);
        if (!mounted.current) return;
        setIssued(result); setStatus(current => ({ ...current, pending: result.credential }));
        changed = true;
        setNotice("Pending QR created. Download it and confirm you saved it before activation.");
      } else if (action === "activate") {
        if (!pending || !canConfirmCopy || !savedCopy) return;
        const latest = await getPublicPreview(token);
        if (!mounted.current) return;
        setPreview(latest);
        if (latest.profileRevision !== preview.profileRevision || !latest.hasSharedInformation) {
          setNotice("Your sharing choices changed. Review the updated preview before activating."); return;
        }
        const credential = await activateQr(token, pending.id);
        if (!mounted.current) return;
        setStatus({ active: credential, pending: null }); setIssued(null);
        changed = true;
        setNotice(active ? "Replacement activated. Your previous QR is now disabled." : "Your QR is now active.");
      } else if (action === "revoke" && target) {
        await revokeQr(token, target.id);
        if (!mounted.current) return;
        setStatus(current => ({ ...current, [target.kind === "pending" ? "pending" : "active"]: null }));
        if (target.kind === "pending") setIssued(null);
        changed = true;
        setNotice(target.kind === "pending" ? "Pending QR discarded. Any existing active QR keeps working." : "Your QR has been revoked. Your saved profile remains.");
        closeConfirmation();
      }
    } catch (error) {
      if (!mounted.current) return;
      if (error.status === 401) onSessionEnd(error.message);
      else { setFailure(error.message); setNeedsReview(true); setConfirm(null); }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setWorking("");
        // Reconcile other-device changes before allowing another mutation.
        if (changed) await refresh(undefined, true);
      }
    }
  }

  function askConfirmation(event, kind, id) {
    returnFocus.current = event.currentTarget;
    setConfirm({ kind, id });
  }
  function closeConfirmation() {
    setConfirm(null); returnFocus.current?.focus();
  }

  return <div className="profile-page mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Manage your emergency QR</h1>
        <p className="mt-3 text-secondary">Review what you share. Create a QR you can download and control.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading || Boolean(working) || signOutPending} className="secondary-button"><Icon name="refresh" className="h-4 w-4" />Refresh QR status</button>
    </div>
    {failure && <div role="alert" tabIndex={-1} ref={alertRef} className="form-alert mb-6"><p>{failure}</p><p className="mt-2">Use “Refresh QR status” before making another change. If you have not saved a profile yet, <a href="#/profile" className="text-link">open your profile</a>.</p></div>}
    {notice && <p role="status" className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4 text-base text-success">{notice}</p>}
    {loading && <p role="status" className="profile-section mb-6">Loading your saved public preview and QR status…</p>}
    {preview && status && !loading && !needsReview && <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
      <PublicPreview preview={preview} />
      <div className="min-w-0 space-y-5">
        <section className="profile-section" aria-labelledby="qr-status-title" aria-busy={Boolean(working)}>
          <div className="section-heading"><h2 id="qr-status-title">Your QR code</h2>
            <span className={`rounded-full px-3 py-1 text-sm ${active ? "bg-green-50 text-success" : "bg-slate-100 text-secondary"}`}>{pending ? active ? "Replacement pending" : "Pending" : active ? "Active" : "None active"}</span></div>
          {active && <div className="profile-field mb-5 text-base leading-6">
            <h3 className="mb-2 font-bold">{pending ? "Current QR — active" : "Your emergency QR is active"}</h3>
            <p>{pending ? "Your current QR keeps working while the replacement is pending." : "Keep your downloaded QR safe. If you lose it, create a replacement."}</p>
            {!pending && <p className="mt-3 text-sm text-secondary">The original QR link cannot be retrieved after this browser session ends.</p>}
          </div>}
          {pending ? <div>
            <h3 className="font-heading text-lg font-bold">{active ? "Replacement QR — pending" : "Pending — not active"}</h3>
            {hasLink ? <>
              <p className="mt-3 text-base leading-6 text-secondary">Visitors cannot see your profile through this QR until you activate it.</p>
              {image ? <QrStickerPicker images={image} disabled={disabled}
                onSelectionChange={() => { setDownloadRequested(false); setSavedCopy(false); }}
                onDownloadState={value => { setDownloadRequested(value); setSavedCopy(false); }} />
                : imageError ? <div role="alert" className="my-5 text-base"><p>We couldn’t create the sticker images. Your pending QR is still saved.</p><button className="secondary-button mt-3" type="button" onClick={() => setRenderAttempt(value => value + 1)}>Retry images</button></div>
                  : <p role="status" className="my-5 text-base text-secondary">Creating sticker images…</p>}
            </> : <div className="profile-field my-4 text-base leading-6">
              <p className="font-bold">Download unavailable</p><p className="mt-2">The original link is no longer available in this browser session. If you already downloaded this pending QR, confirm below that you still have its PNG to activate it.</p>
              <p className="mt-2">If you no longer have the PNG, discard this pending QR and generate a new one.</p>
              {active && <p className="mt-2">Your existing active QR keeps working.</p>}
            </div>}
            <label className="my-5 flex items-start gap-3 text-base leading-6">
              <input type="checkbox" checked={savedCopy} disabled={disabled || !canConfirmCopy} onChange={event => setSavedCopy(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-primary" />
              {hasLink ? "I have downloaded and saved my selected sticker designs." : "I still have the PNG I downloaded for this pending QR."}
            </label>
            {active && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-base leading-6 text-amber-900">Activating this replacement will permanently disable your previous QR.</p>}
            <button type="button" onClick={() => void perform("activate")} disabled={disabled || !savedCopy || !canConfirmCopy || !preview.hasSharedInformation} className="primary-button"><Icon name="check" />{working === "activate" ? "Activating…" : active ? "Activate replacement" : "Activate QR"}</button>
            {!preview.hasSharedInformation && <p className="my-4 text-base text-secondary">Save at least one non-empty public field or category before activation.</p>}
            <button type="button" onClick={event => askConfirmation(event, "pending", pending.id)} disabled={disabled} className="secondary-button mt-4 w-full">Discard {active ? "replacement" : "pending QR"}</button>
          </div> : <>
            {!active && <div className="mb-5 py-4 text-center"><Icon name="qr" className="mx-auto mb-3 h-10 w-10 text-secondary" /><h3 className="font-heading text-lg font-bold">No active or pending QR</h3><p className="mt-3 text-base leading-6 text-secondary">Generate a pending QR, download it, then activate it when you’re ready.</p></div>}
            {!preview.hasSharedInformation && <p className="mb-4 text-base leading-6 text-secondary">Choose at least one non-empty public field or category on your profile and save it before generating a QR.</p>}
            <button type="button" disabled={disabled || !preview.hasSharedInformation} onClick={() => void perform("generate")} className="primary-button"><Icon name={active ? "refresh" : "plus"} />{working === "generate" ? "Generating…" : active ? "Replace QR" : "Generate QR"}</button>
          </>}
          {active && <button type="button" onClick={event => askConfirmation(event, "active", active.id)} disabled={disabled} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 text-base font-bold text-primary disabled:opacity-60"><Icon name="trash" className="h-4 w-4" />Revoke active QR</button>}
          {confirm && <section ref={confirmRef} tabIndex={-1} role="region" aria-labelledby="qr-confirm-title" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <h3 id="qr-confirm-title" className="font-heading text-lg font-bold">{confirm.kind === "pending" ? "Discard pending QR?" : "Revoke your active QR?"}</h3>
            <p className="my-3 text-base leading-6">{confirm.kind === "pending" ? "This pending QR will stop working. Any existing active QR keeps working. After discarding, you can generate a new one."
              : "Anyone using this link will no longer be able to view your emergency profile. Your saved profile will remain."}</p>
            <div className="flex flex-wrap gap-3"><button type="button" disabled={Boolean(working) || signOutPending} onClick={closeConfirmation} className="secondary-button">{confirm.kind === "pending" ? "Keep pending QR" : "Keep QR active"}</button>
              <button type="button" disabled={disabled} onClick={() => void perform("revoke")} className="primary-button sm:w-auto">{working === "revoke" ? "Please wait…" : confirm.kind === "pending" ? "Discard pending QR" : "Revoke QR"}</button></div>
          </section>}
        </section>
        <aside className="profile-section text-base leading-6 text-secondary"><h2 className="mb-2 font-heading text-xl font-bold text-ink">You control access</h2><p>Anyone holding your active QR link can read the information you share. An internet connection is required.</p><p className="mt-3">Only one QR can be active at a time. You can keep one replacement pending.</p></aside>
      </div>
    </div>}
  </div>;
}
