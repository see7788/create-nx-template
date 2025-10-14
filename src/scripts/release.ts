#!/usr/bin/env node

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ================================
// 🚀 极简 Git 发布脚本（TypeScript 版 + 完整错误处理）
// ================================

// ✅ 正确指向项目根目录的 package.json
const PKG_PATH = path.resolve(process.cwd(), 'package.json');

interface PackageJson {
  version: string;
  [key: string]: any;
}

/**
 * 执行命令并输出日志
 */
function run(cmd: string, options = {}): void {
  console.log(`\n🐚 ${cmd}`);
  try {
    execSync(cmd, {
      stdio: 'inherit',
      cwd: process.cwd(),
      ...options
    });
    console.log(`✅ 成功`);
  } catch (error: any) {
    console.error(`❌ 失败: ${cmd}`);
    if (error.message) {
      console.error(`   错误信息: ${error.message}`);
    }
    process.exit(1);
  }
}

/**
 * 检查是否有未暂存的变更
 */
function hasUnstagedChanges(): boolean {
  try {
    const result = execSync('git status --porcelain', { encoding: 'utf8' });
    return result.trim().length > 0;
  } catch (error: any) {
    console.error('❌ 检查 git 状态失败:', error.message);
    return false;
  }
}

/**
 * 获取当前分支名
 */
function getCurrentBranch(): string {
  try {
    const result = execSync('git branch --show-current', { encoding: 'utf8' });
    const branch = result.trim();
    if (!branch) {
      throw new Error('无法获取当前分支');
    }
    return branch;
  } catch (error: any) {
    console.error('❌ 无法获取当前分支:', error.message);
    process.exit(1);
  }
}

/**
 * 检查是否已存在标签
 */
function tagExists(tagName: string): boolean {
  try {
    const result = execSync(`git tag -l "${tagName}"`, { encoding: 'utf8' });
    return result.trim() === tagName;
  } catch (error: any) {
    console.error('❌ 检查标签存在性失败:', error.message);
    return false;
  }
}

/**
 * 创建或更新标签
 */
function createOrUpdateTag(tagName: string): void {
  if (tagExists(tagName)) {
    console.warn(`⚠️  标签 ${tagName} 已存在，正在覆盖...`);
    try {
      execSync(`git tag -d ${tagName}`, { stdio: 'ignore' });
    } catch (error: any) {
      console.error(`❌ 删除旧标签失败:`, error.message);
    }
  }

  try {
    execSync(`git tag ${tagName}`, { stdio: 'ignore' });
    console.log(`✅ 标签 ${tagName} 创建/更新成功`);
  } catch (error: any) {
    console.error(`❌ 创建标签失败:`, error.message);
    process.exit(1);
  }
}

/**
 * 主发布函数
 */
export async function releaseProject(): Promise<void> {
  // 1. 读取 package.json
  let pkg: PackageJson;
  try {
    const pkgContent = fs.readFileSync(PKG_PATH, 'utf-8');
    pkg = JSON.parse(pkgContent);
  } catch (error: any) {
    console.error('❌ 无法读取 package.json，请检查路径是否正确');
    console.error('尝试路径:', PKG_PATH);
    if (error.code) {
      console.error(`   错误代码: ${error.code}`);
    }
    if (error.message) {
      console.error(`   错误信息: ${error.message}`);
    }
    process.exit(1);
  }

  const currentVersion = pkg.version;
  if (!currentVersion || typeof currentVersion !== 'string') {
    console.error('❌ package.json 中 version 字段缺失或格式错误');
    process.exit(1);
  }

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
  } catch (error: any) {
    console.error('❌ 无法写入 package.json:', error.message);
    process.exit(1);
  }

  // 4. 检查是否有未暂存的变更
  if (hasUnstagedChanges()) {
    console.log('\n🔍 检测到未暂存的变更：');
    run('git status --short');

    const answer = await promptUser('是否将所有变更加入提交？[y/N] ');
    const shouldAdd = ['y', 'yes', 'Y'].includes(answer.trim());

    if (!shouldAdd) {
      console.log('👋 取消发布');
      process.exit(0);
    }

    // ✅ 关键：添加所有变更
    run('git add .');
  }

  // 5. 提交 package.json + 其他变更
  run(`git commit -m "release: v${nextVersion}"`);

  // 6. 获取当前分支
  const branch = getCurrentBranch();
  console.log(`🔍 当前分支: ${branch}`);

  // 7. 推送代码
  run(`git push origin ${branch}`);

  // 8. 创建或更新标签
  createOrUpdateTag(`v${nextVersion}`);

  // 9. 推送标签
  run(`git push origin v${nextVersion}`);

  // 10. 成功提示
  console.log('\n🎉 发布成功！');
  console.log(`🔗 https://github.com/see7788/create-nx-template/releases/tag/v${nextVersion}`);
  console.log('');
}

/**
 * 异步提示用户输入
 */
async function promptUser(question: string): Promise<string> {
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

// ✅ 检查是否直接执行此脚本
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  releaseProject().catch((error: any) => {
    console.error('❌ 发布过程中发生错误:', error.message);
    if (error.stack) {
      console.error('详细错误信息:', error.stack);
    }
    process.exit(1);
  });
}



