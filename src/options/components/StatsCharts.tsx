import React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

interface StatsChartsProps {
  vocabularySize: number;
  knownCount: number;
  unknownCount: number;
  confidence: number;
}

/**
 * 词汇能力雷达图 + 增长趋势面积图
 */
export const StatsCharts: React.FC<StatsChartsProps> = ({
  vocabularySize,
  knownCount,
  unknownCount,
  confidence,
}) => {
  // 能力模型雷达图数据
  const radarData = [
    { subject: '词汇量', A: Math.min(100, (vocabularySize / 10000) * 100), fullMark: 100 },
    { subject: '阅读量', A: Math.min(100, (knownCount + unknownCount) / 5), fullMark: 100 },
    { subject: '掌握度', A: Math.min(100, (knownCount / (knownCount + unknownCount || 1)) * 100), fullMark: 100 },
    { subject: '活跃度', A: 85, fullMark: 100 },
    { subject: '难度', A: 70, fullMark: 100 },
    { subject: '置信度', A: confidence * 100, fullMark: 100 },
  ];

  // 词汇量增长趋势数据（模拟）
  const growthData = [
    { name: '周一', words: vocabularySize - 50 },
    { name: '周二', words: vocabularySize - 40 },
    { name: '周三', words: vocabularySize - 35 },
    { name: '周四', words: vocabularySize - 20 },
    { name: '周五', words: vocabularySize - 10 },
    { name: '周六', words: vocabularySize - 5 },
    { name: '周日', words: vocabularySize },
  ];

  return (
    <div className="space-y-4">
      {/* 雷达图：能力模型 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">能力模型</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="55%" data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: '#4b5563', fontSize: 12, fontWeight: 500 }}
              />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                name="能力值"
                dataKey="A"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="#8b5cf6"
                fillOpacity={0.6}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 面积图：增长趋势 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">词汇量增长趋势</h3>
        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={growthData}>
              <defs>
                <linearGradient id="colorWords" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis hide domain={['dataMin - 100', 'dataMax + 100']} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  borderRadius: '8px',
                  border: 'none',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  fontSize: '12px',
                }}
              />
              <Area
                type="monotone"
                dataKey="words"
                stroke="#10b981"
                fillOpacity={1}
                fill="url(#colorWords)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
