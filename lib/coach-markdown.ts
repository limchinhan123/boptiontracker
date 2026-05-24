import type { WeeklyFactSheet } from "./weekly-fact-sheet";

export type ReviewExport = {
  weekEnding: string;
  generatedAt: number;
  model: string;
  factSheet: WeeklyFactSheet;
  narrativeMarkdown: string;
  memoryMarkdown: string;
};

export function formatCoachExportMarkdown(review: ReviewExport): string {
  const when = new Date(review.generatedAt).toISOString();
  return `# Options coach review — week ending ${review.weekEnding}

Generated: ${when}  
Model: ${review.model}

---

## Coach narrative

${review.narrativeMarkdown.trim()}

---

## Rolling memory (for next review)

${review.memoryMarkdown.trim()}

---

## Fact sheet (structured)

\`\`\`json
${JSON.stringify(review.factSheet, null, 2)}
\`\`\`
`;
}

export function formatMemoryOnlyMarkdown(review: ReviewExport): string {
  return `# Coach memory — ${review.weekEnding}

${review.memoryMarkdown.trim()}
`;
}
