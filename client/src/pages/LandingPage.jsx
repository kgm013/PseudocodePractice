const SECTIONS = [
  {
    href: "#/practice/ol",
    title: "O Level / IGCSE Practice",
    code: "2210 · 0478",
    text: "Questions by topic, from variables and output to arrays and files. Write your answer and check it.",
  },
  {
    href: "#/practice/as",
    title: "AS Level Practice",
    code: "9618",
    text: "Questions by topic for AS Level pseudocode, including records, string functions and file handling.",
  },
  {
    href: "#/compiler",
    title: "Compiler",
    code: "All levels",
    text: "Write and run any pseudocode program, with input, output and text files.",
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <div className="landing-intro">
        <h1>Practise Cambridge pseudocode</h1>
        <p>
          Questions by topic for O Level / IGCSE (2210, 0478) and AS Level (9618), plus a compiler to run your own
          programs.
        </p>
      </div>
      <nav className="landing-cards" aria-label="Sections">
        {SECTIONS.map((s) => (
          <a key={s.href} href={s.href} className="landing-card">
            <span className="landing-card-code">{s.code}</span>
            <span className="landing-card-title">{s.title}</span>
            <span className="landing-card-text">{s.text}</span>
            <span className="landing-card-go" aria-hidden="true">
              Open →
            </span>
          </a>
        ))}
      </nav>
    </div>
  );
}
