export function validPageCount(value: number) {
  return Number.isFinite(value) ? Math.max(1,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(value))) : 1
}

// Displayed page numbers are one-based. Do not coerce empty input, fractions,
// signs or exponents into requests; very large positive integers clamp safely.
export function resolvePageJump(input: string, totalPages: number): number | null {
  const value = input.normalize('NFKC').trim()
  if (!/^\d+$/.test(value)) return null
  const pages = validPageCount(totalPages)
  const requested = Number(value)
  return Math.max(1,Math.min(pages,requested))
}
