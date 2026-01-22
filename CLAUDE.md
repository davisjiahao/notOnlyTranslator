# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 通用限制
1. 回答一律使用中文回答
2. 代码注释也使用中文


## Project Overview

NotOnlyTranslator is a Chrome/Edge browser extension that intelligently translates English content based on the user's proficiency level. It only translates words above the user's current level, helping English learners read naturally while expanding vocabulary.

## Development Commands

```bash
npm install        # Install dependencies (auto-runs icon generation)
npm run dev        # Start Vite dev server with hot reload
npm run build      # TypeScript check + production build
npm run lint       # ESLint with zero warnings tolerance
npm run type-check # TypeScript type checking only
```

**Testing**: Load the `dist` folder in `chrome://extensions/` (Developer mode enabled) after building.

## Architecture

This is a Chrome Extension (Manifest V3) with four main components that communicate via Chrome messaging:

```
Background Service Worker (src/background/)
├── index.ts         # Message routing, context menu setup
├── translation.ts   # LLM API calls (OpenAI, Anthropic, custom)
├── storage.ts       # Chrome Storage wrapper
└── userLevel.ts     # Vocabulary estimation with Bayesian updates

Content Script (src/content/)
├── index.ts         # Main injection, page scanning, DOM highlighting
├── highlighter.ts   # Text highlighting logic
├── tooltip.ts       # Translation tooltip UI
└── marker.ts        # Word marking (known/unknown)

Popup UI (src/popup/)           # Click extension icon
Options UI (src/options/)       # Full settings page with tabs
Shared (src/shared/)            # Types, constants, utils, Zustand store
```

### Message Flow

1. Content script scans page text → sends to Background
2. Background calls LLM API based on user's proficiency level
3. Translation cached in Chrome local storage
4. Content script highlights difficult words in DOM
5. User clicks word → tooltip shows translation + mark actions
6. User marks known/unknown → Background updates profile using Bayesian estimation

### Storage Strategy

- **Chrome Sync Storage** (cloud-synced): User profile, settings, API key
- **Chrome Local Storage** (device-only): Known/unknown word lists, translation cache (1000 entry limit)

## Key Message Types

Defined in `src/shared/types/index.ts`:
- `TRANSLATE_TEXT` - Request translation
- `MARK_WORD_KNOWN` / `MARK_WORD_UNKNOWN` - Update proficiency
- `GET_USER_PROFILE` / `UPDATE_USER_PROFILE` - Profile management
- `GET_SETTINGS` / `UPDATE_SETTINGS` - Configuration
- `GET_VOCABULARY` / `ADD_TO_VOCABULARY` / `REMOVE_FROM_VOCABULARY` - Word list management

## Tech Stack

- React 18 + TypeScript
- Vite + @crxjs/vite-plugin (Chrome extension bundling)
- Tailwind CSS
- Zustand (state management with Chrome Storage persistence)
- LLM APIs: OpenAI GPT-4o-mini, Anthropic Claude, or OpenAI-compatible custom endpoints

## Code Conventions

- Path alias: `@/` maps to `src/`
- All new code must be TypeScript with proper type annotations
- Use Tailwind CSS for styling (no inline styles)
- Prefix unused variables with `_` (ESLint configured for this)

## LLM Integration

Translation service in `src/background/translation.ts` supports three providers:
- OpenAI (default: gpt-4o-mini)
- Anthropic (default: claude-3-haiku)
- Custom (any OpenAI-compatible API endpoint)

Prompts and API endpoints defined in `src/shared/constants/index.ts`.
