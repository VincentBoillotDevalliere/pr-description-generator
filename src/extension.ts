import * as vscode from "vscode";
import { exec } from "child_process";
import { buildMarkdown, FileChange, FileStatus } from "./template";

type DiffSummary = {
  added: number;
  removed: number;
};

type ParsedFileChange = FileChange & {
  key: string;
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

function normalizePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function statusFromCode(code: string): FileStatus {
  switch (code) {
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return "Renamed";
    case "C":
      return "Added";
    default:
      return "Modified";
  }
}

function parseRenamePath(pathPart: string): { displayPath: string; key: string } {
  if (!pathPart) {
    return { displayPath: "", key: "" };
  }

  if (pathPart.includes("->")) {
    const [oldPart, newPart] = pathPart.split("->");
    const oldPath = normalizePath(oldPart || "");
    const newPath = normalizePath(newPart || "");
    const displayPath = `${oldPath} -> ${newPath}`.trim();
    const key = newPath || oldPath || displayPath;
    return { displayPath, key };
  }

  const normalized = normalizePath(pathPart);
  return { displayPath: normalized, key: normalized };
}

function parsePorcelainStagedChanges(statusOutput: string): ParsedFileChange[] {
  if (!statusOutput) {
    return [];
  }

  return statusOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      if (line.length < 3) {
        return null;
      }
      const indexStatus = line[0];
      if (indexStatus === " " || indexStatus === "?") {
        return null;
      }
      const pathPart = line.slice(3).trim();
      const status = statusFromCode(indexStatus);
      if (status === "Renamed") {
        const { displayPath, key } = parseRenamePath(pathPart);
        if (!displayPath) {
          return null;
        }
        return { status, path: displayPath, key };
      }
      const normalized = normalizePath(pathPart);
      if (!normalized) {
        return null;
      }
      return { status, path: normalized, key: normalized };
    })
    .filter((entry): entry is ParsedFileChange => Boolean(entry));
}

function parseNameStatus(output: string): ParsedFileChange[] {
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t+/);
      const statusField = parts[0] || "";
      const statusCode = statusField[0] || "M";
      const status = statusFromCode(statusCode);

      if (status === "Renamed") {
        const oldPath = normalizePath(parts[1] || "");
        const newPath = normalizePath(parts[2] || "");
        const displayPath = `${oldPath} -> ${newPath}`.trim();
        const key = newPath || oldPath || displayPath;
        if (!displayPath) {
          return null;
        }
        return { status, path: displayPath, key };
      }

      const normalized = normalizePath(parts[1] || "");
      if (!normalized) {
        return null;
      }
      return { status, path: normalized, key: normalized };
    })
    .filter((entry): entry is ParsedFileChange => Boolean(entry));
}

function mergeChanges(
  primary: ParsedFileChange[],
  secondary: ParsedFileChange[]
): FileChange[] {
  const merged = new Map<string, FileChange>();

  for (const change of primary) {
    if (!merged.has(change.key)) {
      merged.set(change.key, { status: change.status, path: change.path });
    }
  }

  for (const change of secondary) {
    if (!merged.has(change.key)) {
      merged.set(change.key, { status: change.status, path: change.path });
    }
  }

  return Array.from(merged.values());
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

  const stagedChanges = parsePorcelainStagedChanges(statusOutput);
  if (stagedChanges.length === 0) {
    await vscode.window.showInformationMessage("No staged changes");
    return;
  }

  const config = vscode.workspace.getConfiguration("prd");
  const maxDiffLines = Math.max(
    config.get<number>("maxDiffLines", 2000) ?? 2000,
    1
  );
  const copyToClipboard = config.get<boolean>("copyToClipboard", false) ?? false;
  const includeFilesSection =
    config.get<boolean>("includeFilesSection", false) ?? false;

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
    files: mergeChanges(stagedChanges, []),
    added,
    removed,
    truncated,
    maxLines: maxDiffLines,
    analyzedLines: truncated ? maxDiffLines : diffLines.length,
    summaryLabel: "Staged changes",
    diffLabel: "staged",
    emptyChangesLine: "No staged files detected.",
    includeFilesSection,
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
  const includeFilesSection =
    config.get<boolean>("includeFilesSection", false) ?? false;

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
      `git diff --name-status ${shellEscape(range)}`,
      workspaceRoot
    );
    diffOutputWorking = await execGit("git diff HEAD --no-color", workspaceRoot);
    filesOutputWorking = await execGit(
      "git diff --name-status HEAD",
      workspaceRoot
    );
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Failed to run git diff against ${baseBranch}: ${getErrorMessage(error)}`
    );
    return;
  }

  const rangeChanges = parseNameStatus(filesOutputRange);
  const workingChanges = parseNameStatus(filesOutputWorking);
  const files = mergeChanges(rangeChanges, workingChanges);
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
    includeFilesSection,
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
