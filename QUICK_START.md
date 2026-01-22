# Quick Start Guide

Get NotOnlyTranslator up and running in minutes!

## Prerequisites

- Node.js 18+
- npm or pnpm
- Chrome or Edge browser

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/notOnlyTranslator.git
cd notOnlyTranslator

# 2. Install dependencies
npm install

# 3. Create placeholder icons (optional, already done)
npm run create-icons

# 4. Build the extension
npm run build
```

## Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `dist` folder from the project directory
5. The extension icon should appear in your toolbar

## Initial Setup

### 1. Get an API Key

Choose one:
- **OpenAI**: https://platform.openai.com/api-keys
- **Anthropic**: https://console.anthropic.com/

### 2. Configure the Extension

1. Click the extension icon in your toolbar
2. Click the settings icon (⚙️)
3. Go to **API Settings**
4. Select your provider (OpenAI or Anthropic)
5. Enter your API key and click "Save"

### 3. Set Your English Level

Option A - Use Exam Scores:
1. Go to **English Level** tab
2. Select your exam type (CET-4/6, TOEFL, IELTS, GRE)
3. Enter your score
4. Click "Save Settings"

Option B - Take Quick Test:
1. Go to **Quick Test** tab
2. Complete the 20-question vocabulary test
3. Click "Use This Result" to save

## Start Using

1. Visit any English website (e.g., https://www.bbc.com/news)
2. The extension will automatically highlight words above your level
3. Click on highlighted words to see translations
4. Mark words as "Known" or "Unknown"
5. Build your vocabulary book!

## Troubleshooting

### Extension not working?
- Make sure it's enabled in `chrome://extensions/`
- Check that you've entered a valid API key
- Look for errors in the browser console (F12)

### API errors?
- Verify your API key is correct
- Check your API quota/credits
- Try switching between OpenAI and Anthropic

### No words highlighted?
- Make sure "Auto Highlight" is enabled in settings
- Try adjusting your proficiency level
- Switch to "Full Mode" temporarily to see if translation works

## Development Mode

```bash
# Run in development mode with hot reload
npm run dev

# This will start a development server
# Load the extension from the dist folder
# Changes will reload automatically
```

## Next Steps

- Customize highlight colors in **General Settings**
- Review your vocabulary in the popup
- Export your data for backup
- Contribute to the project!

## Need Help?

- Check the [README](README.md) for detailed documentation
- Open an issue on GitHub
- Read the [Contributing Guide](CONTRIBUTING.md)

Happy learning! 📚✨
