import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvRow, selectDictionaryEntries } from '../../../../scripts/buildOfflineDictionary';

describe('离线词典资源构建', () => {
  it('正确处理引号、逗号和转义引号', () => {
    expect(parseCsvRow('apple,"æp,l","say ""hello""",')).toEqual(['apple', 'æp,l', 'say "hello"', '']);
  });

  it('只保留有中文释义的常用词，并展开词形', () => {
    const source = 'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio\n' +
      'apple,æpl,,n. 苹果,,,,cet4,100,200,s:apples,,\n' +
      'rareword,,,中文,,,,,0,0,,,\n' +
      'englishonly,,,English definition,,,,cet4,100,0,,,\n';
    expect(selectDictionaryEntries(source)).toEqual({ apple: { translation: 'n. 苹果', phonetic: 'æpl', forms: ['apples'] } });
  });

  it('真实词典的条目数和内容哈希与来源记录一致', () => {
    const content = readFileSync(resolve(process.cwd(), 'src/data/offline-dictionary.json'), 'utf8');
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/offline-dictionary.meta.json'), 'utf8'));
    expect(Object.keys(JSON.parse(content))).toHaveLength(metadata.entryCount);
    expect(createHash('sha256').update(content).digest('hex')).toBe(metadata.artifactSha256);
    expect(metadata.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.license).toBe('MIT');
  });

  it('供构建复制的许可证与词典来源许可证一致', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/data/ECDICT-LICENSE'), 'utf8');
    const distributed = readFileSync(resolve(process.cwd(), 'public/ECDICT-LICENSE'), 'utf8');
    expect(distributed).toBe(source);
    expect(distributed).toContain('Permission is hereby granted');
  });

  it('拒绝缺列和没有有效词条的资源', () => {
    expect(() => selectDictionaryEntries('word,meaning\napple,苹果')).toThrow();
    expect(() => selectDictionaryEntries('word,translation,bnc,frq,tag\napple,English,1,1,cet4')).toThrow();
  });
});
