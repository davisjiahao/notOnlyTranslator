/**
 * Chrome Web Store 截图生成脚本
 *
 * 使用 Playwright 自动生成扩展截图，规格：
 * - 尺寸: 1280x800
 * - 格式: PNG
 * - 数量: 5 张
 */

import { chromium, type Browser, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

// 扩展路径
const EXTENSION_PATH = path.resolve(__dirname, '../dist')
const OUTPUT_DIR = path.resolve(__dirname, '../screenshots/chrome-store')

// 截图配置
const SCREENSHOTS = [
  {
    name: 'main-interface',
    description: '主界面展示 - 英文网页高亮和翻译提示',
    viewport: { width: 1280, height: 800 }
  },
  {
    name: 'settings-page',
    description: '设置页面 - API 配置和选项',
    viewport: { width: 1280, height: 800 }
  },
  {
    name: 'statistics-dashboard',
    description: '统计面板 - 学习进度图表',
    viewport: { width: 1280, height: 800 }
  },
  {
    name: 'flashcard-review',
    description: '闪卡复习界面',
    viewport: { width: 1280, height: 800 }
  },
  {
    name: 'vocabulary-management',
    description: '词汇管理页面',
    viewport: { width: 1280, height: 800 }
  }
]

/**
 * 确保输出目录存在
 */
function ensureOutputDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    console.log(`✓ 创建目录: ${OUTPUT_DIR}`)
  }
}

/**
 * 启动带扩展的浏览器
 */
async function launchBrowser(): Promise<Browser> {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(
      `扩展目录不存在: ${EXTENSION_PATH}\n请先运行: npm run build`
    )
  }

  return chromium.launch({
    headless: false, // 需要可见窗口来截图
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--window-size=1280,800'
    ]
  })
}

/**
 * 设置测试数据 - 模拟用户学习数据
 */
async function setupTestData(page: Page): Promise<void> {
  // 通过 background script 设置测试数据
  await page.evaluate(() => {
    // 设置测试用的词汇数据
    const testVocabulary = {
      known: ['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i'],
      learning: [
        { word: 'serendipity', addedAt: Date.now() - 86400000 },
        { word: 'ephemeral', addedAt: Date.now() - 172800000 },
        { word: 'ubiquitous', addedAt: Date.now() - 259200000 },
        { word: 'paradigm', addedAt: Date.now() - 345600000 },
        { word: 'eloquent', addedAt: Date.now() - 432000000 }
      ],
      settings: {
        englishLevel: 'intermediate',
        theme: 'light',
        provider: 'openai'
      }
    }

    // 存储到 Chrome Storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.set({
        vocabulary: testVocabulary,
        userProfile: {
          level: 'intermediate',
          estimatedVocabSize: 6000,
          dailyGoal: 10,
          streakDays: 5
        }
      })
    }
  })

  // 等待数据存储
  await page.waitForTimeout(500)
}

/**
 * 截图 1: 主界面展示
 * 打开英文文章，展示高亮单词和翻译提示
 */
async function captureMainInterface(page: Page): Promise<void> {
  console.log('\n📸 截图 1: 主界面展示')

  // 访问英文文章页面
  await page.goto('https://medium.com/@john.doe/technology-trends-2024', {
    waitUntil: 'networkidle'
  })

  // 等待内容脚本加载
  await page.waitForTimeout(2000)

  // 模拟鼠标悬停在某个高亮单词上
  const highlightedWord = await page.$('.not-only-translator-highlight')
  if (highlightedWord) {
    await highlightedWord.hover()
    await page.waitForTimeout(500)
  }

  // 截图
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'main-interface.png'),
    fullPage: false
  })

  console.log('  ✓ 已保存: main-interface.png')
}

/**
 * 截图 2: 设置页面
 * 展示选项页面的设置界面
 */
async function captureSettingsPage(page: Page): Promise<void> {
  console.log('\n📸 截图 2: 设置页面')

  // 打开扩展选项页面
  const optionsUrl = `chrome-extension://${await getExtensionId(page)}/options.html`
  await page.goto(optionsUrl)

  // 等待页面加载
  await page.waitForSelector('[data-testid="settings-page"]', {
    timeout: 5000
  })

  // 截图
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'settings-page.png'),
    fullPage: false
  })

  console.log('  ✓ 已保存: settings-page.png')
}

/**
 * 截图 3: 统计面板
 * 展示学习统计图表
 */
async function captureStatisticsDashboard(page: Page): Promise<void> {
  console.log('\n📸 截图 3: 统计面板')

  // 打开选项页面并切换到统计标签
  const optionsUrl = `chrome-extension://${await getExtensionId(page)}/options.html#/statistics`
  await page.goto(optionsUrl)

  // 等待图表加载
  await page.waitForSelector('[data-testid="statistics-dashboard"]', {
    timeout: 5000
  })
  await page.waitForTimeout(1000)

  // 截图
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'statistics-dashboard.png'),
    fullPage: false
  })

  console.log('  ✓ 已保存: statistics-dashboard.png')
}

/**
 * 截图 4: 闪卡复习
 * 展示闪卡式单词复习界面
 */
async function captureFlashcardReview(page: Page): Promise<void> {
  console.log('\n📸 截图 4: 闪卡复习')

  // 打开复习页面
  const reviewUrl = `chrome-extension://${await getExtensionId(page)}/options.html#/review`
  await page.goto(reviewUrl)

  // 等待闪卡加载
  await page.waitForSelector('[data-testid="flashcard-container"]', {
    timeout: 5000
  })
  await page.waitForTimeout(500)

  // 截图 - 闪卡正面
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'flashcard-review.png'),
    fullPage: false
  })

  console.log('  ✓ 已保存: flashcard-review.png')
}

/**
 * 截图 5: 词汇管理
 * 展示词汇列表页面
 */
async function captureVocabularyManagement(page: Page): Promise<void> {
  console.log('\n📸 截图 5: 词汇管理')

  // 打开词汇页面
  const vocabUrl = `chrome-extension://${await getExtensionId(page)}/options.html#/vocabulary`
  await page.goto(vocabUrl)

  // 等待词汇列表加载
  await page.waitForSelector('[data-testid="vocabulary-list"]', {
    timeout: 5000
  })
  await page.waitForTimeout(500)

  // 截图
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'vocabulary-management.png'),
    fullPage: false
  })

  console.log('  ✓ 已保存: vocabulary-management.png')
}

/**
 * 获取扩展 ID
 */
async function getExtensionId(page: Page): Promise<string> {
  // 通过执行 Chrome API 获取扩展 ID
  const extensionId = await page.evaluate(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      return chrome.runtime.id
    }
    return null
  })

  if (extensionId) {
    return extensionId
  }

  // 备用方案：从 service worker 获取
  const context = page.context()
  const background = context.backgroundPages()[0]
  if (background) {
    const bgId = await background.evaluate(() => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        return chrome.runtime.id
      }
      return null
    })
    if (bgId) return bgId
  }

  throw new Error('无法获取扩展 ID')
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log('========================================')
  console.log('Chrome Web Store 截图生成工具')
  console.log('========================================\n')

  // 检查构建
  if (!fs.existsSync(EXTENSION_PATH)) {
    console.error('❌ 错误: 扩展未构建')
    console.error('请先运行: npm run build')
    process.exit(1)
  }

  // 确保输出目录
  ensureOutputDir()

  let browser: Browser | null = null

  try {
    // 启动浏览器
    console.log('🚀 启动 Chrome 浏览器...')
    browser = await launchBrowser()

    // 创建新页面
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    })
    const page = await context.newPage()

    // 设置测试数据
    console.log('📝 设置测试数据...')
    await setupTestData(page)

    // 依次截取所有截图
    await captureMainInterface(page)
    await captureSettingsPage(page)
    await captureStatisticsDashboard(page)
    await captureFlashcardReview(page)
    await captureVocabularyManagement(page)

    console.log('\n========================================')
    console.log('✅ 所有截图生成完成!')
    console.log('========================================')
    console.log(`\n输出目录: ${OUTPUT_DIR}`)
    console.log('\n生成的文件:')
    SCREENSHOTS.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.name}.png - ${s.description}`)
    })

  } catch (error) {
    console.error('\n❌ 截图生成失败:', error)
    process.exit(1)
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

// 运行主函数
main()
