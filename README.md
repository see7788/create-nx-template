# create-nx-template

一个快速创建现代前端项目的模板生成工具，支持从多种流行框架和库的模板中选择，提供简单的交互式界面和命令行参数支持，帮助开发者快速初始化新项目或管理项目版本。

## 特性

- 🚀 **快速初始化**：通过简单命令即可创建各类前端项目
- 📋 **多模板支持**：内置React、Vite、Electron、Nx工作区等多种流行模板
- 💻 **命令行与交互式**：支持直接通过命令行参数或交互式问答创建项目
- 🔄 **版本管理**：内置版本发布功能，方便管理项目版本

## 安装

作为一个创建工具，您不需要全局安装它，而是通过包管理器的`create`命令直接使用：

```bash
# 使用pnpm（推荐）
pnpm create nx-template

# 使用npm
npm create nx-template

# 使用yarn
yarn create nx-template
```

## 使用方法

### 1. 创建新项目

#### 直接指定项目名称

```bash
# 创建名为my-app的项目
pnpm create nx-template my-app
```

#### 交互式创建

如果不提供项目名称，工具将进入交互式模式，引导您创建项目：

```bash
pnpm create nx-template
# 系统将提示您输入项目名称并选择模板
```

### 2. 发布新版本

如果您是项目维护者，可以使用以下命令发布新版本：

```bash
# 方式1
pnpm create nx-template -- --release

# 方式2（简写）
pnpm create nx-template -- -r
```

## 支持的模板

当前支持的项目模板包括：

- React 官方仓库
- Jest Mock Extended
- Vite 仓库
- Electron 快速启动模板
- Nx 工作区模板

## 项目要求

- Node.js >= 18

## 核心依赖

- degit：用于从Git仓库克隆模板
- prompts：提供交互式命令行界面

## 开发

如果您想参与本项目的开发，可以按照以下步骤操作：

```bash
# 克隆仓库
git clone https://github.com/see7788/create-nx-template.git
cd create-nx-template

# 安装依赖
pnpm install

# 构建项目
pnpm run build

# 本地测试\pnpm start
```

## License

本项目采用MIT许可证 - 详见 [LICENSE](LICENSE) 文件

## 问题反馈

如有任何问题或建议，请在 [GitHub Issues](https://github.com/see7788/create-nx-template/issues) 中提交。