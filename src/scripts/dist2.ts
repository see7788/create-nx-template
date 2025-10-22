// scripts/extract-preload.ts
import { Project, SyntaxKind, SourceFile } from "ts-morph";
import path from 'path';
import type { PackageJson } from 'type-fest';
import fs from "fs"
import LibBase, { Appexit } from "./tool.js";
import prompts from "prompts"
export default class extends LibBase {
    //入口文件路径
    private entryFilePath!: string
    //产物目录名称
    private distDirName: string = "dist";
    private dependenciesNode = new Set([
        'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
        'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https',
        'module', 'net', 'os', 'path', 'os', 'punycode', 'querystring', 'readline',
        'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'tty',
        'url', 'util', 'vm', 'zlib', 'process', 'v8', 'worker_threads'
    ]);
    private dependencies: Record<string, string> = {}
    private get distPath() {
        return path.join(this.cwdProjectInfo.cwdPath, this.distDirName)
    }
    constructor() {
        super()
        console.log(this.cwdProjectInfo, "**********")
    }
    async task1(): Promise<void> {
        console.log('\n🚀 开始抽取流程');

        console.log('📋 1. 交互定义dist目录名称');
        await this.askDistDirName();

        console.log('📋 2. 交互定义入口文件');
        await this.askEntryFilePath();

        console.log('⚙️3. 抽取js,.d.ts,插件里实现依赖抽取和package.json生成');
        await this.extractToFile();
        await this.createJson();
        console.log('\n🚀 完成抽取流程');
    }
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
    private async askDistDirName(): Promise<void> {
        let isValid = false;
        let dirName = this.distDirName;

        while (!isValid) {
            const response = await prompts({
                type: 'text',
                name: 'distName',
                message: '请输入输出目录名称 (可直接回车使用默认值)',
                initial: dirName,
                validate: (value: string) => {
                    const trimmedValue = value.trim();
                    const validNameRegex = /^[a-zA-Z0-9-_]+$/;

                    if (!trimmedValue) return '目录名不能为空';
                    if (!validNameRegex.test(trimmedValue)) return '目录名只能包含字母、数字、- 和 _';

                    // 检查是否存在同名目录
                    const targetPath = path.join(this.cwdProjectInfo.cwdPath, trimmedValue);
                    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
                        return `${targetPath} 已存在，请选择其他名称`;
                    } else {
                        fs.mkdirSync(targetPath, { recursive: true });
                    }
                    return true;
                }
            });

            // 用户取消操作
            if (response.distName === undefined) {
                const error = new Error('user-cancelled');
                throw error;
            }

            dirName = response.distName.trim();
            isValid = true;
        }

        // 更新目录名称
        this.distDirName = dirName;
        console.log(`📁 输出目录已设置为: ${this.distPath}`);
    }
    private async createJson() {
        console.log(this.dependencies)
    }
    private async extractToFile(): Promise<void> {
        const project = new Project({
            tsConfigFilePath: path.join(this.cwdProjectInfo.pkgPath, 'tsconfig.json'),
            skipFileDependencyResolution: true,
        });

        const sourceFile = project.getSourceFileOrThrow(this.entryFilePath);

        // 存储已处理的文件路径（绝对路径），防止重复
        const emittedFiles = new Set<string>();
        // 记录每个源文件到输出路径的映射
        const fileToOutputPath = new Map<string, string>();

        // 项目根目录，用于计算相对路径
        const projectRoot = this.cwdProjectInfo.pkgPath;

        /**
         * 将文件路径转为相对于项目根的 POSIX 路径（用作唯一键）
         */
        const toProjectRelative = (filePath: string) => {
            return path.relative(projectRoot, filePath).replace(/\\/g, '/');
        };

        /**
         * 根据当前文件和模块名，解析出目标 .ts 文件路径
         */
        const resolveImportPath = (fromDir: string, moduleSpecifier: string): string | undefined => {
            // 处理相对路径
            if (moduleSpecifier.startsWith('.')) {
                let targetPath = path.resolve(fromDir, moduleSpecifier);

                // 尝试添加 .ts 后缀
                if (!targetPath.endsWith('.ts') && !targetPath.endsWith('.tsx')) {
                    if (fs.existsSync(targetPath + '.ts')) {
                        targetPath = targetPath + '.ts';
                    } else if (fs.existsSync(targetPath + '.tsx')) {
                        targetPath = targetPath + '.tsx';
                    }
                }

                if (fs.existsSync(targetPath)) {
                    return targetPath;
                }
            } else {
                // 第三方模块：尝试从 node_modules 解析主入口
                // 简化处理：只记录依赖，不复制
                return undefined;
            }
            return undefined;
        };

        /**
         * 递归处理文件及其依赖
         */
        const processFile = (file: SourceFile) => {
            const filePath = file.getFilePath();
            const relativeInProject = toProjectRelative(filePath);

            if (emittedFiles.has(relativeInProject)) return;
            emittedFiles.add(relativeInProject);

            // 计算输出路径
            const outputPath = path.join(this.distPath, relativeInProject);
            fileToOutputPath.set(filePath, outputPath);

            const dirName = path.dirname(filePath);

            // 分析所有 import
            file.getImportDeclarations().forEach(decl => {
                const moduleName = decl.getModuleSpecifierValue();

                if (!moduleName.startsWith('.')) {
                    // 第三方依赖
                    const packageName = moduleName.split('/')[0];
                    if (!this.dependenciesNode.has(packageName)) {
                        this.dependencies[moduleName] = '';
                    }
                    return;
                }

                // 解析相对路径导入
                const resolvedPath = resolveImportPath(dirName, moduleName);
                if (resolvedPath) {
                    let importedFile = project.getSourceFile(resolvedPath);
                    if (!importedFile) {
                        // 如果未加载，手动添加（但不触发类型检查）
                        importedFile = project.addSourceFileAtPathIfExists(resolvedPath);
                    }
                    if (importedFile) {
                        processFile(importedFile);
                    }
                }
            });

            // 分析 export ... from "..."
            file.getExportDeclarations().forEach(decl => {
                if (!decl.hasModuleSpecifier()) return;
                const moduleName = decl.getModuleSpecifierValue();
                if (moduleName) {
                    if (!moduleName.startsWith('.')) {
                        const packageName = moduleName.split('/')[0];
                        if (!this.dependenciesNode.has(packageName)) {
                            this.dependencies[moduleName] = '';
                        }
                        return;
                    }
                    const resolvedPath = resolveImportPath(dirName, moduleName);
                    if (resolvedPath) {
                        let exportedFile = project.getSourceFile(resolvedPath);
                        if (!exportedFile) {
                            exportedFile = project.addSourceFileAtPathIfExists(resolvedPath);
                        }
                        if (exportedFile) {
                            processFile(exportedFile);
                        }
                    }
                }
            });
        };

        // 开始递归处理
        processFile(sourceFile);

        // 写入所有文件
        for (const [filePath, outputPath] of fileToOutputPath) {
            const file = project.getSourceFileOrThrow(filePath);
            const content = file.getFullText();
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, content, 'utf8');
            console.log(`📄 已复制: ${toProjectRelative(filePath)} -> ${path.relative(this.distPath, outputPath)}`);
        }

        console.log(`✅ 共复制 ${emittedFiles.size} 个文件`);
    }
}