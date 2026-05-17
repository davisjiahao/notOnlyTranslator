import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatsCard from '@/popup/components/StatsCard';

const defaultStats = {
  estimatedVocabulary: 3500,
  knownWordsCount: 150,
  unknownWordsCount: 50,
  confidence: 0.85,
  level: '中级',
};

describe('StatsCard', () => {
  it('renders vocabulary size estimate', () => {
    render(<StatsCard stats={defaultStats} />);
    expect(screen.getByText('3,500')).toBeTruthy();
    expect(screen.getByText('词汇量')).toBeTruthy();
  });

  it('renders the level badge', () => {
    render(<StatsCard stats={defaultStats} />);
    expect(screen.getByText('中级')).toBeTruthy();
  });

  it('renders confidence percentage', () => {
    render(<StatsCard stats={defaultStats} />);
    expect(screen.getByText('置信度: 85%')).toBeTruthy();
  });

  it('renders known and unknown word counts', () => {
    render(<StatsCard stats={defaultStats} />);
    expect(screen.getByText('150')).toBeTruthy();
    expect(screen.getByText('已掌握')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
    expect(screen.getByText('待学习')).toBeTruthy();
  });

  it('renders progress bar with role=progressbar', () => {
    render(<StatsCard stats={defaultStats} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toBeTruthy();
    expect(progressbar).toHaveAttribute('aria-label', '学习进度');
  });

  it('calculates correct progress percentage (75% for 150 known / 50 unknown)', () => {
    render(<StatsCard stats={defaultStats} />);
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('renders CEFR tooltip on hover for known levels (F2.1)', () => {
    render(<StatsCard stats={defaultStats} />);
    // Tooltip is in the DOM but hidden via opacity-0
    const tooltip = screen.getByText('~B1, 3000词');
    expect(tooltip).toBeTruthy();
    expect(tooltip.className).toContain('opacity-0');
  });

  it('does not render CEFR tooltip for unknown levels', () => {
    const stats = { ...defaultStats, level: '未知等级' };
    render(<StatsCard stats={stats} />);
    // No CEFR mapping should mean no tooltip content
    expect(screen.queryByText('~A')).toBeNull();
    expect(screen.queryByText('~B')).toBeNull();
    expect(screen.queryByText('~C')).toBeNull();
  });

  it('has cursor-help on level badge (accessibility hint)', () => {
    render(<StatsCard stats={defaultStats} />);
    const levelBadge = screen.getByText('中级');
    expect(levelBadge.className).toContain('cursor-help');
  });

  it('renders progress as 0% when no words tracked', () => {
    render(<StatsCard stats={{ ...defaultStats, knownWordsCount: 0, unknownWordsCount: 0 }} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('formats large vocabulary numbers with commas', () => {
    render(<StatsCard stats={{ ...defaultStats, estimatedVocabulary: 12345 }} />);
    expect(screen.getByText('12,345')).toBeTruthy();
  });
});
