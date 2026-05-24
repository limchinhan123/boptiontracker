import { COACH_LOGIC_VERSION } from "./coach-version";
import { isStaleCoachText } from "./coach-payload";

export type CoachHealthStatus =
  | "ok"
  | "regenerate_suggested"
  | "stale_pattern"
  | "generic_memory";

export type CoachHealth = {
  status: CoachHealthStatus;
  label: string;
  coachLogicVersion: number;
  reviewLogicVersion: number | null;
  memoryBulletCount: number;
  genericBulletCount: number;
  archivedReviewCount: number;
};

const GENERIC_MEMORY_PATTERNS = [
  /macro/i,
  /defensive strateg/i,
  /market assumptions/i,
  /volatility shocks?$/i,
  /sector-specific impacts?/i,
  /ensure diversification aligns/i,
  /review top underlyings by trade count/i,
];

export function memoryBullets(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function countMemoryBullets(markdown: string): number {
  return memoryBullets(markdown).length;
}

export function isGenericMemoryBullet(line: string): boolean {
  if (/\d/.test(line)) return false;
  return GENERIC_MEMORY_PATTERNS.some((re) => re.test(line));
}

export function genericMemoryBulletCount(markdown: string): number {
  return memoryBullets(markdown).filter(isGenericMemoryBullet).length;
}

export function computeCoachHealth(input: {
  narrativeMarkdown?: string;
  memoryMarkdown?: string;
  reviewLogicVersion?: number | null;
  archivedReviewCount?: number;
}): CoachHealth {
  const narrative = input.narrativeMarkdown ?? "";
  const memory = input.memoryMarkdown ?? "";
  const reviewLogicVersion = input.reviewLogicVersion ?? null;
  const memoryBulletCount = countMemoryBullets(memory);
  const genericBulletCount = genericMemoryBulletCount(memory);

  let status: CoachHealthStatus = "ok";
  let label = "Memory healthy — prior weeks feed the next review.";

  if (isStaleCoachText(narrative + memory)) {
    status = "stale_pattern";
    label =
      "Stale patterns detected (e.g. open-leg or portfolio MTM scare). Regenerate — no wipe needed.";
  } else if (
    reviewLogicVersion != null &&
    reviewLogicVersion < COACH_LOGIC_VERSION
  ) {
    status = "regenerate_suggested";
    label = `Review uses coach logic v${reviewLogicVersion}; app is v${COACH_LOGIC_VERSION}. Regenerate recommended.`;
  } else if (
    memoryBulletCount > 0 &&
    genericBulletCount >= Math.max(2, Math.ceil(memoryBulletCount / 2))
  ) {
    status = "generic_memory";
    label =
      "Memory bullets look generic (few numbers). Regenerate for tighter, factual memory.";
  }

  return {
    status,
    label,
    coachLogicVersion: COACH_LOGIC_VERSION,
    reviewLogicVersion,
    memoryBulletCount,
    genericBulletCount,
    archivedReviewCount: input.archivedReviewCount ?? 0,
  };
}

export function openQuestionInNarrative(
  narrative: string,
  openQuestion?: string,
): boolean {
  if (!openQuestion?.trim()) return false;
  const q = openQuestion.trim().toLowerCase();
  return narrative.toLowerCase().includes(q);
}
