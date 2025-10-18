// scripts/create-template.ts
import fs from 'fs/promises';
import path from 'path';
import prompts from 'prompts';
import { fileURLToPath } from 'url';
import degit from 'degit';

/**项目模板创建器类 - 采用流畅异步模式，专注于正常流程执行*/
class ProjectTemplateCreator {
  // 常量配置
  private readonly templateRepoPrefix = 'see7788';
  private readonly templates: [string, string][] = [
    ['electron-template', '牛x的electron脚手架'],
    ['ts-template', 'typescript基本脚手架'],
  ];
  
  // 状态属性
  private selectedTemplateRepo = '';
  private validProjectName = '';
  private targetDir = '';

  /**执行项目创建的主流程 - 流畅的异步执行模式*/
  async create(initialProjectName?: string): Promise<void> {
    try {
      // 采用连续的异步调用，专注于正常流程
      await this.selectTemplate();
      await this.getValidProjectName(initialProjectName || undefined);
      await this.createFromTemplate();
    } catch (error: any) {
      // 统一的错误处理，区分用户取消和实际错误
      if (error.message === 'user-cancelled') {
        console.log('👋 操作已取消');
        return; // 正常退出，不使用process.exit
      }
      console.error('❌ 错误:', error.message);
      await this.cleanupFailedDirectory();
    }
  }

  /**选择项目模板 - 使用异常而非布尔返回值表示取消*/
  private async selectTemplate(): Promise<void> {
    const response = await prompts({
      type: 'select',
      name: 'repo',
      message: '选择模板',
      choices: this.templates.map(([value, title]) => ({ title, value }))
    });

    // 用户取消时抛出特定异常
    if (!response.repo) {
      throw new Error('user-cancelled');
    }

    this.selectedTemplateRepo = response.repo;
  }

  /**获取并验证项目名称 - 循环直到获取有效名称或用户取消，确保类型安全*/
  private async getValidProjectName(initialProjectName?: string): Promise<void> {
    let projectName: string | undefined = initialProjectName;

    while (true) {
      // 交互式获取项目名
      if (!projectName) {
        const response = await prompts({
          type: 'text',
          name: 'name',
          message: '请输入项目名',
          initial: 'my-app'
        });

        if (!response.name) {
          throw new Error('user-cancelled');
        }

        projectName = response.name.trim();
      }

      // 验证项目名
      try {
        // 确保projectName是有效的string类型
        if (typeof projectName !== 'string') {
          throw new Error('无效的项目名称类型');
        }
        
        await this.validateProjectName(projectName);
        this.validProjectName = projectName;
        this.targetDir = path.resolve(this.validProjectName);
        return; // 验证成功，直接返回
      } catch (error: any) {
        // 显示错误并准备重新输入
        console.error(`❌ ${error.message}`);
        projectName = undefined;
      }
    }
  }
  
  /**验证项目名称 - 确保接收有效的string类型，验证失败时抛出具体错误*/
  private async validateProjectName(projectName: string): Promise<void> {
    // 确保参数是有效的字符串类型
    if (typeof projectName !== 'string' || !projectName || projectName.trim() === '') {
      throw new Error('项目名不能为空或不是有效字符串');
    }

    if (projectName.includes('/')) {
      throw new Error('项目名不能包含 /');
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(projectName)) {
      throw new Error('项目名只能包含字母、数字、- 和 _');
    }

    // 检查目录是否已存在
    const targetDir = path.resolve(projectName);
    try {
      await fs.access(targetDir);
      throw new Error(`目录已存在: ${projectName}`);
    } catch (error: any) {
      // 目录不存在是预期的正常情况
      if (error.code !== 'ENOENT') {
        throw error; // 重新抛出其他类型的错误
      }
    }
  }

  /**从模板创建项目 - 流畅的执行流程*/
  private async createFromTemplate(): Promise<void> {
    const repoUrl = `${this.templateRepoPrefix}/${this.selectedTemplateRepo}`;

    console.log(`\n🚀 创建项目: ${this.validProjectName}`);
    console.log(`📦 使用 degit 从 ${repoUrl} 获取模板...\n`);

    // 创建degit实例并监听事件
    const emitter = degit(repoUrl, {
      cache: false,
      force: true,
      verbose: true
    });

    emitter.on('info', (info) => console.log(`📝 ${info.message}`));
    emitter.on('warn', (warn) => console.warn(`⚠️ ${warn.message}`));

    // 执行克隆
    await emitter.clone(this.targetDir);
    console.log('🧹 已自动移除 .git 目录（degit 特性）');

    // 更新package.json
    await this.updatePackageJsonName();
    console.log('\n✅ 项目创建成功！');
  }

  /**更新package.json中的name字段 - 简化实现*/
  private async updatePackageJsonName(): Promise<void> {
    try {
      const pkgPath = path.join(this.targetDir, 'package.json');
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      pkg.name = this.validProjectName;
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
      console.log(`✏️  package.json name 已更新为: ${this.validProjectName}`);
    } catch (err: any) {
      console.warn('⚠️ 未找到或无法更新 package.json:', err.message);
    }
  }

  /**清理失败的项目目录 - 仅在有目标目录时执行*/
  private async cleanupFailedDirectory(): Promise<void> {
    if (!this.targetDir || !this.validProjectName) {
      return;
    }

    try {
      await fs.rm(this.targetDir, { recursive: true, force: true });
      console.log(`🗑️ 已清理失败目录: ${this.validProjectName}`);
    } catch {
      // 忽略清理失败
    }
  }
}

/**项目创建的入口函数 - 保持简洁的接口*/
export default async function createProject(projectName?: string): Promise<void> {
  const creator = new ProjectTemplateCreator();
  await creator.create(projectName);
}

/**直接运行脚本时执行 - 添加Promise处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  createProject().catch((error) => {
    console.error('❌ 程序执行失败:', error.message);
  });
}