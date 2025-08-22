# 批量文件AI分析处理工具 2.0 🚀

> 使用现代化框架重构的批量文件AI分析处理工具，支持独立并行工作流和美观界面

## ✨ v2.0 新特性

### 🎨 全新现代化界面
- **React + TypeScript + Vite** 现代技术栈
- **Tailwind CSS + shadcn/ui** 美观的设计系统
- **响应式布局** 完美适配桌面和移动设备
- **深度主题支持** 明暗主题切换
- **流畅动画效果** 提升用户体验

### ⚡ 独立并行工作流
- **每个文件独立处理流水线** 互不干扰
- **三步骤工作流** 内容生成 → 图像生成 → 文档生成
- **智能并发控制** 可配置最大并发数
- **实时进度追踪** 文件级和步骤级进度显示
- **任务队列管理** 支持暂停、重试、取消操作

### 🔧 增强的功能特性
- **状态管理** 使用 Zustand 进行高效状态管理
- **类型安全** 完整的 TypeScript 类型定义
- **错误处理** 完善的错误处理和重试机制
- **数据持久化** 配置信息本地存储
- **批量操作** 支持批量选择、处理、下载

## 🏗️ 技术架构

### 前端框架
```
React 18 + TypeScript + Vite
├── 状态管理: Zustand
├── UI组件: Radix UI + Tailwind CSS
├── 图标库: Lucide React
├── 文件上传: React Dropzone
└── 样式系统: Tailwind CSS + CSS Variables
```

### 项目结构
```
src/
├── components/           # UI组件
│   ├── ui/              # 基础UI组件库
│   ├── FileUpload.tsx   # 文件上传组件
│   ├── ConfigPanel.tsx  # 配置面板
│   ├── WorkflowPanel.tsx # 工作流管理
│   └── ResultsPanel.tsx # 结果展示
├── services/            # 业务服务
│   ├── apiService.ts    # API服务层
│   └── workflowService.ts # 工作流服务
├── stores/              # 状态管理
│   └── appStore.ts      # 应用状态
├── types/               # 类型定义
│   └── index.ts         # 全局类型
├── lib/                 # 工具函数
│   └── utils.ts         # 通用工具
└── App.tsx              # 主应用组件
```

## 🚀 快速开始

### 环境要求
- Node.js 16+ 
- pnpm (推荐) 或 npm/yarn

### 安装和运行
```bash
# 安装依赖 (推荐使用 pnpm)
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 预览生产版本
pnpm preview
```

### 配置API
在应用的配置面板中设置：
- **API Key**: 您的OpenAI API密钥
- **Base URL**: API服务地址 (默认: https://oneapi.basevec.com/v1)
- **模型选择**: 选择合适的AI模型
- **分析模板**: 选择内容生成模板

## 📋 功能模块

### 1. 文件上传模块 📁
- **拖拽上传** 支持拖拽和点击上传
- **批量选择** 多文件同时上传
- **格式验证** 支持多种文件格式
- **大小限制** 可配置文件大小限制
- **状态显示** 实时显示文件状态

### 2. 工作流管理 🔄
- **三步骤流程**
  - 📝 **步骤1**: 生成内容创意 (爆款标题、脚本、提示词)
  - 🎨 **步骤2**: 生成封面图片 (基于AI提示词)
  - 📄 **步骤3**: 生成MD文档 (结构化技术文档)
- **并行处理** 每个文件独立处理流水线
- **进度追踪** 实时显示处理进度
- **状态管理** 支持暂停、重试、取消

### 3. 结果管理 📊
- **分类展示** 按类型分类展示结果
- **预览功能** 内容预览和图片查看
- **批量下载** 一键下载所有结果
- **复制分享** 快速复制内容到剪贴板
- **元数据展示** 显示生成参数和统计信息

### 4. 配置管理 ⚙️
- **API配置** OpenAI API密钥和端点配置
- **模型选择** 22种优质AI模型可选
- **模板管理** 内置多种分析模板
- **参数调整** 并发数、重试次数等参数配置

## 🎯 工作流详解

### 内容创意生成 (病毒式内容生成器)
基于上传的文件分析，生成包含以下内容的策略文档：
- 🎯 **项目标题** (≤66字符，高度可传播)
- 💡 **价值陈述** (≤280字符，清晰描述)
- 🔥 **热点结合** (结合最新14天趋势)
- 📱 **病毒式脚本** (YouTube/Twitter优化)
- 🤖 **AI使用方法** (可复制的GPT提示词)
- 🖼️ **视觉素材提示词** (YouTube缩略图+Instagram封面)

### 图像生成
- 🎨 **自动提取** 从内容创意中提取图像提示词
- 🖼️ **高质量生成** 使用Imagen 3.0生成1024x1024图像
- 📱 **多种规格** 支持YouTube缩略图和Instagram封面
- 💾 **格式支持** 支持URL和Base64格式

### 文档生成 (Markdown解析生成器)
生成结构化的技术文档，包含：
- 🧠 **功能说明** 核心目的和效果
- 💡 **使用技巧** 具体使用建议
- 🛠️ **操作步骤** 详细使用指南
- 🧾 **示例输出** 真实示例展示
- ℹ️ **补充信息** 限制和依赖说明
- 🔗 **相关推荐** 相关提示词推荐

## 🔄 从v1.0迁移

### 主要变化
- ✅ **保留所有原有功能** 向后兼容
- ✅ **增强用户体验** 更美观的界面
- ✅ **改进性能** 更快的响应速度
- ✅ **类型安全** TypeScript类型保护
- ✅ **模块化架构** 更好的代码组织

### 配置迁移
v1.0的配置可以直接在新版本的配置面板中设置，无需额外迁移步骤。

## 🎛️ 高级配置

### 环境变量
创建 `.env.local` 文件：
```env
VITE_DEFAULT_API_KEY=your-api-key
VITE_DEFAULT_BASE_URL=https://api.openai.com/v1
VITE_DEFAULT_MODEL=gpt-4o
```

### 自定义主题
修改 `src/index.css` 中的CSS变量：
```css
:root {
  --primary: 221.2 83.2% 53.3%;
  --secondary: 210 40% 96%;
  /* 更多颜色变量... */
}
```

### 自定义模板
在 `src/stores/appStore.ts` 中添加新的分析模板：
```typescript
templates: [
  {
    id: 'custom_template',
    name: '自定义模板',
    description: '您的模板描述',
    prompt: '您的自定义提示词...'
  }
]
```

## 📈 性能优化

- **代码分割** 使用动态导入减少初始包大小
- **懒加载** 组件和路由懒加载
- **状态优化** Zustand轻量级状态管理
- **并发控制** 智能并发控制避免API限流
- **缓存策略** 本地存储配置和结果缓存

## 🛠️ 开发指南

### 添加新组件
```bash
# 创建新组件
touch src/components/MyComponent.tsx

# 添加对应的类型定义
# 在 src/types/index.ts 中添加类型
```

### 添加新服务
```bash
# 创建新服务
touch src/services/myService.ts

# 在服务中实现业务逻辑
# 使用 APIService 进行API调用
```

### 调试技巧
```bash
# 启用开发者工具
pnpm dev

# 查看状态管理
# 在浏览器中安装 Redux DevTools 扩展
```

## 🐛 故障排除

### 常见问题

**Q: API调用失败**
```
A: 检查API密钥和Base URL配置
   确认网络连接正常
   查看控制台错误信息
```

**Q: 文件上传失败**
```
A: 检查文件格式是否支持
   确认文件大小不超过限制
   检查浏览器兼容性
```

**Q: 构建失败**
```
A: 删除 node_modules 重新安装
   检查 Node.js 版本 (需要16+)
   确认所有依赖正确安装
```

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

### 开发流程
1. Fork 项目
2. 创建功能分支
3. 提交代码
4. 发起Pull Request

### 代码规范
- 使用 TypeScript 编写代码
- 遵循 ESLint 配置
- 组件使用函数式组件 + Hooks
- 保持代码简洁和可读性

## 📄 许可证

本项目采用 MIT 许可证 - 详情请查看 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [React](https://reactjs.org/) - UI框架
- [Vite](https://vitejs.dev/) - 构建工具
- [Tailwind CSS](https://tailwindcss.com/) - CSS框架
- [Radix UI](https://www.radix-ui.com/) - 无障碍UI组件
- [Zustand](https://github.com/pmndrs/zustand) - 状态管理
- [Lucide](https://lucide.dev/) - 图标库

---

**从v1.0到v2.0，我们不仅保留了所有强大功能，更带来了现代化的用户体验和技术架构！** 🎉
