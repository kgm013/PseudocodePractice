import { useEffect, useState } from "react";
import { LEVEL } from "./config.js";
import { LEVEL_NAMES } from "@shared/interpreter/index.ts";
import SiteHeader from "./components/SiteHeader.jsx";
import FeedbackFooter from "./components/FeedbackFooter.jsx";
import LevelSwitch from "./components/LevelSwitch.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import CompilerPage from "./pages/CompilerPage.jsx";
import PracticePage from "./pages/PracticePage.jsx";
import TopicPage from "./pages/TopicPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import { getLevel, getTopic, levelHref } from "./practice/topics.js";
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

  // From a topic page: open the compiler at that topic's level.
  const openCompiler = (compilerLevel) => {
    setLevel(compilerLevel);
    window.location.hash = "#/compiler";
  };

  const page = pageFor(path, level, openCompiler);

  useEffect(() => {
    document.title = page.title ? `${page.title} | ${SITE}` : SITE;
  }, [page.title]);

  return (
    <main className="page">
      <SiteHeader theme={theme} onToggleTheme={toggleTheme}>
        {page.id === "compiler" && <LevelSwitch level={level} onChange={setLevel} />}
      </SiteHeader>
      {page.element}
      <FeedbackFooter />
    </main>
  );
}

/**
 * Picks the page for a path such as "/compiler" or "/practice/ol/variables".
 * The bare home path shows the landing page; anything unknown shows "not found".
 */
function pageFor(path, level, openCompiler) {
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0) return { id: "home", title: "", element: <LandingPage /> };

  if (parts[0] === "compiler" && parts.length === 1) {
    return { id: "compiler", title: `Compiler (${LEVEL_NAMES[level]})`, element: <CompilerPage level={level} /> };
  }

  if (parts[0] === "practice") {
    const practiceLevel = getLevel(parts[1]);
    if (practiceLevel && parts.length === 2) {
      return {
        id: `practice-${practiceLevel.id}`,
        title: `${practiceLevel.name} Practice`,
        element: <PracticePage level={practiceLevel} />,
      };
    }
    const entry = parts.length === 3 ? getTopic(parts[1], parts[2]) : null;
    if (entry) {
      return {
        id: `topic-${entry.level.id}-${entry.topic.id}`,
        title: `${entry.topic.title} | ${entry.level.name} Practice`,
        element: <TopicPage entry={entry} onOpenCompiler={openCompiler} />,
      };
    }
    if (practiceLevel) {
      const back = { backHref: levelHref(practiceLevel.id), backLabel: `See all ${practiceLevel.name} topics` };
      return { id: "not-found", title: "Page not found", element: <NotFoundPage {...back} /> };
    }
  }

  return { id: "not-found", title: "Page not found", element: <NotFoundPage /> };
}
