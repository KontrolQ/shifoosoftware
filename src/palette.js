// A title keeps one colour for good: the same name always lands on the same swatch,
// so a reader learns a title by its colour rather than by its position in a list.
// The hash grows past what a double can hold exactly, so it is worked in BigInt.

const SWATCHES = [
  "#FF8B8B", "#75D151", "#AD8CFF", "#FFAA5E", "#87CEFA", "#FFB3BA", "#42D6A4",
  "#C774E8", "#FFDE59", "#94D0FF", "#FF9AA2", "#CAFFBF", "#BDB2FF", "#F7EA00",
  "#FFD1DC", "#54F2F2", "#FFA8B8", "#90EE90", "#FF6AD5", "#C1E7E3", "#8795E8",
  "#FFDFBA", "#4ADEDE", "#FB91D1", "#AFF8D8", "#FFF9B0", "#B5D8FF", "#FCF6BD",
  "#D5AAFF", "#9EE7FF", "#DCBEFF", "#E0BBE4",
];

function hashOf(text, base = 31n) {
  const held = String(text ?? "");
  const spread = BigInt(held.length) + base;

  let hash = 0n;
  let at = 0;

  for (const character of held) {
    const letter = BigInt(character.codePointAt(0));

    at += 1;
    hash += letter * BigInt(at) * spread + letter;
    hash = (hash << 5n) + hash + letter;
  }

  return hash;
}

export function swatchFor(text) {
  if (!text) {
    return SWATCHES[0];
  }

  return SWATCHES[Number(hashOf(text) % BigInt(SWATCHES.length))];
}
