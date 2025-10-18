#!/usr/bin/env node

import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProjectTool } from "./tool.js"

/**发布管理器类 - 采用流畅异步模式的发布流程管理*/
class ReleaseManager {
  // 项目信息
  private readonly pkgPath: string;
  private readonly pkgJson: any;
  
  // 版本信息
  private currentVersion = '';
  private nextVersion = '';
  
  /**构造函数 - 初始化发布管理器*/
  constructor() {
    const projectInfo = new ProjectTool().getProjectInfo();
    this.pkgPath = projectInfo.pkgPath;
    this.pkgJson = projectInfo.pkgJson;
  }
  
  /**执行发布流程的主方法*/
  async release(): Promise<void> {
    try {
      // 流畅的异步执行流程
      await this.validateCurrentVersion();
      await this.checkGitStatus();
      await this.calculateNextVersion();
      await this.confirmRelease();
      await this.updateVersionInPackageJson();
      await this.commitVersionChanges();
      await this.createGitTag();
      await this.pushChangesToRemote();
      await this.publishToNpm();
      await this.createGithubRelease();
      
      console.log('\n🎉 发布完成！');
    } catch (error: any) {
      // 统一错误处理
      if (error.message === 'user-cancelled') {
        console.log('\n👋 发布已取消');
        return;
      }
      console.error(`\n❌ 发布失败: ${error.message}`);
    }
  }
  
  /**执行命令并返回结果 - 采用更安全的异步风格*/
  private runCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding): string {
    console.log(`\n🐚 ${cmd}`);
    try {
      const result = execSync(cmd, {
        stdio: 'pipe',
        cwd: process.cwd(),
        ...(options || {})
      });
      console.log(`✅ 命令执行成功`);
      return result.toString().trim();
    } catch (error: any) {
      const errorOutput = error.stdout?.toString() || error.stderr?.toString() || '';
      throw new Error(`命令执行失败: ${errorOutput || error.message}`);
    }
  }
  
  /**执行命令并输出到控制台 - 用于需要用户交互的命令*/
  private runInteractiveCommand(cmd: string): void {
    console.log(`\n🐚 ${cmd}`);
    try {
      execSync(cmd, {
        stdio: 'inherit',
        cwd: process.cwd()
      });
      console.log(`✅ 命令执行成功`);
    } catch (error: any) {
      throw new Error(`交互式命令执行失败: ${error.message}`);
    }
  }
  
  /**验证当前版本信息*/
  private async validateCurrentVersion(): Promise<void> {
    this.currentVersion = this.pkgJson.version;
    console.log(`📦 当前版本: ${this.currentVersion}`);
    
    if (!this.currentVersion || typeof this.currentVersion !== 'string') {
      throw new Error('无法获取有效的版本号');
    }
  }
  
  /**检查Git状态 - 确保分支正确且无未提交的更改*/
  private async checkGitStatus(): Promise<void> {
    // 检查是否有未暂存的变更
    const statusResult = this.runCommand('git status --porcelain', { encoding: 'utf8' });
    if (statusResult.trim()) {
      console.error('❌ 发现未提交的更改:');
      console.error(statusResult);
      console.error('\n💡 解决方法:');
      console.error('  1. 暂存并提交更改:');
      console.error('     git add .');
      console.error('     git commit -m "描述你的更改"');
      console.error('  2. 或者，如果这些更改不需要保留:');
      console.error('     git stash');
      console.error('     (发布完成后，使用 git stash pop 恢复更改)');
      throw new Error('发布前请先处理未提交的更改');
    }
    
    // 检查当前分支
    const currentBranch = this.runCommand('git branch --show-current', { encoding: 'utf8' });
    if (!currentBranch) {
      throw new Error('无法获取当前分支信息');
    }
    
    console.log(`🌿 当前分支: ${currentBranch}`);
    
    // 对于main/master分支的检查可以保留，但不强制退出
    if (!['main', 'master'].includes(currentBranch)) {
      console.warn('⚠️ 警告: 建议在main或master分支上发布');
    }
  }
  
  /**从 git remote 中提取 GitHub 的 owner/repo*/
  private getGithubRepo(): string | null {
    try {
      let url = this.runCommand('git remote get-url origin', { encoding: 'utf8' });

      if (url.startsWith('git@github.com:')) {
        url = url.replace('git@github.com:', 'https://github.com/');
      }

      if (url.endsWith('.git')) {
        url = url.slice(0, -4);
      }

      // 提取owner/repo
      const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
      return match ? `${match[1]}/${match[2]}` : null;
    } catch (error) {
      return null;
    }
  }

  /**计算下一版本号 - 采用语义化版本递增*/
  private async calculateNextVersion(): Promise<void> {
    const [major, minor, patch] = this.currentVersion.split('.').map(Number);
    
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
      throw new Error('无效的版本号格式');
    }
    
    this.nextVersion = `${major}.${minor}.${patch + 1}`;
    console.log(`🚀 下一个版本: ${this.nextVersion}`);
  }

  /**确认是否发布 - 使用异常表示取消操作*/
  private async confirmRelease(): Promise<void> {
    // 动态导入prompts以避免不必要的依赖
    const prompts = (await import('prompts')).default;
    
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `是否确认发布版本 ${this.nextVersion}？`,
      initial: true
    });
    
    if (!response.confirm) {
      throw new Error('user-cancelled');
    }
  }

  /**更新package.json中的版本号*/
  private updateVersionInPackageJson(): void {
    this.pkgJson.version = this.nextVersion;
    
    try {
      fs.writeFileSync(this.pkgPath, JSON.stringify(this.pkgJson, null, 2));
      console.log(`✏️  package.json 版本已更新为 ${this.nextVersion}`);
    } catch (error: any) {
      throw new Error(`更新 package.json 失败: ${error.message}`);
    }
  }

  /**检查标签是否已存在*/
  private tagExists(tagName: string): boolean {
    try {
      const result = this.runCommand(`git tag -l "${tagName}"`, { encoding: 'utf8' });
      return result.trim() === tagName;
    } catch (error) {
      // 如果命令失败，假设标签不存在
      return false;
    }
  }

  /**提交版本变更*/
  private commitVersionChanges(): void {
    this.runInteractiveCommand(`git add ${this.pkgPath}`);
    this.runInteractiveCommand(`git commit -m "chore: release ${this.nextVersion}"`);
  }

  /**创建Git标签*/
  private createGitTag(): void {
    const tagName = `v${this.nextVersion}`;
    
    // 检查标签是否已存在
    if (this.tagExists(tagName)) {
      throw new Error(`标签 ${tagName} 已存在`);
    }
    
    this.runInteractiveCommand(`git tag -a ${tagName} -m "Release ${this.nextVersion}"`);
  }

  /**推送到远程仓库*/
  private pushChangesToRemote(): void {
    const currentBranch = this.runCommand('git branch --show-current', { encoding: 'utf8' });
    this.runInteractiveCommand(`git push origin ${currentBranch}`);
    this.runInteractiveCommand(`git push origin v${this.nextVersion}`);
  }

  /**发布到npm*/
  private publishToNpm(): void {
    this.runInteractiveCommand('npm publish --access public');
  }

  /**创建GitHub Release*/
  private createGithubRelease(): void {
    const githubRepo = this.getGithubRepo();
    if (!githubRepo) {
      console.warn('⚠️ 无法从 git remote 中提取 GitHub 仓库信息，跳过创建 Release');
      return;
    }
    
    const tagName = `v${this.nextVersion}`;
    const releaseNotes = `Release ${this.nextVersion}`;
    
    // 使用gh命令创建release
    try {
      this.runInteractiveCommand(`gh release create ${tagName} --title "${tagName}" --notes "${releaseNotes}"`);
    } catch (error) {
      console.warn('⚠️ 创建 GitHub Release 失败，可能需要安装 GitHub CLI 或检查权限');
    }
  }
}

/**项目发布的入口函数 - 简化实现，保持Promise链的完整性*/
export default async function releaseProject(): Promise<void> {
  const releaseManager = new ReleaseManager();
  await releaseManager.release();
}

/**直接运行脚本时执行 - 优雅地处理错误*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  releaseProject().catch((error) => {
    console.error('❌ 发布过程中出现错误:', error.message);
    // 注意：这里不再使用process.exit，让Node.js自然退出
  });
}