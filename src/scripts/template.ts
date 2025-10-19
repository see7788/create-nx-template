// scripts/create-template.ts
import * as fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import { fileURLToPath } from 'url';
import degit from 'degit';
import { spawn } from 'child_process';
import { Appexit, LibBase } from "./tool.js";

/**项目模板创建器类 - 采用流畅异步模式，专注于正常流程执行*/
export class ProjectTemplateCreator {
  // 常量配置
  /**模板仓库前缀 - 所有模板仓库的统一命名空间，用于构建完整的仓库URL */
  private readonly templateRepoPrefix = 'see7788';

  /**可用模板列表 - 存储支持的项目模板选项，每个模板包含仓库名和描述 */
  private readonly templates: [string, string][] = [
    ['electron-template', '牛x的electron脚手架'],
    ['ts-template', 'typescript基本脚手架'],
  ];

  // 状态属性
  /**选中的模板*/
  private selectedTemplateRepo = '';

  /**项目名 */
  private validProjectName: string = "";

  /**目标目录路径 - 动态计算项目创建的完整目标目录绝对路径，用于模板克隆和文件操作 */
  private get targetPath(): string {
    return this.validProjectName ? path.resolve(this.validProjectName) : '';
  }
  
  /**是否使用本地项目生成模板 */
  private useLocalProject = false;
  
  /**本地项目路径 */
  private localProjectPath = '';

  /**执行项目创建工作流 - 编排各个业务步骤的具体执行*/
  async task1(initialProjectName?: string): Promise<void> {
    try {
      // 编排业务流程的执行顺序
      console.log('\n🚀 开始项目创建流程');
      console.log('📋 1. 交互设置项目名称');
      this.validProjectName = initialProjectName || ""
      await this.projectNameprompts(); // 自动验证项目名称
      console.log('📋 2. 选择模板来源');
      await this.selectTemplateSource();
      console.log('🏗️ 3. 模版本地化');
      if (this.useLocalProject) {
        await this.createFromLocalProject();
      } else {
        await this.selectTemplate();
        await this.createFromTemplate();
      }
      console.log('\n🚀 完成项目创建流程');
    } catch (error: any) {
      await this.targetPathDEl()
    }
  }


  /**交互确定项目名称*/
  private async projectNameprompts(): Promise<void> {
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

        await this.projectNameToken(projectName);
        this.validProjectName = projectName;
        return; // 验证成功，直接返回
      } catch (error: any) {
        // 无论是什么错误，都在这里处理并提示用户重新输入
        console.error(`❌ ${error.message}`);
        projectName = undefined; // 重置projectName，让用户重新输入
      }
    }
  }

  /**验证项目名称*/
  private async projectNameToken(projectName: string) {
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
  }


  /**选择模板来源 - 从GitHub仓库或本地项目生成 */
  private async selectTemplateSource(): Promise<void> {
    const response = await prompts({
      type: 'select',
      name: 'source',
      message: '选择模板来源',
      choices: [
        { title: '从GitHub模板创建', value: 'github' },
        { title: '从本地项目生成模板', value: 'local' }
      ]
    });
    
    // 用户取消时不使用AppError，而是通过特殊消息标记正常退出流程
    if (!response.source) {
      const error = new Error('user-cancelled');
      throw error;
    }
    
    this.useLocalProject = response.source === 'local';
    
    // 如果选择本地项目，让用户选择项目路径
    if (this.useLocalProject) {
      await this.selectLocalProjectPath();
    }
  }
  
  /**选择本地项目路径 - 支持选择具体文件或目录 */
  private async selectLocalProjectPath(): Promise<void> {
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
      } catch (error) {
        console.warn('⚠️ 无法获取磁盘列表，使用默认路径');
        availableDrives = ['C:'];
      }
    } else {
      // 非Windows平台默认使用根目录
      availableDrives = ['/'];
    }
    
    // 选择磁盘/根目录
    const driveResponse = await prompts({
      type: 'select',
      name: 'drive',
      message: '选择磁盘驱动器',
      choices: availableDrives.map(drive => ({ title: drive, value: drive }))
    });
    
    if (!driveResponse.drive) {
      const error = new Error('user-cancelled');
      throw error;
    }
    
    let currentPath = driveResponse.drive;
    
    // 递归选择目录
    while (true) {
      // 获取当前目录下的所有文件和文件夹
      let items: { name: string; path: string; isDirectory: boolean }[] = [];
      try {
        const files = fs.readdirSync(currentPath);
        items = files
          .map(name => {
            const itemPath = path.join(currentPath, name);
            const stats = fs.statSync(itemPath);
            return { name, path: itemPath, isDirectory: stats.isDirectory() };
          })
          .sort((a, b) => {
            // 文件夹排在前面
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });
      } catch (error) {
        console.error('❌ 无法读取目录内容:', error);
        // 让用户重试或取消
        const retryResponse = await prompts({
          type: 'confirm',
          name: 'retry',
          message: '是否重试？',
          initial: true
        });
        
        if (!retryResponse.retry) {
          const error = new Error('user-cancelled');
          throw error;
        }
        continue;
      }
      
      // 添加向上一级的选项
      const choices = [
        { title: '.. (上一级)', value: '..' },
        ...items.map(item => ({
          title: item.isDirectory ? `📁 ${item.name}` : `📄 ${item.name}`,
          value: item.path
        }))
      ];
      
      // 询问用户选择
      const selectionResponse = await prompts({
        type: 'select',
        name: 'selection',
        message: `当前路径: ${currentPath}\n选择项目目录或入口文件`,
        choices
      });
      
      if (!selectionResponse.selection) {
        const error = new Error('user-cancelled');
        throw error;
      }
      
      // 处理用户选择
      if (selectionResponse.selection === '..') {
        // 向上一级
        const parentPath = path.dirname(currentPath);
        if (parentPath !== currentPath) { // 防止到达根目录时无限循环
          currentPath = parentPath;
        }
      } else {
        // 检查选择的是否为文件
        const selectedStats = fs.statSync(selectionResponse.selection);
        if (selectedStats.isFile()) {
          // 选择了文件，将其作为入口文件
          this.localProjectPath = selectionResponse.selection;
          console.log(`✅ 已选择入口文件: ${this.localProjectPath}`);
          return;
        } else {
          // 选择了目录，继续深入
          currentPath = selectionResponse.selection;
          
          // 检查是否为有效的项目目录（包含package.json）
          const packageJsonPath = path.join(currentPath, 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            const confirmResponse = await prompts({
              type: 'confirm',
              name: 'confirm',
              message: `已找到有效的项目目录: ${currentPath}\n是否使用此目录作为模板来源？`,
              initial: true
            });
            
            if (confirmResponse.confirm) {
              this.localProjectPath = currentPath;
              console.log(`✅ 已选择项目目录: ${this.localProjectPath}`);
              return;
            }
          }
        }
      }
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
    // 用户取消时不使用AppError，而是通过特殊消息标记正常退出流程
    if (!response.repo) {
      const error = new Error('user-cancelled');
      throw error;
    }
    this.selectedTemplateRepo = response.repo;
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
      
      // 更新package.json
      await this.packageJsonNameSet();
      await this.githubpublishFileAdd();
      
      // 完成创建后的提示信息
      console.log('\n✅ 模板生成成功！');
      console.log(`📁 模板路径: ${path.resolve(this.targetPath)}`);
      console.log('\n💡 下一步操作:');
      console.log(`   cd ${this.validProjectName}`);
      console.log('   npm install');
      console.log('   npm run dev');
      console.log('\n📝 发布提示: 已添加GitHub Actions发布配置，请确保在GitHub仓库中设置NODE_AUTH_TOKEN密钥');
    } catch (error) {
      throw error;
    } finally {
      // 恢复原始工作目录
      process.chdir(originalCwd);
    }
  }
  
  /**使用子进程运行dist命令 */
  private runDistCommand(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 执行dist命令
      const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const args = ['create-nx-template', 'dist'];
      
      const child = spawn(command, args, {
        stdio: 'inherit', // 继承父进程的标准输入输出
        shell: true
      });
      
      child.on('error', (error) => {
        console.error('❌ 执行dist命令失败:', error);
        reject(error);
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`dist命令执行失败，退出码: ${code}`));
        }
      });
    });
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

  /**从模板创建项目*/
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
    await emitter.clone(this.targetPath);
    console.log('🧹 已自动移除 .git 目录（degit 特性）');

    // 更新package.json
    await this.packageJsonNameSet();
    await this.githubpublishFileAdd()

    // 完成创建后的提示信息
    console.log('\n✅ 项目创建成功！');
    console.log(`📁 项目路径: ${path.resolve(this.targetPath)}`);
    console.log('\n💡 下一步操作:');
    console.log(`   cd ${this.validProjectName}`);
    console.log('   npm install');
    console.log('   npm run dev');
    console.log('\n📝 发布提示: 已添加GitHub Actions发布配置，请确保在GitHub仓库中设置NODE_AUTH_TOKEN密钥');
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

  /**更新package.json中的name字段 - 简化实现*/
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