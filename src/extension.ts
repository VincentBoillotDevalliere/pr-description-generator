import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { buildMarkdown, FileChange, FileStatus } from "./template";
import { AIInput, createProvider } from "./ai/providers";

type DiffSummary = {
  added: number;
  removed: number;
};

type ParsedFileChange = FileChange & {
  key: string;
};

type PreparedDiff = {
  text: string;
  truncated: boolean;
  analyzedLines: number;
};

type AiDiffPayload = {
  text: string;
  truncated: boolean;
  analyzedLines: number;
  truncatedByChars: boolean;
};

let extensionRoot: string | null = null;
let promptTemplateCache: string | null = null;
let extensionGlobalState: vscode.Memento | null = null;

function formatList(items: string[], maxItems: number): string {
  if (items.length <= maxItems) {
    return items.join(", ");
  }
  const remaining = items.length - maxItems;
  return `${items.slice(0, maxItems).join(", ")}, and ${remaining} more`;
}

async function getPromptTemplate(): Promise<string> {
  if (promptTemplateCache) {
    return promptTemplateCache;
  }
  if (!extensionRoot) {
    throw new Error("Extension root path not available.");
  }

  const promptPath = path.join(
    extensionRoot,
    "src",
    "prompts",
    "ai-prd-v1.txt"
  );
  const content = await fs.promises.readFile(promptPath, "utf8");
  promptTemplateCache = content;
  return content;
}

async function ensureAiConsent(): Promise<boolean> {
  if (!extensionGlobalState) {
    return true;
  }
  const key = "prd.ai.consentShown";
  if (extensionGlobalState.get<boolean>(key, false)) {
    return true;
  }
  const message =
    "AI enhancement will send the (truncated) diff, list of changed files, and the local PR description to your configured AI endpoint. No data is stored by the extension.";
  const choice = await vscode.window.showWarningMessage(
    message,
    "Continue",
    "Cancel"
  );
  if (choice !== "Continue") {
    return false;
  }
  await extensionGlobalState.update(key, true);
  return true;
}

function extractCurrentPath(path: string): string {
  const arrowIndex = path.lastIndexOf("->");
  if (arrowIndex === -1) {
    return path.trim();
  }
  return path.slice(arrowIndex + 2).trim();
}

function normalizeGroupingPath(path: string): string {
  const trimmed = extractCurrentPath(path).trim();
  return trimmed.replace(/^\.?\//, "");
}

function isTestFile(change: FileChange): boolean {
  const normalized = normalizeGroupingPath(change.path).toLowerCase();
  if (!normalized) {
    return false;
  }
  const parts = normalized.split("/").filter(Boolean);
  const filename = parts[parts.length - 1] || "";

  if (
    parts.some((part) =>
      ["test", "tests", "__tests__", "spec"].includes(part)
    )
  ) {
    return true;
  }

  return /\.(spec|test)\.[^.]+$/.test(filename);
}

function buildTestingLines(files: FileChange[]): string[] {
  if (files.some(isTestFile)) {
    return ["- [x] Unit tests"];
  }

  return [
    "- [ ] Unit tests",
    "- [ ] Manual testing",
    "- Please describe manual testing.",
  ];
}

function buildRiskAssessment(files: FileChange[]): {
  level: "Low" | "Medium" | "High";
  areas: string[];
} {
  const areas = new Set<string>();
  let hasHigh = false;
  let hasMedium = false;

  for (const file of files) {
    const normalized = normalizeGroupingPath(file.path).toLowerCase();

    if (
      normalized.includes("migrations/") ||
      normalized.includes("migration/") ||
      normalized.includes("prisma") ||
      normalized.includes("flyway") ||
      normalized.endsWith(".sql")
    ) {
      areas.add("database");
      hasHigh = true;
    }

    if (
      normalized.includes("auth") ||
      normalized.includes("jwt") ||
      normalized.includes("oauth") ||
      normalized.includes("permission")
    ) {
      areas.add("auth/security");
      hasHigh = true;
    }

    if (
      normalized.includes("terraform") ||
      normalized.includes("helm") ||
      normalized.includes("k8s") ||
      normalized.includes(".github/workflows")
    ) {
      areas.add("infra");
      hasHigh = true;
    }

    if (
      normalized.includes("/config/") ||
      normalized.startsWith("config/") ||
      normalized.includes(".env") ||
      normalized.endsWith(".yml") ||
      normalized.endsWith(".yaml")
    ) {
      areas.add("config");
      hasMedium = true;
    }
  }

  let level: "Low" | "Medium" | "High" = "Low";
  if (hasHigh) {
    level = "High";
  } else if (hasMedium) {
    level = "Medium";
  }

  const order = ["database", "auth/security", "infra", "config"];
  const sortedAreas = order.filter((area) => areas.has(area));

  return { level, areas: sortedAreas };
}

function buildChangeBullets(files: FileChange[]): string[] {
  if (files.length === 0) {
    return [];
  }

  const bullets: string[] = [];
  const maxBullets = 6;

  const pushBullet = (text: string | null): void => {
    if (!text) {
      return;
    }
    if (bullets.length < maxBullets) {
      bullets.push(text);
    }
  };

  let uiTouched = 0;
  let apiTouched = 0;
  let scriptsTouched = 0;
  let docsTouched = 0;
  let assetsTouched = 0;
  let testsTouched = 0;

  let dependenciesTouched = false;
  let configTouched = false;
  let infraTouched = false;
  let dbTouched = false;
  let authTouched = false;

  for (const file of files) {
    const normalized = normalizeGroupingPath(file.path).toLowerCase();
    const extension = normalized.includes(".")
      ? normalized.slice(normalized.lastIndexOf(".") + 1)
      : "";

    if (
      normalized.startsWith("scripts/") ||
      normalized.includes("/scripts/")
    ) {
      scriptsTouched += 1;
    }

    if (
      normalized.includes("/docs/") ||
      (extension === "md" && !normalized.includes("readme"))
    ) {
      docsTouched += 1;
    }

    if (
      normalized.includes("/assets/") ||
      normalized.startsWith("assets/") ||
      normalized.includes("/public/")
    ) {
      assetsTouched += 1;
    }

    if (
      ["html", "css", "scss", "less", "sass", "tsx", "jsx", "vue", "svelte"].includes(
        extension
      ) ||
      normalized.includes("/ui/") ||
      normalized.includes("/components/") ||
      normalized.includes("/views/") ||
      normalized.includes("/pages/") ||
      normalized.includes("/styles/")
    ) {
      uiTouched += 1;
    }

    if (
      normalized.includes("/api/") ||
      normalized.includes("/server/") ||
      normalized.includes("/backend/") ||
      normalized.includes("/controllers/") ||
      normalized.includes("/routes/") ||
      normalized.includes("/services/")
    ) {
      apiTouched += 1;
    }

    if (isTestFile(file)) {
      testsTouched += 1;
    }

    if (
      normalized.endsWith("package.json") ||
      normalized.endsWith("package-lock.json") ||
      normalized.endsWith("yarn.lock") ||
      normalized.endsWith("pnpm-lock.yaml") ||
      normalized.endsWith("bun.lockb")
    ) {
      dependenciesTouched = true;
    }

    if (
      normalized.includes("/config/") ||
      normalized.startsWith("config/") ||
      normalized.includes(".env") ||
      normalized.endsWith(".yml") ||
      normalized.endsWith(".yaml") ||
      normalized.endsWith("config.json")
    ) {
      configTouched = true;
    }

    if (
      normalized.includes(".github/workflows") ||
      normalized.includes("/ci/") ||
      normalized.includes("dockerfile") ||
      normalized.includes("/k8s/") ||
      normalized.includes("/helm/") ||
      normalized.includes("/terraform/")
    ) {
      infraTouched = true;
    }

    if (
      normalized.includes("migrations/") ||
      normalized.includes("migration/") ||
      normalized.includes("prisma") ||
      normalized.includes("flyway") ||
      normalized.endsWith(".sql")
    ) {
      dbTouched = true;
    }

    if (
      normalized.includes("auth") ||
      normalized.includes("jwt") ||
      normalized.includes("oauth") ||
      normalized.includes("permission")
    ) {
      authTouched = true;
    }
  }

  const signals: string[] = [];
  if (dependenciesTouched) {
    signals.push("dependencies");
  }
  if (configTouched) {
    signals.push("config");
  }
  if (dbTouched) {
    signals.push("database");
  }
  if (authTouched) {
    signals.push("auth/security");
  }
  if (infraTouched) {
    signals.push("infra");
  }
  if (signals.length > 0) {
    pushBullet(`Sensitive areas: ${signals.join(", ")}.`);
  }

  const focusAreas: string[] = [];
  if (uiTouched > 0) {
    focusAreas.push("UI");
  }
  if (apiTouched > 0) {
    focusAreas.push("API/backend");
  }
  if (scriptsTouched > 0) {
    focusAreas.push("scripts");
  }
  if (docsTouched > 0) {
    focusAreas.push("docs");
  }
  if (assetsTouched > 0) {
    focusAreas.push("assets");
  }
  if (testsTouched > 0) {
    focusAreas.push("tests");
  }
  if (focusAreas.length > 0) {
    pushBullet(`Touches: ${formatList(focusAreas, 6)}.`);
  }

  if (uiTouched > 0 && apiTouched > 0) {
    pushBullet("Cross-layer change: UI and API/backend updated.");
  }

  if (dependenciesTouched) {
    pushBullet("Dependencies updated.");
  }

  return bullets;
}

function buildReleaseNotesLines(files: FileChange[]): string[] {
  const changelogFiles: string[] = [];
  const releaseNoteFiles: string[] = [];
  const docsFiles: string[] = [];

  for (const file of files) {
    const normalized = normalizeGroupingPath(file.path);
    const lower = normalized.toLowerCase();
    const parts = lower.split("/");
    const filename = parts[parts.length - 1] || "";

    if (
      /^(changelog|change_log|changes|history|news|release[_-]?notes|releasenotes|upgrading|upgrade)(\..+)?$/.test(
        filename
      )
    ) {
      changelogFiles.push(normalized);
    }

    if (
      lower.includes("/release/") ||
      lower.includes("/releases/") ||
      lower.includes("/release-notes/") ||
      lower.includes("/releasenotes/") ||
      lower.includes("/notes/") ||
      lower.includes("/changelog/")
    ) {
      releaseNoteFiles.push(normalized);
    }

    if (
      lower.startsWith("docs/") ||
      lower.includes("/docs/")
    ) {
      docsFiles.push(normalized);
    }
  }

  const lines: string[] = [];

  if (changelogFiles.length > 0) {
    lines.push(
      `Changelog updated: ${formatList(changelogFiles, 3)}.`
    );
  }

  if (releaseNoteFiles.length > 0) {
    lines.push(
      `Release notes touched: ${formatList(releaseNoteFiles, 3)}.`
    );
  }

  if (docsFiles.length > 0) {
    lines.push(`Docs updated: ${docsFiles.length} file${docsFiles.length === 1 ? "" : "s"}.`);
  }

  if (lines.length === 0) {
    lines.push(
      "No changelog or release-docs updates detected (add one if user-facing)."
    );
  }

  return lines;
}

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

function prepareDiffForAnalysis(diffText: string, maxLines: number): PreparedDiff {
  if (!diffText || maxLines <= 0) {
    return {
      text: "",
      truncated: Boolean(diffText),
      analyzedLines: 0,
    };
  }

  let index = 0;
  let lines = 0;
  let lastIndex = 0;

  while (lines < maxLines && index < diffText.length) {
    const nextNewline = diffText.indexOf("\n", index);
    if (nextNewline === -1) {
      lines += 1;
      lastIndex = diffText.length;
      index = diffText.length;
      break;
    }
    lines += 1;
    index = nextNewline + 1;
    lastIndex = index;
  }

  return {
    text: diffText.slice(0, lastIndex),
    truncated: index < diffText.length,
    analyzedLines: lines,
  };
}

function prepareAiDiffPayload(
  diffText: string,
  maxLines: number,
  maxChars: number
): AiDiffPayload {
  const prepared = prepareDiffForAnalysis(diffText, maxLines);
  let text = prepared.text;
  let truncatedByChars = false;

  if (maxChars > 0 && text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncatedByChars = true;
  }

  return {
    text,
    truncated: prepared.truncated || truncatedByChars,
    analyzedLines: prepared.analyzedLines,
    truncatedByChars,
  };
}

function formatFileChanges(files: FileChange[]): string {
  if (files.length === 0) {
    return "none";
  }
  return files.map((file) => `${file.status}: ${file.path}`).join("\n");
}

function applyPromptTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key];
    }
    return match;
  });
}


function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isGitNotAvailable(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  if (message.includes("command not found")) {
    return true;
  }
  if (message.includes("not recognized as an internal")) {
    return true;
  }
  if (message.includes("git: not found")) {
    return true;
  }
  if (message.includes("git: command not found")) {
    return true;
  }
  if (message.includes("no such file or directory")) {
    return true;
  }

  const anyError = error as { code?: unknown };
  if (anyError && (anyError.code === "ENOENT" || anyError.code === 127)) {
    return true;
  }

  return false;
}

function isNotGitRepository(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes("not a git repository");
}

function getGitErrorMessage(error: unknown, fallback: string): string {
  if (isGitNotAvailable(error)) {
    return "Git not installed or not available in PATH.";
  }
  if (isNotGitRepository(error)) {
    return "Not a git repository";
  }

  const detail = getErrorMessage(error);
  return fallback ? `${fallback}: ${detail}` : detail;
}

async function openMarkdownDocument(content: string): Promise<void> {
  const uri = vscode.Uri.parse("untitled:PR_DESCRIPTION.md");
  const document = await vscode.workspace.openTextDocument(uri);

  if (document.languageId !== "markdown") {
    await vscode.languages.setTextDocumentLanguage(document, "markdown");
  }

  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
  });
  const lastLine = document.lineCount - 1;
  const lastCharacter = document.lineAt(lastLine).text.length;
  const fullRange = new vscode.Range(0, 0, lastLine, lastCharacter);

  await editor.edit((edit: vscode.TextEditorEdit) => {
    edit.replace(fullRange, content);
  });
}

async function openTextPreviewDocument(
  content: string,
  title: string
): Promise<void> {
  const uri = vscode.Uri.parse(`untitled:${title}`);
  const document = await vscode.workspace.openTextDocument(uri);

  if (document.languageId !== "plaintext") {
    await vscode.languages.setTextDocumentLanguage(document, "plaintext");
  }

  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
  });
  const lastLine = document.lineCount - 1;
  const lastCharacter = document.lineAt(lastLine).text.length;
  const fullRange = new vscode.Range(0, 0, lastLine, lastCharacter);

  await editor.edit((edit: vscode.TextEditorEdit) => {
    edit.replace(fullRange, content);
  });
}

async function confirmAiSend(
  prompt: string,
  promptTitle: string,
  previewPrompt: boolean
): Promise<boolean> {
  if (previewPrompt) {
    await openTextPreviewDocument(prompt, promptTitle);
    const confirmation = await vscode.window.showInputBox({
      prompt: `Review ${promptTitle}, then type SEND to continue.`,
      placeHolder: "Type SEND to confirm, or leave blank to cancel.",
      ignoreFocusOut: true,
    });
    return confirmation?.trim().toLowerCase() === "send" || confirmation?.trim().toLowerCase() === "";
  }

  const choice = await vscode.window.showWarningMessage(
    "Send the generated prompt (diff, files, and baseline description) to the AI provider?",
    { modal: true },
    "Send",
    "Cancel"
  );
  return choice === "Send";
}

type WorkspacePick = {
  label: string;
  description: string;
  folder: vscode.WorkspaceFolder;
};

async function getWorkspaceFolder(): Promise<vscode.WorkspaceFolder | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    await vscode.window.showErrorMessage("Open a folder");
    return null;
  }
  if (folders.length === 1) {
    return folders[0];
  }

  const picks: WorkspacePick[] = folders.map((folder: any) => ({
    label: folder.name,
    description: folder.uri.fsPath,
    folder,
  }));
  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder: "Select the workspace folder to use",
  });
  return selected ? selected.folder : null;
}

type MarkdownResult = {
  markdown: string;
  copyToClipboard: boolean;
};

type MarkdownData = {
  files: FileChange[];
  changeBullets: string[];
  releaseNotesLines: string[];
  testingLines: string[];
  risk: { level: "Low" | "Medium" | "High"; areas: string[] };
  diffOutput: string;
  preparedDiff: PreparedDiff;
  added: number;
  removed: number;
  maxDiffLines: number;
  includeFilesSection: boolean;
  copyToClipboard: boolean;
  summaryLabel: string;
  diffLabel: string;
  emptyChangesLine: string;
};

async function collectStagedData(
  workspaceRoot: string
): Promise<MarkdownData | null> {
  let statusOutput: string;

  try {
    statusOutput = await execGit("git status --porcelain", workspaceRoot);
  } catch (error) {
    await vscode.window.showErrorMessage(getGitErrorMessage(error, ""));
    return null;
  }

  const stagedChanges = parsePorcelainStagedChanges(statusOutput);
  if (stagedChanges.length === 0) {
    await vscode.window.showInformationMessage("No staged changes");
    return null;
  }
  const files = mergeChanges(stagedChanges, []);
  const changeBullets = buildChangeBullets(files);
  const releaseNotesLines = buildReleaseNotesLines(files);
  const testingLines = buildTestingLines(files);
  const risk = buildRiskAssessment(files);

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
      getGitErrorMessage(error, "Failed to run git diff --staged")
    );
    return null;
  }

  const preparedDiff = prepareDiffForAnalysis(diffOutput, maxDiffLines);
  const { added, removed } = summarizeDiff(preparedDiff.text);

  return {
    files,
    changeBullets,
    releaseNotesLines,
    testingLines,
    risk,
    diffOutput,
    preparedDiff,
    added,
    removed,
    maxDiffLines,
    includeFilesSection,
    copyToClipboard,
    summaryLabel: "Staged changes",
    diffLabel: "staged",
    emptyChangesLine: "No staged files detected.",
  };
}

async function collectBaseData(
  workspaceRoot: string
): Promise<MarkdownData | null> {
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
    await vscode.window.showErrorMessage(getGitErrorMessage(error, ""));
    return null;
  }

  let baseBranch: string;
  try {
    baseBranch = await resolveBaseBranch(workspaceRoot, configuredBase);
  } catch (error) {
    await vscode.window.showErrorMessage(getGitErrorMessage(error, ""));
    return null;
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
      getGitErrorMessage(
        error,
        `Failed to run git diff against ${baseBranch}`
      )
    );
    return null;
  }

  const rangeChanges = parseNameStatus(filesOutputRange);
  const workingChanges = parseNameStatus(filesOutputWorking);
  const files = mergeChanges(rangeChanges, workingChanges);
  if (files.length === 0) {
    await vscode.window.showInformationMessage(
      `No changes against ${baseBranch}`
    );
    return null;
  }

  const changeBullets = buildChangeBullets(files);
  const releaseNotesLines = buildReleaseNotesLines(files);
  const testingLines = buildTestingLines(files);
  const risk = buildRiskAssessment(files);

  const combinedDiff = [diffOutputRange, diffOutputWorking]
    .filter(Boolean)
    .join("\n");
  const preparedDiff = prepareDiffForAnalysis(combinedDiff, maxDiffLines);
  const { added, removed } = summarizeDiff(preparedDiff.text);

  return {
    files,
    changeBullets,
    releaseNotesLines,
    testingLines,
    risk,
    diffOutput: combinedDiff,
    preparedDiff,
    added,
    removed,
    maxDiffLines,
    includeFilesSection,
    copyToClipboard,
    summaryLabel: `Changes against ${baseBranch}`,
    diffLabel: `against ${baseBranch}`,
    emptyChangesLine: `No changes detected against ${baseBranch}.`,
  };
}

async function buildStagedMarkdown(
  workspaceRoot: string
): Promise<MarkdownResult | null> {
  const data = await collectStagedData(workspaceRoot);
  if (!data) {
    return null;
  }

  const markdown = buildMarkdownFromData(data);

  return { markdown, copyToClipboard: data.copyToClipboard };
}

function buildMarkdownFromData(data: MarkdownData): string {
  return buildMarkdown({
    files: data.files,
    changeBullets: data.changeBullets,
    releaseNotesLines: data.releaseNotesLines,
    testingLines: data.testingLines,
    riskLevel: data.risk.level,
    areasImpacted: data.risk.areas,
    added: data.added,
    removed: data.removed,
    truncated: data.preparedDiff.truncated,
    maxLines: data.maxDiffLines,
    analyzedLines: data.preparedDiff.analyzedLines,
    summaryLabel: data.summaryLabel,
    diffLabel: data.diffLabel,
    emptyChangesLine: data.emptyChangesLine,
    includeFilesSection: data.includeFilesSection,
  });
}

async function ensureGitRepo(workspaceRoot: string): Promise<void> {
  try {
    await execGit("git status --porcelain", workspaceRoot);
  } catch (error) {
    throw new Error(getGitErrorMessage(error, ""));
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
    if (isGitNotAvailable(error)) {
      throw new Error(getGitErrorMessage(error, ""));
    }
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
  const workspaceFolder = await getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }
  const workspaceRoot = workspaceFolder.uri.fsPath;

  const result = await buildStagedMarkdown(workspaceRoot);
  if (!result) {
    return;
  }

  await openMarkdownDocument(result.markdown);

  if (result.copyToClipboard) {
    await vscode.env.clipboard.writeText(result.markdown);
    await vscode.window.showInformationMessage("Copied to clipboard");
  }
}

async function generateDescriptionAiEnhanced(): Promise<void> {
  const workspaceFolder = await getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const data = await collectBaseData(workspaceRoot);
  if (!data) {
    return;
  }

  const baselineMarkdown = buildMarkdownFromData(data);
  const aiConfig = vscode.workspace.getConfiguration("prd.ai");
  const apiKey = (aiConfig.get<string>("apiKey", "") ?? "").trim();

  if (!apiKey) {
    await openMarkdownDocument(baselineMarkdown);
    if (data.copyToClipboard) {
      await vscode.env.clipboard.writeText(baselineMarkdown);
      await vscode.window.showInformationMessage("Copied to clipboard");
    }
    return;
  }

  const consentOk = await ensureAiConsent();
  if (!consentOk) {
    return;
  }

  const providerId = (aiConfig.get<string>("provider", "openai") ?? "openai")
    .trim()
    .toLowerCase();
  const endpoint =
    (aiConfig.get<string>(
      "endpoint",
      "https://api.openai.com/v1/chat/completions"
    ) ?? "https://api.openai.com/v1/chat/completions"
    ).trim();
  const model = (aiConfig.get<string>("model", "gpt-4o-mini") ??
    "gpt-4o-mini").trim();
  const timeoutMs = Math.max(
    aiConfig.get<number>("timeoutMs", 12000) ?? 12000,
    1000
  );
  const maxDiffLines = Math.max(
    aiConfig.get<number>("maxDiffLines", 800) ?? 800,
    1
  );
  const maxDiffChars = Math.max(
    aiConfig.get<number>("maxDiffChars", 12000) ?? 12000,
    200
  );
  const tone = (aiConfig.get<string>("tone", "standard") ?? "standard").trim();
  const previewPrompt =
    aiConfig.get<boolean>("previewPrompt", true) ?? true;

  let promptTemplate: string;
  try {
    promptTemplate = await getPromptTemplate();
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Failed to load AI prompt: ${getErrorMessage(error)}`
    );
    return;
  }

  const aiDiff = prepareAiDiffPayload(data.diffOutput, maxDiffLines, maxDiffChars);
  const truncatedReason = aiDiff.truncated
    ? aiDiff.truncatedByChars
      ? "maxChars"
      : "maxLines"
    : "none";
  const prompt = applyPromptTemplate(promptTemplate, {
    BASELINE: baselineMarkdown,
    FILES: formatFileChanges(data.files),
    DIFF: aiDiff.text || "No diff content available.",
    DIFF_TRUNCATED: aiDiff.truncated ? "yes" : "no",
    DIFF_LINES: String(aiDiff.analyzedLines),
    DIFF_TRUNCATED_REASON: truncatedReason,
    TONE: tone,
  });

  const promptTitle = "PRD_AI_PROMPT.txt";
  const confirmSend = await confirmAiSend(prompt, promptTitle, previewPrompt);
  if (!confirmSend) {
    await vscode.window.showInformationMessage("Generation canceled.");
    return;
  }

  let aiMarkdown: string | null = null;
  let canceledByUser = false;
  const abortController = new AbortController();

  try {
    aiMarkdown = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "PRD: Generation in progress",
        cancellable: true,
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => {
          canceledByUser = true;
          abortController.abort();
        });

        const provider = createProvider(providerId);
        const input: AIInput = {
          prompt,
          apiKey,
          endpoint,
          model,
          timeoutMs,
          signal: abortController.signal,
        };

        return await provider.generatePRDescription(input);
      }
    );
  } catch (error) {
    if (
      canceledByUser ||
      abortController.signal.aborted ||
      getErrorMessage(error).toLowerCase().includes("canceled")
    ) {
      await vscode.window.showInformationMessage("Generation canceled.");
      return;
    }
    await vscode.window.showErrorMessage(
      `AI enhancement failed: ${getErrorMessage(error)}`
    );
    aiMarkdown = baselineMarkdown;
  }

  if (!aiMarkdown) {
    await vscode.window.showInformationMessage("Generation canceled.");
    return;
  }

  await openMarkdownDocument(aiMarkdown);

  if (data.copyToClipboard) {
    await vscode.env.clipboard.writeText(aiMarkdown);
    await vscode.window.showInformationMessage("Copied to clipboard");
  }
}

async function insertDescriptionHere(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showErrorMessage("Open a file to insert the description.");
    return;
  }

  const workspaceFolder = await getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }
  const workspaceRoot = workspaceFolder.uri.fsPath;

  const result = await buildStagedMarkdown(workspaceRoot);
  if (!result) {
    return;
  }

  const selection = editor.selection;
  await editor.edit((edit: vscode.TextEditorEdit) => {
    if (selection && !selection.isEmpty) {
      edit.replace(selection, result.markdown);
    } else {
      edit.insert(selection.active, result.markdown);
    }
  });

  if (result.copyToClipboard) {
    await vscode.env.clipboard.writeText(result.markdown);
    await vscode.window.showInformationMessage("Copied to clipboard");
  }
}

async function generateDescriptionAgainstBase(): Promise<void> {
  const workspaceFolder = await getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const data = await collectBaseData(workspaceRoot);
  if (!data) {
    return;
  }

  const markdown = buildMarkdownFromData(data);

  await openMarkdownDocument(markdown);

  if (data.copyToClipboard) {
    await vscode.env.clipboard.writeText(markdown);
    await vscode.window.showInformationMessage("Copied to clipboard");
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extensionRoot = context.extensionPath;
  extensionGlobalState = context.globalState;
  const stagedDisposable = vscode.commands.registerCommand(
    "prd.generateDescriptionStaged",
    generateDescriptionFromStaged
  );
  const baseDisposable = vscode.commands.registerCommand(
    "prd.generateDescriptionBase",
    generateDescriptionAgainstBase
  );
  const aiDisposable = vscode.commands.registerCommand(
    "prd.generateDescriptionAi",
    generateDescriptionAiEnhanced
  );
  const insertDisposable = vscode.commands.registerCommand(
    "prd.insertDescriptionHere",
    insertDescriptionHere
  );
  context.subscriptions.push(
    stagedDisposable,
    baseDisposable,
    aiDisposable,
    insertDisposable
  );
}

export function deactivate(): void {}
