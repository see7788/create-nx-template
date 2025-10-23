// scripts/extract-preload.ts
import { Project, SyntaxKind, SourceFile } from "ts-morph";
import path from 'path';
import type { PackageJson } from 'type-fest';
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

        const emittedFileNames = new Set<string>();
        const processedFiles = new Set<string>();

        /**
         * 使用 TypeScript 编译器 API 移除注释
         */
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

        /**
         * Tree Shaking：删除未使用的代码
         */
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
         * 解析相对模块路径，支持 / 路径和 index.ts/index.tsx
         */
        const resolveModulePath = (specifier: string, fromDir: string): string | null => {
            let resolved = path.resolve(fromDir, specifier);

            // 如果已有扩展名，直接检查
            if (/\.(ts|tsx|js|jsx)$/.test(resolved)) {
                return fs.existsSync(resolved) ? resolved : null;
            }

            // 尝试 index 文件
            const indexCandidates = [
                path.join(resolved, 'index.ts'),
                path.join(resolved, 'index.tsx'),
                path.join(resolved, 'index.js'),
                path.join(resolved, 'index.jsx'),
            ];

            for (const candidate of indexCandidates) {
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }

            // 尝试同名文件
            const extCandidates = [
                resolved + '.ts',
                resolved + '.tsx',
                resolved + '.js',
                resolved + '.jsx',
            ];

            for (const candidate of extCandidates) {
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }

            return null;
        };

        /**
         * 处理单个文件：收集依赖 + Tree Shaking + 输出
         */
        const processFile = (file: SourceFile) => {
            const filePath = file.getFilePath();
            if (processedFiles.has(filePath)) return;
            processedFiles.add(filePath);

            // 生成安全文件名（扁平化）
            const relativePath = path.relative(this.cwdProjectInfo.pkgPath, filePath);
            const safeName = relativePath
                .replace(/^(\.\.\/)+/, '')
                .replace(/[\\/]/g, '_')
                .replace(/\.(tsx?|jsx?)$/, '.ts');

            if (emittedFileNames.has(safeName)) {
                console.warn(`⚠️ 文件名重复，跳过: ${safeName}`);
                return;
            }

            // -------------------------------
            // ✅ 新增：重写所有相对导入和导出
            // -------------------------------

            // 1. 重写 import './xxx' -> import 'xxx_flattened_name'
            file.getImportDeclarations().forEach(decl => {
                const specifier = decl.getModuleSpecifierValue();
                if (!specifier) return;

                if (specifier.startsWith('.')) {
                    // 是相对路径，需要解析并重写
                    const dirPath = path.dirname(filePath);
                    const resolvedPath = resolveModulePath(specifier, dirPath);
                    if (resolvedPath) {
                        const resolvedRel = path.relative(this.cwdProjectInfo.pkgPath, resolvedPath);
                        const resolvedSafeName = resolvedRel
                            .replace(/^(\.\.\/)+/, '')
                            .replace(/[\\/]/g, '_')
                            .replace(/\.(tsx?|jsx?)$/, '.ts');

                        decl.setModuleSpecifier(resolvedSafeName); // ✅ 重写为扁平化后的文件名
                    }
                }
                // 第三方依赖保留原样
            });

            // 2. 重写 export from './xxx'
            file.getExportDeclarations().forEach(decl => {
                if (!decl.hasModuleSpecifier()) return;
                const specifier = decl.getModuleSpecifierValue();
                if (!specifier) return;

                if (specifier.startsWith('.')) {
                    const dirPath = path.dirname(filePath);
                    const resolvedPath = resolveModulePath(specifier, dirPath);
                    if (resolvedPath) {
                        const resolvedRel = path.relative(this.cwdProjectInfo.pkgPath, resolvedPath);
                        const resolvedSafeName = resolvedRel
                            .replace(/^(\.\.\/)+/, '')
                            .replace(/[\\/]/g, '_')
                            .replace(/\.(tsx?|jsx?)$/, '.ts');

                        decl.setModuleSpecifier(resolvedSafeName); // ✅ 重写
                    }
                }
            });

            // -------------------------------
            // 收集第三方依赖（不变）
            // -------------------------------
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

            // -------------------------------
            // Tree Shaking & 输出
            // -------------------------------
            doTreeShaking(file);

            const modifiedCode = file.getFullText();
            const cleanedCode = removeCommentsFromText(modifiedCode, filePath);

            const outputPath = path.join(this.distPath, safeName);
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, cleanedCode, 'utf8');
            emittedFileNames.add(safeName);
            console.log(`📄 已输出: ${safeName}`);
        };

        /**
         * 深度优先遍历所有相对导入的文件
         */
        const traverse = (file: SourceFile) => {
            const dirPath = path.dirname(file.getFilePath());

            // 处理 import './xxx' 和 import '../anyipc/public'
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((specifier): specifier is string => !!specifier)
                .filter(specifier => specifier.startsWith('.'))
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
                .filter((specifier): specifier is string => !!specifier)
                .filter(specifier => specifier.startsWith('.'))
                .forEach(specifier => {
                    const resolvedPath = resolveModulePath(specifier, dirPath);
                    if (resolvedPath) {
                        const depFile = project.addSourceFileAtPath(resolvedPath);
                        traverse(depFile);
                    } else {
                        console.warn(`⚠️ 未找到导出模块: ${specifier} (from ${file.getFilePath()})`);
                    }
                });

            // 处理当前文件
            processFile(file);
        };

        // 开始遍历
        traverse(sourceFile);

        console.log(`✅ 扁平化输出完成，共 ${emittedFileNames.size} 个文件（已去注释、Tree Shaking）`);
    }

}