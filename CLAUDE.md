# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vue 3 Lark (Feishu) Base extension plugin that fetches social media comments from Xiaohongshu (小红书) and Douyin (抖音) into Lark Base tables.

## Build Commands

```bash
pnpm dev          # Development server with hot reload
pnpm build        # Production build (alias: pnpm build:prod)
pnpm build:test   # Test build
pnpm preview      # Preview production build on port 4173
```

## Architecture

**Entry Flow**: `src/main.js` → `src/App.vue` → `src/components/Form.vue`

**Main Component (`Form.vue`)**:
- API key management via `bitable.bridge.setData/getData`
- Social media URL input (platform: `xhs` or `douyin`)
- Task creation → polling → data fetch workflow
- Table creation and data writing to Lark Base

**Lark Base SDK** (`@lark-base-open/js-sdk`):
- `bitable.base` - Table/field management
- `bitable.ui` - UI operations (switchToTable)
- `bitable.bridge` - Plugin storage for API key and form state

**API Communication**:
- Vite dev server proxies `/social/api` → `https://api.52choujiang.cn`
- `src/utils/request.js` exports axios instance with `import.meta.env` baseURL support

**Environment Variables** (via `import.meta.env`):
- `VITE_API_BASE_URL` - API base path (empty string if `/`)

## Key Functions

- `postNoteTask()` - Create fetch task via API
- `getNoteTaskInterval()` - Poll task status every 3s (max 600s)
- `getList()` - Fetch paginated comment data
- `createAndWriteData()` - Create Lark table with fields and insert records
- `createSequentialTable()` - Create numbered table if name exists (e.g., "数据1", "数据2")

## Data Schema

Records are written with fields: 视频编号, 视频标题, 标签, 用户ID, 作者, 点赞数, 评论数, 收藏数, 分享数, 下载链接, 封面, 时长, 发布时间
