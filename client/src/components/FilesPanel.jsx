import { useState } from "react";

/** The simulated text files that OPENFILE / READFILE / WRITEFILE use. */
export default function FilesPanel({ files, onChange, disabled }) {
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(Object.keys(files).length > 0);
  const names = Object.keys(files).sort();

  const add = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || name in files) return;
    onChange({ ...files, [name]: "" });
    setNewName("");
  };

  const remove = (name) => {
    const next = { ...files };
    delete next[name];
    onChange(next);
  };

  return (
    <section className="panel files" aria-label="Files">
      <div className="panel-header">
        <button type="button" className="disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> Files
          {names.length > 0 && <span className="file-count">{names.length}</span>}
        </button>
      </div>
      {open && (
        <div className="files-body">
          <p className="hint">
            Text files your program can read with READFILE. Files it writes with WRITEFILE show up here after it runs.
            Each line is one value.
          </p>
          {names.map((name) => (
            <div className="file" key={name}>
              <div className="file-head">
                <code>{name}</code>
                <button type="button" className="link-button" onClick={() => remove(name)} disabled={disabled}>
                  Delete
                </button>
              </div>
              <textarea
                value={files[name]}
                onChange={(e) => onChange({ ...files, [name]: e.target.value })}
                rows={Math.min(8, Math.max(3, files[name].split("\n").length + 1))}
                spellCheck="false"
                aria-label={`Contents of ${name}`}
                disabled={disabled}
              />
            </div>
          ))}
          <form className="file-add" onSubmit={add}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New file name, e.g. Scores.txt"
              aria-label="New file name"
              disabled={disabled}
            />
            <button type="submit" disabled={disabled || !newName.trim() || newName.trim() in files}>
              Add file
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
