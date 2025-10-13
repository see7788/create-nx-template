#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import prompts from 'prompts';

const __filename = fileURLToPath(import.meta.url);

// ================================
// 🧩 模板配置：直接写 GitHub 仓库地址
// ✅ 扁平化配置，无映射，清晰直观
// ================================

const TEMPLATES = [
  {
    title: 'electron-template模板',
    value: 'see7788/electron-template'
  },
];

// ================================
// 🚀 主流程
// ================================

(async () => {
  console.log('\n🎮 欢迎使用项目创建工具！\n');

  const projectNameFromArg = process.argv[2];
  let projectName = projectNameFromArg;

  // 交互式提问
  const questions = [];

  if (!projectName) {
    questions.push({
      type: 'text',
      name: 'projectName',
      message: '请输入项目名称：',
      initial: 'electron-app',
      validate: (name) => name.trim() ? true : '⚠️ 项目名称不能为空！'
    });
  }

  questions.push({
    type: 'select',
    name: 'repo',
    message: '选择模板：',
    choices: TEMPLATES
  });

  const answers = await prompts(questions);
  projectName = projectName || answers.projectName;
  const repo = answers.repo; // ✅ 直接就是 GitHub 仓库地址

  if (!projectName || !repo) {
    console.log('\n👋 创建已取消。');
    process.exit(0);
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(targetDir)) {
    console.error(`\n🚨 目录 "${projectName}" 已存在，请换一个名字。`);
    process.exit(1);
  }

  console.log(`\n📥 正在下载模板：${repo}`);
  console.log(`   来源：https://github.com/${repo}`);

  // 使用 degit 下载（支持分支：your-username/repo#branch）
  const child = spawn(
    'npx',
    ['degit', repo, projectName],
    { stdio: 'inherit', cwd: process.cwd() }
  );

  child.on('close', (code) => {
    if (code !== 0) {
      console.error('❌ 模板下载失败，请检查网络或仓库是否存在。');
      process.exit(1);
    }

    console.log('✅ 下载完成！');

    // 自动更新 package.json 的 name 字段
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        pkg.name = projectName
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-zA-Z0-9\-]/g, '');
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
        console.log(`📄 已更新 package.json 的 name 为：${pkg.name}`);
      } catch (e) {
        console.warn('⚠️  自动更新 package.json 失败：', e.message);
      }
    }

    console.log(`\n🎉 项目 "${projectName}" 创建成功！\n`);
    console.log('👉 接下来运行：');
    console.log(`   cd ${projectName}`);
    console.log('   pnpm install');
    console.log('   pnpm start');
    console.log('');
  });
})();