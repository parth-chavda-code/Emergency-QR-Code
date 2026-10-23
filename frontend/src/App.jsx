import { useCallback, useEffect, useRef, useState } from "react";
import AuthLayout from "./components/AuthLayout.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import Profile from "./pages/Profile.jsx";
import QrManagement from "./pages/QrManagement.jsx";
import { logoutEverywhere } from "./api.js";

const currentPage = () => ["signup", "profile", "qr"].includes(window.location.hash.slice(2)) ? window.location.hash.slice(2) : "login";

export default function App() {
  const [page, setPage] = useState(currentPage);
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  // The JWT lives only in memory. Never persist passwords or tokens to browser storage.
  const [session, setSession] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [qrDownloadAtRisk, setQrDownloadAtRisk] = useState(false);
  const [qrVisited, setQrVisited] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const [logoutFailure, setLogoutFailure] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const logoutBusy = useRef(false);
  const sessionRef = useRef(null);

  const endSession = useCallback((message = "Your session has ended. Please sign in again.") => {
    sessionRef.current = null;
    setSession(null); setDirty(false); setQrDownloadAtRisk(false); setQrVisited(false); setConfirmSignOut(false); setLogoutFailure("");
    setSignOutPending(false);
    setNotice(message); window.location.hash = "/login";
  }, []);

  useEffect(() => {
    function navigate() { setPage(currentPage()); window.scrollTo(0, 0); }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    document.title = `${session ? page === "qr" ? "Your QR" : "Your profile" : page === "signup" ? "Create account" : "Sign in"} · Emergency QR`;
  }, [page, session]);

  useEffect(() => { if (session && page === "qr") setQrVisited(true); }, [session, page]);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      endSession("Your sign-in has expired. Please sign in again.");
    }, session.expiresIn * 1000);
    return () => clearTimeout(timer);
  }, [session, endSession]);

  function signedIn(data) {
    sessionRef.current = data;
    setSession(data); setNotice(""); setLogoutFailure("");
    window.location.hash = "/profile";
  }

  async function signOut() {
    if (!session || logoutBusy.current) return;
    const activeSession = session;
    logoutBusy.current = true; setSignOutPending(true); setLogoutFailure("");
    try {
      await logoutEverywhere(activeSession.token);
      if (sessionRef.current?.token !== activeSession.token) return;
      endSession("Signed out of all devices.");
    } catch (error) {
      if (sessionRef.current?.token !== activeSession.token) return;
      if (error.status === 401) endSession(error.message);
      else setLogoutFailure("We couldn't confirm sign-out from all devices. Please try again. Your profile is still open.");
    } finally { logoutBusy.current = false; setSignOutPending(false); }
  }

  function signedUp(address) {
    setEmail(address);
    setNotice("Your account is ready. Sign in to continue.");
    window.location.hash = "/login";
  }

  return <AuthLayout page={page} signedIn={Boolean(session)} onNavigate={() => setNotice("")}
    onSignOut={() => dirty || qrDownloadAtRisk ? setConfirmSignOut(true) : signOut()} signOutPending={signOutPending}>
    {session && (confirmSignOut || logoutFailure) && <section aria-label="Sign out" className="mx-auto mt-5 w-full max-w-7xl px-5 sm:px-8">
      <div className="border border-line bg-white p-5">
        {logoutFailure && <p role="alert" className="text-base text-error">{logoutFailure}</p>}
        {confirmSignOut && <p className="text-base">You have unsaved profile changes or a pending QR you have not confirmed saving. Signing out clears this browser’s draft and QR download. Sign out of all devices?</p>}
        <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={signOutPending} onClick={signOut} className="secondary-button">{signOutPending ? "Signing out…" : "Sign out of all devices"}</button>
          <button type="button" disabled={signOutPending} onClick={() => { setConfirmSignOut(false); setLogoutFailure(""); }} className="secondary-button">Keep editing</button></div>
      </div>
    </section>}
    {session ? <>
      {/* Keep drafts and the issued QR link only in memory while switching views. */}
      <div hidden={page === "qr"}><Profile key={session.token} token={session.token} onSessionEnd={endSession} onDirtyChange={setDirty} signOutPending={signOutPending} /></div>
      {(qrVisited || page === "qr") && <div hidden={page !== "qr"}><QrManagement key={session.token} token={session.token} visible={page === "qr"} onSessionEnd={endSession} onDirtyChange={setQrDownloadAtRisk} signOutPending={signOutPending} /></div>}
    </>
      : page === "signup" ? <Signup onSuccess={signedUp} /> : <Login email={email} notice={notice} onSuccess={signedIn} />}
  </AuthLayout>;
}
