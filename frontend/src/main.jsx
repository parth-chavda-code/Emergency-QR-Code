import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PublicEmergency from "./pages/PublicEmergency.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>{/^\/e(?:\/|$)/.test(window.location.pathname) ? <PublicEmergency /> : <App />}</StrictMode>,
);
