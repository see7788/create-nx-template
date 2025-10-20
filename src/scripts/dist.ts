#!/usr/bin/env node
import * as fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LibBase, Appexit } from "./tool.js";
import { build as tsupBuild, Options } from 'tsup';
import { build as esbuild } from "esbuild"
export class DistPackageBuilder extends LibBase {
  //入口文件路径
  private entryFilePath!: string
  //产物目录名称
  private distDirName: string = "dist";
  private get distPath(): string {
    return path.join(this.cwdProjectInfo.cwdPath, this.distDirName);
  }

  constructor() {
    super();
  }


  /**执行构建工作流 - 编排各个业务步骤的具体执行*/
  async task1(): Promise<void> {
    // 编排业务流程的执行顺序
    console.log('\n🚀 开始抽取流程');

    console.log('📋 1. 交互定义dist目录名称');
    await this.askDistDirName();

    console.log('📋 2. 交互定义入口文件');
    await this.askEntryFilePath();

    // 执行核心构建操作
    // console.log('⚙️3. 抽取js');
    // await this.buildJsFile();
    console.log('⚙️3. 抽取相关依赖配置生成package.json');
    await this.createPackageJson();
    console.log('\n🚀 完成抽取流程');
  }

  /**询问用户设置输出目录名称 */
  private async askDistDirName(): Promise<void> {
    const prompts = await import('prompts');
    // 直接提供带默认值的输入框供用户编辑
    const response = await prompts.default({
      type: 'text',
      name: 'distName',
      message: '请输入输出目录名称 (可直接回车使用默认值)',
      initial: this.distDirName,
      validate: (value: string) => {
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
  /**查找项目入口文件 - 异步模式，使用异常处理错误情况*/
  private async askEntryFilePath(): Promise<void> {
    // 使用当前执行命令时的工作目录
    const currentCwd = this.cwdProjectInfo.cwdPath
    console.log(`[DEBUG] 当前工作目录: ${currentCwd}`, process.argv);

    // 读取当前目录内的文件，过滤保留特定扩展名的文件
    const list = fs.readdirSync(currentCwd, { withFileTypes: true })
      .filter((dirent: fs.Dirent) => dirent.isFile() && /\.(js|jsx|ts|tsx|cjs|mjs)$/i.test(dirent.name))
      .map((dirent: fs.Dirent) => dirent.name);

    if (list.length > 0) {
      // 简单按文件名排序
      list.sort((a, b) => a.localeCompare(b));

      // 默认选择第一个文件
      const defaultIndex = 0;

      // 使用prompts让用户选择
      const prompts = await import('prompts');
      const response = await prompts.default({
        type: 'select',
        name: 'entryFile',
        message: '请选择入口文件',
        choices: list.map((file, index) => ({
          title: file,
          value: file
        })),
        initial: defaultIndex
      });

      // 用户取消操作
      if (response.entryFile === undefined) {
        const error = new Error('user-cancelled');
        throw error;
      }

      // 设置完整的入口文件路径
      this.entryFilePath = path.join(currentCwd, response.entryFile);
      console.log(`✅ 已选择入口文件: ${response.entryFile}`);
    } else {
      throw new Appexit('未找到有效的入口文件');
    }
  }

  /**构建JS文件和类型定义 - 使用tsup构建系统*/
  private async buildJsFile() {
    // 创建输出目录
    fs.mkdirSync(this.distPath, { recursive: true });

    console.log(`[DEBUG] 构建前再次检查入口文件`);
    console.log(`[DEBUG] 入口文件名: ${path.basename(this.entryFilePath)}`);
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
      entry: [path.basename(this.entryFilePath)],
      outDir: this.distPath,
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: ['esm'],
      sourcemap: true,
      dts: true,
      external: ['node:*'],
      metafile: true,
      clean: true,
    };
    try {
      console.log(`[DEBUG] 开始使用tsup构建，入口文件路径: ${this.entryFilePath}`);
      await tsupBuild(buildOptions);
    } catch (error) {
      // 保留原始错误信息并添加来源标识
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Appexit(`[DEBUG] 构建错误来源: tsup工具\n原始错误: ${errorMessage}`);
    }
  }

  /**分析并提取使用的依赖项 - 结合tsup构建过程 */
  private async createPackageJson() {

    const result = await esbuild({
      entryPoints: [this.entryFilePath],
      bundle: true,
      platform: 'node',
      target: 'node18',
      metafile: true,
      write: false,
      external: ['node:*'],
    })

    const imported = new Set<string>()
    for (const key in result.metafile.inputs) {
      const segs = key.match(/node_modules[/\\](?:\.pnpm[/\\])?(?:@[^/\\]+[/\\][^/\\]+|[^/\\]+)/g)
      if (!segs) continue
      for (const seg of segs) {
        imported.add(seg)
      }
    }
    const rootPkg = this.cwdProjectInfo.pkgJson
    const usedDeps:Record<string,string> = {}
    const usedDevDeps:Record<string,string> = {}
    for (const name of imported) {
      if (rootPkg.dependencies?.[name]) {
        usedDeps[name] = rootPkg.dependencies[name]
      } else if (rootPkg.devDependencies?.[name]) {
        usedDevDeps[name] = rootPkg.devDependencies[name]
      }
    }
    console.log('used deps:', usedDeps)
    console.log('used dev deps:', usedDevDeps)

    const distPkg = {
      name: rootPkg.name,
      version: rootPkg.version,
      description: rootPkg.description,
      keywords: rootPkg.keywords,
      author: rootPkg.author,
      license: rootPkg.license,
      repository: rootPkg.repository,
      main: './index.js',
      module: './index.js',
      types: './index.d.ts',
      exports: {
        '.': {
          types: './index.d.ts',
          import: './index.js',
          require: './index.js',
        },
      },
      dependencies: usedDeps,
      devDependencies: usedDevDeps,
    }

    fs.mkdirSync(this.distPath, { recursive: true })
    fs.writeFileSync(path.join(this.distPath,"package.json"), JSON.stringify(distPkg, null, 2))
  }
}


/**直接运行脚本时执行 - 优雅的错误处理*/
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  new DistPackageBuilder().task1();
}