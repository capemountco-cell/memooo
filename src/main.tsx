import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ensureAnonAuth } from "./lib/anonAuth";

// Bootstrap anonymous auth before rendering
ensureAnonAuth();

createRoot(document.getElementById("root")!).render(<App />);
