/** A small, deterministic person illustration for accounts without a photo.
 *  The seed is an ID. Cropped, abstract hair and token-coloured faces avoid
 *  presenting a guessed gender, ethnicity or real appearance. */
const HAIR = [
  // Eight short, geometric silhouettes; no long side locks or bun.
  "M7 14Q6 5 16 5Q26 5 25 14L22 12Q16 9 10 13Z",
  "M7 12Q9 5 16 5Q23 5 25 12L27 14H5Z M5 15H27V16H5Z",
  "M6 14Q4 10 9 9Q8 5 13 6Q16 2 20 6Q25 5 24 9Q29 10 26 14L22 12Q16 10 10 13Z",
  "M8 14V11Q8 7 14 7H21Q25 8 25 14L22 12H10Z",
  "M6 14Q5 10 9 9L9 5L14 8Q16 3 21 5L22 9Q27 10 26 14L22 12Q16 9 10 13Z",
  "M6 13Q5 9 9 8Q8 5 13 6Q16 4 19 6Q23 4 25 8Q28 11 26 14L22 12Q16 9 10 13Z",
  "M6 14Q6 6 16 5Q26 5 26 14L22 11Q19 9 17 9Q13 14 9 14Z",
  "M7 14Q6 9 11 8Q13 3 16 7Q20 3 22 8Q27 10 25 14L22 12Q16 10 10 14Z",
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

  return <svg className="ds-av-portrait" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle cx="16" cy="16" r="16" className="portrait-field" />
    <path d="M2 32c1-6 6-10 14-10s13 4 14 10Z" className="portrait-shoulders" />
    <path d={head} className="portrait-face" />
    <path d={hair} className="portrait-hair" />
    <circle cx="12.7" cy="17.6" r="0.85" className="portrait-eye" />
    <circle cx="19.3" cy="17.6" r="0.85" className="portrait-eye" />
    <path d="M13.6 22.4q2.4 1.8 4.8 0" className="portrait-mouth" />
    {glasses && <path d="M9.4 15.4h5.8v4.3H9.4zm7.4 0h5.8v4.3h-5.8zm-1.6 1.3h1.6" className="portrait-glasses" />}
  </svg>;
}

/** For a named person whose stable ID is unavailable: a shared, neutral glyph. */
export function ColleagueUnknown() {
  return <svg className="ds-av-portrait" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle cx="16" cy="16" r="16" className="portrait-field" />
    <circle cx="16" cy="12" r="5" className="portrait-unknown-head" />
    <path d="M4 32c1-7 5-11 12-11s11 4 12 11Z" className="portrait-unknown-body" />
  </svg>;
}
