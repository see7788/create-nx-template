#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'path';
import { fileURLToPath } from 'url';
import fs from "fs"
import { LibBase, Appexit } from "./tool.js";
import { build as tsupBuild, Options } from 'tsup';
import prompts from 'prompts';

class DistPackageBuilder extends LibBase {
  /**产物目录名称 */
  private distDirName: string = "dist";
  private entryName = '';

  private get entryFilePath(): string {
    return path.join(this.cwdProjectInfo.cwdPath, this.entryName);
  }


  private get distPath(): string {
    return path.join(this.cwdProjectInfo.cwdPath, this.distDirName);
  }

  constructor() {
    super();
  }

  /**询问用户设置输出目录名称 */
  private async askForDistName(): Promise<void> {

    // 直接提供带默认值的输入框供用户编辑
    const response = await prompts({
      type: 'text',
      name: 'distName',
      message: '请输入输出目录名称 (可直接回车使用默认值)',
      initial: this.distDirName,
      validate: (value) => {
        // 验证目录名是否合法（不包含特殊字符）
        const validNameRegex = /^[a-zA-Z0-9-_]+$/;
        if (!value.trim()) return '目录名不能为空';
        if (!validNameRegex.test(value.trim())) return '目录名只能包含字母、数字、- 和 _';
        return true;
      }
    });

    // 用户取消操作
    if (response.distName === undefined) {
      const error = new Error('user-cancelled');
      throw error;
    }

    // 更新目录名称
    this.distDirName = response.distName.trim();
    console.log(`📁 输出目录已设置为: ${this.distPath}`);
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

    // 按优先顺序查找标准入口文件
    const availableFiles = [
      'index.ts',
      'index.tsx',
      'index.js',
      'index.jsx',
    ]
      .filter(file => fs.existsSync(path.join(this.cwdProjectInfo.cwdPath, file)));

    // 找到单个标准入口文件，直接使用
    if (availableFiles.length === 1) {
      this.entryName = availableFiles[0];
    } else {
      const currentDirFiles = fs.readdirSync(this.cwdProjectInfo.cwdPath, { withFileTypes: true })
        .filter(dirent => dirent.isFile() && /\.(js|jsx|ts|tsx)$/i.test(dirent.name))
        .map(dirent => dirent.name)
        .sort();

      if (currentDirFiles.length === 0) {
        throw new Appexit('当前目录下没有找到任何 JavaScript 或 TypeScript 文件');
      }

      const choices = currentDirFiles.map(file => ({
        title: file,
        value: file,
        description: path.join(this.cwdProjectInfo.cwdPath, file),
      }));
      // 显示交互式选择菜单，让用户从准备好的文件列表中选择入口文件
      const response = await prompts({
        type: 'select',
        name: 'entry',
        message: '请选择入口文件',
        choices,
      });
      // 处理用户取消选择的情况 - 抛出特殊错误以标记正常退出
      if (!response.entry) {
        // 用户取消不是错误，而是通过消息标记正常退出
        const error = new Error('user-cancelled');
        throw error;
      }

      this.entryName = response.entry;
    }

    // 最后验证选中的入口文件确实存在（防止竞态条件）
    if (!fs.existsSync(this.entryFilePath)) {
      throw new Appexit(`入口文件不存在: ${this.entryFilePath}`);
    }
    console.log(`🔍 找到入口文件: ${this.entryFilePath}`);
  }

  /**构建JS文件和类型定义 - 使用tsup构建系统*/
  private async buildJsFile(): Promise<{ metafile: any }> {
    // 创建输出目录
    mkdirSync(this.distPath, { recursive: true });

    // 再次验证入口文件存在性，防止竞态条件或路径解析问题
    if (!fs.existsSync(this.entryFilePath)) {
      throw new Appexit(`构建时无法找到入口文件: ${this.entryFilePath}。请确保文件路径正确且文件存在。`);
    }

    // 构建配置 - 使用tsup简化构建流程
    const buildOptions: Options = {
      entry: [this.entryFilePath],
      outDir: this.distPath,
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: ['cjs'] as const,
      sourcemap: true,
      // 自动生成类型定义
      dts: true,
      // 排除Node.js核心模块
      external: ['node:*'],
      // 生成metafile用于依赖分析
      metafile: true
    };

    // 只有当tsconfig.json存在时才添加tsconfig配置
    const tsConfigPath = path.join(this.cwdProjectInfo.cwdPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      buildOptions.tsconfig = tsConfigPath;
    }

    // 使用tsup构建
    await tsupBuild(buildOptions);

    // 手动读取生成的文件来检查
    console.log('✅ JS文件和类型定义构建完成');
    return { metafile: {} }; // 暂时返回空对象，依赖分析逻辑需要调整
  }

  /**分析并提取使用的依赖项 - 健壮的错误处理和依赖分析*/
  private async extractUsedDependencies(result: { metafile: any }) {
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


}

/**导分发包构建器类 - 供外部直接使用*/
export { DistPackageBuilder };

/**直接运行脚本时执行 - 优雅的错误处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new DistPackageBuilder().task1();
}