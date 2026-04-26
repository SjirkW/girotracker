export const matchesQuery = (
  q: string,
  ...fields: Array<string | null | undefined>
): boolean => {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return fields.some((f) => f != null && f.toLowerCase().includes(needle));
};
