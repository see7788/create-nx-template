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
        const project = new Project();
        const sourceFilesToProcess: SourceFile[] = [project.addSourceFileAtPath(this.entryFilePath)];
        const processedFiles = new Set<string>();

        // ✅ 使用 / 统一存储路径（POSIX 风格）
        const fileMap = new Map<string, string>(); // 原路径（/） → 输出文件名

        // 工具函数：将路径统一为 /
        const toPosix = (p: string) => p.replace(/\\/g, '/');

        // 1️⃣ 收集所有文件，建立映射
        while (sourceFilesToProcess.length > 0) {
            const file = sourceFilesToProcess.shift()!;
            const filePath = toPosix(file.getFilePath()); // ✅ 统一为 /

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

            // 处理相对导入
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod)
                .filter(mod => mod.startsWith('.'))
                .forEach(relativePath => {
                    try {
                        const fromDir = path.dirname(filePath);
                        const resolved = toPosix(path.resolve(fromDir, relativePath)); // ✅ resolve 后转为 /

                        let actualPath = '';
                        for (const ext of ['.ts', '.tsx', '.js']) {
                            const fullPath = resolved + ext;
                            if (fs.existsSync(fullPath)) {
                                actualPath = toPosix(fullPath); // ✅ 统一为 /
                                break;
                            }
                        }

                        if (!actualPath) {
                            for (const ext of ['.ts', '.tsx', '.js']) {
                                const indexPath = path.join(resolved, `index${ext}`);
                                if (fs.existsSync(indexPath)) {
                                    actualPath = toPosix(indexPath);
                                    break;
                                }
                            }
                        }

                        if (actualPath && !processedFiles.has(actualPath)) {
                            const depFile = project.getSourceFile(actualPath) || project.addSourceFileAtPath(actualPath);
                            if (depFile) {
                                sourceFilesToProcess.push(depFile);
                            }
                        }
                    } catch (e) {
                        console.warn(`⚠️ 无法解析导入: ${relativePath} in ${filePath}`);
                    }
                });

            // ✅ 构建输出文件名（统一使用 /）
            const ext = path.extname(filePath);
            let flatFileName: string;

            if (filePath === toPosix(this.entryFilePath)) {
                flatFileName = `index${ext}`;
            } else {
                const relativePath = toPosix(path.relative(this.cwdProjectInfo.pkgPath, filePath));
                flatFileName = relativePath.replace(/[\\/]/g, '_'); // 安全替换
            }

            fileMap.set(filePath, flatFileName);
        }

        // 2️⃣ 重写 import 路径（全部基于 / 比较）
        project.getSourceFiles().forEach(file => {
            const filePath = toPosix(file.getFilePath());
            if (!fileMap.has(filePath)) return;

            file.getImportDeclarations().forEach(importDecl => {
                const moduleSpecifier = importDecl.getModuleSpecifierValue();
                if (!moduleSpecifier || !moduleSpecifier.startsWith('.')) return;

                try {
                    const fromDir = path.dirname(filePath);
                    const toPath = toPosix(path.resolve(fromDir, moduleSpecifier));
                    const normalizedToPath = path.normalize(toPath).replace(/\\/g, '/'); // ✅ 归一化

                    let targetOutputName = '';
                    for (const [original, flatName] of fileMap.entries()) {
                        const normalizedOriginal = path.normalize(original).replace(/\\/g, '/');
                        if (normalizedOriginal === normalizedToPath) {
                            targetOutputName = flatName;
                            break;
                        }
                    }

                    if (!targetOutputName) return;

                    // ✅ 重写为同目录导入（无路径，仅文件名）
                    const newImportPath = path.basename(targetOutputName, path.extname(targetOutputName));
                    importDecl.setModuleSpecifier(newImportPath);
                } catch (err) {
                    console.warn(`⚠️ 重写导入失败: ${moduleSpecifier} in ${filePath}`, err);
                }
            });
        });

        // 3️⃣ 写出文件
        processedFiles.clear();
        project.getSourceFiles().forEach(file => {
            const filePath = toPosix(file.getFilePath());
            if (!fileMap.has(filePath)) return;
            if (processedFiles.has(filePath)) return;
            processedFiles.add(filePath);

            const outputFileName = fileMap.get(filePath)!;
            const outputPath = path.join(outputDir, outputFileName);
            const content = file.getFullText();

            fs.writeFileSync(outputPath, content, 'utf-8');
            if (outputFileName === 'index.ts' || outputFileName === 'index.js') {
                console.log(`✅ 成功生成入口文件: ${outputPath}`);
            }
        });

        console.log(`✅ 提取完成，共生成 ${fileMap.size} 个文件`);
    }
}