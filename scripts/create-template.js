// scripts/create-template.js

import fs from 'fs/promises';
import path from 'path';
import degit from 'degit';
import prompts from 'prompts';

const TEMPLATES = [
  ['git@github.com:see7788/electron-template.git', 'Default Template'],
];

/**
 * 创建项目（支持交互式补全项目名）
 * @param {string|undefined} projectName - 可为空或不合法，函数内部会处理
 */
export async function createProject(projectName) {
  // ✅ 1. 如果项目名为空、无效，交互式询问
  while (!projectName || typeof projectName !== 'string' || projectName.trim() === '' || projectName.includes('/')) {
    const message = projectName?.includes('/')
      ? '项目名不能包含斜杠 "/"，请重新输入'
      : '项目名不能为空，请输入项目名（例如：my-app）';

    const response = await prompts({
      type: 'text',
      name: 'projectName',
      message,
      validate: (input) => {
        if (!input || input.trim() === '') return '项目名不能为空';
        if (input.includes('/')) return '项目名不能包含 /';
        return true;
      }
    });

    if (!response.projectName) {
      console.log('👋 取消创建');
      process.exit(0);
    }

    projectName = response.projectName.trim();
  }

  projectName = projectName.trim();
  const targetDir = path.resolve(projectName);

  // ✅ 2. 检查目录是否已存在
  try {
    await fs.access(targetDir);
    console.error(`❌ 目录已存在：${projectName}`);
    
    const { confirm } = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: '目录已存在，是否覆盖？'
    });

    if (!confirm) {
      console.log('👋 取消创建');
      process.exit(0);
    }

    // 删除旧目录
    await fs.rm(targetDir, { recursive: true, force: true });
    console.log(`🧹 已删除 ${projectName}`);
  } catch {}

  // ✅ 3. 开始创建
  console.log(`\n🚀 正在创建项目：${projectName}\n`);

  const templateChoice = await prompts({
    type: 'select',
    name: 'template',
    message: '请选择一个模板',
    choices: [
      ...TEMPLATES.map(([repo, display]) => ({
        title: display,
        value: repo,
        description: repo
      })),
      { title: 'Custom (自定义 GitHub 仓库)', value: 'custom' }
    ]
  });

  if (!templateChoice.template) {
    console.log('👋 取消创建');
    process.exit(0);
  }

  let repo;
  if (templateChoice.template === 'custom') {
    const custom = await prompts({
      type: 'text',
      name: 'repo',
      message: '请输入 GitHub 仓库（格式：owner/repo 或 git@github.com:owner/repo.git）',
      validate: (input) => input ? true : '仓库地址不能为空'
    });
    if (!custom.repo) {
      console.error('❌ 必须输入仓库地址');
      process.exit(1);
    }
    repo = custom.repo;
  } else {
    repo = templateChoice.template;
  }

  console.log(`\n🔗 使用模板：${repo}\n`);

  // ✅ 强制 degit 使用 Git + SSH，不降级为 HTTPS
  const emitter = degit(repo, {
    mode: 'git',           // 强制使用 git clone
    cache: false,          // 不使用缓存
    force: false,          // 不强制覆盖（由前面逻辑控制）
    verbose: true          // 显示详细日志
  });

  // ✅ 关键：设置 GIT_SSH_COMMAND，确保 SSH 正常工作
  process.env.GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null';

  try {
    await emitter.clone(targetDir);

    // 修改 package.json name
    const pkgPath = path.join(targetDir, 'package.json');
    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      pkg.name = projectName;
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    } catch (err) {
      // 无 package.json 也继续
    }

    // 初始化 Git
    const { execSync } = await import('child_process');
    execSync('git init', { cwd: targetDir, stdio: 'ignore' });
    execSync('git add .', { cwd: targetDir, stdio: 'ignore' });
    execSync('git commit -m "chore: init" --no-gpg-sign', { cwd: targetDir, stdio: 'ignore' });

    // 安装依赖
    await installDependencies(targetDir);

    // 成功提示
    showSuccess(projectName, detectPackageManager());

  } catch (error) {
    // ✅ 增强错误提示
    if (error.message.includes('Permission denied (publickey)')) {
      console.error('\n❌ SSH 权限被拒绝，请检查：');
      console.error('   1. 是否已生成 SSH 密钥（~/.ssh/id_ed25519）');
      console.error('   2. 是否已运行：ssh-add ~/.ssh/id_ed25519');
      console.error('   3. 是否已将公钥添加到 GitHub：https://github.com/settings/keys');
      console.error('   4. 测试命令：ssh -T git@github.com');
    } else if (error.message.includes('ENOTFOUND')) {
      console.error('❌ 网络错误：无法连接 GitHub');
    } else if (error.message.includes('404')) {
      console.error('❌ 模板仓库不存在');
    } else {
      console.error('❌ 创建失败：', error.message);
    }

    try {
      await fs.rm(targetDir, { recursive: true, force: true });
      console.log(`🧹 已清理 ${projectName}`);
    } catch {}
    process.exit(1);
  }
}

// ------------------------------
// 工具函数（保持不变）
// ------------------------------

async function installDependencies(cwd) {
  console.log('📦 正在安装依赖...\n');
  const pm = detectPackageManager();
  const { execSync } = await import('child_process');

  try {
    execSync(`${pm} install`, { cwd, stdio: 'inherit' });
    console.log(`\n✅ 依赖安装成功`);
  } catch {
    console.warn(`\n⚠️  ${pm} 安装失败，尝试 npm...\n`);
    try {
      execSync('npm install', { cwd, stdio: 'inherit' });
      console.log('\n✅ 使用 npm 安装成功');
    } catch {
      console.error('\n❌ 所有包管理器安装失败，请手动运行 npm install 或 pnpm install');
    }
  }
}

function detectPackageManager() {
  try {
    require('child_process').execSync('pnpm --version', { stdio: 'pipe' });
    return 'pnpm';
  } catch {
    return 'npm';
  }
}

function showSuccess(projectName, pm) {
  console.log('');
  console.log('🎉 项目创建成功！');
  console.log('');
  console.log('👉 下一步：');
  console.log(`   cd ${projectName}`);
  console.log(`   ${pm} dev`);
  console.log('');
  console.log(`💡 发布版本：`);
  console.log(`   ${pm === 'npm' ? 'npx' : 'pnpm dlx'} create-nx-template --release`);
  console.log('');
}

async function handleError(error, targetDir, projectName) {
  if (error.message.includes('ENOTFOUND')) {
    console.error('❌ 网络错误：无法连接 GitHub');
  } else if (error.message.includes('404')) {
    console.error('❌ 模板仓库不存在');
  } else {
    console.error('❌ 创建失败：', error.message);
  }

  try {
    await fs.rm(targetDir, { recursive: true, force: true });
    console.log(`🧹 已清理 ${projectName}`);
  } catch {}
  process.exit(1);
}