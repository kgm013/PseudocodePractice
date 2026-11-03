/** Renders text where `backticked` parts are shown as code, e.g. "Show values with `OUTPUT`." */
export default function InlineCode({ text }) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i} className="inline-code">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
