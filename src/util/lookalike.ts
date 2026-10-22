// Letters from other alphabets that look like Latin ones on screen
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'l', ɡ: 'g',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  0: 'o', 1: 'l', 3: 'e', 5: 's', '|': 'l', i: 'l',
};

// Letter pairs that read as one letter
const MULTI_GLYPHS: [string, string][] = [['rn', 'm'], ['vv', 'w'], ['cl', 'd']];

const IGNORED_CHARS_REGEX = /[\s._\-\u200B-\u200D\u2060\uFEFF]/g;

// Names this short match too many real people
const MIN_NAME_LENGTH = 3;
const MIN_CONTAINED_LENGTH = 5;
// dHash bits that may differ for two avatars to still count as the same picture
export const AVATAR_HASH_THRESHOLD = 6;

export type LookalikeReason = 'sameName' | 'similarName' | 'similarUsername' | 'samePhoto';

export type LookalikeCandidate = {
  id: string;
  name: string;
  username?: string;
  avatarHash?: string;
};

export type LookalikeMatch = {
  candidateId: string;
  reasons: LookalikeReason[];
};

export function normalizeForLookalike(text: string) {
  let normalized = text.normalize('NFKC').toLowerCase().replace(IGNORED_CHARS_REGEX, '');
  normalized = Array.from(normalized).map((char) => HOMOGLYPHS[char] || char).join('');
  MULTI_GLYPHS.forEach(([from, to]) => {
    normalized = normalized.split(from).join(to);
  });

  return normalized;
}

export function getEditDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = temp;
    }
  }

  return previous[b.length];
}

function isSimilarText(a: string, b: string) {
  const normalizedA = normalizeForLookalike(a);
  const normalizedB = normalizeForLookalike(b);
  if (normalizedA.length < MIN_NAME_LENGTH || normalizedB.length < MIN_NAME_LENGTH) return false;
  if (normalizedA === normalizedB) return true;
  // "alexmorgan_support" style: the original name with something added
  if (Math.min(normalizedA.length, normalizedB.length) >= MIN_CONTAINED_LENGTH
    && (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA))) {
    return true;
  }

  const maxDistance = Math.min(normalizedA.length, normalizedB.length) >= 8 ? 2 : 1;
  return getEditDistance(normalizedA, normalizedB) <= maxDistance;
}

export function getAvatarHashDistance(a: string, b: string) {
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }

  return distance;
}

export function findLookalike(sender: LookalikeCandidate, candidates: LookalikeCandidate[]) {
  let bestMatch: LookalikeMatch | undefined;

  candidates.forEach((candidate) => {
    if (candidate.id === sender.id) return;

    const reasons: LookalikeReason[] = [];

    if (sender.name.trim() && sender.name.trim() === candidate.name.trim()) {
      reasons.push('sameName');
    } else if (isSimilarText(sender.name, candidate.name)) {
      reasons.push('similarName');
    }

    if (sender.username && candidate.username && isSimilarText(sender.username, candidate.username)) {
      reasons.push('similarUsername');
    }

    if (sender.avatarHash && candidate.avatarHash
      && getAvatarHashDistance(sender.avatarHash, candidate.avatarHash) <= AVATAR_HASH_THRESHOLD) {
      reasons.push('samePhoto');
    }

    // A single weak signal, like a common first name, is not enough
    const isStrong = reasons.length >= 2 || reasons.includes('samePhoto') || reasons.includes('similarUsername');
    if (!isStrong) return;

    if (!bestMatch || reasons.length > bestMatch.reasons.length) {
      bestMatch = { candidateId: candidate.id, reasons };
    }
  });

  return bestMatch;
}

// Marks the characters of `text` that differ from `original`, so the UI can highlight them
export function getLookalikeDiff(text: string, original: string) {
  const textChars = Array.from(text);
  const originalChars = Array.from(original);
  const rows = textChars.length;
  const cols = originalChars.length;
  const table: number[][] = Array.from({ length: rows + 1 }, (_, i) => (
    Array.from({ length: cols + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
  ));

  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + (textChars[i - 1] === originalChars[j - 1] ? 0 : 1),
      );
    }
  }

  const isDifferent = textChars.map(() => false);
  let i = rows;
  let j = cols;
  while (i > 0 && j > 0) {
    const isSame = textChars[i - 1] === originalChars[j - 1];
    if (table[i][j] === table[i - 1][j - 1] + (isSame ? 0 : 1)) {
      if (!isSame) isDifferent[i - 1] = true;
      i--;
      j--;
    } else if (table[i][j] === table[i - 1][j] + 1) {
      isDifferent[i - 1] = true;
      i--;
    } else {
      j--;
    }
  }
  while (i > 0) {
    isDifferent[i - 1] = true;
    i--;
  }

  return textChars.map((char, index) => ({ char, isDifferent: isDifferent[index] }));
}

// 64-bit difference hash: survives resizing and recompression of the same picture
export async function getAvatarHash(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;

  context.drawImage(image, 0, 0, 9, 8);
  const { data } = context.getImageData(0, 0, 9, 8);

  let hash = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = (y * 9 + x) * 4;
      const right = left + 4;
      const leftBrightness = data[left] * 0.299 + data[left + 1] * 0.587 + data[left + 2] * 0.114;
      const rightBrightness = data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114;
      hash += leftBrightness > rightBrightness ? '1' : '0';
    }
  }

  return hash;
}
