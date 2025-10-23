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
    /**
    * 提取入口文件及其依赖，扁平化输出到指定目录，并收集第三方依赖名
    */
    public async extractToFile(): Promise<void> {
        // ✅ 1. 确定输出根目录（假设 this.outputRoot 已在构造函数中设置）
        const outputDir = this.distPath;

        // ✅ 3. 使用 ts-morph 解析项目
        const project = new Project();
        const sourceFilesToProcess: SourceFile[] = [project.addSourceFileAtPath(this.entryFilePath)];
        const processedFiles = new Set<string>(); // 防止重复处理

        // ✅ 4. 遍历所有依赖文件（BFS）
        while (sourceFilesToProcess.length > 0) {
            const file = sourceFilesToProcess.shift()!;
            const filePath = file.getFilePath();

            // 跳过已处理的文件
            if (processedFiles.has(filePath)) continue;
            processedFiles.add(filePath);

            // 收集所有非相对路径的导入模块（如 lodash, @org/name, zustand 等）
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod)
                .filter(mod => !mod.startsWith('.') && !path.isAbsolute(mod))
                .forEach(mod => {
                    // 提取包名：@scope/name 或 name
                    const pkgName = mod.startsWith('@')
                        ? mod.split('/').slice(0, 2).join('/')
                        : mod.split('/')[0];
                    this.dependencies[pkgName] = ''; // 值留空，后续可填充版本号
                });

            // 处理相对导入的文件（递归）
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod)
                .filter(mod => mod.startsWith('.')) // 只处理相对路径
                .forEach(relativePath => {
                    try {
                        // 解析相对路径为绝对路径
                        const dir = path.dirname(filePath);
                        const resolved = path.resolve(dir, relativePath);
                        let actualPath = '';

                        // 尝试常见扩展名
                        for (const ext of ['.ts', '.tsx', '.js']) {
                            const fullPath = resolved + ext;
                            if (fs.existsSync(fullPath)) {
                                actualPath = fullPath;
                                break;
                            }
                        }

                        // 尝试 index 文件
                        if (!actualPath) {
                            for (const ext of ['.ts', '.tsx', '.js']) {
                                const indexPath = path.join(resolved, `index${ext}`);
                                if (fs.existsSync(indexPath)) {
                                    actualPath = indexPath;
                                    break;
                                }
                            }
                        }

                        // 如果找到文件且未处理过，加入队列
                        if (actualPath && fs.existsSync(actualPath) && !processedFiles.has(actualPath)) {
                            const depFile = project.getSourceFile(actualPath) || project.addSourceFileAtPath(actualPath);
                            if (depFile) {
                                sourceFilesToProcess.push(depFile);
                            }
                        }
                    } catch {
                        // 解析失败则跳过（如类型声明、未安装包）
                    }
                });
        }

        // ✅ 5. 写出所有源文件（扁平化命名）
        processedFiles.clear();
        project.getSourceFiles().forEach(file => {
            const filePath = file.getFilePath();

            // 跳过 node_modules 和已处理或不在项目中的文件
            if (filePath.includes('node_modules') || processedFiles.has(filePath)) return;
            processedFiles.add(filePath);

            // 生成扁平化文件名：src/utils/helper.ts → src_utils_helper.ts
            const relativeToProject = path.relative(this.cwdProjectInfo.pkgPath, filePath);
            const ext = path.extname(relativeToProject);
            const baseName = relativeToProject.replace(/[\\/]/g, '_').replace(ext, '');

            // 入口文件特殊处理：输出为 index.ts
            let outputFileName: string;
            if (path.normalize(filePath) === path.normalize(this.entryFilePath)) {
                outputFileName = `index${ext}`;
            } else {
                outputFileName = `${baseName}${ext}`;
            }

            const outputPath = path.join(outputDir, outputFileName);
            fs.writeFileSync(outputPath, file.getFullText(), 'utf-8');
        });
    }
}