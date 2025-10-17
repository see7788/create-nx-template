#!/usr/bin/env node

import { execSync, spawnSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PackageJson } from 'type-fest';
import tool from "./tool.js"
// ================================
// 🚀 极简 Git 发布脚本（TypeScript 版 + 完整错误处理）
// ================================
// ✅ 正确指向项目根目录的 package.json

/**
 * 执行命令并输出日志
 */
function run(cmd: string, options?: ExecSyncOptionsWithStringEncoding): void {
  console.log(`\n🐚 ${cmd}`);
  try {
    execSync(cmd, {
      stdio: 'inherit',
      cwd: process.cwd(),
      ...(options || {})
    });
    console.log(cmd, `✅ 成功`);
  } catch (error: any) {
    console.error(cmd, `❌ 失败`);
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
 * 主发布函数
 */
export default async function releaseProject(): Promise<void> {
  const { pkgPath, pkgJson } = tool()
  // 1. 读取 package.json
  const currentVersion = pkgJson.version;
  if (!currentVersion || typeof currentVersion !== 'string') {
    console.error('❌ package.json 中 version 字段缺失或格式错误');
    process.exit(1);
  }
  // 2. 自动递增 patch
  const versionParts = currentVersion.split('.').map(Number);
  if (versionParts.some(isNaN)) {
    console.error('❌ 版本号格式错误:', currentVersion);
    process.exit(1);
  }
  versionParts[2]++;
  const nextVersion = versionParts.join('.');

  // 3. 更新 package.json
  pkgJson.version = nextVersion;
  try {
    fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf-8');
    console.log(`📦 版本更新: ${currentVersion} → ${nextVersion}`);
  } catch (error: any) {
    console.error('❌ 无法写入 package.json:', error.message);
    process.exit(1);
  }

  if (hasUnstagedChanges()) {
    console.log('\n🔍 检测到未暂存的变更：');
    run('git status --short');
    run('git add .');
  }

  console.log('\n🔍 提交 package.json + 其他变更');
  run(`git commit -m "release: v${nextVersion}"`);

  const branch = getCurrentBranch();
  console.log(`\n 当前分支: ${branch}`);

  run(`git push origin ${branch}`);
  console.log(`\n 推送代码`);

  const tagName = `v${nextVersion}`
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

  run(`git push origin v${nextVersion}`);
  console.log(`\n 推送标签`);

  // 10. 成功提示
  const repo = getGithubRepo();
  console.log('\n🎉 发布成功！');

  if (repo) {
    const tagName = `v${nextVersion}`;
    const releaseUrl = `https://github.com/${repo}/releases/tag/${tagName}`;
    console.log(`🔗 发布地址: ${releaseUrl}`);
  } else {
    console.log(`🔗 无法自动确定发布地址，请检查 git remote。`);
    console.log(`   默认格式: https://github.com/<owner>/<repo>/releases/tag/v${nextVersion}`);
  }
  console.log('');
}
/**
 * 从 git remote 中提取 GitHub 的 owner/repo
 * 支持 ssh 和 https 格式
 */
function getGithubRepo(): string | null {
  try {
    let url = execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();

    // 处理 SSH 格式: git@github.com:owner/repo.git
    if (url.startsWith('git@github.com:')) {
      url = url.replace('git@github.com:', 'https://github.com/');
    }

    // 确保以 .git 结尾的去掉 .git
    if (url.endsWith('.git')) {
      url = url.slice(0, -4);
    }

    // 匹配 https://github.com/owner/repo
    const match = url.match(/github\.com[/|:](.+)$/i);
    if (match) {
      return match[1]; // 返回 owner/repo
    }

    return null;
  } catch (error) {
    console.warn('⚠️  无法获取 git remote 信息');
    return null;
  }
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



