/**
 * 成本监控面板组件
 *
 * 展示 API 调用成本、Token 使用量、预算状态等信息
 */
import { useState, useEffect, useCallback } from 'react';
import {
  CostDashboardData,
  CostSummary,
  ProviderCostDetail,
  BudgetStatus,
  CostWarning,
} from '@/shared/cost/types';
import { getCostTracker, getCostDashboardData } from '@/shared/cost/tracker';
import { logger } from '@/shared/utils';

/**
 * 成本监控面板组件
 */
export default function CostDashboard() {
  const [dashboardData, setDashboardData] = useState<CostDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState(30);
  const [monthlyBudget, setMonthlyBudget] = useState(10);

  // 加载数据
  const loadData = useCallback(() => {
    setIsLoading(true);
    try {
      const tracker = getCostTracker();
      const data = getCostDashboardData(periodDays);
      setDashboardData(data);
      setMonthlyBudget(tracker.getConfig().monthlyBudget);
    } catch (error) {
      logger.error('加载成本数据失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    loadData();

    // 监听数据变更
    const tracker = getCostTracker();
    const unsubscribe = tracker.addListener(loadData);

    return unsubscribe;
  }, [loadData]);

  // 更新预算配置
  const handleBudgetUpdate = () => {
    const tracker = getCostTracker();
    tracker.updateConfig({ monthlyBudget });
    loadData();
  };

  // 确认警告
  const handleAcknowledgeWarning = (warningId: string) => {
    const tracker = getCostTracker();
    tracker.acknowledgeWarning(warningId);
    loadData();
  };

  // 清空数据
  const handleClearData = () => {
    if (confirm('确定要清空所有成本记录吗？此操作不可恢复。')) {
      const tracker = getCostTracker();
      tracker.clear();
      loadData();
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">成本监控</h2>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">成本监控</h2>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          暂无数据
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 标题和时间范围选择器 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">成本监控</h2>
        <select
          value={periodDays}
          onChange={(e) => setPeriodDays(Number(e.target.value))}
          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value={7}>最近 7 天</option>
          <option value={14}>最近 14 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
      </div>

      {/* 警告提示 */}
      {dashboardData.summary.totalCost > 0 && (
        <WarningsSection
          warnings={getCostTracker().getActiveWarnings()}
          onAcknowledge={handleAcknowledgeWarning}
        />
      )}

      {/* 总览卡片 */}
      <SummaryCards summary={dashboardData.summary} budget={dashboardData.budget} />

      {/* 预算设置 */}
      <BudgetSection
        budget={dashboardData.budget}
        monthlyBudget={monthlyBudget}
        onBudgetChange={setMonthlyBudget}
        onBudgetUpdate={handleBudgetUpdate}
      />

      {/* 提供商详情 */}
      <ProviderDetailsSection details={dashboardData.providerDetails} />

      {/* 成本趋势图 */}
      <CostTrendChart trend={dashboardData.costTrend} />

      {/* 高成本请求 */}
      {dashboardData.topExpensiveRequests.length > 0 && (
        <TopExpensiveRequests requests={dashboardData.topExpensiveRequests} />
      )}

      {/* 操作按钮 */}
      <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleClearData}
          className="px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
        >
          清空所有记录
        </button>
      </div>
    </div>
  );
}

/**
 * 警告提示区域
 */
function WarningsSection({
  warnings,
  onAcknowledge,
}: {
  warnings: CostWarning[];
  onAcknowledge: (id: string) => void;
}) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((warning) => (
        <div
          key={warning.id}
          className={`flex items-center justify-between px-4 py-3 rounded-lg ${
            warning.type === 'budget_exceeded'
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
              : warning.type === 'budget_warning'
                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
          }`}
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-sm font-medium">{warning.message}</span>
          </div>
          <button
            onClick={() => onAcknowledge(warning.id)}
            className="text-sm underline hover:no-underline"
          >
            知道了
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * 总览卡片区域
 */
function SummaryCards({ summary, budget }: { summary: CostSummary; budget: BudgetStatus }) {
  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${(cost * 100).toFixed(4)}¢`;
    return `$${cost.toFixed(4)}`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const cards = [
    {
      label: '总成本',
      value: formatCost(summary.totalCost),
      subValue: `LLM: ${formatCost(summary.llmCost)} | 翻译: ${formatCost(summary.translationCost)}`,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'primary',
    },
    {
      label: '预算使用',
      value: budget.monthlyBudget > 0 ? `${budget.usagePercent.toFixed(1)}%` : '未设置',
      subValue: budget.monthlyBudget > 0 ? `已使用 ${formatCost(budget.used)} / $${budget.monthlyBudget}` : undefined,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      color: budget.isOverBudget ? 'red' : budget.usagePercent > 80 ? 'yellow' : 'green',
    },
    {
      label: 'Token 使用量',
      value: `${formatNumber(summary.totalInputTokens + summary.totalOutputTokens)}`,
      subValue: `输入: ${formatNumber(summary.totalInputTokens)} | 输出: ${formatNumber(summary.totalOutputTokens)}`,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      ),
      color: 'blue',
    },
    {
      label: 'API 请求',
      value: formatNumber(summary.successRequests + summary.failedRequests),
      subValue: `成功: ${summary.successRequests} | 失败: ${summary.failedRequests}`,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      color: 'purple',
    },
  ];

  const colorClasses = {
    primary: 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    yellow: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
    green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${colorClasses[card.color as keyof typeof colorClasses]}`}>
              {card.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">{card.value}</p>
              {card.subValue && (
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{card.subValue}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 预算设置区域
 */
function BudgetSection({
  budget,
  monthlyBudget,
  onBudgetChange,
  onBudgetUpdate,
}: {
  budget: BudgetStatus;
  monthlyBudget: number;
  onBudgetChange: (value: number) => void;
  onBudgetUpdate: () => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">月度预算设置</h3>

      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
            月度预算 (美元)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">$</span>
            <input
              type="number"
              value={monthlyBudget}
              onChange={(e) => onBudgetChange(Number(e.target.value))}
              min={0}
              step={1}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="0 表示不限制"
            />
          </div>
        </div>
        <button
          onClick={onBudgetUpdate}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          保存
        </button>
      </div>

      {/* 预算进度条 */}
      {budget.monthlyBudget > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400 mb-1">
            <span>已使用 {budget.usagePercent.toFixed(1)}%</span>
            <span>
              ${budget.used.toFixed(4)} / ${budget.monthlyBudget}
            </span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                budget.isOverBudget
                  ? 'bg-red-500'
                  : budget.usagePercent > 80
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, budget.usagePercent)}%` }}
            />
          </div>
          {budget.projectedEndOfMonth > budget.monthlyBudget && (
            <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
              按当前使用率，预计月底支出 ${budget.projectedEndOfMonth.toFixed(2)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 提供商详情表格
 */
function ProviderDetailsSection({ details }: { details: ProviderCostDetail[] }) {
  if (details.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">各提供商成本详情</h3>
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          暂无使用记录
        </p>
      </div>
    );
  }

  const formatCost = (cost: number) => {
    if (cost === 0) return '-';
    if (cost < 0.01) return `$${(cost * 100).toFixed(4)}¢`;
    return `$${cost.toFixed(4)}`;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">各提供商成本详情</h3>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-3 px-2">提供商</th>
              <th className="py-3 px-2">类型</th>
              <th className="py-3 px-2 text-right">请求数</th>
              <th className="py-3 px-2 text-right">成功率</th>
              <th className="py-3 px-2 text-right">使用量</th>
              <th className="py-3 px-2 text-right">总成本</th>
            </tr>
          </thead>
          <tbody>
            {details.map((detail) => (
              <tr
                key={detail.provider}
                className="border-b border-gray-100 dark:border-gray-800 last:border-0"
              >
                <td className="py-3 px-2 font-medium text-gray-900 dark:text-white">
                  {detail.displayName}
                </td>
                <td className="py-3 px-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      detail.category === 'llm'
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    }`}
                  >
                    {detail.category === 'llm' ? 'LLM' : '翻译'}
                  </span>
                </td>
                <td className="py-3 px-2 text-right text-gray-600 dark:text-gray-300">
                  {detail.requestCount}
                </td>
                <td className="py-3 px-2 text-right">
                  <span
                    className={
                      detail.requestCount > 0 && detail.successCount / detail.requestCount >= 0.95
                        ? 'text-green-600 dark:text-green-400'
                        : detail.requestCount > 0 && detail.successCount / detail.requestCount >= 0.8
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-gray-600 dark:text-gray-300'
                    }
                  >
                    {detail.requestCount > 0
                      ? `${((detail.successCount / detail.requestCount) * 100).toFixed(0)}%`
                      : '-'}
                  </span>
                </td>
                <td className="py-3 px-2 text-right text-gray-600 dark:text-gray-300">
                  {detail.category === 'llm'
                    ? `${((detail.totalInputTokens || 0) + (detail.totalOutputTokens || 0)).toLocaleString()} tokens`
                    : `${(detail.totalCharacters || 0).toLocaleString()} 字符`}
                </td>
                <td className="py-3 px-2 text-right font-medium text-gray-900 dark:text-white">
                  {formatCost(detail.totalCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 成本趋势图
 */
function CostTrendChart({ trend }: { trend: Array<{ date: string; cost: number; requestCount: number }> }) {
  if (trend.length === 0 || trend.every((d) => d.cost === 0)) {
    return null;
  }

  const maxCost = Math.max(...trend.map((d) => d.cost), 0.01);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">成本趋势</h3>

      <div className="flex items-end gap-1 h-32">
        {trend.map((point, index) => {
          const height = (point.cost / maxCost) * 100;
          return (
            <div
              key={index}
              className="flex-1 flex flex-col items-center gap-1"
              title={`${point.date}: $${point.cost.toFixed(4)} (${point.requestCount} 次请求)`}
            >
              <div
                className="w-full bg-primary-500 rounded-t hover:bg-primary-600 transition-colors cursor-pointer"
                style={{ height: `${Math.max(height, 2)}%` }}
              />
              {index % 7 === 0 && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{point.date}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 高成本请求列表
 */
function TopExpensiveRequests({
  requests,
}: {
  requests: Array<{ provider: string; cost: number; timestamp: number; details: string }>;
}) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${(cost * 100).toFixed(4)}¢`;
    return `$${cost.toFixed(4)}`;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">高成本请求</h3>

      <div className="space-y-2">
        {requests.slice(0, 5).map((request, index) => (
          <div
            key={index}
            className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
          >
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 dark:text-gray-500 w-8">
                #{index + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {request.provider}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{request.details}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                {formatCost(request.cost)}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {formatTime(request.timestamp)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}