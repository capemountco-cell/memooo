import "@fontsource-variable/figtree";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { windowView } from "./lib/native";
import "./styles.css";
import { Mini } from "./views/Mini";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element in index.html.");

createRoot(root).render(<StrictMode>{windowView() === "mini" ? <Mini /> : <App />}</StrictMode>);
