export type FileStatus = "Added" | "Modified" | "Deleted" | "Renamed";

export type FileChange = {
  status: FileStatus;
  path: string;
};

export type TemplateOptions = {
  files: FileChange[];
  changeBullets: string[];
  testingLines: string[];
  added: number;
  removed: number;
  truncated: boolean;
  maxLines: number;
  analyzedLines: number;
  summaryLabel: string;
  diffLabel: string;
  emptyChangesLine: string;
  includeFilesSection: boolean;
};

export function buildMarkdown(options: TemplateOptions): string {
  const {
    files,
    changeBullets,
    testingLines,
    added,
    removed,
    truncated,
    maxLines,
    analyzedLines,
    summaryLabel,
    diffLabel,
    emptyChangesLine,
    includeFilesSection,
  } = options;

  const summaryLines = [
    `${summaryLabel} in ${files.length} file${files.length === 1 ? "" : "s"}.`,
    `Diff stats (${diffLabel}): +${added} / -${removed} lines.`,
  ];

  if (truncated) {
    summaryLines.push(
      `Diff analysis truncated to ${maxLines} lines (analyzed ${analyzedLines}).`
    );
  }

  const changesLines =
    changeBullets.length > 0 ? changeBullets : [emptyChangesLine];

  const filesLines =
    files.length > 0
      ? files.map((file) => `- ${file.status}: ${file.path}`)
      : [];

  const output: string[] = [
    "## Summary",
    ...summaryLines.map((line) => `- ${line}`),
    "",
    "## Changes",
    ...changesLines.map((line) => `- ${line}`),
    "",
  ];

  if (includeFilesSection) {
    output.push(
      "## Files changed",
      ...(filesLines.length > 0 ? filesLines : [`- ${emptyChangesLine}`]),
      ""
    );
  } else if (filesLines.length > 0) {
    output.push("Files changed:", ...filesLines, "");
  }

  output.push(
    "## Testing",
    ...(testingLines.length > 0
      ? testingLines
      : ["- [ ] Not run (not specified)."]),
    "",
    "## Risk / Impact",
    "- Level: TBD",
    "- Areas impacted: TBD",
    "",
    "## Rollout / Backout",
    "- Rollout: TBD",
    "- Backout: TBD",
    ""
  );

  return output.join("\n");
}
