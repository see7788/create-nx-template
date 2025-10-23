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
    async extractToFile(): Promise<void> {
        const entryPath = this.entryFilePath;
        const outputDir: string = this.distPath
        const project = new Project();
        const entry = project.addSourceFileAtPath(path.resolve(entryPath));
        const filesToProcess: SourceFile[] = [entry];
        const processedFiles = new Set<string>();
        const fileToFlatName = new Map<string, string>();
        const posix = (s: string) => s.replace(/\\/g, '/');

        // 收集所有依赖文件
        while (filesToProcess.length > 0) {
            const file = filesToProcess.shift()!;
            const filePath = posix(file.getFilePath());
            if (processedFiles.has(filePath)) continue;
            processedFiles.add(filePath);

            for (const imp of file.getImportDeclarations()) {
                const moduleSpecifier = imp.getModuleSpecifierValue();
                if (!moduleSpecifier?.startsWith('.')) continue;

                try {
                    const resolved = path.resolve(path.dirname(filePath), moduleSpecifier);
                    let targetPath = '';
                    for (const ext of ['.ts', '.tsx']) {
                        const fp = resolved + ext;
                        if (fs.existsSync(fp)) {
                            targetPath = posix(fp);
                            break;
                        }
                        const indexPath = path.join(resolved, `index${ext}`);
                        if (fs.existsSync(indexPath)) {
                            targetPath = posix(indexPath);
                            break;
                        }
                    }
                    if (targetPath && !processedFiles.has(targetPath)) {
                        const depFile = project.getSourceFile(targetPath) || project.addSourceFileAtPath(targetPath);
                        filesToProcess.push(depFile);
                    }
                } catch { }
            }

            const isEntry = filePath === posix(entryPath);
            const flatName = isEntry ? 'index.ts' : filePath.split('/').slice(-3).join('_');
            fileToFlatName.set(filePath, flatName);
        }

        // 移除未使用的变量/函数（基于类型检查）
        await project.emit({ emitOnlyDtsFiles: false });
        const diagnostics = project.getPreEmitDiagnostics();
        const unusedSymbols = new Set<string>();
        for (const diag of diagnostics) {
            const msg = diag.getMessageText();
            if (typeof msg === 'string' && (msg.includes('is declared but its value is never read') ||
                msg.includes('is assigned a value but never used'))) {
                const file = diag.getSourceFile();
                if (!file) continue;
                const start = diag.getStart();
                if (start) {
                    const node = file.getDescendantAtPos(start);
                    if (node) {
                        const nameNode = node.getChildSyntaxListOrThrow().getChildren()[0];
                        if (nameNode) {
                            unusedSymbols.add(`${file.getFilePath()}:${nameNode.getPos()}`);
                        }
                    }
                }
            }
        }

        // 清理每个文件：删除注释 + 删除未使用符号
        for (const file of project.getSourceFiles()) {
            const filePath = posix(file.getFilePath());
            if (!fileToFlatName.has(filePath)) continue;

            // 删除所有注释
            file.getDescendants().forEach(n => {
                if (n.isKind(154) || n.isKind(155)) { // SyntaxKind.SingleLineCommentTrivia, MultiLineCommentTrivia
                    n.replaceWithText('');
                }
            });

            // // 删除未使用的变量/函数
            // file.getVariableDeclarations().forEach(decl => {
            //     const pos = decl.getNameNode().getPos();
            //     if (unusedSymbols.has(`${filePath}:${pos}`)) {
            //         const parent = decl.getParentOrThrow();
            //         if (parent.isKind(163)) { // VariableStatement
            //             parent.remove();
            //         }
            //     }
            // });
            // file.getFunctionDeclarations().forEach(fn => {
            //     const pos = fn.getNameNode()?.getPos();
            //     if (pos && unusedSymbols.has(`${filePath}:${pos}`)) {
            //         fn.remove();
            //     }
            // });
        }

        // 重写导入路径
        for (const file of project.getSourceFiles()) {
            const filePath = posix(file.getFilePath());
            if (!fileToFlatName.has(filePath)) continue;

            for (const imp of file.getImportDeclarations()) {
                const moduleSpecifier = imp.getModuleSpecifierValue();
                if (!moduleSpecifier?.startsWith('.')) continue;

                try {
                    const resolved = posix(path.resolve(path.dirname(filePath), moduleSpecifier));
                    const targetFile = [...fileToFlatName.keys()].find(k => k === resolved);
                    if (targetFile) {
                        const flatName = fileToFlatName.get(targetFile)!;
                        const importPath = './' + path.basename(flatName, path.extname(flatName));
                        imp.setModuleSpecifier(importPath);
                    }
                } catch { }
            }
        }

        // 输出文件
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        for (const file of project.getSourceFiles()) {
            const filePath = posix(file.getFilePath());
            if (!fileToFlatName.has(filePath)) continue;
            const outputFilePath = path.join(outputDir, fileToFlatName.get(filePath)!);
            fs.writeFileSync(outputFilePath, file.getFullText(), 'utf8');
        }
    }
}