# PR Description Generator
<img src="https://raw.githubusercontent.com/VincentBoillotDevalliere/pr-description-generator/main/assets/icon.png" alt="Array Size Extension Logo" width="128" height="128">

A VS Code extension that generates **clear, structured pull request descriptions** directly from your Git changes.

Instead of manually summarizing commits or diffs, this extension analyzes your changes and produces a clean, ready-to-use **Markdown PR description** — saving time and improving consistency across your team.

---

## Features

- ✅ Generate PR descriptions from **staged changes**
- ✅ Generate PR descriptions **against a base branch**
- ✅ Insert the description directly into the active editor
- ✅ Optional clipboard copy
- ✅ Output is clean, structured Markdown
- ✅ Designed for fast, repeatable PR workflows

---

## Commands

Open the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run one of the following:

### Generate from staged changes
```
PRD: Generate PR Description (staged)
```
Analyzes currently staged files (`git add`) and generates a PR description.

---

### Generate against a base branch
```
PRD: Generate PR Description (against base branch)
```
Diffs the current branch against a configured base branch (default: `main`).

---

### Insert into the current editor
```
PRD: Insert PR Description Here
```
Inserts the generated PR description at the current cursor position — perfect for GitHub/GitLab PR templates.

---

## Configuration

All settings are optional and can be configured in `settings.json`.

### `prd.baseBranch` (default: `"main"`)
Base branch used when generating a diff against a branch.

```json
"prd.baseBranch": "main"
```

---

### `prd.maxDiffLines` (default: `2000`)
Maximum number of diff lines analyzed to avoid excessive processing.

```json
"prd.maxDiffLines": 2000
```

---

### `prd.copyToClipboard` (default: `false`)
Automatically copy the generated Markdown to the clipboard.

```json
"prd.copyToClipboard": true
```

---

### `prd.includeFilesSection` (default: `false`)
Include a **Files changed** section in the generated description.

```json
"prd.includeFilesSection": true
```

---

## Output format

The generated PR description is structured Markdown, typically including:

- Summary of changes
- Key modifications
- Optional list of changed files

Designed to be pasted directly into:
- GitHub PRs
- GitLab MRs
- Bitbucket PRs

---

## Development

### Available scripts

- `npm run compile`  
  Compile TypeScript into `out/`.

- `npm run watch`  
  Rebuild automatically on file changes during development.

- `npm run build`  
  Package the extension into a `.vsix` file using `vsce`.

- `npm run run`  
  Launch a development instance of VS Code with the extension loaded.

---

## Why this extension?

PR descriptions are often:
- rushed
- inconsistent
- incomplete

This extension gives you:
- faster PR creation
- better communication
- cleaner reviews

It’s a small tool — but it compounds into better engineering habits.



## Feedback & Contributions

- [Report an Issue](https://github.com/VincentBoillotDevalliere/pr-description-generator/issues)
- [Request a Feature](https://github.com/VincentBoillotDevalliere/pr-description-generator/issues)
- [Contribute](https://github.com/VincentBoillotDevalliere/pr-description-generator)

## Buy Me a Coffee
If you appreciate the extension and would like to support its development, feel free to [buy me a coffee](https://buymeacoffee.com/vincentboillotdevalliere)! Your support helps keep the project alive and improving. ☕💖


## License

This extension is licensed under the [MIT License](LICENSE).