export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const randomBetween = (min, max) => {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
};
