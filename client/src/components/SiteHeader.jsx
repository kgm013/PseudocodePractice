export const YOUTUBE_URL = "https://www.youtube.com/@zainematics";
export const INSTAGRAM_URL = "https://www.instagram.com/kurlyatzainematics/";

/** The header on every page: site name, page-specific controls, social links and theme toggle. */
export default function SiteHeader({ theme, onToggleTheme, children }) {
  return (
    <header className="header">
      <a href="#/" className="brand" aria-label="Zainematics Pseudocode Practice, home">
        <span className="brand-name">Zainematics</span>
        <span className="brand-title">Pseudocode Practice</span>
      </a>
      {children}
      <div className="header-actions">
        <a className="social-link" href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer">
          <YouTubeIcon />
          <span className="social-label">YouTube</span>
        </a>
        <a className="social-link" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
          <InstagramIcon />
          <span className="social-label">Instagram</span>
        </a>
        <button type="button" className="theme-toggle" onClick={onToggleTheme}>
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span> {theme === "dark" ? "Light" : "Dark"} mode
        </button>
      </div>
    </header>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="2" y="5" width="20" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.3" cy="6.7" r="1.2" fill="currentColor" />
    </svg>
  );
}
