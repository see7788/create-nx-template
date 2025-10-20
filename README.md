# create-nx-template

一个现代化的前端项目模板生成工具，旨在简化项目初始化流程，提供丰富的模板选择和灵活的配置选项。

## ✨ 特性

- 🚀 **极速创建**：通过简洁命令快速生成各类前端项目
- 📋 **模板丰富**：内置多种流行框架模板，包括React、Vite、Electron和Nx工作区等
- 💻 **双重交互**：支持命令行参数直接配置或交互式问答配置
- 🔄 **版本管理**：内置版本发布功能，便于项目维护
- 📦 **智能依赖管理**：自动处理项目依赖，确保构建环境正确配置
- 🔧 **灵活配置**：支持自定义输出目录和入口文件

## 📦 安装与使用

作为创建工具，您无需全局安装，直接通过包管理器的`create`命令使用：

```bash
# 使用pnpm（推荐）
pnpm create nx-template

# 使用npm
npm create nx-template

# 使用yarn
yarn create nx-template
```

## 🔨 使用方法

### 创建新项目

#### 直接指定项目名称

```bash
# 创建名为my-app的项目
pnpm create nx-template my-app
```

#### 交互式创建

不提供项目名称时，工具将进入交互式模式：

```bash
pnpm create nx-template
# 系统将引导您完成项目名称和模板选择
```

### 高级命令

#### 发布新版本

项目维护者可使用以下命令发布新版本：

```bash
# 完整命令
pnpm create nx-template -- --release

# 简写命令
pnpm create nx-template -- -r
```

## 📋 支持的模板

- **React 官方仓库**：React官方推荐的项目结构
- **Jest Mock Extended**：增强Jest测试能力的模板
- **Vite 仓库**：基于Vite的现代化构建工具模板
- **Electron 快速启动模板**：桌面应用开发模板
- **Nx 工作区模板**：企业级Monorepo工作区模板

## ⚙️ 系统要求

- Node.js >= 18
- 任一支持的包管理器：pnpm、npm或yarn

## 🧩 核心依赖

- **degit**：从Git仓库高效克隆模板
- **prompts**：提供友好的交互式命令行界面
- **tsup**：零配置TypeScript构建工具
- **esbuild**：极速JavaScript/TypeScript打包工具

## 🚀 开发指南

如果您想参与项目开发：

```bash
# 克隆仓库
git clone https://github.com/see7788/create-nx-template.git
cd create-nx-template

# 安装依赖
pnpm install

# 构建项目
pnpm run build

# 本地测试
pnpm start
```

## 📄 许可证

本项目采用MIT许可证 - 详见 [LICENSE](LICENSE) 文件

## 🐛 问题反馈

如有任何问题或建议，请在 [GitHub Issues](https://github.com/see7788/create-nx-template/issues) 提交反馈。我们将尽快回复并解决您的问题。

## 🤝 贡献

欢迎提交Pull Request来改进本项目。请确保在提交前进行适当的测试。

如有任何问题或建议，请在 [GitHub Issues](https://github.com/see7788/create-nx-template/issues) 中提交。