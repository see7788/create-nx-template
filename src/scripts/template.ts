// scripts/create-template.ts
import * as fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import { fileURLToPath } from 'url';
import degit from 'degit';
import { spawn } from 'child_process';
import { Appexit, LibBase } from "./tool.js";

export class ProjectTemplateCreator {
  /**模板列表*/
  private readonly templates: [name: string, remark: string][] = [
    ["createFromLocalProject", "从本地项目抽取"],
    ['see7788/electron-template', '牛x的electron脚手架'],
    ['see7788/ts-template', 'typescript基本脚手架'],
  ];
  /**确定项目名*/
  private validProjectName!: string;

  /**确定模版 */
  private templatesIndex!: number

  /**本地项目路径 */
  private localProjectPath = '';

  /**目标目录路径 - 动态计算项目创建的完整目标目录绝对路径，用于模板克隆和文件操作 */
  private get targetPath(): string {
    return path.resolve(this.validProjectName);
  }

  /**执行项目创建工作流 - 编排各个业务步骤的具体执行*/
  async task1(initialProjectName?: string): Promise<void> {
    try {
      // 编排业务流程的执行顺序
      console.log('\n✨ 开始项目创建流程');
      console.log('📝 1. 交互设置项目名称,同时排除目录已存在的情况');
      this.validProjectName = initialProjectName || ""
      await this.validProjectNameSet();
      console.log('🎯 2. 选择模板index');
      await this.templatesIndexSet();
      console.log('🔨 3. 模版本地化');
      if (this.templatesIndex === 0) {
        await this.createFromLocalProject();
      } else {
        await this.createFromdegit();
      }
      console.log('📦 4. githubpublishFile');
      await this.githubpublishFileAdd()
      console.log('✏️  5. packageJsonNameSet');
      await this.packageJsonNameSet()
      console.log('\n🎉 完成项目创建流程');

      console.log(`📁 模板路径: ${path.resolve(this.targetPath)}`);
      console.log('\n💡 下一步操作:');
      console.log(`   cd ${this.validProjectName}`);
      console.log('   pnpm install');
      console.log('   pnpm run dev');
      console.log('\n📝 发布提示: 已添加GitHub Actions发布配置，请确保在GitHub仓库中设置NODE_AUTH_TOKEN密钥');
    } catch (error: any) {
      await this.targetPathDEl()
    }
  }

  /**交互确定项目名称*/
  private async validProjectNameSet(): Promise<void> {
    let projectName: string | undefined = this.validProjectName;
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
          console.error('❌ 无效的项目名称类型');
          projectName = undefined;
          continue;
        }

        // 验证项目名不为空
        if (!projectName || projectName.trim() === '') {
          throw new Error('项目名不能为空');
        }

        // 验证项目名不包含斜杠
        if (projectName.includes('/')) {
          throw new Error('项目名不能包含 /');
        }

        // 验证项目名只包含允许的字符
        const validProjectNameRegex = /^[a-zA-Z0-9-_]+$/;
        if (!validProjectNameRegex.test(projectName)) {
          throw new Error('项目名只能包含字母、数字、- 和 _');
        }

        // 检查目录是否已存在（使用try-catch处理可能的文件系统错误）
        const targetPath = path.resolve(projectName);
        try {
          if (fs.existsSync(targetPath)) {
            throw new Error(`目录已存在: ${projectName}`);
          }
        } catch (error: any) {
          if (!error.message.startsWith('目录已存在')) {
            // 文件系统访问错误不是致命错误，记录警告但继续执行
            console.warn(`⚠️  检查目录时出现警告: ${error.message}`);
          } else {
            // 目录已存在错误直接抛出
            throw error;
          }
        }
        this.validProjectName = projectName;
        return; // 验证成功，直接返回
      } catch (error: any) {
        // 无论是什么错误，都在这里处理并提示用户重新输入
        console.error(`❌ ${error.message}`);
        projectName = undefined; // 重置projectName，让用户重新输入
      }
    }
  }

  /**选择模板索引*/
  private async templatesIndexSet(): Promise<void> {
    const response = await prompts({
      type: 'select',
      name: 'templateIndex',
      message: '请选择模板',
      choices: this.templates.map(([value, remark], index) => ({
        title: `${index + 1}. ${remark}`,
        value: index
      }))
    });

    // 用户取消时不使用AppError，而是通过特殊消息标记正常退出流程
    if (response.templateIndex === undefined) {
      const error = new Error('user-cancelled');
      throw error;
    }

    this.templatesIndex = response.templateIndex;

    // 如果选择了本地项目模板，直接进入本地项目路径选择
    if (this.templatesIndex === 0) {
      await this.selectLocalProjectPath();
    }
  }

  /**选择本地项目路径 - 优化的多级选择体验 */
  private async selectLocalProjectPath(): Promise<void> {
    console.log('📁 开始本地项目选择...');

    // 首先获取可用的磁盘驱动器
    let availableDrives: string[] = [];
    if (process.platform === 'win32') {
      // Windows平台获取所有可用磁盘
      const { execSync } = await import('child_process');
      try {
        const drivesOutput = execSync('wmic logicaldisk get caption', { encoding: 'utf8' });
        availableDrives = drivesOutput
          .split('\n')
          .map(line => line.trim())
          .filter(line => /^[A-Z]:$/.test(line));

        // 添加当前目录作为快速访问选项
        const currentDrive = process.cwd().split(':')[0] + ':';
        if (!availableDrives.includes(currentDrive)) {
          availableDrives.push(currentDrive);
        }
      } catch (error) {
        console.warn('⚠️ 无法获取磁盘列表，使用默认路径');
        availableDrives = ['C:', process.cwd().split(':')[0] + ':'];
      }
    } else {
      // 非Windows平台默认使用根目录和当前目录
      availableDrives = ['/', process.cwd()];
    }

    // 选择磁盘/根目录
    console.log('\n🔍 第1步：选择磁盘驱动器');
    const driveResponse = await prompts({
      type: 'select',
      name: 'drive',
      message: '请选择要查找项目的磁盘驱动器',
      choices: availableDrives.map(drive => ({
        title: drive === process.cwd().split(':')[0] + ':' ? `${drive} (当前磁盘)` : drive,
        value: drive
      }))
    });

    if (!driveResponse.drive) {
      const error = new Error('user-cancelled');
      throw error;
    }

    console.log(`✅ 已选择: ${driveResponse.drive}`);

    let currentPath = driveResponse.drive;
    let navigationLevel = 1; // 导航层级计数

    // 多级导航选择目录
    while (true) {
      navigationLevel++;
      console.log(`\n🔍 第${navigationLevel}步：浏览目录结构`);

      // 获取当前目录下的所有文件和文件夹
      let items: { name: string; path: string; isDirectory: boolean }[] = [];
      try {
        const files = fs.readdirSync(currentPath);
        items = files
          .map(name => {
            const itemPath = path.join(currentPath, name);
            try {
              const stats = fs.statSync(itemPath);
              return { name, path: itemPath, isDirectory: stats.isDirectory() };
            } catch (error) {
              // 跳过无法访问的文件/文件夹
              return null;
            }
          })
          .filter((item): item is { name: string; path: string; isDirectory: boolean } => item !== null) // 类型断言过滤null值
          .sort((a, b) => {
            // 文件夹排在前面，文件排在后面
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            // 同类项按名称排序
            return a.name.localeCompare(b.name);
          });
      } catch (error) {
        console.error('❌ 无法读取目录内容:', error);
        // 让用户重试或取消
        const retryResponse = await prompts({
          type: 'confirm',
          name: 'retry',
          message: '是否重试访问该目录？',
          initial: true
        });

        if (!retryResponse.retry) {
          // 给用户返回上一级的选项
          const goBackResponse = await prompts({
            type: 'confirm',
            name: 'goBack',
            message: '是否返回上一级目录？',
            initial: true
          });

          if (goBackResponse.goBack) {
            const parentPath = path.dirname(currentPath);
            if (parentPath !== currentPath) {
              currentPath = parentPath;
              navigationLevel--;
              continue;
            }
          }

          const error = new Error('user-cancelled');
          throw error;
        }
        continue;
      }

      // 添加特殊选项
      const specialChoices = [
        { title: '.. (上一级目录)', value: '..' },
        { title: '🏠 当前工作目录', value: 'current' },
        { title: '❌ 取消选择', value: 'cancel' }
      ];

      // 构建文件/文件夹选项
      const itemChoices = items.map(item => ({
        title: item.isDirectory
          ? `📁 ${item.name}${this.isProjectDirectory(item.path) ? ' (项目目录)' : ''}`
          : `📄 ${item.name}`,
        value: item.path
      }));

      // 组合所有选项
      const choices = [...specialChoices, ...itemChoices];

      // 询问用户选择
      const selectionResponse = await prompts({
        type: 'select',
        name: 'selection',
        message: `\n当前位置: ${currentPath}\n请选择一个目录进入，或选择一个JavaScript/TypeScript文件作为入口`,
        choices
      });

      // 处理特殊选择
      if (!selectionResponse.selection) {
        const error = new Error('user-cancelled');
        throw error;
      }

      // 处理特殊选项
      if (selectionResponse.selection === 'cancel') {
        const error = new Error('user-cancelled');
        throw error;
      } else if (selectionResponse.selection === 'current') {
        currentPath = process.cwd();
        console.log(`📂 已切换到当前工作目录: ${currentPath}`);
        continue;
      } else if (selectionResponse.selection === '..') {
        // 向上一级
        const parentPath = path.dirname(currentPath);
        if (parentPath !== currentPath) { // 防止到达根目录时无限循环
          console.log(`⬆️ 返回上一级目录`);
          currentPath = parentPath;
          navigationLevel--;
        } else {
          console.log('⚠️ 已经到达根目录，无法继续向上');
        }
        continue;
      }

      // 处理常规选择
      try {
        const selectedStats = fs.statSync(selectionResponse.selection);

        if (selectedStats.isFile()) {
          // 检查是否为JavaScript/TypeScript文件
          const ext = path.extname(selectionResponse.selection).toLowerCase();
          const isCodeFile = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext);

          if (!isCodeFile) {
            console.warn(`⚠️ 选择的文件不是有效的JavaScript/TypeScript文件（扩展名: ${ext}）`);
            const confirmResponse = await prompts({
              type: 'confirm',
              name: 'confirm',
              message: '是否继续使用此文件作为入口？',
              initial: false
            });

            if (!confirmResponse.confirm) {
              continue;
            }
          }

          // 选择了文件，将其作为入口文件
          this.localProjectPath = selectionResponse.selection;
          console.log(`\n✅ 已选择入口文件: ${this.localProjectPath}`);
          return;
        } else if (selectedStats.isDirectory()) {
          // 选择了目录，继续深入
          currentPath = selectionResponse.selection;
          console.log(`📂 已进入目录: ${currentPath}`);

          // 检查是否为有效的项目目录（包含package.json）
          if (this.isProjectDirectory(currentPath)) {
            const confirmResponse = await prompts({
              type: 'confirm',
              name: 'confirm',
              message: `\n已找到有效的项目目录: ${currentPath}\n包含package.json文件\n是否使用此目录作为模板来源？`,
              initial: true
            });

            if (confirmResponse.confirm) {
              this.localProjectPath = currentPath;
              console.log(`\n✅ 已选择项目目录: ${this.localProjectPath}`);
              return;
            }
          }
        }
      } catch (error) {
        console.error('❌ 无法访问选定的项目:', error);
        continue;
      }
    }
  }

  /**检查目录是否为有效的项目目录 */
  private isProjectDirectory(dirPath: string): boolean {
    try {
      return fs.existsSync(path.join(dirPath, 'package.json'));
    } catch (error) {
      return false;
    }
  }

  /**从本地项目生成模板 - 使用子进程调用dist功能 */
  private async createFromLocalProject(): Promise<void> {
    console.log(`\n🚀 从本地项目生成模板: ${this.validProjectName}`);
    console.log(`📦 处理项目: ${this.localProjectPath}\n`);

    // 保存当前工作目录
    const originalCwd = process.cwd();

    try {
      // 临时切换到本地项目目录
      const projectDir = fs.statSync(this.localProjectPath).isDirectory()
        ? this.localProjectPath
        : path.dirname(this.localProjectPath);

      process.chdir(projectDir);

      // 执行dist功能（使用子进程调用）
      console.log('🔄 使用子进程调用dist功能处理项目...');
      await this.runDistCommand();

      // 获取dist目录路径
      const distDirPath = path.join(projectDir, 'dist');

      // 检查dist目录是否存在
      if (!fs.existsSync(distDirPath)) {
        throw new Error(`dist目录不存在: ${distDirPath}`);
      }

      // 创建目标目录
      fs.mkdirSync(this.targetPath, { recursive: true });

      // 复制dist目录内容到目标目录
      console.log(`📋 复制处理后的文件到目标位置...`);
      this.copyDirectory(distDirPath, this.targetPath);

      // 完成创建后的提示信息
      console.log('\n✅ 模板生成成功！');
    } catch (error) {
      throw error;
    } finally {
      // 恢复原始工作目录
      process.chdir(originalCwd);
    }
  }

  /**使用子进程运行dist命令 */
  private async runDistCommand(): Promise<void> {
    try {
      // 直接使用DistPackageBuilder类，避免子进程调用带来的路径和递归问题
      const { DistPackageBuilder } = await import('./dist.js');
      const distBuilder = new DistPackageBuilder();
      await distBuilder.task1();
    } catch (error) {
      console.error('❌ 执行dist功能失败:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**复制目录函数 - 递归复制目录内容 */
  private copyDirectory(source: string, target: string): void {
    // 确保目标目录存在
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    // 读取源目录内容
    const files = fs.readdirSync(source);

    // 复制每个文件/目录
    for (const file of files) {
      const sourcePath = path.join(source, file);
      const targetPath = path.join(target, file);

      const stats = fs.statSync(sourcePath);

      if (stats.isDirectory()) {
        // 递归复制子目录
        this.copyDirectory(sourcePath, targetPath);
      } else {
        // 复制文件
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  /**用degit创建项目*/
  private async createFromdegit(): Promise<void> {
    const repoUrl = this.templates[this.templatesIndex][0];

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
    await emitter.clone(this.targetPath);
    console.log('🧹 已自动移除 .git 目录（degit 特性）');

    // 完成创建后的提示信息
    console.log('\n✅ 项目创建成功！');
  }

  private async githubpublishFileAdd() {
    try {
      // 定义源文件和目标文件路径
      const srcPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/publish.yml');
      const destPath = path.join(this.targetPath, '.github', 'workflows', 'publish.yml');

      // 创建目标目录
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      // 复制文件
      const config = fs.readFileSync(srcPath, 'utf-8');
      fs.writeFileSync(destPath, config);
      console.log('✅ 已添加GitHub Actions发布配置');
    } catch (error: any) {
      throw new Appexit(`⚠️  添加GitHub Actions配置时出错: ${error.message}`);
    }
  }

  /**更新package.json中的name字段*/
  private async packageJsonNameSet(): Promise<void> {
    try {
      const pkgPath = path.join(this.targetPath, 'package.json');
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
  private async targetPathDEl() {
    try {
      // 检查目录是否存在
      if (fs.existsSync(this.targetPath)) {
        console.log(`🧹 清理失败的项目目录: ${this.targetPath}`);
        fs.rmSync(this.targetPath, { recursive: true, force: true });
        console.log(`✅ 目录已清理`);
      }
    } catch (error: any) {
      // 文件系统操作错误不是致命错误，仅输出警告
      throw new Appexit(`⚠️  清理目录时出现警告: ${error.message}`);
    }
  }
}

/**直接运行脚本时执行 - 添加Promise处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new ProjectTemplateCreator().task1();
}