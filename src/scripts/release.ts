#!/usr/bin/env node

import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProjectTool, Appexit } from "./tool.js"

/**发布管理器类 - 采用流畅异步模式的发布流程管理*/
class ReleaseManager {
  // 项目信息
  /**包文件路径 - 存储package.json文件的绝对路径，用于读取和写入版本信息 */
  private readonly pkgPath: string;
  
  /**包配置对象 - 存储解析后的package.json内容，包含项目的所有配置信息 */
  private readonly pkgJson: any;

  // 版本信息
  /**当前版本号 - 存储从package.json读取的当前项目版本，用于版本比较和递增计算 */
  private currentVersion = '';
  
  /**下一个版本号 - 存储计算得出的新版本号，将用于更新package.json和创建标签 */
  private nextVersion = '';

  /**构造函数 - 初始化发布管理器*/
  constructor() {
    const projectInfo = new ProjectTool().getProjectInfo();
    this.pkgPath = projectInfo.pkgPath;
    this.pkgJson = projectInfo.pkgJson;
  }

  /**执行版本发布的主流程 - 编排所有步骤的执行顺序*/
  async release(): Promise<void> {
    try {
      // 编排业务流程的执行顺序
      await this.executeReleaseWorkflow();
      
      console.log('\n🎉 发布完成！');
    } catch (error: any) {
      // 统一错误处理
      // 用户取消不是错误，而是正常退出流程
      if (error.message === 'user-cancelled') {
        console.log('\n👋 操作已取消');
        return;
      }
      // 重新抛出Appexit错误，确保错误能够正确传播到顶层处理
      if (error instanceof Appexit) {
        throw error;
      }
      // 对于非Appexit错误，记录日志后再抛出
      console.error(`\n❌ 发布失败: ${error.message}`);
      throw error;
    }
  }

  /**执行版本发布工作流 - 编排各个业务步骤的具体执行*/
  private async executeReleaseWorkflow(): Promise<void> {
    // 连续的异步调用，专注于正常流程
    console.log("验证并更新版本信息")
    await this.processVersion();
    console.log("检查Git状态 - 确保分支正确，自动处理未提交的更改")
    await this.checkGitStatus();
    console.log("提交版本更改和创建标签")
    await this.commitAndTagVersion();
    console.log("推送更改到远程仓库 - 同步代码和标签")
    await this.pushChangesToRemote();
    console.log("创建GitHub发布 - 在GitHub上创建正式发布")
    await this.createGithubRelease();
  }

  /**执行Git命令并处理错误 - 统一Git操作的错误处理*/
  private runGitCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError: boolean = true): string | null {
    console.log(`\n🐚 git ${cmd}`);
    try {
      const result = execSync(`git ${cmd}`, {
        stdio: 'pipe',
        cwd: process.cwd(),
        ...(options || {})
      });
      console.log(`✅ Git命令执行成功`);
      return result.toString().trim();
    } catch (error: any) {
      if (throwOnError) {
        // 致命错误
        throw new Appexit(`Git命令执行失败: ${cmd}`);
      }
      // 非致命错误，返回null
      return null;
    }
  }

  /**执行交互式命令 - 用于需要用户交互的命令*/
  private runInteractiveCommand(cmd: string, throwOnError: boolean = true): void {
    console.log(`\n🐚 ${cmd}`);
    try {
      execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
      console.log(`✅ 命令执行成功`);
    } catch (error: any) {
      if (throwOnError) {
        // 交互式命令执行失败是致命错误
        throw new Appexit('交互式命令执行失败');
      }
      // 非致命错误，静默失败
    }
  }

  /**执行通用命令并返回结果 - 支持非致命错误模式*/
  private runCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError: boolean = true): string | null {
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
      if (throwOnError) {
        // 致命错误
        throw new Appexit(`命令执行失败: ${cmd}`);
      }
      // 非致命错误，返回null
      console.warn(`⚠️  命令执行失败: ${cmd}`);
      return null;
    }
  }

  /**处理版本相关操作 - 优化版本规则实现*/
  private async processVersion(): Promise<void> {
    // 1. 获取当前版本，如果不存在或不规范则使用默认版本0.0.1（符合语义化版本初始规范）
    this.currentVersion = this.pkgJson.version;
    
    // 更严格的语义化版本验证正则
    const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
    
    if (!this.currentVersion || typeof this.currentVersion !== 'string' || 
        !semverRegex.test(this.currentVersion)) {
      console.warn('⚠️  版本不规范或不存在，使用初始版本 0.0.1');
      this.currentVersion = '0.0.1';
    }
    console.log(`📦 当前版本: ${this.currentVersion}`);
    
    // 2. 版本号递增 - 符合语义化版本规则的递增
    // 移除可能存在的预发布或构建元数据部分
    const baseVersion = this.currentVersion.split(/[-+]/)[0];
    const [major, minor, patch] = baseVersion.split('.').map(Number);
    
    // 按照补丁版本递增规则
    this.nextVersion = `${major}.${minor}.${patch + 1}`;
    console.log(`🚀 下一个版本: ${this.nextVersion}`);
    
    // 3. 检查新版本是否已存在（避免版本冲突）
    this.checkVersionConflict(this.nextVersion);
    
    // 4. 更新package.json
    this.pkgJson.version = this.nextVersion;
    fs.writeFileSync(this.pkgPath, JSON.stringify(this.pkgJson, null, 2));
    console.log(`✏️  package.json 版本已更新为 ${this.nextVersion}`);
  }
  
  /**检查版本是否已存在冲突*/
  private checkVersionConflict(version: string): void {
    // 检查是否存在相同版本的标签
    const tagExists = this.tagExists(`v${version}`);
    if (tagExists) {
      throw new Appexit(`版本冲突: 版本 ${version} 的标签已存在`);
    }
    
    // 检查git历史中是否有相同版本的提交信息
    const commitExists = this.runGitCommand(
      `log --grep="chore: release ${version}" --oneline`, 
      { encoding: 'utf8' }, 
      false
    );
    
    if (commitExists && commitExists.trim()) {
      throw new Appexit(`版本冲突: 版本 ${version} 的提交历史已存在`);
    }
  }

  /**检查Git状态 - 确保分支正确，自动处理未提交的更改*/
  private async checkGitStatus(): Promise<void> {
    // 检查并初始化Git仓库
    if (!this.isGitRepository()) {
      this.initializeGitRepository();
    }
    
    // 检查是否有未暂存的变更
    const statusResult = this.runGitCommand('status --porcelain', { encoding: 'utf8' }, false);
    if (statusResult?.trim()) {
      this.handleUncommittedChanges(statusResult);
    }

    // 获取当前分支信息
    const currentBranch = this.getCurrentBranchInfo();
    console.log(`🌿 当前分支: ${currentBranch}`);

    // 检查是否在推荐的发布分支上
    this.checkRecommendedBranch(currentBranch);
  }
  
  /**检查是否为Git仓库*/
  private isGitRepository(): boolean {
    return this.runGitCommand('rev-parse --is-inside-work-tree', { encoding: 'utf8' }, false) === 'true';
  }
  
  /**初始化Git仓库 - 非致命错误处理，允许继续执行*/
  private initializeGitRepository(): void {
    console.log('ℹ️  检测到未初始化的git仓库，正在自动初始化...');
    if (this.runCommand('git init', undefined, false)) {
      console.log('✅ Git仓库初始化成功');
    } else {
      console.warn('⚠️  Git仓库初始化失败，但将继续尝试其他操作');
    }
    console.log('\n💡 提示:');
    console.log('  完成发布后，建议手动添加远程仓库:');
    console.log('  git remote add origin <your-repo-url>')
  }
  
  /**处理未提交的更改*/
  private handleUncommittedChanges(statusResult: string): void {
    console.log('⚠️  发现未提交的更改:');
    console.log(statusResult);
    console.log('\n🔄 正在自动暂存并提交更改...');
      
    try {
      // 自动暂存所有更改
      this.runGitCommand('add .');
      // 自动提交更改
      this.runGitCommand('commit -m "Update files before release"');
      console.log('✅ 已成功暂存并提交所有更改');
    } catch (error: any) {
      // 处理未提交更改失败是致命错误
      throw new Appexit('处理未提交更改失败');
    }
  }
  
  /**获取当前分支信息*/
  private getCurrentBranchInfo(): string {
    let currentBranch = this.runGitCommand('branch --show-current', { encoding: 'utf8' }, false);
    
    if (!currentBranch) {
      // 尝试获取提交SHA作为标识
      const commitSha = this.runGitCommand('rev-parse --short HEAD', { encoding: 'utf8' }, false);
      
      if (!commitSha) {
        console.error('❌ 无法获取当前分支或提交信息');
        throw new Appexit('获取Git信息失败');
      }
      
      console.warn('⚠️  当前处于分离HEAD状态');
      console.warn(`  当前提交: ${commitSha}`);
      return commitSha;
    }
    
    return currentBranch;
  }
  
  /**检查是否在推荐的发布分支上*/
  private checkRecommendedBranch(branch: string): void {
    if (!['main', 'master'].includes(branch)) {
      console.warn('⚠️ 警告: 您当前不在推荐的发布分支（main/master）上');
      console.warn(`  当前分支: ${branch}`);
      console.warn('  建议在main或master分支上发布以确保代码的稳定性和可靠性');
      console.warn('💡 提示: 如果确定要在此分支发布，请继续操作');
      console.warn('  如需切换分支: git checkout main 或 git checkout master');
    }
  }

  /**从 git remote 中提取 GitHub 的 owner/repo*/
  private getGithubRepo(): string | null {
    const url = this.runGitCommand('remote get-url origin', { encoding: 'utf8' }, false);
    if (!url) return null;

    // 标准化URL格式
    let normalizedUrl = url;
    if (normalizedUrl.startsWith('git@github.com:')) {
      normalizedUrl = normalizedUrl.replace('git@github.com:', 'https://github.com/');
    }
    if (normalizedUrl.endsWith('.git')) {
      normalizedUrl = normalizedUrl.slice(0, -4);
    }

    // 提取owner/repo
    const match = normalizedUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    return match ? `${match[1]}/${match[2]}` : null;
  }

  /**检查标签是否已存在 - 保留为私有工具方法*/
  private tagExists(tagName: string): boolean {
    const result = this.runGitCommand(`tag -l "${tagName}"`, { encoding: 'utf8' }, false);
    return result?.trim() === tagName;
  }

  /**提交版本变更并创建标签 - 合并两个相关操作*/
  private async commitAndTagVersion(): Promise<void> {
    // 1. 检查package.json是否有未提交的更改
    const statusResult = this.runGitCommand(`status --porcelain ${this.pkgPath}`, { encoding: 'utf8' }, false);
    
    // 只有当文件有更改时才提交
    if (statusResult?.trim()) {
      this.runInteractiveCommand(`git add ${this.pkgPath}`);
      this.runInteractiveCommand(`git commit -m "chore: release ${this.nextVersion}"`);
    } else {
      console.log(`ℹ️  package.json 已经是最新状态，跳过提交`);
    }
    
    // 2. 创建Git标签
    const tagName = `v${this.nextVersion}`;
    // 检查标签是否已存在
    if (this.tagExists(tagName)) {
      // 标签已存在是致命错误
      throw new Appexit('标签已存在');
    }
    this.runInteractiveCommand(`git tag -a ${tagName} -m "Release ${this.nextVersion}"`);
  }

  /**检查远程仓库是否存在*/
  private hasRemoteRepository(): boolean {
    const remotes = this.runGitCommand('remote', { encoding: 'utf8' }, false);
    return !!remotes && remotes.trim().length > 0;
  }

  /**推送到远程仓库*/
  private pushChangesToRemote(): void {
    if (!this.hasRemoteRepository()) {
      this.handleNoRemoteRepository();
      return;
    }

    try {
      const currentBranch = this.runGitCommand('branch --show-current', { encoding: 'utf8' });
      this.runInteractiveCommand(`git push origin ${currentBranch}`);
      this.runInteractiveCommand(`git push origin v${this.nextVersion}`);
    } catch (error: any) {
      // 推送代码到远程仓库失败是致命错误
      throw new Appexit('推送代码到远程仓库失败');
    }
  }
  
  /**处理没有远程仓库的情况*/
  private handleNoRemoteRepository(): void {
    console.warn('⚠️  检测到没有配置远程仓库');
    console.warn('📋 以下步骤将被跳过:');
    console.warn('  - 推送代码到远程仓库');
    console.warn('  - 推送标签到远程仓库');
    console.warn('  - 创建GitHub Release');

    console.log('\n💡 后续操作建议:');
    console.log('  1. 添加远程仓库: git remote add origin <your-repo-url>');
    console.log('  2. 推送代码: git push -u origin <branch-name>');
    console.log('  3. 推送标签: git push origin v' + this.nextVersion);

    // 这不是致命错误，允许继续执行npm发布
  }



  /**创建GitHub Release*/
  private createGithubRelease(): void {
    // 检查远程仓库
    if (!this.hasRemoteRepository()) {
      console.log('📡 未配置远程仓库，跳过创建GitHub Release');
      return;
    }

    // 检查GitHub仓库信息
    const githubRepo = this.getGithubRepo();
    if (!githubRepo) {
      console.warn('⚠️ 无法从 git remote 中提取 GitHub 仓库信息，跳过创建 Release');
      return;
    }

    // 创建GitHub Release（非致命错误）
    const tagName = `v${this.nextVersion}`;
    const releaseNotes = `Release ${this.nextVersion}`;
    
    // 使用gh命令创建release，允许失败
    this.runInteractiveCommand(
      `gh release create ${tagName} --title "${tagName}" --notes "${releaseNotes}"`,
      false // 非致命错误，不抛出异常
    );
    
    // 由于设置了throwOnError为false，即使失败也会继续执行，不需要额外的try-catch
    // 命令执行失败时的警告会在runInteractiveCommand中处理
  }
}

/**导出版本发布管理器类 - 供外部直接使用*/
export { ReleaseManager };

/**直接运行脚本时执行 - 简化的错误处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const releaseManager = new ReleaseManager();
  releaseManager.release().catch((error) => {
    if (error instanceof Appexit) {
      console.error(`❌ 程序错误: ${error.message}`);
    } else if (error.message?.includes('user-cancelled')) {
      console.log('👋 操作已取消');
    } else {
      console.error('❌ 程序执行失败:', error.message || '未知错误');
    }
  });
}