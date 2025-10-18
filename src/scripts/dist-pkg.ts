#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { build as esbuild, BuildResult } from 'esbuild'
import path from 'path';
import { fileURLToPath } from 'url';
import fs from "fs"
import { ProjectTool, Appexit } from "./tool.js";

/**分发包构建器类 - 采用流畅异步执行模式*/
class DistPackageBuilder {
  // 项目基本信息
  /**当前工作目录 - 存储项目的根目录路径，用于解析所有文件路径 */
  private readonly cwdPath: string;
  
  /**包配置对象 - 存储项目的package.json内容，用于读取项目信息和依赖项 */
  private readonly pkgJson: any;
  
  // 构建相关路径
  /**入口文件名 - 存储项目入口文件的名称，用于识别构建入口 */
  private entryName = '';
  
  /**入口文件路径 - 存储项目入口文件的完整绝对路径，作为esbuild的构建起点 */
  private entryFilePath = '';
  
  /**构建输出目录 - 存储分发包的输出目录路径，所有构建产物都将放在这里 */
  private readonly distPath: string;
  
  /**分发包package.json路径 - 存储生成的分发包配置文件路径，用于输出精简的package.json */
  private readonly distPackagePath: string;
  
  /**构造函数 - 初始化构建器*/
  constructor() {
    const projectInfo = new ProjectTool().getProjectInfo();
    this.pkgJson = projectInfo.pkgJson;
    this.cwdPath = projectInfo.cwdPath;
    this.distPath = path.join(this.cwdPath, "dist");
    this.distPackagePath = path.join(this.distPath, 'package.json');
  }
  
  /**执行完整的构建流程 - 编排所有步骤的执行顺序*/
  public async build(): Promise<void> {
    try {
      // 编排业务流程的执行顺序
      await this.executeBuildWorkflow();
      
      console.log('\n🎉 分发包构建完成！');
      console.log(`📦 输出目录: ${this.distPath}`);
    } catch (error: any) {
      // 统一的错误处理
      // 用户取消不是错误，而是正常退出流程
      if (error.message === 'user-cancelled') {
        console.log('\n👋 构建已取消');
        return;
      }
      // 重新抛出Appexit错误，确保错误能够正确传播到顶层处理
      if (error instanceof Appexit) {
        throw error;
      }
      // 对于非Appexit错误，记录日志后再抛出
      console.error(`\n❌ 构建失败: ${error.message}`);
      throw error;
    }
  }

  /**执行构建工作流 - 编排各个业务步骤的具体执行*/
  private async executeBuildWorkflow(): Promise<void> {
    // 连续的异步调用，专注于正常流程
    console.log("查找项目入口文件 - 自动识别或交互式选择")
    await this.findEntryFilePath();
    console.log("构建JavaScript文件 - 使用esbuild进行快速转译")
    const buildResult = await this.buildJsFile();
    console.log("生成TypeScript类型声明文件")
    await this.generateTypeDeclarations();
    console.log("提取使用的依赖项 - 优化package.json")
    const { usedDeps, usedDevDeps } = this.extractUsedDependencies(buildResult);
    console.log("生成分发包package.json文件")
    this.writeDistPackageJson(usedDeps, usedDevDeps);
    
    // 初始化git仓库（如果尚未初始化）
    console.log("初始化Git仓库（如果需要）")
    await this.initializeGitRepository();
  }
  
  /**查找项目入口文件 - 异步模式，使用异常处理错误情况*/
  private async findEntryFilePath(): Promise<void> {
    const entryOptions = [
      'index.ts',
      'index.tsx',
      'index.js',
      'index.jsx',
    ];
    
    const availableFiles = entryOptions
      .map(file => ({ file, fullPath: path.join(this.cwdPath, file) }))
      .filter(({ fullPath }) => fs.existsSync(fullPath));

    // 处理不同情况
    if (availableFiles.length === 1) {
      this.entryName = availableFiles[0].file;
    } else if (availableFiles.length > 1) {
      // 动态导入prompts以避免不必要的依赖
      const prompts = (await import('prompts')).default;
      
      const response = await prompts({
        type: 'select',
        name: 'entry',
        message: '请选择入口文件',
        choices: availableFiles.map(({ file, fullPath }) => ({
          title: file,
          value: file,
          description: fullPath,
        })),
      });
      
      if (!response.entry) {
        // 用户取消不是错误，而是通过消息标记正常退出
        const error = new Error('user-cancelled');
        throw error;
      }
      
      this.entryName = response.entry;
    } else {
      // 未找到有效的入口文件是致命错误
      throw new Appexit('未找到有效的入口文件');
    }
    
    this.entryFilePath = path.join(this.cwdPath, this.entryName);
    console.log(`🔍 找到入口文件: ${this.entryName}`);
  }
  
  /**构建JS文件 - 简化实现，专注于构建过程*/
  private async buildJsFile(): Promise<BuildResult> {
    // 创建输出目录
    mkdirSync(this.distPath, { recursive: true });
    
    // 构建JS文件并输出到dist目录
    const result = await esbuild({
      entryPoints: [this.entryFilePath],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(this.distPath, 'index.js'),
      metafile: true,
      write: true,
      external: ['node:*'],
      // 启用生成类型声明文件
      tsconfig: path.join(this.cwdPath, 'tsconfig.json')
    });
    
    console.log('✅ JS文件构建完成');
    return result;
  }
  
  /**生成TypeScript类型声明文件*/
  private async generateTypeDeclarations(): Promise<void> {
    if (this.entryFilePath.endsWith('.ts') || this.entryFilePath.endsWith('.tsx')) {
      console.log('📝 处理TypeScript项目，需要生成类型声明文件');
      
      // 使用TypeScript编译器生成类型声明文件
      try {
        const { execSync } = await import('child_process');
        execSync(`npx tsc ${this.entryFilePath} --emitDeclarationOnly --outDir ${this.distPath}`, { stdio: 'inherit' });
        console.log('✅ TypeScript类型声明文件生成完成');
      } catch (error: any) {
        console.warn('⚠️ 类型声明文件生成失败:', error.message);
        // 即使类型声明生成失败，也继续执行后续步骤
      }
    }
  }
  
  /**分析并提取使用的依赖项 - 健壮的错误处理和依赖分析*/
  private extractUsedDependencies(result: BuildResult): { usedDeps: Record<string, string>, usedDevDeps: Record<string, string> } {
    const imported = new Set<string>();
    
    // 安全地检查metafile
    if (!result.metafile || !result.metafile.inputs) {
      console.warn('⚠️ 无法分析依赖关系：缺少metafile信息');
      return { usedDeps: {}, usedDevDeps: {} };
    }
    
    // 遍历所有输入文件提取依赖
    for (const key in result.metafile.inputs) {
      const segs = key.match(/node_modules[/\\](?:\.pnpm[/\\])?(?:@[^/\\]+[/\\][^/\\]+|[^/\\]+)/g);
      if (!segs) continue;
      
      for (const seg of segs) {
        const name = seg.includes('@')
          ? seg.split(/[/\\]/).slice(-2).join('/')
          : seg.split(/[/\\]/).pop();
        
        imported.add(name as any);
      }
    }

    const usedDeps: Record<string, string> = {};
    const usedDevDeps: Record<string, string> = {};
    
    for (const name of imported) {
      if (this.pkgJson.dependencies?.[name]) {
        usedDeps[name as any] = this.pkgJson.dependencies[name];
      } else if (this.pkgJson.devDependencies?.[name]) {
        usedDevDeps[name as any] = this.pkgJson.devDependencies[name];
      }
    }
    
    return { usedDeps, usedDevDeps };
  }
  
  /**初始化Git仓库 - 如果dist目录中尚未初始化git仓库，则自动创建*/
  private async initializeGitRepository(): Promise<void> {
    try {
      // 检查dist目录中是否已有.git文件夹
      const gitDirPath = path.join(this.distPath, '.git');
      
      if (!fs.existsSync(gitDirPath)) {
        console.log('\n🔄 初始化Git仓库...');
        const { execSync } = await import('child_process');
        
        // 执行git init命令
        execSync('git init', { cwd: this.distPath, stdio: 'inherit' });
        
        // 创建.gitignore文件
        const gitignoreContent = `# Logs\nlogs\n*.log\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\nlerna-debug.log*\n\nnode_modules\ndist\ndist-ssr\n*.local\n\n# Editor directories and files\n.vscode/*\n!.vscode/extensions.json\n.idea\n.DS_Store\n*.suo\n*.ntvs*\n*.njsproj\n*.sln\n*.sw?\n`;
        
        writeFileSync(path.join(this.distPath, '.gitignore'), gitignoreContent);
        
        // 添加初始提交
        execSync('git add .', { cwd: this.distPath, stdio: 'inherit' });
        execSync('git commit -m "Initial commit"', { cwd: this.distPath, stdio: 'inherit' });
        
        console.log('✅ Git仓库初始化完成');
      }
    } catch (error: any) {
      console.warn('⚠️ Git仓库初始化失败:', error.message);
      // 即使git初始化失败，也不中断整个构建流程
    }
  }
  
  /**生成并写入分发package.json - 精简实现*/
  private writeDistPackageJson(usedDeps: Record<string, string>, usedDevDeps: Record<string, string>): void {
      const distPkg: Record<string, any> = {
        name: this.pkgJson.name,
        version: this.pkgJson.version,
        description: this.pkgJson.description,
        keywords: this.pkgJson.keywords,
        author: this.pkgJson.author,
        license: this.pkgJson.license,
        repository: this.pkgJson.repository,
        main: 'index.js',
        module: 'index.js',
        types: 'index.d.ts',
        exports: {
          '.': {
            types: './index.d.ts',
            import: './index.js',
            require: './index.js',
          },
        },
        dependencies: usedDeps,
        devDependencies: usedDevDeps,
      };
      
      // 清理undefined值
      Object.keys(distPkg).forEach(key => {
        if (distPkg[key] === undefined) {
          delete distPkg[key];
        }
      });
    
    writeFileSync(this.distPackagePath, JSON.stringify(distPkg, null, 2));
    console.log('✅ package.json已生成');
  }
}

/**导分发包构建器类 - 供外部直接使用*/
export { DistPackageBuilder };

/**直接运行脚本时执行 - 优雅的错误处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const builder = new DistPackageBuilder();
  builder.build().catch((error) => {
    if (error instanceof Appexit) {
      console.error(`❌ 程序错误: ${error.message}`);
    } else if (error.message === 'user-cancelled') {
      console.log('👋 构建已取消');
    } else {
      console.error('❌ 构建过程中出现错误:', error.message);
    }
    // 不使用process.exit，让Node.js自然退出
  });
}