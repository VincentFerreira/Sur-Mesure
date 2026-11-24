// Lightweight inline markup for CV bullet points: `*words*` renders as bold.
// Only a non-empty span without `*` or line breaks counts, so a lone `*` stays literal.
const BOLD_PATTERN = /\*([^*\n]+)\*/g;

export interface TextSegment {
  text: string;
  bold: boolean;
}

export const splitBold = (str: string): TextSegment[] => {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of str.matchAll(BOLD_PATTERN)) {
    if (match.index > last) segments.push({ text: str.slice(last, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < str.length) segments.push({ text: str.slice(last), bold: false });
  return segments;
};

// Plain-text form (markers dropped), for contexts that can't render bold such as AI prompts.
export const stripBold = (str: string): string => str.replace(BOLD_PATTERN, '$1');
