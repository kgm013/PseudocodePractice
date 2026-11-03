/** "Home / O Level / IGCSE / Variables": items are { label, href }; the last one is the current page. */
export default function Breadcrumbs({ items }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, i) => {
          const current = i === items.length - 1;
          return (
            <li key={item.href ?? item.label}>
              {current ? (
                <span aria-current="page">{item.label}</span>
              ) : (
                <a href={item.href}>{item.label}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
