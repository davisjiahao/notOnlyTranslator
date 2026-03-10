# NotOnlyTranslator 性能优化分析报告

## 概述

本报告基于对项目核心文件的深入分析，从内容脚本性能、API 和网络性能、React 组件性能、资源加载和内存管理五个方面，详细分析性能优化空间，并提供具体的优化建议。

---

## 一、内容脚本性能分析

### 1.1 DOM 操作优化

#### 发现的问题

**问题 1：频繁的 DOM 查询**
- [`src/content/index.ts`](src/content/index.ts:552-579) 中 [`getNavigableHighlights()`](src/content/index.ts:552) 方法每次导航都会遍历整个 DOM 树：
  ```typescript
  // 每次导航都重新查询所有高亮元素
  private getNavigableHighlights(): HTMLElement[] {
    const selectors = [
      `.${CSS_CLASSES.HIGHLIGHT}`,
      '.not-translator-grammar-highlight',
      // ...
    ];
    const elements: HTMLElement[] = [];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        // ...
      });
    });
  }
  ```

**问题 2：高亮处理中的重复遍历**
- [`src/content/highlighter.ts`](src/content/highlighter.ts:26-58) 中使用 TreeWalker 遍历文本节点时，每次调用 [`highlightWords()`](src/content/highlighter.ts:13) 都会重新创建 TreeWalker 并遍历整个容器。

**问题 3：翻译显示中的多次 DOM 操作**
- [`src/content/translationDisplay.ts`](src/content/translationDisplay.ts:140-153) 中 [`applyInlineModeNonInvasive()`](src/content/translationDisplay.ts:140) 对每个单词都单独进行 DOM 操作。

#### 优化建议

1. **缓存 DOM 查询结果**：
   ```typescript
   // 建议实现：使用 Map 缓存高亮元素
   private highlightedElementsCache: Map<string, HTMLElement[]> = new Map();
   private cacheInvalidationToken: number = 0;
   
   // 使用 MutationObserver 监听变化，按需更新缓存
   private invalidateCache(): void {
     this.cacheInvalidationToken++;
   }
   ```

2. **批量 DOM 操作**：
   ```typescript
   // 使用 DocumentFragment 进行批量插入
   const fragment = document.createDocumentFragment();
   // 先在内存中完成所有操作，再一次性插入 DOM
   container.appendChild(fragment);
   ```

3. **使用 requestAnimationFrame 调度 DOM 操作**：
   ```typescript
   requestAnimationFrame(() => {
     // 执行 DOM 操作
   });
   ```

### 1.2 事件监听器管理

#### 发现的问题

**问题 1：事件监听器绑定在 document 上**
- [`src/content/index.ts:514-539`](src/content/index.ts:514-539) 中，所有事件监听器都绑定到 `document`：
  ```typescript
  document.addEventListener('mouseup', this.handleMouseUp);
  document.addEventListener('mouseover', this.handleMouseOver);
  document.addEventListener('mouseout', this.handleMouseOut);
  document.addEventListener('keydown', this.handleKeyDown);
  ```

**问题 2：事件处理中的重复 DOM 查询**
- [`src/content/index.ts:73-108`](src/content/index.ts:73-108) 中 [`handleMouseOver`](src/content/index.ts:73) 每次触发都执行多次 `classList.contains()` 和 `closest()` 查询。

**问题 3：双文对照模式的事件监听器泄漏风险**
- [`src/content/index.ts:1066-1086`](src/content/index.ts:1066-1086) 中 [`setupBilingualHoverEffects()`](src/content/index.ts:1057) 每次调用都会添加新的事件监听器，没有检查是否已存在。

#### 优化建议

1. **使用事件委托优化**：
   - 当前的事件委托实现是正确的，但可以进一步优化过滤逻辑
   ```typescript
   // 在事件处理开始时快速过滤
   const target = e.target as HTMLElement;
   if (!target.matches('[class*="not-translator"]')) return;
   ```

2. **添加事件监听器清理机制**：
   ```typescript
   // 使用 AbortController 管理事件监听器
   private eventController: AbortController = new AbortController();
   
   private setupEventListeners(): void {
     const signal = this.eventController.signal;
     document.addEventListener('mouseup', this.handleMouseUp, { signal });
     // 清理时调用
     this.eventController.abort();
   }
   ```

3. **双文对照事件去重**：
   ```typescript
   // 使用 WeakMap 跟踪已绑定事件监听器的元素
   private boundHoverEffects: WeakSet<HTMLElement> = new WeakSet();
   
   private setupBilingualHoverEffects(paragraph: HTMLElement): void {
     if (this.boundHoverEffects.has(paragraph)) return;
     this.boundHoverEffects.add(paragraph);
     // 继续添加事件监听器
   }
   ```

### 1.3 滚动/鼠标事件节流

#### 发现的问题

**问题 1：缺少滚动事件节流**
- 虽然 [`ViewportObserver`](src/content/viewportObserver.ts:29) 使用了 IntersectionObserver（推荐做法），但 [`checkCurrentViewport()`](src/content/viewportObserver.ts:279-303) 方法中手动检测可见性时没有节流。

**问题 2：鼠标移动事件过于频繁**
- `mouseover`/`mouseout` 事件触发频率高，虽然有 hoverTimer 延迟，但每次触发都会执行 DOM 查询。

#### 优化建议

1. **添加节流包装器**：
   ```typescript
   import { throttle } from '@/shared/utils';
   
   // 对频繁触发的事件使用节流
   private throttledCheckViewport = throttle(() => {
     this.checkCurrentViewport();
   }, 100);
   ```

2. **优化鼠标事件处理**：
   ```typescript
   // 使用 requestAnimationFrame 减少不必要的计算
   private lastMouseMoveTime: number = 0;
   private handleMouseOver = (e: MouseEvent): void => {
     const now = performance.now();
     if (now - this.lastMouseMoveTime < 16) return; // 约 60fps
     this.lastMouseMoveTime = now;
     // 处理逻辑
   };
   ```

### 1.4 MutationObserver 使用

#### 发现的问题

**问题 1：MutationObserver 回调中的重复遍历**
- [`src/content/index.ts:891-947`](src/content/index.ts:891-947) 中，每次 mutation 都遍历所有 `addedNodes`，并对每个节点调用 `querySelectorAll`。

**问题 2：防抖时间可能不够**
- 当前防抖时间为 1000ms，对于动态内容频繁的页面可能导致过多扫描。

#### 优化建议

1. **优化 MutationObserver 回调**：
   ```typescript
   // 批量收集变更，减少处理次数
   private pendingMutations: Set<HTMLElement> = new Set();
   
   private setupMutationObserver(): void {
     this.observer = new MutationObserver((mutations) => {
       for (const mutation of mutations) {
         // 只收集有效元素
         this.collectNewElements(mutation);
       }
       // 统一处理
       this.processPendingMutations();
     });
   }
   ```

2. **动态调整防抖时间**：
   ```typescript
   // 根据页面活跃度动态调整
   private getAdaptiveDebounce(): number {
     const mutationCount = this.recentMutationCount;
     return Math.min(1000 + mutationCount * 100, 5000);
   }
   ```

---

## 二、API 和网络性能分析

### 2.1 请求缓存策略

#### 发现的问题

**问题 1：缓存实现良好，但缺少请求去重**
- [`src/background/enhancedCache.ts`](src/background/enhancedCache.ts:23) 缓存实现完善，支持 LRU 淘汰和批量操作
- 但当同一文本在短时间内被多次请求翻译时，会发起多个相同的 API 请求

**问题 2：缓存粒度**
- 缓存是基于段落文本哈希，但对于部分修改的段落无法利用之前的缓存结果。

#### 优化建议

1. **添加请求去重机制**：
   ```typescript
   // 在 TranslationApiService 中添加
   private static pendingRequests: Map<string, Promise<string>> = new Map();
   
   static async call(prompt: string, apiKey: string, settings: UserSettings): Promise<string> {
     const cacheKey = this.generateCacheKey(prompt, settings);
     
     // 检查是否有相同请求正在进行
     const pending = this.pendingRequests.get(cacheKey);
     if (pending) return pending;
     
     const requestPromise = this.doCall(prompt, apiKey, settings);
     this.pendingRequests.set(cacheKey, requestPromise);
     
     try {
       return await requestPromise;
     } finally {
       this.pendingRequests.delete(cacheKey);
     }
   }
   ```

2. **子段落缓存匹配**：
   ```typescript
   // 对于修改的段落，尝试匹配子段落
   async findSubParagraphCache(text: string): Promise<TranslationResult | null> {
     // 拆分段落，尝试匹配缓存
   }
   ```

### 2.2 批量请求处理

#### 发现的问题

**问题 1：批量翻译实现良好**
- [`src/background/batchTranslation.ts`](src/background/batchTranslation.ts:54) 已实现完善的批量翻译机制
- 使用 `[PARA_n]` 标记区分段落，支持最多 10 个段落合并请求

**问题 2：批量大小固定**
- 当前批量大小固定为 10，没有根据文本长度动态调整

#### 优化建议

1. **动态批量大小**：
   ```typescript
   private static calculateOptimalBatchSize(paragraphs: Array<{ text: string }>): number {
     const totalLength = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
     const avgLength = totalLength / paragraphs.length;
     
     // 根据平均长度动态调整批量大小
     if (avgLength > 1000) return 3;
     if (avgLength > 500) return 5;
     return DEFAULT_BATCH_CONFIG.maxBatchSize;
   }
   ```

### 2.3 请求取消机制

#### 发现的问题

**问题 1：缺少请求取消机制**
- 当用户切换翻译模式或离开页面时，正在进行的 API 请求没有被取消
- [`src/content/index.ts:328-358`](src/content/index.ts:328-358) 中 `refreshTranslation()` 只是清除定时器，没有取消进行中的请求

**问题 2：超时处理简单**
- [`src/content/index.ts:1341-1368`](src/content/index.ts:1341-1368) 中 `sendMessage()` 使用 Promise.race 实现超时，但请求本身仍在继续

#### 优化建议

1. **实现 AbortController 支持**：
   ```typescript
   // 在 TranslationApiService 中添加
   static async call(
     prompt: string,
     apiKey: string,
     settings: UserSettings,
     signal?: AbortSignal
   ): Promise<string> {
     const response = await fetch(endpoint, {
       method: 'POST',
       headers: { ... },
       body: JSON.stringify({ ... }),
       signal, // 支持 AbortSignal
     });
     // ...
   }
   ```

2. **请求生命周期管理**：
   ```typescript
   // 在内容脚本中
   private activeRequests: Set<AbortController> = new Set();
   
   private async translateText(text: string): Promise<TranslationResult> {
     const controller = new AbortController();
     this.activeRequests.add(controller);
     
     try {
       return await this.sendMessage({ ... }, { signal: controller.signal });
     } finally {
       this.activeRequests.delete(controller);
     }
   }
   
   private cancelAllRequests(): void {
     this.activeRequests.forEach(controller => controller.abort());
     this.activeRequests.clear();
   }
   ```

### 2.4 并发控制

#### 发现的问题

**问题 1：缺少并发请求限制**
- 对于大量段落的翻译，可能同时发起多个批量请求，消耗 API 配额

#### 优化建议

1. **实现请求队列**：
   ```typescript
   class RequestQueue {
     private queue: Array<() => Promise<void>> = [];
     private activeCount: number = 0;
     private maxConcurrent: number = 3;
     
     async add<T>(request: () => Promise<T>): Promise<T> {
       return new Promise((resolve, reject) => {
         this.queue.push(async () => {
           try {
             resolve(await request());
           } catch (error) {
             reject(error);
           }
         });
         this.process();
       });
     }
     
     private async process(): Promise<void> {
       while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
         this.activeCount++;
         const request = this.queue.shift()!;
         request().finally(() => {
           this.activeCount--;
           this.process();
         });
       }
     }
   }
   ```

---

## 三、React 组件性能分析

### 3.1 不必要的重渲染

#### 发现的问题

**问题 1：popup/App.tsx 中缺少 useMemo/useCallback**
- [`src/popup/App.tsx:24-27`](src/popup/App.tsx:24-27) 中 `showToast` 函数每次渲染都会重新创建：
  ```typescript
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2000);
  };
  ```

**问题 2：options/components/ApiSettings.tsx 状态过多**
- [`src/options/components/ApiSettings.tsx:55-75`](src/options/components/ApiSettings.tsx:55-75) 中有超过 15 个 useState，任何状态变化都会触发整个组件重渲染

**问题 3：内联函数导致的重渲染**
- [`src/popup/App.tsx:255-296`](src/popup/App.tsx:255-296) 中按钮的 onClick 使用内联箭头函数

#### 优化建议

1. **使用 useCallback 缓存函数**：
   ```typescript
   const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
     setToast({ message, type });
     setTimeout(() => setToast(null), 2000);
   }, []);
   
   const toggleGlobalEnabled = useCallback(async () => {
     // ...
   }, [settings]);
   ```

2. **拆分大组件**：
   ```typescript
   // 将 ApiSettings 拆分为更小的组件
   const ApiConfigForm = memo(({ config, onSave, onCancel }) => {
     // 只管理表单相关状态
   });
   
   const ApiConfigList = memo(({ configs, activeId, onSelect, onEdit }) => {
     // 只管理列表显示
   });
   ```

3. **避免内联函数**：
   ```typescript
   // 使用 data 属性或 useCallback
   const handleModeChange = useCallback((mode: TranslationMode) => {
     updateSettings({ translationMode: mode });
   }, [updateSettings]);
   
   <button onClick={() => handleModeChange('inline-only')}>...</button>
   ```

### 3.2 useMemo/useCallback 使用

#### 发现的问题

**问题 1：options/App.tsx 中部分函数已使用 useCallback，但不完整**
- 代码中有部分使用了 useCallback，但有些函数仍然缺失

**问题 2：派生状态缺少 useMemo**
- [`src/popup/App.tsx:155-156`](src/popup/App.tsx:155-156) 中每次渲染都重新计算：
  ```typescript
  const isSiteTranslationEnabled = settings && (!settings.blacklist?.includes(currentHostname));
  const confidencePercent = Math.round((stats?.confidence || 0) * 100);
  ```

#### 优化建议

1. **为派生状态添加 useMemo**：
   ```typescript
   const isSiteTranslationEnabled = useMemo(() => {
     return settings && (!settings.blacklist?.includes(currentHostname));
   }, [settings, currentHostname]);
   
   const confidencePercent = useMemo(() => {
     return Math.round((stats?.confidence || 0) * 100);
   }, [stats?.confidence]);
   ```

### 3.3 组件懒加载

#### 发现的问题

**问题 1：options 页面加载所有组件**
- 设置页面加载了所有组件，即使用户可能只访问某个 tab

#### 优化建议

1. **使用 React.lazy 懒加载**：
   ```typescript
   const ApiSettings = lazy(() => import('./components/ApiSettings'));
   const GeneralSettings = lazy(() => import('./components/GeneralSettings'));
   const VocabularySettings = lazy(() => import('./components/VocabularySettings'));
   
   // 在渲染时
   <Suspense fallback={<Loading />}>
     {activeTab === 'api' && <ApiSettings {...props} />}
   </Suspense>
   ```

### 3.4 状态更新优化

#### 发现的问题

**问题 1：多个 setState 调用导致多次渲染**
- [`src/popup/App.tsx:48-79`](src/popup/App.tsx:48-79) 中 `loadData()` 函数多次调用 setState：
  ```typescript
  const loadData = async () => {
     setIsLoading(true);
     // ...
     setProfile(profileRes.data);
     setStats({ ... });
     // ...
     setSettings(settingsRes.data);
     // ...
     setIsLoading(false);
  };
  ```

#### 优化建议

1. **合并状态更新**：
   ```typescript
   // 使用 useReducer 或合并状态
   const [state, setState] = useState({
     profile: null,
     settings: null,
     stats: null,
     isLoading: true,
   });
   
   // 一次更新所有状态
   setState(prev => ({
     ...prev,
     profile: profileRes.data,
     stats: { ... },
     isLoading: false,
   }));
   ```

---

## 四、资源加载分析

### 4.1 打包体积优化

#### 发现的问题

**问题 1：vite.config.ts 缺少打包优化配置**
- [`vite.config.ts`](vite.config.ts:24-43) 配置简单，没有配置代码分割、压缩等优化

**问题 2：未配置 Tree Shaking**
- 项目使用 TypeScript + Vite，但没有显式配置 sideEffects

#### 优化建议

1. **添加打包优化配置**：
   ```typescript
   export default defineConfig({
     build: {
       // 代码分割
       rollupOptions: {
         output: {
           manualChunks: {
             'react-vendor': ['react', 'react-dom'],
             'background': ['src/background/index.ts'],
             'content': ['src/content/index.ts'],
           },
         },
       },
       // 压缩配置
       minify: 'terser',
       terserOptions: {
         compress: {
           drop_console: true, // 生产环境移除 console
         },
       },
       // 启用 gzip 压缩报告
       reportCompressedSize: true,
       // chunk 大小警告阈值
       chunkSizeWarningLimit: 500,
     },
   });
   ```

2. **配置 Tree Shaking**：
   ```json
   // package.json
   {
     "sideEffects": [
       "*.css",
       "*.less"
     ]
   }
   ```

### 4.2 代码分割

#### 发现的问题

**问题 1：content script 和 background 是独立入口，但共享代码没有优化**
- 共享代码（如 `shared/utils`、`shared/constants`）可能被重复打包

#### 优化建议

1. **使用 Vite 的模块预加载优化**：
   ```typescript
   build: {
     rollupOptions: {
       output: {
         manualChunks(id) {
           if (id.includes('shared/')) {
             return 'shared';
           }
         },
       },
     },
   },
   ```

### 4.3 懒加载策略

#### 发现的问题

**问题 1：词汇数据一次性加载**
- [`src/data/vocabulary/`](src/data/vocabulary/) 下的词汇数据被打包进主 bundle

#### 优化建议

1. **按需加载词汇数据**：
   ```typescript
   // 使用动态 import
   const loadVocabulary = async (type: 'cet4' | 'cet6' | 'gre') => {
     const data = await import(`./data/vocabulary/${type}.json`);
     return data.default;
   };
   ```

---

## 五、内存管理分析

### 5.1 内存泄漏风险

#### 发现的问题

**问题 1：定时器清理完善**
- [`src/content/index.ts:1373-1407`](src/content/index.ts:1373-1407) 中 `destroy()` 方法已正确清理所有定时器和事件监听器，这是好的实践。

**问题 2：闭包引用风险**
- [`src/content/index.ts:105-108`](src/content/index.ts:105-108) 中 hoverTimer 回调引用了 validElement，可能导致元素无法被垃圾回收：
  ```typescript
  this.hoverTimer = setTimeout(() => {
    this.handleHoverShow(validElement); // validElement 被闭包引用
  }, hoverDelay);
  ```

**问题 3：WeakMap 使用不完整**
- [`src/content/highlighter.ts:8`](src/content/highlighter.ts:8) 中 `highlightedElements` 使用普通 Map 存储 HTMLElement：
  ```typescript
  private highlightedElements: Map<string, HTMLElement[]> = new Map();
  ```

#### 优化建议

1. **清理定时器时清除引用**：
   ```typescript
   private clearHoverTimer(): void {
     if (this.hoverTimer) {
       clearTimeout(this.hoverTimer);
       this.hoverTimer = null;
       this.hoverElement = null; // 清除元素引用
     }
   }
   ```

2. **使用 WeakMap 存储元素引用**：
   ```typescript
   // 对于需要跟踪单个元素的场景
   private elementMetadata: WeakMap<HTMLElement, ElementMetadata> = new WeakMap();
   ```

### 5.2 事件监听器清理

#### 发现的问题

**问题 1：destroy 方法完善**
- 已正确移除所有 document 级别的事件监听器

**问题 2：动态添加的事件监听器**
- [`setupBilingualHoverEffects`](src/content/index.ts:1057) 中添加的事件监听器没有被追踪和清理

#### 优化建议

1. **追踪动态事件监听器**：
   ```typescript
   private dynamicListeners: Array<{
     element: HTMLElement;
     type: string;
     listener: EventListener;
   }> = [];
   
   private addTrackedListener(
     element: HTMLElement,
     type: string,
     listener: EventListener
   ): void {
     element.addEventListener(type, listener);
     this.dynamicListeners.push({ element, type, listener });
   }
   
   private clearDynamicListeners(): void {
     this.dynamicListeners.forEach(({ element, type, listener }) => {
       element.removeEventListener(type, listener);
     });
     this.dynamicListeners = [];
   }
   ```

### 5.3 缓存大小限制

#### 发现的问题

**问题 1：缓存限制实现良好**
- [`src/background/enhancedCache.ts:226-253`](src/background/enhancedCache.ts:226-253) 已实现 LRU 淘汰策略，最大条目限制为 `maxCacheEntries`

**问题 2：内存使用估算不精确**
- [`src/background/enhancedCache.ts:344-346`](src/background/enhancedCache.ts:344-346) 中内存估算使用 `JSON.stringify().length * 2`，可能低估实际内存占用

#### 优化建议

1. **添加更精确的内存监控**：
   ```typescript
   // 使用 performance.memory（Chrome 特有）或估算
   async getMemoryStats(): Promise<{
     cacheSize: number;
     estimatedMemoryMB: number;
   }> {
     const stats = await this.getStats();
     // 考虑对象开销
     const estimatedMemory = stats.memoryUsage * 1.5; // 增加 50% 开销估算
     return {
       cacheSize: stats.totalEntries,
       estimatedMemoryMB: estimatedMemory / (1024 * 1024),
     };
   }
   ```

2. **根据内存压力动态调整缓存大小**：
   ```typescript
   private adjustCacheForMemoryPressure(): void {
     if (performance.memory) {
       const usedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
       if (usedMB > 100) { // 超过 100MB
         // 更激进的淘汰策略
         this.evictLRU(Math.ceil(this.memoryCache.size * 0.3));
       }
     }
   }
   ```

---

## 六、优化优先级排序

### 高优先级（影响大、实现简单）

| 优化项 | 影响范围 | 实现难度 | 预期收益 |
|--------|----------|----------|----------|
| 添加请求去重机制 | API 调用 | 低 | 减少 20-40% 重复请求 |
| React 组件添加 useCallback/useMemo | UI 响应 | 低 | 减少 30-50% 不必要渲染 |
| 动态事件监听器清理 | 内存 | 低 | 防止内存泄漏 |
| 打包配置优化 | 加载性能 | 低 | 减少 20-30% 包体积 |

### 中优先级（影响大、实现中等）

| 优化项 | 影响范围 | 实现难度 | 预期收益 |
|--------|----------|----------|----------|
| DOM 操作缓存 | 内容脚本 | 中 | 减少 30-50% DOM 查询 |
| 请求取消机制 | API 调用 | 中 | 减少无效请求，提升用户体验 |
| 批量 DOM 操作 | 渲染性能 | 中 | 减少重排重绘 |

### 低优先级（影响小或实现复杂）

| 优化项 | 影响范围 | 实现难度 | 预期收益 |
|--------|----------|----------|----------|
| 组件懒加载 | 加载性能 | 低 | 首屏加载优化 |
| 动态批量大小 | API 调用 | 中 | 优化 API 利用率 |
| 内存压力感知缓存 | 内存 | 高 | 更稳定的长期运行 |

---

## 七、总结

### 现有优点

1. **良好的架构设计**：内容脚本、后台脚本、UI 组件职责分离清晰
2. **完善的缓存机制**：实现了 LRU 淘汰、批量操作、持久化存储
3. **批量翻译优化**：已实现段落合并请求，减少 API 调用次数
4. **IntersectionObserver 使用**：可视区域检测使用原生 API，性能优秀
5. **清理机制完善**：destroy 方法正确清理了大部分资源

### 主要改进方向

1. **请求去重和取消**：避免重复请求和无效请求
2. **React 性能优化**：添加 memo、useCallback、useMemo
3. **DOM 操作缓存**：减少重复 DOM 查询
4. **打包优化**：代码分割和压缩配置
5. **内存管理**：使用 WeakMap、追踪动态事件监听器

### 预期性能提升

- **API 调用减少**：20-40%（通过请求去重）
- **UI 响应速度**：提升 30-50%（通过 React 优化）
- **包体积减少**：20-30%（通过打包优化）
- **内存占用**：更稳定，避免内存泄漏

---

*报告生成时间：2026-03-10*