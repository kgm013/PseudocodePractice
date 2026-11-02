import { useEffect, useState } from "react";

// Pages live after the # (e.g. #/compiler) because GitHub Pages can't serve
// other paths: refreshing on /compiler would give a 404.

const readPath = () => window.location.hash.replace(/^#/, "") || "/";

/** The current page path, such as "/" or "/practice/ol". */
export function useHashRoute() {
  const [path, setPath] = useState(readPath);

  useEffect(() => {
    const onChange = () => {
      setPath(readPath());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return path;
}
