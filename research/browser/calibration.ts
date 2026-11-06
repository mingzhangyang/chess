/** Fixed integer work, to measure how much the thread is actually slowed down. */
export const calibrationWork = (): number => {
  let x = 0x12345678;
  for (let i = 0; i < 40_000_000; i += 1) x = (Math.imul(x ^ (x >>> 13), 0x5bd1e995) + i) | 0;
  return x;
};
