// scripts/create-template.js
import fs from 'fs/promises';
import path from 'path';
import degit from 'degit';
import prompts from 'prompts';

/**
 * ✅ 极简模板列表：[URL, 名称]
 */
const TEMPLATES = [
  ['https://github.com/Illyism/vite-react-ts-starter', 'React + TS + Vite'],
  ['https://github.com/ruanbekier/vite-react-starter', 'React + JS + Vite']
];

export async function createProject(projectName) {
  // 1. 获取项目名
  if (!projectName || projectName.includes('/')) {
    const result = await prompts({
      type: 'text',
      name: 'name',
      message: '请输入项目名',
      initial: 'my-app',
      validate: (name) => {
        if (!name || !name.trim()) return '项目名不能为空';
        if (name.includes('/')) return '不能包含 /';
        return true;
      }
    });
    projectName = result.name?.trim();
    if (!projectName) return console.log('👋 取消创建');
  }

  const targetDir = path.resolve(projectName);

  // 2. 检查目录是否已存在
  try {
    await fs.access(targetDir);
    const { confirm } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: '目录已存在，是否覆盖？'
    });
    if (!confirm) return console.log('👋 取消创建');
    await fs.rm(targetDir, { recursive: true });
  } catch {}

  // 3. 选择模板
  const { template } = await prompts({
    type: 'select',
    name: 'template',
    message: '选择模板',
    choices: TEMPLATES.map(([url, name]) => ({
      title: name,
      value: url
    }))
  });

  if (!template) return console.log('👋 取消创建');

  // 4. 创建项目
  console.log(`\n🚀 创建项目: ${projectName}`);
  console.log(`🔗 模板: ${template}\n`);

  const emitter = degit(template, { mode: 'tar', cache: false, force: true });

  try {
    await emitter.clone(targetDir);

    // 安装依赖
    const pm = detectPackageManager();
    const { execSync } = await import('child_process');
    console.log(`📦 使用 ${pm} 安装依赖...\n`);
    execSync(`${pm} install`, { cwd: targetDir, stdio: 'inherit' });

    // 成功提示
    console.log('\n🎉 创建成功！');
    console.log(`👉 cd ${projectName}`);
    console.log(`   ${pm} dev\n`);
  } catch (error) {
    console.error('❌ 创建失败:', error.message);
    try {
      await fs.rm(targetDir, { recursive: true });
      console.log(`🧹 已清理 ${projectName}`);
    } catch {}
  }
}

// 检测包管理器
function detectPackageManager() {
  try {
    require('child_process').execSync('pnpm --version', { stdio: 'null' });
    return 'pnpm';
  } catch {
    return 'npm';
  }
}