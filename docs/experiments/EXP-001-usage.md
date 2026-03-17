# EXP-001 欢迎弹窗实验使用说明

## 快速集成

在 Options 页面中使用 `WelcomeModalExperiment` 组件：

```tsx
import WelcomeModalExperiment, {
  shouldShowWelcomeModal,
  getExperimentGroup,
} from '@/shared/components/WelcomeModalExperiment';

function OptionsApp() {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    // 检查是否首次使用
    if (shouldShowWelcomeModal()) {
      setShowWelcome(true);
    }
  }, []);

  const handleWelcomeComplete = () => {
    setShowWelcome(false);
    // 可以继续设置流程或跳转到主页
  };

  return (
    <div>
      {/* 其他内容 */}

      <WelcomeModalExperiment
        isOpen={showWelcome}
        onClose={() => setShowWelcome(false)}
        onComplete={handleWelcomeComplete}
      />
    </div>
  );
}
```

## 实验分组

| 分组 | 步骤 | 流程 |
|------|------|------|
| A (对照) | 5步 | 欢迎 → 水平选择 → API配置 → 模型选择 → 完成 |
| B (实验) | 3步 | 欢迎+水平合并 → API配置 → 完成 |
| C (极简) | 2步 | 欢迎+水平+API合并 → 完成 |

## 数据埋点

### Experiment_Assigned
用户被分配到实验组时触发：
```json
{
  "experiment": "EXP-001",
  "group": "A|B|C",
  "timestamp": 1234567890
}
```

### Onboarding_Progress
用户完成每个步骤时触发：
```json
{
  "experiment": "EXP-001",
  "group": "A|B|C",
  "step": "welcome|level|api|demo|complete",
  "action": "start|complete|skip",
  "selectedLevel": "beginner|intermediate|advanced",
  "selectedProvider": "openai|anthropic|custom"
}
```

## 本地存储

实验使用以下 localStorage 键：
- `not_onboarding_experiment_group` - 用户所属实验组
- `not_onboarding_completed` - 是否已完成引导
- `not_onboarding_completed_at` - 完成时间戳
- `not_onboarding_skipped` - 是否跳过引导

## 注意事项

1. 实验组分配是随机的，一旦分配不会更改
2. 完成或跳过后不会再次显示
3. 数据埋点需要 analytics 系统已初始化
