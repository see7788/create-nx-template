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
    // 使用normalize确保路径格式正确，避免出现双斜杠等问题
    return path.normalize(path.join(this.cwdProjectInfo.cwdPath, this.entryName));
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
    console.log(`[DEBUG] 当前工作目录: ${this.cwdProjectInfo.cwdPath}`);

    // 按优先顺序查找标准入口文件
    const availableFiles = [
      'index.ts',
      'index.tsx',
      'index.js',
      'index.jsx',
    ]
      .filter(file => {
        const fullPath = path.join(this.cwdProjectInfo.cwdPath, file);
        const exists = fs.existsSync(fullPath);
        console.log(`[DEBUG] 检查标准入口文件: ${fullPath}, 存在: ${exists}`);
        return exists;
      });

    console.log(`[DEBUG] 找到的标准入口文件: ${JSON.stringify(availableFiles)}`);

    // 找到单个标准入口文件，直接使用
    if (availableFiles.length === 1) {
      this.entryName = availableFiles[0];
    } else {
      const currentDirFiles = fs.readdirSync(this.cwdProjectInfo.cwdPath, { withFileTypes: true })
        .filter(dirent => dirent.isFile() && /\.(js|jsx|ts|tsx)$/i.test(dirent.name))
        .map(dirent => dirent.name)
        .sort();

      console.log(`[DEBUG] 当前目录下的JS/TS文件: ${JSON.stringify(currentDirFiles)}`);

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

    console.log(`[DEBUG] 选中的入口文件名: ${this.entryName}`);
    console.log(`[DEBUG] 完整入口文件路径: ${this.entryFilePath}`);

    // 最后验证选中的入口文件确实存在（防止竞态条件）
    if (!fs.existsSync(this.entryFilePath)) {
      // 使用与tsup工具一致的错误格式，便于用户理解
      throw new Appexit(`Cannot find ${this.entryFilePath}`);
    }
    console.log(`🔍 找到入口文件: ${this.entryFilePath}`);
  }

  /**构建JS文件和类型定义 - 使用tsup构建系统*/
  private async buildJsFile(): Promise<{ metafile: any }> {
    // 创建输出目录
    mkdirSync(this.distPath, { recursive: true });

    console.log(`[DEBUG] 构建前再次检查入口文件`);
    console.log(`[DEBUG] 入口文件名: ${this.entryName}`);
    console.log(`[DEBUG] 入口文件路径: ${this.entryFilePath}`);
    console.log(`[DEBUG] 文件是否存在: ${fs.existsSync(this.entryFilePath)}`);

    // 再次验证入口文件存在性，防止竞态条件或路径解析问题
    if (!fs.existsSync(this.entryFilePath)) {
      // 使用与tsup工具一致的错误格式，便于用户理解
      throw new Appexit(`Cannot find ${this.entryFilePath}`);
    }

    // 构建配置 - 使用tsup简化构建流程
    const buildOptions: Options = {
      // 使用相对路径作为入口，避免tsup的路径解析问题
      entry: [this.entryName],
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
      metafile: true,
      // 清理输出目录
      clean: true,
      // 移除write属性，tsup不支持此选项
    };

    // 只有当tsconfig.json存在时才添加tsconfig配置
    const tsConfigPath = path.join(this.cwdProjectInfo.cwdPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      buildOptions.tsconfig = tsConfigPath;
    }

    try {
      console.log(`[DEBUG] 开始使用tsup构建，入口文件路径: ${this.entryFilePath}`);
      
      // 使用tsup API模式
      // 注意：根据tsup的API设计，metafile信息可能不会直接在返回值中提供
      await tsupBuild(buildOptions);
      console.log(`[DEBUG] tsup构建成功完成`);
      
      // 由于tsup API的限制，我们将使用静态分析作为主要的依赖检测方法
      // 这是更可靠的方式来分析项目依赖
      console.log(`[DEBUG] 将使用静态分析方法分析依赖关系`);
      
      return { metafile: null };
    } catch (error) {
      // 保留原始错误信息并添加来源标识
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Appexit(`[DEBUG] 构建错误来源: tsup工具\n原始错误: ${errorMessage}`);
    } finally {
      // 构建完成提示
      console.log('✅ JS文件和类型定义构建完成');
    }
  }

  /**分析并提取使用的依赖项 - 健壮的错误处理和依赖分析*/
  private async extractUsedDependencies(result: { metafile: any }) {
    const imported = new Set<string>();
    console.log('[DEBUG] 开始分析项目依赖');

    // 安全地检查metafile
    if (!result.metafile || !result.metafile.inputs) {
      console.warn('⚠️ 无法通过metafile分析依赖关系');
      console.log('[DEBUG] 使用静态分析作为替代方案');
      
      try {
        // 读取入口文件内容进行简单的静态分析
        const entryContent = fs.readFileSync(this.entryFilePath, 'utf-8');
        
        // 提取import语句中的包名
        const importRegex = /from\s+['"]((?:@[^/]+[/])?[^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(entryContent)) !== null) {
          const depName = match[1];
          // 只添加非相对路径的依赖（相对路径是项目内部文件）
          if (!depName.startsWith('./') && !depName.startsWith('../')) {
            imported.add(depName);
          }
        }
        console.log(`[DEBUG] 静态分析找到${imported.size}个依赖`);
      } catch (error) {
        console.error('❌ 静态分析失败:', error instanceof Error ? error.message : String(error));
        // 如果静态分析也失败，就从原始package.json中复制所有依赖
        console.log('[DEBUG] 静态分析失败，将从原始package.json复制所有依赖');
      }
    } else {
      // 如果有metafile信息，则使用它进行精确的依赖分析
      console.log('[DEBUG] 使用metafile信息进行精确依赖分析');
      
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
      console.log(`[DEBUG] metafile分析找到${imported.size}个依赖`);
    }
    const srcJson = this.cwdProjectInfo.pkgJson;
    const usedDeps: Record<string, string> = {};
    const usedDevDeps: Record<string, string> = {};
    
    // 处理依赖收集逻辑
    if (imported.size > 0) {
      console.log(`[DEBUG] 根据分析结果只包含使用的${imported.size}个依赖`);
      
      // 从原始package.json中查找并添加使用的依赖
      for (const name of imported) {
        if (srcJson.dependencies?.[name]) {
          usedDeps[name] = srcJson.dependencies[name];
        } else if (srcJson.devDependencies?.[name]) {
          usedDevDeps[name] = srcJson.devDependencies[name];
        } else {
          console.log(`[DEBUG] 警告: 依赖 ${name} 在项目package.json中未找到`);
        }
      }
    } else {
      // 如果没有找到任何依赖，从原始package.json复制所有依赖
      console.warn('⚠️ 没有分析到任何依赖，将包含原始package.json中的所有依赖');
      if (srcJson.dependencies) {
        Object.assign(usedDeps, srcJson.dependencies);
      }
      if (srcJson.devDependencies) {
        Object.assign(usedDevDeps, srcJson.devDependencies);
      }
    }
    
    // 创建输出的package.json内容
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
    console.log(`✅ package.json已生成，包含${Object.keys(usedDeps).length}个依赖和${Object.keys(usedDevDeps).length}个开发依赖`);
  }


}

/**导分发包构建器类 - 供外部直接使用*/
export { DistPackageBuilder };

/**直接运行脚本时执行 - 优雅的错误处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new DistPackageBuilder().task1();
}