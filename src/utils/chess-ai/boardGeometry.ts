/**
 * Precomputed square geometry for the signed 64-square board (a8 = 0, h1 = 63).
 * Directions 0..3 are diagonal and 4..7 orthogonal; every ray lists its
 * squares nearest first. Tables are built once and must not be mutated.
 */
export const DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]] as const;
export const FIRST_ORTHOGONAL_DIRECTION = 4;
const KNIGHT_DELTAS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] as const;

const onBoard = (rank: number, file: number): boolean => rank >= 0 && rank < 8 && file >= 0 && file < 8;
const targets = (square: number, deltas: ReadonlyArray<readonly [number, number]>): Int8Array => {
  const rank = square >> 3;
  const file = square & 7;
  return Int8Array.from(deltas.filter(([dr, df]) => onBoard(rank + dr, file + df)).map(([dr, df]) => (rank + dr) * 8 + file + df));
};

export const KNIGHT_TARGETS: readonly Int8Array[] = Array.from({ length: 64 }, (_, square) => targets(square, KNIGHT_DELTAS));
export const KING_TARGETS: readonly Int8Array[] = Array.from({ length: 64 }, (_, square) => targets(square, DIRECTIONS));
export const RAYS: readonly (readonly Int8Array[])[] = Array.from({ length: 64 }, (_, square) => DIRECTIONS.map(([dr, df]) => {
  const ray: number[] = [];
  for (let r = (square >> 3) + dr, f = (square & 7) + df; onBoard(r, f); r += dr, f += df) ray.push(r * 8 + f);
  return Int8Array.from(ray);
}));
/**
 * Squares from which a pawn of the given side attacks `square`:
 * index 0 for white pawns (which attack toward a8), 1 for black pawns.
 */
export const PAWN_ATTACKERS: readonly (readonly Int8Array[])[] = [
  Array.from({ length: 64 }, (_, square) => targets(square, [[1, -1], [1, 1]])),
  Array.from({ length: 64 }, (_, square) => targets(square, [[-1, -1], [-1, 1]])),
];
