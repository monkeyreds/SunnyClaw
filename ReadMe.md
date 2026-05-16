# SunnyClaw

SunnyClaw 是一个对标 OpenClaw 的 Agent 项目，提供智能化的自动化操作能力。

## 项目结构

```
SunnyClaw/
├── SunnyClawControlCenter/   # 前端控制中心 (React + TypeScript)
├── SunnyClawService/         # 后端服务 (Node.js + TypeScript)
├── .husky/                   # Git hooks
├── commitlint.config.js      # Commit 规范配置
└── package.json              # 根目录配置
```

## 子项目

### SunnyClawControlCenter

前端控制中心，基于 React + TypeScript + Vite 构建，提供 Agent 的可视化操作界面。

```bash
cd SunnyClawControlCenter
npm install
npm run dev
```

### SunnyClawService

后端服务，基于 Node.js + TypeScript + Express 构建。服务默认绑定 `127.0.0.1`，仅允许本地访问，确保安全性。

```bash
cd SunnyClawService
npm install
npm run dev
```

后端服务启动后运行在 `http://127.0.0.1:3000`。

## 快速开始

```bash
# 安装根目录依赖
npm install

# 安装前端依赖
cd SunnyClawControlCenter
npm install

# 安装后端依赖
cd ../SunnyClawService
npm install
```

## Commit 规范

本项目使用 commitlint + husky 强制执行 Conventional Commits 规范：

```
<type>(<scope>): <subject>
```

常用类型：`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`

## License

ISC
