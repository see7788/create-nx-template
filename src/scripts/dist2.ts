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
    private async extractToFile(): Promise<void> {
        const project = new Project({
            tsConfigFilePath: path.join(this.cwdProjectInfo.pkgPath, 'tsconfig.json'),
            skipFileDependencyResolution: true,
        });

        const sourceFile = project.getSourceFileOrThrow(this.entryFilePath);

        const emittedFileNames = new Set<string>();
        const processedFiles = new Set<string>();

        /** 使用 TypeScript 缘码器 API 移除注释 */
        const removeCommentsFromText = (code: string, filePath: string): string => {
            const sourceFile = ts.createSourceFile(
                filePath,
                code,
                ts.ScriptTarget.Latest,
                false,
                ts.ScriptKind.TS
            );

            const printer = ts.createPrinter({ removeComments: true });
            return printer.printFile(sourceFile);
        };

        /** Tree Shaking：删除未使用的代码 */
        const doTreeShaking = (f: SourceFile) => {
            // 1. 删除未使用的命名导入
            f.getImportDeclarations().forEach(decl => {
                const namedImports = decl.getNamedImports();
                const unused = namedImports.filter(imp => {
                    const name = imp.getName();
                    const refs = f.getDescendantsOfKind(SyntaxKind.Identifier)
                        .filter(id => id.getText() === name);
                    return refs.length === 0;
                });
                unused.forEach(imp => imp.remove());
                if (!decl.getNamedImports().length && !decl.getDefaultImport() && !decl.getNamespaceImport()) {
                    decl.remove();
                }
            });

            // 2. 删除未使用的变量声明
            f.getVariableStatements().forEach(stmt => {
                if (stmt.isExported()) return;
                const declarations = stmt.getDeclarations();
                const toKeep = declarations.filter(decl => {
                    const name = decl.getName();
                    const refs = f.getDescendantsOfKind(SyntaxKind.Identifier)
                        .filter(id => id.getText() === name);
                    return refs.length > 1;
                });
                if (toKeep.length === 0) {
                    stmt.remove();
                } else if (toKeep.length < declarations.length) {
                    const names = toKeep.map(d => d.getName()).join(', ');
                    const type = toKeep[0].getTypeNode() ? `: ${toKeep[0].getTypeNode()?.getText()}` : '';
                    const init = toKeep[0].getInitializer() ? ` = ${toKeep[0].getInitializer()?.getText()}` : '';
                    stmt.replaceWithText(`const ${names}${type}${init};`);
                }
            });

            // 3. 删除未使用的函数
            f.getFunctions().forEach(fn => {
                if (fn.isExported()) return;
                const name = fn.getName();
                if (!name) return;
                const refs = f.getDescendantsOfKind(SyntaxKind.Identifier)
                    .filter(id => id.getText() === name);
                if (refs.length <= 1) fn.remove();
            });

            // 4. 删除未使用的类
            f.getClasses().forEach(cls => {
                if (cls.isExported()) return;
                const name = cls.getName();
                if (!name) return;
                const refs = f.getDescendantsOfKind(SyntaxKind.Identifier)
                    .filter(id => id.getText() === name);
                if (refs.length <= 1) cls.remove();
            });

            // 5. 删除未使用的类型别名
            f.getTypeAliases().forEach(ta => {
                if (ta.isExported()) return;
                const name = ta.getName();
                const refs = f.getDescendantsOfKind(SyntaxKind.Identifier)
                    .filter(id => id.getText() === name);
                if (refs.length <= 1) ta.remove();
            });

            // 6. 删除未使用的接口
            f.getInterfaces().forEach(iface => {
                if (iface.isExported()) return;
                const name = iface.getName();
                if (!name) return;
                const refs = f.getDescendantsOfKind(SyntaxKind.Identifier)
                    .filter(id => id.getText() === name);
                if (refs.length <= 1) iface.remove();
            });
        };

        /**
         * 解析模块路径，支持 ./ ../ / 和 index 文件
         */
        const resolveModulePath = (specifier: string, fromDir: string): string | null => {
            if (!specifier.startsWith('.')) return null;

            let resolved = path.resolve(fromDir, specifier);

            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                return resolved;
            }

            // 尝试 index 文件
            for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
                const indexPath = path.join(resolved, `index${ext}`);
                if (fs.existsSync(indexPath)) return indexPath;
            }

            // 尝试添加扩展名
            for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
                const fullPath = resolved + ext;
                if (fs.existsSync(fullPath)) return fullPath;
            }

            return null;
        };

        // ✅ 获取入口文件基本信息
        const entryBasename = path.basename(this.entryFilePath, path.extname(this.entryFilePath));
        const entryExt = path.extname(this.entryFilePath); // '.ts' 或 '.js'
        const outputDirForEntry = path.join(this.distPath, entryBasename); // dist/入口文件名/

        /**
         * 处理单个文件
         */
        const processFile = (file: SourceFile) => {
            const filePath = file.getFilePath();
            if (processedFiles.has(filePath)) return;
            processedFiles.add(filePath);

            const isEntryPoint = filePath === this.entryFilePath;
            const relativeToProject = path.relative(this.cwdProjectInfo.pkgPath, filePath);
            const fileName = isEntryPoint ? `index${entryExt}` : path.basename(filePath);
            const outputPath = path.join(outputDirForEntry, fileName);

            if (emittedFileNames.has(fileName)) {
                console.warn(`⚠️ 同名文件已存在，跳过: ${fileName}`);
                return;
            }

            // ✅ 重写相对导入路径
            file.getImportDeclarations().forEach(decl => {
                const specifier = decl.getModuleSpecifierValue();
                if (!specifier || !specifier.startsWith('.')) return;

                const dirPath = path.dirname(filePath);
                const resolvedPath = resolveModulePath(specifier, dirPath);
                if (!resolvedPath) {
                    console.warn(`⚠️ 未找到模块，跳过导入: ${specifier} (from ${filePath})`);
                    return;
                }

                // 计算新导入路径：相对于 outputDirForEntry 的相对路径
                const importedFileName = resolvedPath === this.entryFilePath
                    ? 'index' + path.extname(resolvedPath)
                    : path.basename(resolvedPath);

                const relativeImport = path.relative(path.dirname(outputPath), path.join(outputDirForEntry, importedFileName));
                const finalImportPath = relativeImport.startsWith('.')
                    ? relativeImport
                    : './' + relativeImport;

                decl.setModuleSpecifier(finalImportPath);
            });

            // ✅ 重写 export from './xxx'
            file.getExportDeclarations().forEach(decl => {
                if (!decl.hasModuleSpecifier()) return;
                const specifier = decl.getModuleSpecifierValue();
                if (!specifier || !specifier.startsWith('.')) return;

                const dirPath = path.dirname(filePath);
                const resolvedPath = resolveModulePath(specifier, dirPath);
                if (!resolvedPath) {
                    console.warn(`⚠️ 未找到导出模块，跳过: ${specifier} (from ${filePath})`);
                    return;
                }

                const exportedFileName = resolvedPath === this.entryFilePath
                    ? 'index' + path.extname(resolvedPath)
                    : path.basename(resolvedPath);

                const relativeImport = path.relative(path.dirname(outputPath), path.join(outputDirForEntry, exportedFileName));
                const finalImportPath = relativeImport.startsWith('.')
                    ? relativeImport
                    : './' + relativeImport;

                decl.setModuleSpecifier(finalImportPath);
            });

            // 收集第三方依赖
            file.getImportDeclarations().forEach(decl => {
                const moduleName = decl.getModuleSpecifierValue();
                if (moduleName && !moduleName.startsWith('.')) {
                    const packageName = moduleName.split('/')[0];
                    if (!this.dependenciesNode.has(packageName)) {
                        this.dependencies[moduleName] = '';
                    }
                }
            });

            file.getExportDeclarations().forEach(decl => {
                const moduleName = decl.getModuleSpecifierValue();
                if (moduleName && !moduleName.startsWith('.')) {
                    const packageName = moduleName.split('/')[0];
                    if (!this.dependenciesNode.has(packageName)) {
                        this.dependencies[moduleName] = '';
                    }
                }
            });

            // Tree Shaking
            doTreeShaking(file);

            // 获取并清理代码
            const modifiedCode = file.getFullText();
            const cleanedCode = removeCommentsFromText(modifiedCode, filePath);

            // 输出文件
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, cleanedCode, 'utf8');
            emittedFileNames.add(fileName);

            const displayPath = path.relative(this.distPath, outputPath);
            console.log(`📄 已输出: ${displayPath} (${relativeToProject})`);
        };

        /**
         * 深度优先遍历依赖图
         */
        const traverse = (file: SourceFile) => {
            const dirPath = path.dirname(file.getFilePath());

            // 处理 import './xxx'
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((s): s is string => !!s)
                .filter(s => s.startsWith('.'))
                .forEach(specifier => {
                    const resolvedPath = resolveModulePath(specifier, dirPath);
                    if (resolvedPath) {
                        const depFile = project.addSourceFileAtPath(resolvedPath);
                        traverse(depFile);
                    } else {
                        console.warn(`⚠️ 未找到模块: ${specifier} (from ${file.getFilePath()})`);
                    }
                });

            // 处理 export from './xxx'
            file.getExportDeclarations()
                .filter(decl => decl.hasModuleSpecifier())
                .map(decl => decl.getModuleSpecifierValue())
                .filter((s): s is string => !!s)
                .filter(s => s.startsWith('.'))
                .forEach(specifier => {
                    const resolvedPath = resolveModulePath(specifier, dirPath);
                    if (resolvedPath) {
                        const depFile = project.addSourceFileAtPath(resolvedPath);
                        traverse(depFile);
                    } else {
                        console.warn(`⚠️ 未找到导出模块: ${specifier} (from ${file.getFilePath()})`);
                    }
                });

            processFile(file);
        };

        // 创建输出目录
        fs.mkdirSync(outputDirForEntry, { recursive: true });

        // 开始处理
        traverse(sourceFile);

        console.log(`✅ 抽取完成，共输出 ${emittedFileNames.size} 个文件`);
        console.log(`📁 结构路径: ${entryBasename}/index${entryExt}`);
    }
}