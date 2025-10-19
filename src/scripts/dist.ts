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
   * 简化的类型定义生成方法
   * 直接使用tsc命令生成类型定义，失败时给出明确错误并提供简单兜底
   */
  private async generateTypeDefinition(): Promise<void> {
    try {
      console.log(`📄 正在使用tsc从 ${this.entryFilePath} 生成类型定义...`);
      
      // 构建tsc命令
      const tscCommand = `tsc --declaration --emitDeclarationOnly --outDir ${this.distPath} ${this.entryFilePath} --esModuleInterop --allowSyntheticDefaultImports --target es2020 --moduleResolution node --noImplicitAny`;
      
      // 执行tsc命令
      const { execSync } = await import('child_process');
      execSync(tscCommand, { stdio: 'inherit' });
      
      // 检查是否生成了.d.ts文件
      const dtsFiles = fs.readdirSync(this.distPath).filter(file => file.endsWith('.d.ts'));
      
      if (dtsFiles.length > 0) {
        // 重命名第一个生成的.d.ts文件为index.d.ts
        const firstDtsFile = dtsFiles[0];
        const oldPath = path.join(this.distPath, firstDtsFile);
        const newPath = path.join(this.distPath, 'index.d.ts');
        
        if (firstDtsFile !== 'index.d.ts') {
          fs.renameSync(oldPath, newPath);
          console.log(`✅ 已将${firstDtsFile}复制为index.d.ts`);
        } else {
          console.log('✅ tsc已成功生成index.d.ts文件');
        }
      } else {
        console.log('❌ tsc生成类型定义失败: 未生成任何.d.ts文件');
        // 仅在失败时创建最基本的类型定义文件
        this.createSimpleTypeDefinition();
      }
    } catch (error: any) {
      console.error('❌ 类型定义生成失败:', error.message);
      // 创建简单类型定义作为最终兜底
      this.createSimpleTypeDefinition();
    }
  }
  
  /**
   * 创建简单的类型定义文件
   * 只作为tsc命令失败时的简单兜底
   */
  private createSimpleTypeDefinition(): void {
    try {
      const sourceContent = fs.readFileSync(this.entryFilePath, 'utf8');
      const hasDefaultExport = /export\s+default\s+/.test(sourceContent);
      const namedExports = [];
      
      // 简单提取命名导出
      const exportDeclarations = sourceContent.match(/export\s+(?:const|let|var|function|class|interface|type|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g) || [];
      for (const decl of exportDeclarations) {
        const match = decl.match(/export\s+(?:const|let|var|function|class|interface|type|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        if (match && match[1]) {
          namedExports.push(match[1]);
        }
      }
      
      // 生成简单类型定义
      let dtsContent = `/**
 * ${this.distDirName} - 基本类型定义
 */

declare module '${this.distDirName}' {\n`;
      
      // 添加命名导出
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
      console.log('⚠️ 已创建基本类型定义作为替代方案');
    } catch (error: any) {
      console.error('❌ 创建基本类型定义失败:', error.message);
      // 最后兜底：使用最基本的类型定义
      this.createFallbackTypeDefinition();
    }
  }
  
  /**
   * 创建最基本的回退类型定义文件
   * 仅在所有其他方法都失败时使用
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