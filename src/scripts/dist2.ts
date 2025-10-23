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
        const outputDir = this.distPath;

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        this.dependencies = {};

        const project = new Project();
        const sourceFilesToProcess: SourceFile[] = [project.addSourceFileAtPath(this.entryFilePath)];
        const processedFiles = new Set<string>();

        // 建立：原文件路径 → 输出文件名 的映射
        const fileMap = new Map<string, string>();

        // 1️⃣ 收集所有依赖文件，并建立映射
        while (sourceFilesToProcess.length > 0) {
            const file = sourceFilesToProcess.shift()!;
            const filePath = file.getFilePath();

            if (processedFiles.has(filePath)) continue;
            processedFiles.add(filePath);

            // 收集第三方依赖
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod)
                .filter(mod => !mod.startsWith('.') && !path.isAbsolute(mod))
                .forEach(mod => {
                    const pkgName = mod.startsWith('@')
                        ? mod.split('/').slice(0, 2).join('/')
                        : mod.split('/')[0];
                    this.dependencies[pkgName] = '';
                });

            // 递归处理相对导入
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod)
                .filter(mod => mod.startsWith('.'))
                .forEach(relativePath => {
                    try {
                        const resolved = path.resolve(path.dirname(filePath), relativePath);
                        let actualPath = '';
                        for (const ext of ['.ts', '.tsx', '.js']) {
                            const p = resolved + ext;
                            if (fs.existsSync(p)) {
                                actualPath = p;
                                break;
                            }
                        }
                        if (!actualPath) {
                            for (const ext of ['.ts', '.tsx', '.js']) {
                                const indexPath = path.join(resolved, `index${ext}`);
                                if (fs.existsSync(indexPath)) {
                                    actualPath = indexPath;
                                    break;
                                }
                            }
                        }
                        if (actualPath && !processedFiles.has(actualPath)) {
                            const depFile = project.getSourceFile(actualPath) || project.addSourceFileAtPath(actualPath);
                            if (depFile) sourceFilesToProcess.push(depFile);
                        }
                    } catch { }
                });

            // 构建输出文件名映射
            const relativeInProject = path.relative(this.cwdProjectInfo.pkgPath, filePath);
            const ext = path.extname(relativeInProject);
            const flatFileName = filePath === this.entryFilePath
                ? `index${ext}`
                : relativeInProject.replace(/[\\/]/g, '_');
            fileMap.set(filePath, flatFileName);
        }

        // 2️⃣ 重写所有 import 路径
        project.getSourceFiles().forEach(file => {
            const filePath = file.getFilePath();
            if (!fileMap.has(filePath)) return;

            file.getImportDeclarations().forEach(importDecl => {
                const moduleSpecifier = importDecl.getModuleSpecifierValue();
                if (!moduleSpecifier || !moduleSpecifier.startsWith('.')) return;

                try {
                    // 解析相对导入的原目标文件
                    const fromDir = path.dirname(filePath);
                    const toPath = path.resolve(fromDir, moduleSpecifier);
                    const normalizedToPath = path.normalize(toPath);

                    // 查找目标文件对应的输出文件名
                    let targetOutputName = '';
                    for (const [original, flatName] of fileMap.entries()) {
                        if (path.normalize(original) === normalizedToPath) {
                            targetOutputName = flatName;
                            break;
                        }
                    }

                    if (!targetOutputName) return;

                    // 计算新的相对路径（从当前输出文件到目标输出文件）
                    // 当前文件的输出名
                    const currentOutputName = fileMap.get(filePath)!;
                    // 因为都在同一目录，所以直接用文件名即可
                    const newModuleSpecifier = path.basename(targetOutputName, path.extname(targetOutputName));

                    // 🔁 重写 import 语句
                    importDecl.setModuleSpecifier(newModuleSpecifier);
                } catch (err) {
                    console.warn(`⚠️ 无法重写导入: ${moduleSpecifier} in ${filePath}`);
                }
            });
        });

        // 3️⃣ 写出所有文件
        processedFiles.clear();
        project.getSourceFiles().forEach(file => {
            const filePath = file.getFilePath();
            if (!fileMap.has(filePath) || processedFiles.has(filePath)) return;
            processedFiles.add(filePath);

            const outputFileName = fileMap.get(filePath)!;
            const outputPath = path.join(outputDir, outputFileName);
            const content = file.getFullText();

            fs.writeFileSync(outputPath, content, 'utf-8');
        });
    }
}