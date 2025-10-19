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

    // 询问用户是否更改默认dist名称，使用select类型提供选项
    const response = await prompts({
      type: 'select',
      name: 'action',
      message: '请选择输出目录名称操作',
      choices: [
        { title: '使用默认目录名称 (dist)', value: 'default' },
        { title: '自定义目录名称', value: 'custom' }
      ],
      initial: 0
    });

    // 用户取消操作
    if (response.action === undefined) {
      const error = new Error('user-cancelled');
      throw error;
    }

    // 如果用户选择自定义目录名称
    if (response.action === 'custom') {
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
      // 使用默认目录名称
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

  /**构建JS文件和类型定义 - 使用esbuild和更成熟的类型生成方案*/
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
   * 使用tsc直接生成类型定义文件
   * 采用更成熟的方法，确保生成高质量的类型定义
   */
  private async generateTypeDefinition(): Promise<void> {
    try {
      // 首先尝试使用TypeScript编译器直接生成类型定义
      console.log(`📄 正在使用tsc从 ${this.entryFilePath} 生成类型定义...`);
      
      // 使用子进程运行tsc命令
      const { execSync } = await import('child_process');
      const tsConfigPath = path.join(this.cwdProjectInfo.cwdPath, 'tsconfig.json');
      
      // 构建tsc命令
      let tscCommand = `tsc --declaration --emitDeclarationOnly --outDir ${this.distPath} --skipLibCheck`;
      
      // 如果存在tsconfig.json，则使用它
      if (fs.existsSync(tsConfigPath)) {
        tscCommand += ` --project ${tsConfigPath}`;
      }
      
      // 添加源文件路径
      tscCommand += ` ${this.entryFilePath}`;
      
      // 执行tsc命令
      execSync(tscCommand, { stdio: 'inherit' });
      
      // 检查是否生成了类型定义文件
      const generatedDtsPath = path.join(this.distPath, path.basename(this.entryFilePath).replace(/\.(ts|tsx)$/, '.d.ts'));
      
      if (fs.existsSync(generatedDtsPath)) {
        // 读取生成的类型定义内容
        const dtsContent = fs.readFileSync(generatedDtsPath, 'utf8');
        
        // 如果生成的文件名不是index.d.ts，重命名它
        const indexDtsPath = path.join(this.distPath, 'index.d.ts');
        if (generatedDtsPath !== indexDtsPath) {
          writeFileSync(indexDtsPath, dtsContent);
          // 可选：删除原文件
          if (fs.existsSync(generatedDtsPath)) {
            fs.unlinkSync(generatedDtsPath);
          }
        }
        
        console.log('✅ 使用tsc成功生成高质量类型定义文件(.d.ts)');
        console.log(`📊 类型定义内容长度: ${dtsContent.length} 字符`);
        // 输出前几行内容作为预览
        const preview = dtsContent.split('\n').slice(0, 5).join('\n');
        console.log(`📋 类型定义预览:\n${preview}...`);
        return;
      }
      
      throw new Error('tsc未生成类型定义文件');
    } catch (error: any) {
      console.warn('⚠️ tsc生成类型定义失败:', error.message);
      
      // 回退到使用TypeScript API的方法
      try {
        console.log('ℹ️ 尝试使用TypeScript API生成类型定义');
        await this.generateTypeDefinitionWithApi();
      } catch (secondaryError) {
        console.warn('⚠️ TypeScript API生成类型失败，使用源文件分析');
        this.generateTypeFromSource();
      }
    }
  }
  
  /**
   * 使用TypeScript官方API作为备用方案生成类型定义
   */
  private async generateTypeDefinitionWithApi(): Promise<void> {
    const ts = await import('typescript');
    
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
      strict: true,
      outDir: this.distPath,
      rootDir: path.dirname(this.entryFilePath)
    };
    
    // 如果存在tsconfig.json，则尝试读取它
    if (fs.existsSync(tsConfigPath)) {
      try {
        const tsConfigContent = JSON.parse(fs.readFileSync(tsConfigPath, 'utf8'));
        if (tsConfigContent.compilerOptions) {
          compilerOptions = {
            ...tsConfigContent.compilerOptions,
            declaration: true,
            emitDeclarationOnly: true,
            outDir: this.distPath,
            rootDir: path.dirname(this.entryFilePath)
          };
        }
      } catch (e) {
        console.warn('⚠️ 无法读取tsconfig.json，使用默认配置');
      }
    }
    
    // 创建编译程序
    const program = ts.createProgram([this.entryFilePath], compilerOptions);
    
    // 直接编译，不指定特定源文件（让TypeScript自动处理依赖）
     const emitResult = program.emit();
    
    // 检查是否有错误
    const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
    const errors = allDiagnostics.filter(diagnostic => 
      diagnostic.category === ts.DiagnosticCategory.Error
    );
    
    if (errors.length > 0) {
      throw new Error(`TypeScript API编译错误: ${errors.length}个错误`);
    }
    
    // 确保生成了index.d.ts文件
    const indexDtsPath = path.join(this.distPath, 'index.d.ts');
    if (!fs.existsSync(indexDtsPath)) {
      // 如果没有生成index.d.ts，尝试查找其他.d.ts文件并复制
      const dtsFiles = fs.readdirSync(this.distPath).filter(file => file.endsWith('.d.ts'));
      if (dtsFiles.length > 0) {
        const firstDtsFile = dtsFiles[0];
        const dtsContent = fs.readFileSync(path.join(this.distPath, firstDtsFile), 'utf8');
        writeFileSync(indexDtsPath, dtsContent);
        console.log(`✅ 已将${firstDtsFile}复制为index.d.ts`);
      } else {
        throw new Error('TypeScript API未生成任何.d.ts文件');
      }
    } else {
      console.log('✅ 使用TypeScript API成功生成类型定义文件');
    }
  }
  
  /**
   * 直接从源文件分析导出内容并生成类型定义
   * 作为TypeScript API失败时的中间回退方案
   */
  private generateTypeFromSource(): void {
    try {
      console.log(`📝 正在分析源文件: ${this.entryFilePath}`);
      const sourceContent = fs.readFileSync(this.entryFilePath, 'utf8');
      
      // 检查是否有默认导出
      const hasDefaultExport = /export\s+default\s+/.test(sourceContent);
      
      // 检查是否有命名导出
      const namedExports = [];
      const exportDeclarations = sourceContent.match(/export\s+(?:const|let|var|function|class|interface|type|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g) || [];
      for (const decl of exportDeclarations) {
        const match = decl.match(/export\s+(?:const|let|var|function|class|interface|type|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        if (match && match[1]) {
          namedExports.push(match[1]);
        }
      }
      
      // 检查是否有导出声明
      const exportFromDeclarations = sourceContent.match(/export\s+(?:\*|(?:\{[^}]*\}))\s+from\s+['"][^'"]+['"]/g) || [];
      
      console.log(`📊 源文件分析结果:`);
      console.log(`- 默认导出: ${hasDefaultExport ? '是' : '否'}`);
      console.log(`- 命名导出: ${namedExports.length} 个`);
      console.log(`- 重导出声明: ${exportFromDeclarations.length} 个`);
      
      // 生成更详细的类型定义
      let dtsContent = `/**
 * ${this.distDirName} - 基于源代码分析生成的类型定义
 */

declare module '${this.distDirName}' {\n`;
      
      // 添加命名导出的类型声明
      for (const name of namedExports) {
        dtsContent += `  export const ${name}: any;\n`;
      }
      
      // 添加默认导出
      if (hasDefaultExport) {
        dtsContent += `  export default any;\n`;
      }
      
      dtsContent += `}\n`;
      
      // 写入类型定义文件
      const dtsFilePath = path.join(this.distPath, 'index.d.ts');
      writeFileSync(dtsFilePath, dtsContent);
      console.log('✅ 基于源文件分析生成类型定义成功');
    } catch (error: any) {
      console.error('❌ 源文件分析生成类型失败:', error.message);
      throw error;
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