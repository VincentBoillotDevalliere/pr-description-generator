const vscode = require("vscode");
const { exec } = require("child_process");

function execGit(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(
      command,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trimEnd());
      }
    );
  });
}

function parseStagedFiles(statusOutput) {
  if (!statusOutput) {
    return [];
  }
  return statusOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const indexStatus = line[0];
      const pathPart = line.slice(3).trim();
      return { indexStatus, pathPart };
    })
    .filter((entry) => entry.indexStatus !== " " && entry.indexStatus !== "?")
    .map((entry) => entry.pathPart);
}

function summarizeDiff(diffText) {
  if (!diffText) {
    return { added: 0, removed: 0 };
  }

  let added = 0;
  let removed = 0;

  diffText.split(/\r?\n/).forEach((line) => {
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@")
    ) {
      return;
    }
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  });

  return { added, removed };
}

function buildMarkdown(options) {
  const {
    files,
    added,
    removed,
    truncated,
    maxLines,
    analyzedLines,
  } = options;

  const summaryLines = [
    `Staged changes in ${files.length} file${files.length === 1 ? "" : "s"}.`,
    `Diff stats (staged): +${added} / -${removed} lines.`,
  ];

  if (truncated) {
    summaryLines.push(
      `Diff analysis truncated to ${maxLines} lines (analyzed ${analyzedLines}).`
    );
  }

  const changesLines =
    files.length > 0
      ? files.map((file) => `- ${file}`)
      : ["- No staged files detected."];

  return [
    "## Summary",
    ...summaryLines.map((line) => `- ${line}`),
    "",
    "## Changes",
    ...changesLines,
    "",
    "## Testing",
    "- [ ] Not run (not specified).",
    "",
  ].join("\n");
}

async function generateDescriptionFromStaged() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    await vscode.window.showErrorMessage("Open a folder");
    return;
  }

  const workspaceRoot = folders[0].uri.fsPath;
  let statusOutput;

  try {
    statusOutput = await execGit("git status --porcelain", workspaceRoot);
  } catch (error) {
    await vscode.window.showErrorMessage("Not a git repository");
    return;
  }

  const stagedFiles = parseStagedFiles(statusOutput);
  if (stagedFiles.length === 0) {
    await vscode.window.showInformationMessage("No staged changes");
    return;
  }

  const config = vscode.workspace.getConfiguration("prd");
  const maxDiffLines = Math.max(config.get("maxDiffLines", 2000), 1);
  const copyToClipboard = config.get("copyToClipboard", false);

  let diffOutput;
  try {
    diffOutput = await execGit("git diff --staged --no-color", workspaceRoot);
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Failed to run git diff --staged: ${error.message}`
    );
    return;
  }

  const diffLines = diffOutput ? diffOutput.split(/\r?\n/) : [];
  const truncated = diffLines.length > maxDiffLines;
  const limitedDiff = diffLines.slice(0, maxDiffLines).join("\n");
  const { added, removed } = summarizeDiff(limitedDiff);

  const markdown = buildMarkdown({
    files: stagedFiles,
    added,
    removed,
    truncated,
    maxLines: maxDiffLines,
    analyzedLines: truncated ? maxDiffLines : diffLines.length,
  });

  const document = await vscode.workspace.openTextDocument({
    content: markdown,
    language: "markdown",
  });
  await vscode.window.showTextDocument(document, { preview: false });

  if (copyToClipboard) {
    await vscode.env.clipboard.writeText(markdown);
    await vscode.window.showInformationMessage("Copied to clipboard");
  }
}

function activate(context) {
  const disposable = vscode.commands.registerCommand(
    "prd.generateDescriptionStaged",
    generateDescriptionFromStaged
  );
  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
