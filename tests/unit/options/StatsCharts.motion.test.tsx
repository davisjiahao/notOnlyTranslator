import { afterEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatsCharts } from '@/options/components/StatsCharts';

afterEach(() => document.documentElement.classList.remove('dark'));
it('静态快照替代模拟图表，不引入 JS 动画或覆盖页面主题，外部数据变化即时反映', () => {
  document.documentElement.classList.add('dark');
  const props = { vocabularySize: 4500, knownCount: 12, unknownCount: 3, confidence: 0.5 };
  const { rerender, container } = render(<StatsCharts {...props} />);
  expect(document.documentElement).toHaveClass('dark');
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(container.querySelector('svg,canvas,[class*="animate-"]')).toBeNull();
  document.documentElement.classList.remove('dark');
  rerender(<StatsCharts {...props} vocabularySize={5000} confidence={2} />);
  expect(document.documentElement).not.toHaveClass('dark');
  expect(screen.getByText('5,000')).toBeInTheDocument();
  expect(screen.getByText('100%')).toBeInTheDocument();
  rerender(<StatsCharts {...props} confidence={-1} />);
  expect(screen.getByText('0%')).toBeInTheDocument();
});
