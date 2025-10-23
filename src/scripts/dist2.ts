// scripts/extract-preload.ts
import { Project, SyntaxKind, SourceFile } from "ts-morph";
import path from 'path';
import type { PackageJson } from 'type-fest';
import crypto from 'crypto'
import fs from "fs"
import ts from "typescript"
import LibBase, { Appexit } from "./tool.js";
import prompts from "prompts"
export default class extends LibBase {
    //入口文件路径
    private entryFilePath!: string
    //产物目录名称
    private distDirName: string = "dist";
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

        console.log('⚙️3. 抽取js,.d.ts,插件里实现依赖抽取');
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

    public async extractToFile(): Promise<void> {


        // 使用 ts-morph 解析源文件
        const project = new Project();
        const sourceFilesToProcess: SourceFile[] = [project.addSourceFileAtPath(this.entryFilePath)];
        const processedFiles = new Set<string>(); // 防止重复处

        // 遍历所有依赖文件
        while (sourceFilesToProcess.length > 0) {
            const file = sourceFilesToProcess.shift()!;
            const filePath = file.getFilePath();

            if (processedFiles.has(filePath)) continue;
            processedFiles.add(filePath);

            // 收集所有非相对/非绝对路径的导入模块（即第三方或内部包）
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod)
                .filter(mod => !mod.startsWith('.') && !path.isAbsolute(mod)) // 排除相对和绝对路径
                .forEach(mod => {
                    const pkgName = mod.startsWith('@')
                        ? mod.split('/').slice(0, 2).join('/') // 完整 scope 包名，如 @org/name
                        : mod.split('/')[0]; // 基础包名，如 lodash
                    this.dependencies[pkgName] = ''; // 仅存键，值由外部填充
                });

            // 收集相对导入的文件用于递归处理
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod)
                .filter(mod => mod.startsWith('.') || path.isAbsolute(mod))
                .forEach(relativeMod => {
                    try {
                        const resolvedPath = path.resolve(path.dirname(filePath), relativeMod);
                        let actualPath = '';

                        // 尝试解析 .ts 文件
                        for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
                            const tryPath = resolvedPath + ext;
                            if (fs.existsSync(tryPath)) {
                                actualPath = tryPath;
                                break;
                            }
                        }

                        // 尝试解析目录下的 index 文件
                        if (!actualPath) {
                            for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
                                const tryPath = path.join(resolvedPath, `index${ext}`);
                                if (fs.existsSync(tryPath)) {
                                    actualPath = tryPath;
                                    break;
                                }
                            }
                        }

                        if (actualPath && !processedFiles.has(actualPath)) {
                            const depFile = project.getSourceFile(actualPath) || project.addSourceFileAtPath(actualPath);
                            if (depFile) sourceFilesToProcess.push(depFile);
                        }
                    } catch {
                        // 解析失败则跳过（如类型声明、未安装包等）
                    }
                });
        }

        // 写出所有源文件到输出目录（扁平化命名）
        processedFiles.clear();
        project.getSourceFiles().forEach(file => {
            const filePath = file.getFilePath();
            if (!filePath.includes(this.cwdProjectInfo.pkgPath) || processedFiles.has(filePath)) return;
            processedFiles.add(filePath);

            const relativePath = path.relative(this.cwdProjectInfo.pkgPath, filePath);
            const ext = path.extname(relativePath);

            // 入口文件命名为 index.{ext}
            let outputFileName: string;
            if (path.normalize(filePath) === path.normalize(this.entryFilePath)) {
                outputFileName = `index${ext}`;
            } else {
                outputFileName = relativePath.replace(/[\\/]/g, '_');
            }

            const outputPath = path.join(this.distPath, outputFileName);
            fs.writeFileSync(outputPath, file.getFullText(), 'utf-8');
        });
    }
}