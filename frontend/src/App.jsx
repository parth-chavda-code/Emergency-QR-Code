import { useEffect, useState } from "react";
import AuthLayout from "./components/AuthLayout.jsx";
import Icon from "./components/Icon.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";

const currentPage = () => window.location.hash === "#/signup" ? "signup" : "login";

export default function App() {
  const [page, setPage] = useState(currentPage);
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  // The JWT lives only in memory. Never persist passwords or tokens to browser storage.
  const [session, setSession] = useState(null);

  useEffect(() => {
    function navigate() { setPage(currentPage()); window.scrollTo(0, 0); }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    document.title = `${session ? "Signed in" : page === "signup" ? "Create account" : "Sign in"} · Emergency QR`;
  }, [page, session]);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      setSession(null);
      setNotice("Your sign-in has expired. Please sign in again.");
      window.location.hash = "/login";
    }, session.expiresIn * 1000);
    return () => clearTimeout(timer);
  }, [session]);

  function signedUp(address) {
    setEmail(address);
    setNotice("Your account is ready. Sign in to continue.");
    window.location.hash = "/login";
  }

  return <AuthLayout page={page} signedIn={Boolean(session)} onNavigate={() => setNotice("")}>
    {session ? <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-14">
      <section aria-labelledby="signed-in-title" className="auth-card p-8 text-center sm:p-10">
        <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success"><Icon name="check" className="h-7 w-7" /></span>
        <p className="eyebrow mb-3 text-success" role="status">Sign-in successful</p>
        <h1 id="signed-in-title" className="font-heading text-3xl font-bold tracking-tight">Welcome, {session.user.firstName}</h1>
        <p className="mt-4 leading-7 text-secondary">You’re signed in. Profile and QR screens will be added in the next frontend step.</p>
        <p className="mt-6 border-t border-line pt-5 text-sm leading-6 text-secondary">For now, refreshing this page clears your sign-in here. Your account remains saved.</p>
      </section>
    </div> : page === "signup" ? <Signup onSuccess={signedUp} /> : <Login email={email} notice={notice} onSuccess={setSession} />}
  </AuthLayout>;
}
