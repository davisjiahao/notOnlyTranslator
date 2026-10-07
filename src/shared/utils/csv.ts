export const SAFE_CSV_ENCODING = 'safe-v1';

export function escapeRoundTripCSVCell(value: string | number): string {
  const text = String(value);
  return escapeCSVCell(text.startsWith("'") ? `'${text}` : text);
}

export function decodeRoundTripCSVCell(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

export function escapeCSVCell(value: string | number): string {
  const text = String(value);
  let first = 0;
  while (first < text.length && (text.charCodeAt(first) <= 32 || !text[first].trim())) first++;
  const safe = first < text.length && '=+-@'.includes(text[first]) ? `'${text}` : text;
  if (safe !== text || /[,"\r\n]/u.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
