/** Template reference only. The server must supply the canonical researched name. */
export function subjectPossessive(subject?: { subjectName?: string }, capitalized = true): string {
  return subject?.subjectName ? `${subject.subjectName}'s` : capitalized ? "Your" : "your";
}

export function subjectName(subject?: { subjectName?: string }): string {
  return subject?.subjectName ?? "you";
}
