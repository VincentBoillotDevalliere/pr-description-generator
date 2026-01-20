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

type PreparedDiff = {
  text: string;
  truncated: boolean;
  analyzedLines: number;
};

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

function getTopLevelFolder(path: string): string | null {
  const normalized = normalizeGroupingPath(path);
  const parts = normalized.split("/");
  if (parts.length <= 1) {
    return null;
  }
  return parts[0];
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

  const formatList = (items: string[], maxItems: number): string => {
    if (items.length <= maxItems) {
      return items.join(", ");
    }
    const remaining = items.length - maxItems;
    return `${items.slice(0, maxItems).join(", ")}, and ${remaining} more`;
  };

  const statusCounts: Record<FileStatus, number> = {
    Added: 0,
    Modified: 0,
    Deleted: 0,
    Renamed: 0,
  };

  const folderCounts = new Map<string, number>();
  let rootCount = 0;

  let uiTouched = 0;
  let apiTouched = 0;
  let scriptsTouched = 0;
  let docsTouched = 0;
  let assetsTouched = 0;
  let dataTouched = 0;
  let translationsTouched = 0;
  let testsTouched = 0;

  let dependenciesTouched = false;
  let configTouched = false;
  let infraTouched = false;
  let dbTouched = false;
  let authTouched = false;

  for (const file of files) {
    statusCounts[file.status] += 1;

    const folder = getTopLevelFolder(file.path);
    if (folder) {
      folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
    } else {
      rootCount += 1;
    }

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
      normalized.includes("/i18n/") ||
      normalized.includes("/locales/") ||
      normalized.includes("/l10n/")
    ) {
      translationsTouched += 1;
    }

    if (
      ["csv", "tsv", "xlsx", "jsonl"].includes(extension)
    ) {
      dataTouched += 1;
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

  const statusParts: string[] = [];
  if (statusCounts.Added > 0) {
    statusParts.push(`${statusCounts.Added} added`);
  }
  if (statusCounts.Modified > 0) {
    statusParts.push(`${statusCounts.Modified} modified`);
  }
  if (statusCounts.Deleted > 0) {
    statusParts.push(`${statusCounts.Deleted} deleted`);
  }
  if (statusCounts.Renamed > 0) {
    statusParts.push(`${statusCounts.Renamed} renamed`);
  }
  if (statusParts.length > 0) {
    pushBullet(`File operations: ${statusParts.join(", ")}.`);
  }

  if (folderCounts.size > 0 || rootCount > 0) {
    const sorted = Array.from(folderCounts.entries()).sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    });

    const top = sorted.slice(0, 3).map(([folder, count]) => ({
      label: `${folder}/ (${count})`,
      count,
    }));

    if (rootCount > 0 && top.length < 3) {
      top.push({ label: `root files (${rootCount})`, count: rootCount });
    }

    if (top.length > 0) {
      pushBullet(`Primary areas: ${top.map((entry) => entry.label).join(", ")}.`);
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
    pushBullet(`Signals detected: ${signals.join(", ")}.`);
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
  if (dataTouched > 0) {
    focusAreas.push("data files");
  }
  if (translationsTouched > 0) {
    focusAreas.push("localization");
  }
  if (testsTouched > 0) {
    focusAreas.push("tests");
  }
  if (focusAreas.length > 0) {
    pushBullet(`Touches: ${formatList(focusAreas, 6)}.`);
  }

  if (testsTouched > 0) {
    pushBullet(
      `Tests updated: ${testsTouched} file${testsTouched === 1 ? "" : "s"}.`
    );
  }

  if (translationsTouched > 0) {
    pushBullet(
      `Localization updates: ${translationsTouched} file${
        translationsTouched === 1 ? "" : "s"
      }.`
    );
  }

  if (dataTouched > 0) {
    pushBullet(
      `Data files updated: ${dataTouched} file${dataTouched === 1 ? "" : "s"}.`
    );
  }

  return bullets;
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

  await editor.edit((edit) => {
    edit.replace(fullRange, content);
  });
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

  const picks: WorkspacePick[] = folders.map((folder) => ({
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

async function buildStagedMarkdown(
  workspaceRoot: string
): Promise<MarkdownResult | null> {
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

  const markdown = buildMarkdown({
    files,
    changeBullets,
    testingLines,
    riskLevel: risk.level,
    areasImpacted: risk.areas,
    added,
    removed,
    truncated: preparedDiff.truncated,
    maxLines: maxDiffLines,
    analyzedLines: preparedDiff.analyzedLines,
    summaryLabel: "Staged changes",
    diffLabel: "staged",
    emptyChangesLine: "No staged files detected.",
    includeFilesSection,
  });

  return { markdown, copyToClipboard };
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
  await editor.edit((edit) => {
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
    return;
  }

  let baseBranch;
  try {
    baseBranch = await resolveBaseBranch(workspaceRoot, configuredBase);
  } catch (error) {
    await vscode.window.showErrorMessage(getGitErrorMessage(error, ""));
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
      getGitErrorMessage(
        error,
        `Failed to run git diff against ${baseBranch}`
      )
    );
    return;
  }

  const rangeChanges = parseNameStatus(filesOutputRange);
  const workingChanges = parseNameStatus(filesOutputWorking);
  const files = mergeChanges(rangeChanges, workingChanges);
  const changeBullets = buildChangeBullets(files);
  const testingLines = buildTestingLines(files);
  const risk = buildRiskAssessment(files);
  if (files.length === 0) {
    await vscode.window.showInformationMessage(
      `No changes against ${baseBranch}`
    );
    return;
  }

  const combinedDiff = [diffOutputRange, diffOutputWorking]
    .filter(Boolean)
    .join("\n");
  const preparedDiff = prepareDiffForAnalysis(combinedDiff, maxDiffLines);
  const { added, removed } = summarizeDiff(preparedDiff.text);

  const markdown = buildMarkdown({
    files,
    changeBullets,
    testingLines,
    riskLevel: risk.level,
    areasImpacted: risk.areas,
    added,
    removed,
    truncated: preparedDiff.truncated,
    maxLines: maxDiffLines,
    analyzedLines: preparedDiff.analyzedLines,
    summaryLabel: `Changes against ${baseBranch}`,
    diffLabel: `against ${baseBranch}`,
    emptyChangesLine: `No changes detected against ${baseBranch}.`,
    includeFilesSection,
  });

  await openMarkdownDocument(markdown);

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
  const insertDisposable = vscode.commands.registerCommand(
    "prd.insertDescriptionHere",
    insertDescriptionHere
  );
  context.subscriptions.push(stagedDisposable, baseDisposable, insertDisposable);
}

export function deactivate(): void {}
