import { useEffect, useState } from "react";
import { LEVEL } from "./config.js";
import { LEVEL_NAMES } from "@shared/interpreter/index.ts";
import SiteHeader from "./components/SiteHeader.jsx";
import LevelSwitch from "./components/LevelSwitch.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import CompilerPage from "./pages/CompilerPage.jsx";
import PracticePage from "./pages/PracticePage.jsx";
import { useHashRoute } from "./useHashRoute.js";
import { load, save } from "./storage.js";

const LEVEL_KEY = "pseudo-practice:level";
const DEFAULT_LEVEL = LEVEL === "AS Levels" ? "AS" : "O";
const THEME_KEY = "pseudo-practice:theme";
const SITE = "Pseudocode Practice | Zainematics";

// index.html has already set data-theme (saved choice, else the system setting).
function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    save(THEME_KEY, next);
    setTheme(next);
  };
  return [theme, toggle];
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const path = useHashRoute();
  // The compiler's O Level / IGCSE or AS Level choice, remembered between visits.
  const [level, setLevel] = useState(() => {
    const saved = load(LEVEL_KEY, DEFAULT_LEVEL);
    return saved === "O" || saved === "AS" ? saved : DEFAULT_LEVEL;
  });

  useEffect(() => {
    save(LEVEL_KEY, level);
  }, [level]);

  const page = pageFor(path, level);

  useEffect(() => {
    document.title = page.title ? `${page.title} | ${SITE}` : SITE;
  }, [page.title]);

  return (
    <main className="page">
      <SiteHeader theme={theme} onToggleTheme={toggleTheme}>
        {page.id === "compiler" && <LevelSwitch level={level} onChange={setLevel} />}
      </SiteHeader>
      {page.element}
    </main>
  );
}

/** Picks the page for a path such as "/compiler". Unknown paths show the landing page. */
function pageFor(path, level) {
  switch (path.replace(/\/+$/, "")) {
    case "/compiler":
      return { id: "compiler", title: `Compiler (${LEVEL_NAMES[level]})`, element: <CompilerPage level={level} /> };
    case "/practice/ol":
      return { id: "practice-ol", title: "O Level / IGCSE Practice", element: <PracticePage title="O Level / IGCSE Practice" /> };
    case "/practice/as":
      return { id: "practice-as", title: "AS Level Practice", element: <PracticePage title="AS Level Practice" /> };
    default:
      return { id: "home", title: "", element: <LandingPage /> };
  }
}
