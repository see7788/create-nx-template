// scripts/create-template.ts
import * as fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import { fileURLToPath } from 'url';
import degit from 'degit';
import { Appexit } from "./tool.js";

/**项目模板创建器类 - 采用流畅异步模式，专注于正常流程执行*/
class ProjectTemplateCreator {
  // 常量配置
  /**模板仓库前缀 - 所有模板仓库的统一命名空间，用于构建完整的仓库URL */
  private readonly templateRepoPrefix = 'see7788';
  
  /**可用模板列表 - 存储支持的项目模板选项，每个模板包含仓库名和描述 */
  private readonly templates: [string, string][] = [
    ['electron-template', '牛x的electron脚手架'],
    ['ts-template', 'typescript基本脚手架'],
  ];
  
  // 状态属性
  /**选中的模板仓库 - 存储用户选择的模板仓库名称，用于后续的项目创建 */
  private selectedTemplateRepo = '';
  
  /**验证后的项目名 - 存储经过验证的有效项目名称，用于创建目录和更新package.json */
  private validProjectName = '';
  
  /**目标目录路径 - 存储项目创建的完整目标目录绝对路径，用于模板克隆和文件操作 */
  private targetDir = '';

  /**执行项目创建的主流程 - 编排所有步骤的执行顺序*/
  async create(initialProjectName?: string): Promise<void> {
    try {
      // 编排业务流程的执行顺序
      await this.executeWorkflow(initialProjectName);
    } catch (error: any) {
      // 统一的错误处理，区分用户取消和实际错误
      // 用户取消不是错误，而是正常退出流程
      if (error.message === 'user-cancelled') {
        console.log('👋 操作已取消');
        return; // 正常退出，不使用process.exit
      }
      // 清理失败的目录（传入具体的projectDir）
      await this.cleanupFailedDirectory(this.targetDir);
      // 重新抛出Appexit错误，确保错误能够正确传播到顶层处理
      if (error instanceof Appexit) {
        throw error;
      }
      // 对于非Appexit错误，记录日志后再抛出
      console.error('❌ 错误:', error.message);
      throw error;
    }
  }

  /**执行项目创建工作流 - 编排各个业务步骤的具体执行*/
  private async executeWorkflow(initialProjectName?: string): Promise<void> {
    // 采用连续的异步调用，专注于正常流程
    console.log("选择项目模板")
    await this.selectTemplate();
    console.log("验证项目名称 - 确保名称有效且目录可用")
    await this.getValidProjectName(initialProjectName || undefined);
    console.log("创建项目结构 - 基于选定的模板生成文件")
    await this.createFromTemplate();
  }

  /**选择项目模板 - 使用异常而非布尔返回值表示取消*/
  private async selectTemplate(): Promise<void> {
    const response = await prompts({
      type: 'select',
      name: 'repo',
      message: '选择模板',
      choices: this.templates.map(([value, title]) => ({ title, value }))
    });

    // 用户取消时不使用AppError，而是通过特殊消息标记正常退出流程
    if (!response.repo) {
      const error = new Error('user-cancelled');
      throw error;
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

        // 用户取消时不使用AppError，而是通过特殊消息标记正常退出流程
        if (!response.name) {
          const error = new Error('user-cancelled');
          throw error;
        }

        projectName = response.name.trim();
      }

      // 验证项目名
      try {
        // 确保projectName是有效的string类型
        if (typeof projectName !== 'string') {
          throw new Appexit('无效的项目名称类型');
        }
        
        await this.validateProjectName(projectName);
        this.validProjectName = projectName;
        this.targetDir = path.resolve(this.validProjectName);
        return; // 验证成功，直接返回
      } catch (error: any) {
        // 致命错误(Appexit)应该向上传播，而不是在此处捕获并重置
        if (error instanceof Appexit) {
          throw error;
        }
        // 非致命错误可以在这里处理并重置
        console.error(`❌ ${error.message}`);
        projectName = undefined;
      }
    }
  }
  
  /**验证项目名称 - 确保接收有效的string类型，验证失败时抛出具体错误*/
    private async validateProjectName(projectName: string): Promise<void> {
      // 验证项目名称
      if (typeof projectName !== 'string') {
        // 无效的项目名称类型是致命错误
        throw new Appexit('无效的项目名称类型');
      }

      // 验证项目名不为空
      if (!projectName || projectName.trim() === '') {
        // 项目名不能为空是致命错误
        throw new Appexit('项目名不能为空');
      }

      // 验证项目名不包含斜杠
      if (projectName.includes('/')) {
        // 项目名包含斜杠是致命错误
        throw new Appexit('项目名不能包含 /');
      }

      // 验证项目名只包含允许的字符
      const validProjectNameRegex = /^[a-zA-Z0-9-_]+$/;
      if (!validProjectNameRegex.test(projectName)) {
        // 项目名包含非法字符是致命错误
        throw new Appexit('项目名只能包含字母、数字、- 和 _');
      }

      // 检查目录是否已存在（使用try-catch处理可能的文件系统错误）
      const projectDir = path.resolve(projectName);
      try {
        if (fs.existsSync(projectDir)) {
          // 目录已存在是致命错误
          throw new Appexit(`目录已存在: ${projectName}`);
        }
      } catch (error: any) {
        if (error instanceof Appexit) {
          // 重新抛出Appexit错误
          throw error;
        }
        // 文件系统访问错误不是致命错误，继续执行
        console.warn(`⚠️  检查目录时出现警告: ${error.message}`);
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
      const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      pkg.name = this.validProjectName;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
      console.log(`✏️  package.json name 已更新为: ${this.validProjectName}`);
    } catch (err: any) {
      console.warn('⚠️ 未找到或无法更新 package.json:', err.message);
    }
  }

  /**清理失败的项目目录 - 仅在有目标目录时执行*/
  private async cleanupFailedDirectory(projectDir: string): Promise<void> {
    try {
      // 检查目录是否存在
      if (fs.existsSync(projectDir)) {
        console.log(`🧹 清理失败的项目目录: ${projectDir}`);
        fs.rmSync(projectDir, { recursive: true, force: true });
        console.log(`✅ 目录已清理`);
      }
    } catch (error: any) {
      // 文件系统操作错误不是致命错误，仅输出警告
      console.warn(`⚠️  清理目录时出现警告: ${error.message}`);
    }
  }
}

/**导出项目模板创建器类 - 供外部直接使用*/
export { ProjectTemplateCreator };

/**直接运行脚本时执行 - 添加Promise处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const creator = new ProjectTemplateCreator();
  creator.create().catch((error) => {
    if (error instanceof Appexit) {
      console.error(`❌ 程序错误: ${error.message}`);
    } else if (error.message === 'user-cancelled') {
      console.log('👋 操作已取消');
    } else {
      console.error('❌ 程序执行失败:', error.message);
    }
  });
}