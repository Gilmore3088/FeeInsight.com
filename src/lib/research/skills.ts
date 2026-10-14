import { HAMILTON_DELIVERABLES } from "@/lib/hamilton/knowledge";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  content: string;
}

/**
 * The deliverables an answer may offer come from Hamilton's fixed, versioned knowledge set
 * (src/lib/hamilton/knowledge.ts), never from `.claude/skills` at runtime (#1081).
 */
function loadAllSkills(): SkillInfo[] {
  return HAMILTON_DELIVERABLES.map((deliverable) => ({
    id: deliverable.id,
    name: deliverable.name,
    description: deliverable.description,
    triggers: [...deliverable.triggers],
    content: deliverable.framework,
  }));
}

/**
 * Auto-detect which skills are relevant to a user's message.
 * Returns the top matching skill (or null if no strong match).
 * Matching is based on keyword overlap between the message and skill triggers.
 */
export function detectSkill(userMessage: string): SkillInfo | null {
  const skills = loadAllSkills();
  if (skills.length === 0) return null;

  const messageLower = userMessage.toLowerCase();
  const messageWords = new Set(messageLower.split(/\s+/));

  let bestSkill: SkillInfo | null = null;
  let bestScore = 0;

  for (const skill of skills) {
    let score = 0;

    for (const trigger of skill.triggers) {
      // Multi-word triggers: check if the phrase appears in the message
      if (trigger.includes(" ")) {
        if (messageLower.includes(trigger)) score += 3;
      } else {
        // Single word: check word-level match
        if (messageWords.has(trigger)) score += 2;
        // Partial match (e.g., "benchmarking" matches "benchmark")
        else if (messageLower.includes(trigger)) score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestSkill = skill;
    }
  }

  // Require at least 2 points to activate (one exact word match or partial phrase)
  return bestScore >= 2 ? bestSkill : null;
}

/**
 * Build the skill injection text to append to a system prompt.
 *
 * Skills are offered as optional deliverables, not auto-executed.
 * The model answers the user's question concisely, then offers the
 * deliverable as an option. The full skill content is NOT included
 * until the user opts in — this prevents the model from following
 * the skill's imperative instructions and burning tokens.
 */
export function buildSkillInjection(skill: SkillInfo): string {
  return `\n\n---\n\nIMPORTANT INSTRUCTION: You detected that this question may relate to a "${skill.name}" deliverable (${skill.description}). Do NOT produce a full report, guide, analysis, or structured deliverable unless the user explicitly asks for one. Instead:
1. Answer the user's question concisely using data from your tools (2-4 paragraphs max).
2. At the end, add one sentence offering the option: "Would you like me to generate a full **${skill.name}**? This will provide a more detailed, structured analysis."
3. Do NOT include any report template, executive summary, methodology section, or structured output format unless the user says yes.`;
}

/**
 * Build the full skill execution prompt — only used when the user
 * explicitly opts in to generating a deliverable.
 */
export function buildSkillExecution(skill: SkillInfo): string {
  return `\n\n---\n\nThe user has requested a full "${skill.name}" deliverable. Follow the framework below to produce it.\n\n${skill.content}`;
}

/**
 * Detect if the user's message is confirming a previously offered skill.
 * Looks for short affirmative messages like "yes", "generate it", "sure", etc.
 */
export function isSkillOptIn(userMessage: string): boolean {
  const msg = userMessage.trim().toLowerCase();
  const optInPatterns = [
    /^(yes|yeah|yep|sure|ok|okay|go ahead|do it|please|generate)/,
    /^(go for it|let'?s do it|sounds good|absolutely)/,
    /generate .*(report|guide|pulse|analysis|brief|deliverable)/,
    /full .*(report|guide|pulse|analysis|brief|deliverable)/,
  ];
  return optInPatterns.some((p) => p.test(msg));
}

/**
 * Scan conversation history to find which skill was previously offered.
 * Looks for the "Would you like me to generate a full **skill-name**" pattern
 * in assistant messages.
 */
export function findOfferedSkill(
  assistantMessages: { text: string }[]
): SkillInfo | null {
  const skills = loadAllSkills();
  for (const msg of [...assistantMessages].reverse()) {
    for (const skill of skills) {
      if (msg.text.includes(`**${skill.name}**`)) {
        return skill;
      }
    }
  }
  return null;
}

export function listSkills(): Omit<SkillInfo, "content">[] {
  return loadAllSkills().map(({ content: _, ...rest }) => rest);
}
