// The AI thinks here, off the page, so the table keeps moving.
import { searchCard, searchTrump, searchDouble } from './ai.js';

const fn = { card: searchCard, trump: searchTrump, double: searchDouble };
onmessage = e => {
  const { id, what, view, opts } = e.data;
  postMessage({ id, result: fn[what](view, opts, Math.random) });
};
