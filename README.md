# PR Description Generator

Generate a structured PR description from staged git changes.

## Command

Open the Command Palette and run:

`PRD: Generate PR Description (staged)`

Or generate against a base branch:

`PRD: Generate PR Description (against base branch)`

Or insert the description into the current editor:

`PRD: Insert PR Description Here`

## Settings

- `prd.baseBranch`: Base branch to diff against (default: main).
- `prd.maxDiffLines`: Maximum number of diff lines to analyze (default: 2000).
- `prd.copyToClipboard`: Copy the generated Markdown to the clipboard (default: false).
- `prd.includeFilesSection`: Include a `Files changed` section (default: false).

## Scripts

- `npm run compile`: Compile TypeScript into `out/`.
- `npm run watch`: Rebuild on changes during development.
- `npm run build`: Package the extension into a `.vsix` using `vsce`.
- `npm run run`: Launch VS Code with the extension loaded for development.
