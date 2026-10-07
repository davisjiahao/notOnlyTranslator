import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
const FREQUENCY_LIMIT = 15_000;
const MAX_SOURCE_BYTES = 100_000_000;
const WORD_PATTERN = /^[a-z]+(?:[-'][a-z]+)*$/;

interface DictionaryEntry {
  translation: string;
  phonetic?: string;
  forms?: string[];
}

export function parseCsvRow(line: string): string[] {
  let fields: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields = [...fields, value];
      value = '';
    } else value += character;
  }
  if (quoted) throw new Error('词典 CSV 含未闭合的引号');
  return [...fields, value];
}

export function selectDictionaryEntries(csv: string): Record<string, DictionaryEntry> {
  const [header, ...lines] = csv.split(/\r?\n/);
  const columns = parseCsvRow(header.replace(/^﻿/, ''));
  if (!['word', 'translation', 'bnc', 'frq', 'tag'].every(column => columns.includes(column))) {
    throw new Error('词典 CSV 缺少必要列');
  }
  const entries = lines.filter(Boolean).flatMap(line => {
    const row = parseCsvRow(line);
    const get = (column: string): string => row[columns.indexOf(column)] ?? '';
    const word = get('word').toLowerCase();
    const frequent = ['bnc', 'frq'].some(column => Number(get(column)) > 0 && Number(get(column)) <= FREQUENCY_LIMIT);
    const examination = /\b(cet4|cet6|gk|ky)\b/.test(get('tag'));
    const translation = get('translation').replace(/\\n/g, '；').trim();
    if (!WORD_PATTERN.test(word) || !/[㐀-鿿]/.test(translation) || (!frequent && !examination)) return [];
    const forms = [...new Set(get('exchange').split('/').filter(part => /^[pdi3rts]:/.test(part))
      .flatMap(part => part.slice(2).split(',')).filter(form => WORD_PATTERN.test(form) && form !== word))];
    const entry: DictionaryEntry = {
      translation,
      ...(get('phonetic') ? { phonetic: get('phonetic') } : {}),
      ...(forms.length ? { forms } : {}),
    };
    return [[word, entry] as const];
  });
  if (entries.length === 0) throw new Error('词典没有有效词条');
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right, 'en')));
}

async function build(): Promise<void> {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`词典下载失败：HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES) throw new Error('词典源文件超出大小限制');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('词典源文件超出大小限制');
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const metadataPath = new URL('../src/data/offline-dictionary.meta.json', import.meta.url);
  const previous = await readFile(metadataPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  // 已收录资产固定来源哈希；上游变化必须经人工审查，不能静默替换。
  if (previous && JSON.parse(previous).sourceSha256 !== sourceSha256) throw new Error('词典来源已变化，请审查新版本后再更新');
  const dictionary = selectDictionaryEntries(new TextDecoder().decode(bytes));
  const content = JSON.stringify(dictionary);
  const metadata = {
    source: SOURCE_URL,
    sourceSha256,
    license: 'MIT',
    licenseFile: 'ECDICT-LICENSE',
    selection: { frequencyLimit: FREQUENCY_LIMIT, examinationTags: ['cet4', 'cet6', 'gk', 'ky'] },
    entryCount: Object.keys(dictionary).length,
    artifactSha256: createHash('sha256').update(content).digest('hex'),
  };
  await writeFile(new URL('../src/data/offline-dictionary.json', import.meta.url), content);
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  process.stdout.write(`离线词典：${metadata.entryCount} 个词条，${Buffer.byteLength(content)} 字节，源 SHA256 ${sourceSha256}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  build().catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
}
