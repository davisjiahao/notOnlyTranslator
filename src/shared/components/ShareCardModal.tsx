import { useState, useEffect } from 'react';
import {
  generateShareCardData,
  shareToPlatform,
} from '@/shared/analytics/achievements';
import type { ShareCardData, SharePlatform, ShareResult } from '@/shared/types/achievements';
import { TIER_COLORS, TIER_NAMES } from '@/shared/types/achievements';

interface ShareCardModalProps {
  achievementId: string;
  onClose: () => void;
}

/**
 * 分享卡片弹窗组件
 * 生成并分享成就卡片
 */
export function ShareCardModal({ achievementId, onClose }: ShareCardModalProps) {
  const [shareData, setShareData] = useState<ShareCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadShareData();
  }, [achievementId]);

  const loadShareData = async () => {
    try {
      setLoading(true);
      const data = await generateShareCardData(achievementId);
      setShareData(data);
    } catch (error) {
      console.error('Failed to load share data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (platform: SharePlatform) => {
    if (!shareData) return;

    setSharing(true);
    try {
      const result = await shareToPlatform(platform, shareData);
      setShareResult(result);

      if (result.success && result.url && platform !== 'copy' && platform !== 'wechat') {
        // 打开分享窗口
        window.open(result.url, '_blank', 'width=600,height=400');
      }
    } catch (error) {
      console.error('Share failed:', error);
    } finally {
      setSharing(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareData) return;

    try {
      await navigator.clipboard.writeText(shareData.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      handleShare('copy');
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  if (!shareData) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full">
          <p className="text-center text-gray-600">无法生成分享卡片</p>
          <button
            onClick={onClose}
            className="mt-4 w-full px-4 py-2 bg-blue-600 text-white rounded-lg"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }

  const { achievement, userStats, inviteCode } = shareData;
  const colors = TIER_COLORS[achievement.tier as keyof typeof TIER_COLORS];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-300">
        {/* 头部 */}
        <div className={`${colors.bg} px-6 py-4`}>
          <div className="flex items-center justify-between">
            <h3 className={`font-bold ${colors.text}`}>分享成就</h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="关闭"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 分享卡片预览 */}
        <div className="p-6">
          <div className={`${colors.bg} ${colors.border} border-2 rounded-xl p-6 text-center`}>
            {/* 成就图标 */}
            <div className="text-5xl mb-3">{achievement.icon}</div>

            {/* 成就名称 */}
            <h4 className={`text-xl font-bold ${colors.text} mb-1`}>
              {achievement.name}
            </h4>

            {/* 成就描述 */}
            <p className="text-sm text-gray-600 mb-4">
              {achievement.description}
            </p>

            {/* 等级标签 */}
            <span className={`inline-block ${colors.bg} ${colors.text} px-3 py-1 rounded-full text-sm font-medium mb-4`}>
              {TIER_NAMES[achievement.tier as keyof typeof TIER_NAMES]} · {achievement.points} 积分
            </span>

            {/* 用户统计 */}
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-200/50">
              <div>
                <div className="text-2xl font-bold text-gray-700">{userStats.totalWords}</div>
                <div className="text-xs text-gray-500">掌握词汇</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-700">{userStats.streakDays}</div>
                <div className="text-xs text-gray-500">连续天数</div>
              </div>
            </div>

            {/* 用户等级 */}
            {userStats.rank && (
              <div className="mt-3 text-sm font-medium text-gray-600">
                🏅 {userStats.rank}
              </div>
            )}
          </div>

          {/* 邀请码 */}
          <div className="mt-4 bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">我的邀请码</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm font-mono">
                {inviteCode}
              </code>
              <button
                onClick={handleCopyLink}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                }`}
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              朋友使用你的邀请码注册，双方都可获得奖励！
            </p>
          </div>

          {/* 分享按钮 */}
          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700 mb-3">分享到</div>
            <div className="flex justify-center gap-4">
              <ShareButton
                platform="twitter"
                icon="𝕏"
                label="Twitter"
                onClick={() => handleShare('twitter')}
                disabled={sharing}
              />
              <ShareButton
                platform="weibo"
                icon="📝"
                label="微博"
                onClick={() => handleShare('weibo')}
                disabled={sharing}
              />
              <ShareButton
                platform="wechat"
                icon="💬"
                label="微信"
                onClick={() => handleShare('wechat')}
                disabled={sharing}
              />
              <ShareButton
                platform="copy"
                icon="📋"
                label="复制链接"
                onClick={handleCopyLink}
                disabled={sharing}
              />
            </div>
          </div>

          {/* 分享结果 */}
          {shareResult && (
            <div className={`mt-4 p-3 rounded-lg text-sm text-center ${
              shareResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {shareResult.success ? '分享成功！' : shareResult.error || '分享失败，请重试'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ShareButtonProps {
  platform: SharePlatform;
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function ShareButton({ icon, label, onClick, disabled }: ShareButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 group disabled:opacity-50"
    >
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-xl
        group-hover:bg-blue-100 group-hover:scale-110 transition-all">
        {icon}
      </div>
      <span className="text-xs text-gray-600">{label}</span>
    </button>
  );
}
