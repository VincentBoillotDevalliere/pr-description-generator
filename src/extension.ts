import * as vscode from "vscode";
import { exec } from "child_process";

type DiffSummary = {
  added: number;
  removed: number;
};

type MarkdownOptions = {
  files: string[];
  added: number;
  removed: number;
  truncated: boolean;
  maxLines: number;
  analyzedLines: number;
  summaryLabel: string;
  diffLabel: string;
  emptyChangesLine: string;
};

function execGit(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trimEnd());
      }
    );
  });
}

function shellEscape(value: string): string {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function parseStagedFiles(statusOutput: string): string[] {
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

function summarizeDiff(diffText: string): DiffSummary {
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

function buildMarkdown(options: MarkdownOptions): string {
  const {
    files,
    added,
    removed,
    truncated,
    maxLines,
    analyzedLines,
    summaryLabel,
    diffLabel,
    emptyChangesLine,
  } = options;

  const summaryLines = [
    `${summaryLabel} in ${files.length} file${
      files.length === 1 ? "" : "s"
    }.`,
    `Diff stats (${diffLabel}): +${added} / -${removed} lines.`,
  ];

  if (truncated) {
    summaryLines.push(
      `Diff analysis truncated to ${maxLines} lines (analyzed ${analyzedLines}).`
    );
  }

  const changesLines =
    files.length > 0
      ? files.map((file) => `- ${file}`)
      : [`- ${emptyChangesLine}`];

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function ensureGitRepo(workspaceRoot: string): Promise<void> {
  try {
    await execGit("git status --porcelain", workspaceRoot);
  } catch (error) {
    throw new Error("Not a git repository");
  }
}

async function resolveBaseBranch(
  workspaceRoot: string,
  configuredBase: string
): Promise<string> {
  const ref = `refs/heads/${configuredBase}`;
  try {
    await execGit(`git show-ref --verify ${shellEscape(ref)}`, workspaceRoot);
    return configuredBase;
  } catch (error) {
    if (configuredBase === "main") {
      const fallbackRef = "refs/heads/master";
      try {
        await execGit(
          `git show-ref --verify ${shellEscape(fallbackRef)}`,
          workspaceRoot
        );
        return "master";
      } catch (fallbackError) {
        throw new Error("Base branch main or master not found locally");
      }
    }
    throw new Error(`Base branch ${configuredBase} not found locally`);
  }
}

async function generateDescriptionFromStaged(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    await vscode.window.showErrorMessage("Open a folder");
    return;
  }

  const workspaceRoot = folders[0].uri.fsPath;
  let statusOutput: string;

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
  const maxDiffLines = Math.max(
    config.get<number>("maxDiffLines", 2000) ?? 2000,
    1
  );
  const copyToClipboard = config.get<boolean>("copyToClipboard", false) ?? false;

  let diffOutput: string;
  try {
    diffOutput = await execGit("git diff --staged --no-color", workspaceRoot);
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Failed to run git diff --staged: ${getErrorMessage(error)}`
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
    summaryLabel: "Staged changes",
    diffLabel: "staged",
    emptyChangesLine: "No staged files detected.",
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

async function generateDescriptionAgainstBase(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    await vscode.window.showErrorMessage("Open a folder");
    return;
  }

  const workspaceRoot = folders[0].uri.fsPath;
  const config = vscode.workspace.getConfiguration("prd");
  const maxDiffLines = Math.max(
    config.get<number>("maxDiffLines", 2000) ?? 2000,
    1
  );
  const copyToClipboard = config.get<boolean>("copyToClipboard", false) ?? false;
  const configuredBase = config.get<string>("baseBranch", "main") ?? "main";

  try {
    await ensureGitRepo(workspaceRoot);
  } catch (error) {
    await vscode.window.showErrorMessage(getErrorMessage(error));
    return;
  }

  let baseBranch;
  try {
    baseBranch = await resolveBaseBranch(workspaceRoot, configuredBase);
  } catch (error) {
    await vscode.window.showErrorMessage(getErrorMessage(error));
    return;
  }

  const range = `${baseBranch}...HEAD`;
  let diffOutputRange: string;
  let filesOutputRange: string;
  let diffOutputWorking = "";
  let filesOutputWorking = "";

  try {
    diffOutputRange = await execGit(
      `git diff ${shellEscape(range)} --no-color`,
      workspaceRoot
    );
    filesOutputRange = await execGit(
      `git diff --name-only ${shellEscape(range)}`,
      workspaceRoot
    );
    diffOutputWorking = await execGit("git diff HEAD --no-color", workspaceRoot);
    filesOutputWorking = await execGit(
      "git diff --name-only HEAD",
      workspaceRoot
    );
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Failed to run git diff against ${baseBranch}: ${getErrorMessage(error)}`
    );
    return;
  }

  const filesRange = filesOutputRange
    ? filesOutputRange.split(/\r?\n/).filter(Boolean)
    : [];
  const filesWorking = filesOutputWorking
    ? filesOutputWorking.split(/\r?\n/).filter(Boolean)
    : [];
  const files: string[] = [];
  const seen = new Set<string>();

  for (const file of filesRange) {
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }

  for (const file of filesWorking) {
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }
  if (files.length === 0) {
    await vscode.window.showInformationMessage(
      `No changes against ${baseBranch}`
    );
    return;
  }

  const combinedDiff = [diffOutputRange, diffOutputWorking]
    .filter(Boolean)
    .join("\n");
  const diffLines = combinedDiff ? combinedDiff.split(/\r?\n/) : [];
  const truncated = diffLines.length > maxDiffLines;
  const limitedDiff = diffLines.slice(0, maxDiffLines).join("\n");
  const { added, removed } = summarizeDiff(limitedDiff);

  const markdown = buildMarkdown({
    files,
    added,
    removed,
    truncated,
    maxLines: maxDiffLines,
    analyzedLines: truncated ? maxDiffLines : diffLines.length,
    summaryLabel: `Changes against ${baseBranch}`,
    diffLabel: `against ${baseBranch}`,
    emptyChangesLine: `No changes detected against ${baseBranch}.`,
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

export function activate(context: vscode.ExtensionContext): void {
  const stagedDisposable = vscode.commands.registerCommand(
    "prd.generateDescriptionStaged",
    generateDescriptionFromStaged
  );
  const baseDisposable = vscode.commands.registerCommand(
    "prd.generateDescriptionBase",
    generateDescriptionAgainstBase
  );
  context.subscriptions.push(stagedDisposable, baseDisposable);
}

export function deactivate(): void {}
