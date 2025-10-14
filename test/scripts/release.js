#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from "url"

// ================================
// 🚀 极简 Git 发布脚本（修复路径 + 完整文件推送）
// ================================

// ✅ 兼容 Windows 的 __dirname
const __filename = new URL(import.meta.url).pathname;
const isWin = process.platform === 'win32';
const filepath = isWin ? __filename.slice(1).replace(/\//g, '\\') : __filename;
const __dirname = path.dirname(filepath);

// ✅ 正确指向项目根目录的 package.json
const PKG_PATH = path.resolve(__dirname, '..', 'package.json');

/**
 * 执行命令并输出日志
 */
function run(cmd, options = {}) {
  console.log(`\n🐚 ${cmd}`);
  try {
    execSync(cmd, {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
      ...options
    });
    console.log(`✅ 成功`);
  } catch (error) {
    console.error(`❌ 失败: ${cmd}`);
    process.exit(1);
  }
}

/**
 * 检查是否有未暂存的变更
 */
function hasUnstagedChanges() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * 主发布函数
 */
export async function releaseProject() {
  // 1. 读取 package.json
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  } catch (err) {
    console.error('❌ 无法读取 package.json，请检查路径是否正确');
    console.error('尝试路径:', PKG_PATH);
    process.exit(1);
  }

  const currentVersion = pkg.version;
  console.log(`📄 当前版本: ${currentVersion}`);

  // 2. 自动递增 patch
  const versionParts = currentVersion.split('.').map(Number);
  if (versionParts.some(isNaN)) {
    console.error('❌ 版本号格式错误:', currentVersion);
    process.exit(1);
  }
  versionParts[2]++;
  const nextVersion = versionParts.join('.');

  // 3. 更新 package.json
  pkg.version = nextVersion;
  try {
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(`📦 版本更新: ${currentVersion} → ${nextVersion}`);
  } catch (err) {
    console.error('❌ 无法写入 package.json:', err.message);
    process.exit(1);
  }

  // 4. 检查是否有未暂存的变更
  if (hasUnstagedChanges()) {
    console.log('\n🔍 检测到未暂存的变更：');
    run('git status --short');

    const answer = await promptUser(
      '是否将所有变更加入提交？[y/N] ',
      (input) => ['y', 'yes', 'Y'].includes(input) || !input.trim()
    );

    if (!['y', 'yes', 'Y'].includes(answer)) {
      console.log('👋 取消发布');
      process.exit(0);
    }

    // ✅ 关键：添加所有变更
    run('git add .');
  }

  // 5. 提交 package.json + 其他变更
  run(`git commit -m "release: v${nextVersion}"`);

  // 6. 获取当前分支
  let branch;
  try {
    branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    console.log(`🔍 当前分支: ${branch}`);
  } catch (err) {
    console.error('❌ 无法获取当前分支');
    process.exit(1);
  }

  // 7. 推送代码
  run(`git push origin ${branch}`);

  // 8. 打标签（安全处理已存在标签）
  try {
    execSync(`git tag v${nextVersion}`, { stdio: 'ignore' });
    console.log(`✅ 标签 v${nextVersion} 创建成功`);
  } catch {
    console.warn(`⚠️  标签 v${nextVersion} 已存在，正在覆盖...`);
    execSync(`git tag -d v${nextVersion}`, { stdio: 'ignore' });
    execSync(`git tag v${nextVersion}`);
    console.log(`✅ 标签 v${nextVersion} 已更新`);
  }

  // 9. 推送标签
  run(`git push origin v${nextVersion}`);

  // 10. 成功提示
  console.log('\n🎉 发布成功！');
  console.log(`🔗 https://github.com/see7788/create-nx-template/releases/tag/v${nextVersion}`);
  console.log('');
}

async function promptUser(question) {
  const { createInterface } = await import('readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (input) => {
      rl.close();
      resolve(input.trim());
    });
  });
}

if (path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1])) {
  releaseProject().catch(console.error);
}
