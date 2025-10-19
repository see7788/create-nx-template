#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { build as esbuild, Metafile } from 'esbuild'
import path from 'path';
import { fileURLToPath } from 'url';
import fs from "fs"
import { LibBase, Appexit } from "./tool.js";

class DistPackageBuilder extends LibBase {
  private entryName = '';

  /**产物目录名称 */
  private distDirName: string = "dist";

  private get entryFilePath(): string {
    return path.join(this.cwdProjectInfo.cwdPath, this.entryName);
  }


  private get distPath(): string {
    return path.join(this.cwdProjectInfo.cwdPath, this.distDirName);
  }

  constructor() {
    super();
  }

  /**询问用户是否修改默认dist目录名称 */
  private async askForDistName(): Promise<void> {
    const prompts = (await import('prompts')).default;

    // 询问用户是否更改默认dist名称
    const response = await prompts({
      type: 'confirm',
      name: 'changeDist',
      message: '是否要更改默认的输出目录名称（默认为"dist"）?',
      initial: false
    });

    // 用户取消操作
    if (response.changeDist === undefined) {
      const error = new Error('user-cancelled');
      throw error;
    }

    // 如果用户选择更改，询问新的目录名称
    if (response.changeDist) {
      const nameResponse = await prompts({
        type: 'text',
        name: 'distName',
        message: '请输入新的输出目录名称',
        initial: 'dist',
        validate: (value) => {
          // 验证目录名是否合法（不包含特殊字符）
          const validNameRegex = /^[a-zA-Z0-9-_]+$/;
          if (!value.trim()) return '目录名不能为空';
          if (!validNameRegex.test(value.trim())) return '目录名只能包含字母、数字、- 和 _';
          return true;
        }
      });

      // 用户取消操作
      if (nameResponse.distName === undefined) {
        const error = new Error('user-cancelled');
        throw error;
      }

      // 更新目录名称
      this.distDirName = nameResponse.distName.trim();
      console.log(`📁 输出目录已设置为: ${this.distPath}`);
    } else {
      console.log(`📁 使用默认输出目录: ${this.distPath}`);
    }
  }

  /**执行构建工作流 - 编排各个业务步骤的具体执行*/
  async task1(): Promise<void> {
    // 编排业务流程的执行顺序
    console.log('\n🚀 开始抽取流程');

    console.log('📋 1. 交互定义dist目录名称');
    await this.askForDistName();

    console.log('📋 2. 交互定义入口文件');
    await this.findEntryFilePath();

    // 执行核心构建操作
    console.log('⚙️3. 抽取js');
    const buildResult = await this.buildJsFile();
    console.log('⚙️3. 抽取相关依赖配置生成package.json');
    await this.extractUsedDependencies(buildResult);
    console.log('\n🚀 完成抽取流程');
  }

  /**查找项目入口文件 - 异步模式，使用异常处理错误情况*/
  private async findEntryFilePath(): Promise<void> {
    const availableFiles = [
      'index.ts',
      'index.tsx',
      'index.js',
      'index.jsx',
    ]
      .map(file => ({ file, fullPath: path.join(this.cwdProjectInfo.cwdPath, file) }))
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

    console.log(`🔍 找到入口文件: ${this.entryFilePath}`);
  }

  /**构建JS文件 - 使用esbuild进行单文件打包*/
  private async buildJsFile(): Promise<{ metafile: Metafile }> {
    // 创建输出目录
    mkdirSync(this.distPath, { recursive: true });

    // 构建JS文件并输出到dist目录 - 仅针对单个入口文件及其依赖
    const buildOptions = {
      entryPoints: [this.entryFilePath],
      bundle: true,
      platform: 'node' as const,
      target: 'node18',
      outfile: path.join(this.distPath, 'index.js'),
      metafile: true,
      write: true,
      external: ['node:*'],
      // 启用sourcemap以便更好地调试
      sourcemap: true
    };

    // 只有当tsconfig.json存在时才添加tsconfig配置
    const tsConfigPath = path.join(this.cwdProjectInfo.cwdPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      (buildOptions as any).tsconfig = tsConfigPath;
    }

    const result = await esbuild(buildOptions);

    // 为TypeScript文件生成类型定义文件
    if (this.entryFilePath.endsWith('.ts') || this.entryFilePath.endsWith('.tsx')) {
      await this.generateTypeDefinition();
    }

    console.log('✅ JS文件构建完成');
    return { metafile: result.metafile || {} as Metafile };
  }

  /**分析并提取使用的依赖项 - 健壮的错误处理和依赖分析*/
  private async extractUsedDependencies(result: { metafile: Metafile }) {
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
    const srcJson = this.cwdProjectInfo.pkgJson;
    const usedDeps: Record<string, string> = {};
    const usedDevDeps: Record<string, string> = {};

    for (const name of imported) {
      if (srcJson.dependencies?.[name]) {
        usedDeps[name as any] = srcJson.dependencies[name];
      } else if (srcJson.devDependencies?.[name]) {
        usedDevDeps[name as any] = srcJson.devDependencies[name];
      }
    }
    const distPkg: Record<string, any> = {
      // 始终使用distDirName作为包名
      name: this.distDirName,
      version: srcJson.version,
      description: srcJson.description,
      keywords: srcJson.keywords,
      author: srcJson.author,
      license: srcJson.license,
      repository: srcJson.repository,
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

    writeFileSync(path.join(this.distPath, "package.json"), JSON.stringify(distPkg, null, 2));
    console.log('✅ package.json已生成');
  }
    
  /**
   * 使用TypeScript官方API生成类型定义文件
   * 不使用子进程或手搓方式，确保标准性和可靠性
   */
  private async generateTypeDefinition(): Promise<void> {
    try {
      // 导入TypeScript模块
      const ts = await import('typescript');
      
      // 检查TypeScript是否可用
      if (!ts) {
        throw new Error('TypeScript模块不可用');
      }
      
      // 获取或创建tsconfig配置
      const tsConfigPath = path.join(this.cwdProjectInfo.cwdPath, 'tsconfig.json');
      let compilerOptions: any = {
        declaration: true,
        emitDeclarationOnly: true,
        skipLibCheck: true,
        esModuleInterop: true,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        allowSyntheticDefaultImports: true,
        strict: true
      };
      
      // 如果存在tsconfig.json，则尝试读取它
      if (fs.existsSync(tsConfigPath)) {
        try {
          const tsConfigContent = JSON.parse(fs.readFileSync(tsConfigPath, 'utf8'));
          if (tsConfigContent.compilerOptions) {
            // 合并配置，但确保必要的选项
            compilerOptions = {
              ...tsConfigContent.compilerOptions,
              declaration: true,
              emitDeclarationOnly: true
            };
          }
        } catch (e) {
          console.warn('⚠️ 无法读取tsconfig.json，使用默认配置');
        }
      }
      
      // 为单文件生成类型定义
      const tempDir = path.join(this.distPath, '.temp-types');
      mkdirSync(tempDir, { recursive: true });
      
      // 创建编译程序主机
      const compilerHost = ts.createCompilerHost(compilerOptions);
      
      // 重写写入文件方法，以便我们可以自定义输出处理
      let generatedDtsContent: string | null = null;
      
      compilerHost.writeFile = (fileName: string, content: string) => {
        if (fileName.endsWith('.d.ts')) {
          generatedDtsContent = content;
        }
      };
      
      // 创建程序并编译
      const program = ts.createProgram([this.entryFilePath], compilerOptions, compilerHost);
      const emitResult = program.emit();
      
      // 检查编译错误
      const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
      
      if (allDiagnostics.length > 0) {
        const errors = allDiagnostics
          .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
          .map(diagnostic => {
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            if (diagnostic.file && diagnostic.start !== undefined) {
              const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
              return `${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`;
            }
            return message;
          });
        
        if (errors.length > 0) {
          throw new Error(`TypeScript编译错误:\n${errors.join('\n')}`);
        }
      }
      
      // 如果成功生成了类型定义内容
      if (generatedDtsContent) {
        // 确保类型定义正确指向我们的包
        const dtsFilePath = path.join(this.distPath, 'index.d.ts');
        writeFileSync(dtsFilePath, generatedDtsContent);
        console.log('✅ 使用TypeScript官方API生成类型定义文件(.d.ts)成功');
      } else {
        throw new Error('未能通过TypeScript API生成类型定义内容');
      }
    } catch (error: any) {
      console.warn('⚠️ TypeScript官方API生成类型定义失败:', error.message);
      
      // 直接使用回退方案生成类型定义
      console.log('ℹ️ 使用标准回退方案生成类型定义');
      this.createFallbackTypeDefinition();
    } finally {
      // 清理临时目录
      try {
        const tempDir = path.join(this.distPath, '.temp-types');
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        console.warn('⚠️ 清理临时文件时出错:', cleanupError);
      }
    }
  }
  
  /**
   * 创建标准的回退类型定义文件
   * 确保类型定义符合CommonJS和ES模块规范
   */
  private createFallbackTypeDefinition(): void {
    const fallbackDts = `/**
 * ${this.distDirName} - 标准回退类型定义
 */

// 同时支持ESM和CommonJS导入

declare module '${this.distDirName}' {
  /**
   * 模块主入口导出
   */
  const mainExport: any;
  
  // ES模块导出
  export default mainExport;
  
  // CommonJS导出
  export = mainExport;
}`;
    
    writeFileSync(path.join(this.distPath, 'index.d.ts'), fallbackDts);
    console.log('✅ 已创建标准回退类型定义文件');
  }
}

/**导分发包构建器类 - 供外部直接使用*/
export { DistPackageBuilder };

/**直接运行脚本时执行 - 优雅的错误处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new DistPackageBuilder().task1();
}