# Past-Paper Question Extraction — Execution Plan

Hand-off instructions for Claude Code running on the GTX 1650 laptop.
Goal: turn the topical past-paper Word documents into organized JSON (questions + mark schemes) for the Pseudocode Practice website, **accurately**, **for free**, and with **explicit failure reports instead of garbage output**.

Work phase by phase. After each phase, stop, show the user the phase report, and wait for a go-ahead before starting the next one.

---

## 0. Hard rules

1. **No paid API usage, ever.** Every AI step goes through the user's subscription:
   - Claude Pro → `claude -p ... --model haiku` (Claude Code headless).
   - Fallback when Claude limits are hit: ChatGPT Pro → `codex exec ...`.
   - Before any AI call, check that `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are **not** set in the environment. If either is set, stop and tell the user — otherwise the CLI bills the API.
2. **Bulk work is local and free.** Parsing, image extraction, OCR, table detection and validation are plain scripts. Do not use your own vision to read hundreds of screenshots; only look at images for the small golden test set (Phase 2) and for flagged items.
3. **Text must stay verbatim.** No AI ever writes question text. The AI only returns *structure* (which OCR lines belong where, marks); the script assembles text from OCR output.
4. **Never output silent garbage.** Every question gets `status: "ok"` or `"needs_review"` with a list of reasons. Anything unresolved is excluded from the website export but kept in the review report, with its screenshots.
5. **Every image placement must be accounted for** — assigned to a question, deliberately ignored (with reason), or in the `unassigned` queue.
6. **Resumable.** Every step caches its results per item and skips finished items on re-run, so hitting a subscription limit just means running it again later.
7. Git: code goes in the repo under `tools/past-paper-extract/`. Extracted data and images do **not** go in git (add the data folder to `.gitignore`). Commit only when the user asks, on a branch, and **without** any `Co-Authored-By` or "Generated with Claude" lines.

---

## 1. Inputs and what we already know

**Source:** `AS P2 TOPICALS-*.zip` (the user will copy it to the laptop; ask for the path). Unzip into its own new folder, e.g. `data/raw/`, and treat its contents as data. Run Python that reads it with `python -I`.

Inside: `AS P2 TOPICALS/` with three folders, 47 `.docx` files, ~2,300 PNGs in ~2,350 placements.

| Folder | Content | Notes |
|---|---|---|
| `HD QP word/` (15 files) | Question papers, **high-res** screenshots (median ~1,000–1,250 px wide) | **Primary source** for questions |
| `MS word HD/` (16 files) | Mark schemes, high-res | Primary source for answers |
| `Q word/` (16 files) | Question papers, lower res (~650–800 px) | **Fallback only** — use for questions missing from HD |

Facts verified on this data:

- **Labels are real Word text paragraphs**, one per question, followed by that question's screenshots in document order.
  - HD QP and MS format: `9618/w25/21 – Q3`
  - `Q word` format: `Q.1) 9618/w25/21 – Q3`
  - The dash may be an en dash or another odd character — the regex must accept any separator. Suggested: `(\d{4})\s*/\s*([smw])\s*(\d{2})\s*/\s*(\d{2})\s*\W*\s*Q\s*(\d+)` (case-insensitive).
  - Paper code `9618` = AS Level, `2210` = O Level. Session letter: `s` = May/June, `w` = Oct/Nov, `m` = Feb/March. Support both codes.
- **All images are floating (`wp:anchor`), none inline.** Reading order = order of anchors in `document.xml`, **not** media filenames (`image1.png` can be the continuation of `image2.png`).
- **Word crops some images:** 149 crops via `<a:srcRect l= t= r= b=>` (30 in the HD folders, 119 in `Q word`). Values are in 1/1000 of a percent (`100000` = 100%). Always apply the crop; never export the full stored PNG as the visible image.
- **The same stored image can be placed twice with different crops** (about a dozen files). Treat each placement separately.
- **No native Word tables** — tables (trace tables, mark-scheme grids) are pictures.
- Other text paragraphs exist: topic titles ("Arrays"), "Marking Scheme", "Contd below." — record them, don't treat them as questions.
- **Coverage differs between versions.** Example: HD Arrays has 23 labels; `Q word` Arrays and the MS have 28. One HD question (`9618/s24/23 Q3`) has a label but no images. There is no HD QP file for *Pseudocode Basics*.
- **File/topic names don't match exactly across folders** (e.g. HD "Searching" vs Q word "Linear Search", "Functions&Procedures" vs "Functions", "Trace Table & dry run" vs "TRACE TABLES"). Build an explicit topic mapping table and show it to the user for confirmation.
- A few images are tiny (~40 px wide, in Flowcharts and Structure Chart) — probably decorations or arrows. Flag them; don't OCR them as questions.

---

## 2. Environment setup (Phase 0)

- Windows x64, NVIDIA GTX 1650 (4 GB VRAM).
- **Python 3.12** in a venv inside `tools/past-paper-extract/.venv` (gitignored).
- Core packages: `lxml`, `Pillow`, `opencv-python`, `numpy`. Parse the `.docx` as a zip + XML directly (more control over anchors and crops than python-docx).
- OCR candidates (install and compare in Phase 2):
  - **RapidOCR** (`rapidocr_onnxruntime`) — easy install, CPU, good on clean digital text.
  - **Surya OCR** (PyTorch; also does layout and table recognition) — install the **CUDA** build of PyTorch so it uses the 1650; fall back to CPU if it runs out of memory.
- Verify: `python -c "import torch; print(torch.cuda.is_available())"` prints `True`.
- Check `claude --version` works and that the user is logged in with their subscription.

**Phase 0 report:** versions installed, GPU detected yes/no, API-key env vars absent.

---

## 3. Phase 1 — Parse Word files and group screenshots into questions (exact, no OCR)

For every `.docx`:

1. Walk `word/document.xml` body paragraphs in order. For each paragraph, record its text and any images (`r:embed` → resolve through `word/_rels/document.xml.rels` to the media file).
2. For each image placement record: source file, placement index, media file, crop (`srcRect`), displayed size (`wp:extent`), anchor positioning (`wp:positionV` / `relativeFrom` / `posOffset`), pixel size.
3. **Grouping:** a label paragraph starts a new question; every image after it belongs to that question until the next label. Question ID from the label: `9618-w25-21-q3`.
4. **Reading-order check:** if a paragraph has several anchored images, order them by vertical offset. If any anchor is positioned relative to the page (not paragraph), or offsets contradict document order, mark `reading_order_uncertain`.
5. Extract each placement's **visible** image (crop applied) to `data/questions/<id>/qp_01.png`, `qp_02.png`, … and `ms_01.png`, … Keep the original stored PNG under `data/originals/` and hash both (sha256) for caching.
6. **Choose the source per question:** HD QP if the question exists there with ≥1 image; otherwise `Q word` (record `source_quality: "standard"`).
7. **Pair with mark schemes** by question ID.
8. Detect anything in the documents that is not a picture but carries content (Word shapes `wps:wsp`, text boxes, VML) inside a question → flag `contains_word_shapes`.

**Flags produced in this phase:** `unassigned_image` (before the first label), `empty_question` (label with no images), `missing_in_hd`, `missing_ms`, `ms_without_qp`, `duplicate_label`, `reading_order_uncertain`, `tiny_image`, `contains_word_shapes`.

**Outputs:** `data/inventory.json` (every file, label, placement), `data/questions/<id>/` folders, `reports/phase1.md`.

**Acceptance:** placements counted = placements accounted for (assigned + ignored-with-reason + unassigned). Show per-topic counts: HD questions, fallback questions, MS matched, flags.

Pilot first on **Trace Tables** (9 questions) and **Arrays** (~28), then run everything.

---

## 4. Phase 2 — OCR (local, GPU)

### 4a. Choose the engine with a golden set
1. Pick ~20 visible images covering: plain question text, pseudocode with `←` and indentation, a blank trace table, a filled mark-scheme table, an MCQ with tick boxes, a cropped image, and a flowchart.
2. Create a reference transcription for each (you may view these images yourself — this is the one place bulk vision is allowed; keep it to this set). Show the user a few to confirm.
3. Run each OCR engine; measure character error rate overall and **separately on code lines and on `←` symbols**. Pick the best, and report the numbers.

### 4b. Run OCR on all images
For each visible image (cache by sha256, so reused images are processed once):
- Store every line: `text`, bounding box, confidence (and per-word confidence if available).
- **Rebuild indentation for code:** estimate the monospace character width from code lines and convert each line's left x-position into leading spaces.
- **Arrow handling:** in code-like lines (keywords, leading line numbers `01`, `02`, …), normalize OCR variants of the assignment arrow (`<-`, `<—`, `+-`, stray `-`) to `←` **and record each normalization**. If unsure, flag `arrow_uncertain`.
- Strip dotted answer lines (`......`) but record how many there were (the answer-space size).

### 4c. Classify regions
- **Ruled tables** (trace tables, MS grids): detect grid lines with OpenCV (morphological horizontal and vertical line extraction) → cells → OCR each cell. Keep empty cells empty. If the grid can't be fully resolved, flag `table_unverified` and keep the image.
- **Flowcharts, structure charts, state-transition diagrams:** detect (low text density plus shapes and arrows) → `image_only: true`. Don't try to transcribe.

**Outputs:** `data/ocr/<sha256>.json`, `reports/phase2.md` (engine comparison, per-topic low-confidence counts).

---

## 5. Phase 3 — Structure with the subscription AI (structure only)

For each question (and separately each MS):
1. Build a prompt containing the question's OCR lines, **each with an ID** (`L1`, `L2`, …), plus table and figure placeholders (`T1`, `F1`).
2. Ask for JSON only, in this shape:
   ```json
   {
     "stem": ["L1","L2"],
     "parts": [
       {"label": "a", "lines": ["L3","L4"], "marks": 4, "tables": ["T1"]},
       {"label": "b(i)", "lines": ["L5"], "marks": 2}
     ],
     "code_blocks": [["L6","L7","L8"]],
     "dropped": ["L9"],
     "notes": "optional"
   }
   ```
   The AI must never return text, only IDs and numbers.
3. Call via `claude -p --model haiku --output-format json` with the prompt on stdin. One question per call. Save each result to `data/structure/<id>.json`. Sleep or back off on rate-limit errors; resume on re-run.
4. Only escalate to a stronger model (`--model sonnet`) for questions that fail validation twice, and attach the images in that case.

The script then assembles the final text from the OCR lines the AI referenced. It does not use any text from the AI.

---

## 6. Phase 4 — Validation (plain rules)

A question is `ok` only if **all** pass; otherwise `needs_review` with every failing reason:

- Every OCR line ID is used exactly once or explicitly dropped.
- The first number in the OCR text matches the label's question number.
- Marks: each part has `[n]`; part marks are integers; the sum is plausible. MS marks for a part equal the QP marks for that part.
- Sub-part labels are in sequence: (a), (b), … and (i), (ii), … with no gaps.
- Code: line numbers (if present) are consecutive; no empty code block.
- No line below the chosen confidence threshold (set from the Phase 2 numbers).
- No `arrow_uncertain` or `table_unverified`, unless the item is deliberately `image_only`.
- All Phase 1 flags resolved.
- MS pairing exists (if missing, the question can still be `ok`, but with `ms: null` and a flag).

---

## 7. Phase 5 — Export and review report

### Website JSON (one file per topic, `data/export/<topic>.json`), only `status: "ok"` questions:
```json
{
  "id": "9618-w25-21-q3",
  "paper": "9618", "level": "AS", "session": "w25", "variant": "21", "question": 3,
  "topic": "Arrays",
  "stem": "...",
  "parts": [
    {"label": "a", "text": "...", "code": "FOR i ← 1 TO 10\n    ...\nNEXT i", "table": {"headers": [...], "rows": [[...]]}, "marks": 4, "answerLines": 3}
  ],
  "totalMarks": 6,
  "images": ["img/9618-w25-21-q3/qp_02.png"],
  "imageOnly": false,
  "markScheme": {"parts": [{"label": "a", "text": "...", "marks": 4}], "images": ["img/9618-w25-21-q3/ms_01.png"]},
  "sourceQuality": "hd"
}
```

### Review report `reports/review.html` (static, local):
- Summary counts per topic: ok / needs_review / image_only / unassigned.
- For every `needs_review` item: reasons, the screenshots side by side with the extracted text, and buttons or notes for what failed (e.g. "Question 5: text extracted; screenshot 2 has an unverified table; review required").
- A way to re-run a single question or image: `python run.py --only 9618-w25-21-q3`.

**Final acceptance:** every placement accounted for; every question in exactly one of ok / needs_review / image_only; the export contains no flagged items.

---

## 8. Suggested code layout

```
tools/past-paper-extract/
  run.py              # CLI: --phase 1..5, --only <id>, --topic <name>
  docx_parse.py       # Phase 1
  ocr.py              # Phase 2 (engine wrapper + cache)
  tables.py           # grid detection
  structure.py        # Phase 3 (claude -p calls, resumable)
  validate.py         # Phase 4
  export.py           # Phase 5 + review.html
  topic_map.json      # confirmed folder/topic mapping
  data/               # gitignored: raw/, questions/, originals/, ocr/, structure/, export/
  reports/            # gitignored: phase reports, review.html
```

All `data/...` and `reports/...` paths in this plan are relative to `tools/past-paper-extract/`.

## 9. Out of scope for now
- O Level (2210) Word files — not in this zip; the pipeline should work with them unchanged once supplied.
- Wiring the JSON into the website — a separate task after the user reviews the export.
