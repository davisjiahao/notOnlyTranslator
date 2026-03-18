import { useState, useEffect } from 'react';

interface RecruitmentBannerProps {
  onDismiss: () => void;
}

/**
 * 检查用户是否为近7天内安装的新用户
 */
async function checkIsNewUser(): Promise<boolean> {
  try {
    const result = await chrome.storage.sync.get('installDate');
    if (!result.installDate) {
      // 如果没有安装日期，记录当前日期并视为新用户
      await chrome.storage.sync.set({ installDate: Date.now() });
      return true;
    }
    const installDate = new Date(result.installDate);
    const now = new Date();
    const diffDays = (now.getTime() - installDate.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays < 7;
  } catch (_error) {
    return false;
  }
}
export default function RecruitmentBanner({ onDismiss }: RecruitmentBannerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // 检查是否应该显示（新用户且未关闭过）
  useEffect(() => {
    const checkVisibility = async () => {
      const [dismissedResult, isNewUser] = await Promise.all([
        chrome.storage.sync.get('recruitmentBannerDismissed'),
        checkIsNewUser()
      ]);

      // 只有新用户且未关闭过才显示
      if (!dismissedResult.recruitmentBannerDismissed && isNewUser) {
        setIsVisible(true);
      }
    };
    checkVisibility();
  }, []);

  const handleClose = async () => {
    setIsClosing(true);
    // 保存关闭状态
    await chrome.storage.sync.set({ recruitmentBannerDismissed: true });
    // 动画完成后隐藏
    setTimeout(() => {
      setIsVisible(false);
      onDismiss();
    }, 300);
  };

  const handleParticipate = () => {
    // 打开招募表单
    const formUrl = 'https://forms.gle/notonlytranslator-onboarding-recruitment';
    chrome.tabs.create({ url: formUrl });

    // 标记为已参与，不再显示
    chrome.storage.sync.set({ recruitmentBannerDismissed: true });
  };

  if (!isVisible) return null;

  return (
    <div
      className={`relative bg-gradient-to-r from-primary-500 to-primary-600 rounded-lg p-3 text-white shadow-md transition-all duration-300 ${
        isClosing ? 'opacity-0 -translate-y-2' : 'opacity-100 translate-y-0'
      }`}
    >
      {/* 关闭按钮 */}
      <button
        onClick={handleClose}
        className="absolute top-2 right-2 p-1 text-white/70 hover:text-white transition-colors"
        aria-label="关闭"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* 内容 */}
      <div className="flex items-start gap-3">
        {/* 图标 */}
        <div className="flex-shrink-0 w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
            />
          </svg>
        </div>

        {/* 文字内容 */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm mb-1">参与用户访谈，赢取 30元红包</h3>
          <p className="text-xs text-white/90 mb-2 leading-relaxed">
            我们正在进行一项用户研究，希望了解您使用 NotOnlyTranslator 的体验。参与 30 分钟访谈即可获得红包奖励！
          </p>

          {/* 按钮 */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleParticipate}
              className="flex-1 bg-white text-primary-600 text-xs font-medium py-1.5 px-3 rounded-md hover:bg-white/90 transition-colors"
            >
              立即报名
            </button>
            <button
              onClick={handleClose}
              className="text-xs text-white/80 hover:text-white px-2 py-1.5 transition-colors"
            >
              暂不参与
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
