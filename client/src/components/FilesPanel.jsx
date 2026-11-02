import { useRef, useState } from "react";
import { MAX_FILE_CHARS, MAX_TOTAL_FILE_CHARS } from "@shared/interpreter/index.ts";

// Real files are copied in and out of the panel. The interpreter itself only ever
// sees these in-memory copies, so a program can never touch the student's disk.

const isTxtName = (name) => name.toLowerCase().endsWith(".txt");

/** The text files that OPENFILE / READFILE / WRITEFILE use. */
export default function FilesPanel({ files, onChange, disabled, saved = true }) {
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(Object.keys(files).length > 0);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
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

  const importFiles = async (e) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // let the same file be picked again later
    const next = { ...files };
    const problems = [];
    let changed = false;

    for (const file of picked) {
      if (!isTxtName(file.name)) {
        problems.push(`${file.name} is not a .txt file.`);
        continue;
      }
      // file.size is in bytes; checking it first avoids reading a huge file at all.
      if (file.size > MAX_FILE_CHARS * 4) {
        problems.push(`${file.name} is bigger than the 1 MB limit.`);
        continue;
      }
      let text = await file.text();
      if (text.includes("\0")) {
        problems.push(`${file.name} does not look like plain text.`);
        continue;
      }
      // Drop the byte order mark Notepad sometimes adds, and use one kind of line ending.
      text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
      if (text.length > MAX_FILE_CHARS) {
        problems.push(`${file.name} is bigger than the 1 MB limit.`);
        continue;
      }
      const others = Object.entries(next).reduce((n, [k, v]) => (k === file.name ? n : n + v.length), 0);
      if (others + text.length > MAX_TOTAL_FILE_CHARS) {
        problems.push(`${file.name} would take all your files over the 2 MB limit. Delete a file first.`);
        continue;
      }
      if (file.name in next && !window.confirm(`Replace the existing ${file.name}?`)) continue;
      next[file.name] = text;
      changed = true;
    }

    setError(problems.join(" "));
    if (changed) onChange(next);
  };

  const download = (name) => {
    // Windows line endings so older versions of Notepad show each line separately.
    const blob = new Blob([files[name].replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isTxtName(name) ? name : `${name}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
          <p className="hint note">
            You can open files from your computer and download them again. Only plain <code>.txt</code> files up to
            1 MB are supported. To make one, use Notepad on Windows, or TextEdit on a Mac (choose Format › Make Plain
            Text before saving). Files here are only kept until you close this tab, so download any you want to keep.
          </p>
          {!saved && (
            <p className="file-error" role="alert">
              Your browser couldn't hold these files, so they will be lost if you refresh. Download any you want to
              keep.
            </p>
          )}
          {names.map((name) => (
            <div className="file" key={name}>
              <div className="file-head">
                <code>{name}</code>
                <span className="file-actions">
                  <button type="button" className="link-button" onClick={() => download(name)}>
                    Download
                  </button>
                  <button type="button" className="link-button" onClick={() => remove(name)} disabled={disabled}>
                    Delete
                  </button>
                </span>
              </div>
              <textarea
                value={files[name]}
                onChange={(e) => onChange({ ...files, [name]: e.target.value })}
                rows={Math.min(8, Math.max(3, files[name].split("\n").length + 1))}
                maxLength={MAX_FILE_CHARS}
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
          <div className="file-import">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,text/plain"
              multiple
              hidden
              onChange={importFiles}
            />
            <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled}>
              Open .txt file from computer
            </button>
          </div>
          {error && (
            <p className="file-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
