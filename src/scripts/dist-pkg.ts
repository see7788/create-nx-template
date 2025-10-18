#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { build as esbuild, BuildResult } from 'esbuild'
import path from 'path';
import { fileURLToPath } from 'url';
import fs from "fs"
import { ProjectTool } from "./tool.js";

/**分发包构建器类 - 采用流畅异步执行模式*/
class DistPackageBuilder {
  // 项目基本信息
  private readonly cwdPath: string;
  private readonly pkgJson: any;
  
  // 构建相关路径
  private entryName = '';
  private entryFilePath = '';
  private readonly distPath: string;
  private readonly distPackagePath: string;
  
  /**构造函数 - 初始化构建器*/
  constructor() {
    const projectInfo = new ProjectTool().getProjectInfo();
    this.pkgJson = projectInfo.pkgJson;
    this.cwdPath = projectInfo.cwdPath;
    this.distPath = path.join(this.cwdPath, "dist");
    this.distPackagePath = path.join(this.distPath, 'package.json');
  }
  
  /**执行完整的构建流程 - 流畅的异步执行流程*/
  public async build(): Promise<void> {
    try {
      // 连续的异步调用，专注于正常流程
      await this.findEntryFilePath();
      const buildResult = await this.buildJsFile();
      await this.generateTypeDeclarations();
      const { usedDeps, usedDevDeps } = this.extractUsedDependencies(buildResult);
      this.writeDistPackageJson(usedDeps, usedDevDeps);
      
      console.log('\n🎉 分发包构建完成！');
      console.log(`📦 输出目录: ${this.distPath}`);
    } catch (error: any) {
      // 统一的错误处理
      if (error.message === 'user-cancelled') {
        console.log('\n👋 构建已取消');
        return;
      }
      console.error(`\n❌ 构建失败: ${error.message}`);
      throw error;
    }
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
        throw new Error('user-cancelled');
      }
      
      this.entryName = response.entry;
    } else {
      throw new Error('未找到有效的入口文件');
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

/**分发包构建的入口函数 - 保持简洁接口*/
export default async function distpkg(): Promise<void> {
  const builder = new DistPackageBuilder();
  await builder.build();
}

/**直接运行脚本时执行 - 优雅的错误处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  distpkg().catch((error) => {
    console.error('❌ 构建过程中出现错误:', error.message);
    // 不使用process.exit，让Node.js自然退出
  });
}