// scripts/create-template.js
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import prompts from 'prompts';
import {fileURLToPath} from "url"

const TEMPLATES = [
  ['facebook/react', 'React 官方仓库'],
  ['marchaos/jest-mock-extended', 'Jest Mock Extended'],
  ['vitejs/vite', 'Vite 仓库']
];

export async function createProject(projectName) {
  // 如果通过命令行传参：pnpm create nx-template my-app
  if (projectName) {
    const targetDir = path.resolve(projectName);

    // 检查名字是否合法
    if (projectName.includes('/')) {
      return console.error('❌ 项目名不能包含 /');
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(projectName)) {
      return console.error('❌ 项目名只能包含字母、数字、- 和 _');
    }

    // 检查目录是否存在
    try {
      await fs.access(targetDir);
      return console.error(`❌ 目录已存在: ${projectName}`);
    } catch {
      // 不存在，继续
    }

    // 直接开始创建（不进入交互循环）
    return await createFromTemplate(projectName, targetDir);
  }

  // 交互式创建：允许循环输入
  while (true) {
    const result = await prompts({
      type: 'text',
      name: 'name',
      message: '请输入项目名',
      initial: 'my-app'
    });

    projectName = result.name?.trim();

    if (!projectName) {
      console.log('👋 取消创建');
      return;
    }

    if (projectName.includes('/')) {
      console.error('❌ 项目名不能包含 /，请重新输入');
      continue;
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(projectName)) {
      console.error('❌ 项目名只能包含字母、数字、- 和 _，请重新输入');
      continue;
    }

    const targetDir = path.resolve(projectName);

    try {
      await fs.access(targetDir);
      console.error(`❌ 目录已存在: ${projectName}，请换一个名字`);
      continue; // ✅ 真正回到开头，重新输入
    } catch {
      // 目录不存在，跳出循环，开始创建
      return await createFromTemplate(projectName, targetDir);
    }
  }
}

// 单独封装创建逻辑
async function createFromTemplate(projectName, targetDir) {
  // 选择模板
  const { repo } = await prompts({
    type: 'select',
    name: 'repo',
    message: '选择模板',
    choices: TEMPLATES.map(([value, title]) => ({ title, value }))
  });

  if (!repo) return console.log('👋 取消创建');

  console.log(`\n🚀 创建项目: ${projectName}`);
  console.log(`📦 从 https://github.com/${repo} 克隆模板...\n`);

  try {
    execSync(`git clone https://github.com/${repo}.git ${targetDir}`, {
      stdio: 'inherit'
    });

    // 删除 .git
    const gitDir = path.join(targetDir, '.git');
    try {
      await fs.rm(gitDir, { recursive: true, force: true });
      console.log('🧹 已移除 .git 目录');
    } catch (err) {
      console.warn('⚠️ 删除 .git 失败:', err.message);
    }

    // 更新 package.json name
    const pkgPath = path.join(targetDir, 'package.json');
    try {
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      pkg.name = projectName;
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
      console.log(`✏️  package.json name 已更新为: ${projectName}`);
    } catch (err) {
      console.warn('⚠️ 未找到或无法更新 package.json:', err.message);
    }

    // 安装依赖
    const pm = detectPackageManager();
    console.log(`\n📦 使用 ${pm} 安装依赖...\n`);
    execSync(`${pm} install`, { cwd: targetDir, stdio: 'inherit' });
    console.log('\n✅ 项目创建成功！');
    console.log('');
  } catch (error) {
    console.error('❌ 创建失败:', error.message);
    try {
      await fs.rm(targetDir, { recursive: true, force: true });
      console.log(`🗑️ 已清理失败目录: ${projectName}`);
    } catch { }
  }
}

function detectPackageManager() {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    return 'pnpm';
  } catch {
    return 'npm';
  }
}

if (path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1])) {
  createProject().catch(console.error);
}