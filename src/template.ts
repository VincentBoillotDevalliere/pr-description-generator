export type FileStatus = "Added" | "Modified" | "Deleted" | "Renamed";

export type FileChange = {
  status: FileStatus;
  path: string;
};

export type TemplateOptions = {
  files: FileChange[];
  changeBullets: string[];
  releaseNotesLines: string[];
  testingLines: string[];
  riskLevel: string;
  areasImpacted: string[];
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
    releaseNotesLines,
    testingLines,
    riskLevel,
    areasImpacted,
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
    `Risk: ${riskLevel}${
      areasImpacted.length > 0 ? ` (${areasImpacted.join(", ")})` : ""
    }.`,
  ];

  if (truncated) {
    summaryLines.push(
      `Diff analysis truncated to ${maxLines} lines (analyzed ${analyzedLines}).`
    );
  }

  const filesLines =
    files.length > 0
      ? files.map((file) => `- ${file.status}: ${file.path}`)
      : [];

  const output: string[] = [
    "## Summary",
    ...summaryLines.map((line) => `- ${line}`),
    "",
    "## Changes",
    ...(changeBullets.length > 0
      ? changeBullets.map((line) => `- ${line}`)
      : [`- ${emptyChangesLine}`]),
    "",
    "## Release Notes",
    ...(releaseNotesLines.length > 0
      ? releaseNotesLines.map((line) => `- ${line}`)
      : ["- No release-note candidates detected."]),
    "",
  ];

  if (includeFilesSection) {
    output.push(
      "## Files changed",
      ...(filesLines.length > 0 ? filesLines : [`- ${emptyChangesLine}`]),
      ""
    );
  }

  output.push(
    "## Testing",
    ...(testingLines.length > 0
      ? testingLines
      : ["- [ ] Not run (not specified)."]),
    "",
    "## Risk / Impact",
    `- Level: ${riskLevel}`,
    `- Areas impacted: ${
      areasImpacted.length > 0 ? areasImpacted.join(", ") : "none detected."
    }`,
    "",
    "## Rollout / Backout",
    "- Rollout: TBD",
    "- Backout: TBD",
    ""
  );

  return output.join("\n");
}
