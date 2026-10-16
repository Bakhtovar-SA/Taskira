/** A small, deterministic person illustration for accounts without a photo.
 *  The face is deliberately symbolic: the seed is an ID, never a guess about
 *  somebody's appearance, role, gender or background. */
const HAIR = [
  // Long frame, cap, bun, crop, high crest, curls, side sweep, and hood.
  "M5 17Q4 5 16 4Q28 5 27 17L27 29H22L22 16Q16 11 10 16L10 29H5Z",
  "M7 13Q9 5 16 5Q24 5 25 13L28 15H4Z M3 15H29V17H3Z",
  "M6 16Q5 8 12 6Q11 1 17 2Q22 2 22 7Q27 10 26 16L23 13Q18 11 16 10Q11 13 8 15Z",
  "M8 14V11Q8 7 14 7H21Q25 8 25 14L22 12H10Z",
  "M6 16Q4 11 8 9L7 4L13 7Q15 1 21 4L20 8Q27 9 26 16L22 12Q15 9 9 15Z",
  "M5 16Q4 12 8 11Q6 6 12 6Q14 3 18 5Q23 3 24 8Q29 9 27 15L23 14Q18 11 15 13Q10 11 7 16Z",
  "M5 16Q6 5 17 5Q27 5 27 16L23 13Q20 10 18 9Q13 16 6 16Z",
  "M5 19Q4 5 16 4Q28 5 27 19L24 27H21L23 15Q16 9 9 15L11 27H8Z",
] as const;

const HEAD = [
  "M8.5 16c0-6 2.5-9 7.5-9s7.5 3 7.5 9v3c0 6-3 9-7.5 9s-7.5-3-7.5-9v-3Z",
  "M9 15c0-5 2.5-8 7-8s7 3 7 8v4c0 6-2.5 9-7 9s-7-3-7-9v-4Z",
  "M8 16c0-5.5 3-9 8-9s8 3.5 8 9v3c0 5.5-3.5 9-8 9s-8-3.5-8-9v-3Z",
] as const;

const hashSeed = (seed: string) => {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return hash >>> 0;
};

/** Stable two-colour palette: a full hue circle and a varied, harmonious accent. */
export const colleagueColorVars = (seed: string): Record<string, string> => {
  const hue = hashSeed(`portrait:${seed}`) % 360;
  const accentOffset = 48 + (hashSeed(`accent:${seed}`) % 96);
  return {
    "--portrait-hue": `${hue}deg`,
    "--portrait-accent-hue": `${(hue + accentOffset) % 360}deg`,
  };
};

export function ColleaguePortrait({ seed }: { seed: string }) {
  const hash = hashSeed(seed);
  const hair = HAIR[hash % HAIR.length];
  const head = HEAD[(hash >>> 6) % HEAD.length];
  const glasses = (hash >>> 10) % 4 === 0;
  const part = (hash >>> 13) % 3;

  return <svg className="ds-av-portrait" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle cx="16" cy="16" r="16" className="portrait-field" />
    <path d="M2 32c1-6 6-10 14-10s13 4 14 10Z" className="portrait-shoulders" />
    <path d={head} className="portrait-face" />
    <path d={hair} className="portrait-hair" />
    {part === 1 && <path d="M8 13c3 2 6 2 9-2" className="portrait-lock" />}
    {part === 2 && <path d="M23 9c3 1 4 4 4 7" className="portrait-lock" />}
    <circle cx="12.7" cy="17.6" r="0.85" className="portrait-eye" />
    <circle cx="19.3" cy="17.6" r="0.85" className="portrait-eye" />
    <path d="M13.6 22.4q2.4 1.8 4.8 0" className="portrait-mouth" />
    {glasses && <path d="M9.4 15.4h5.8v4.3H9.4zm7.4 0h5.8v4.3h-5.8zm-1.6 1.3h1.6" className="portrait-glasses" />}
  </svg>;
}
