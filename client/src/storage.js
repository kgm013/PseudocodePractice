// Code and settings are kept between visits (localStorage). Files are only kept for
// this browser session (sessionStorage): they survive a refresh but are cleared when
// the tab is closed. Students download a file to keep it.
export function load(key, fallback, store = localStorage) {
  try {
    const v = store.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** Returns false when the browser refused to save (storage full or blocked). */
export function save(key, value, store = localStorage) {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
