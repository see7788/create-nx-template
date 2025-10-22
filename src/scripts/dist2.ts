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
                        return `目录名 '${trimmedValue}' 已存在，请选择其他名称`;
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
        const outputPath = path.join(this.distPath, this.entryFilePath);
        const project = new Project({
            tsConfigFilePath: path.join(this.cwdProjectInfo.pkgPath, 'tsconfig.json'),
            skipFileDependencyResolution: true,
        });
        const sourceFile = project.getSourceFileOrThrow(this.entryFilePath);
        sourceFile.getImportDeclarations().forEach(decl => {
            const moduleName = decl.getModuleSpecifierValue();
            if (!moduleName.startsWith('.') && !this.dependenciesNode.has(moduleName.split('/')[0])) {
                this.dependencies[moduleName] = '';
            }
        });
        // ✅ 1. 找到任意 IIFE 变量声明：const x = (() => {...})() 或 () => {...}()
        const iifeDecl = sourceFile.getVariableDeclarations().find((decl) => {
            const initializer = decl.getInitializer();
            const isIIFE =
                initializer?.isKind(SyntaxKind.CallExpression) &&
                (initializer.getExpression().isKind(SyntaxKind.FunctionExpression) ||
                    initializer.getExpression().isKind(SyntaxKind.ArrowFunction));
            return isIIFE;
        });

        if (!iifeDecl) {
            throw new Error('❌ 未找到任何 IIFE 变量声明（如 () => {...}()）');
        }

        const iifeVarName = iifeDecl.getName(); // 动态获取变量名

        // ✅ 2. 自动收集 IIFE 中引用的所有用户定义类型
        const typeDependencies = new Set<string>();

        // 工具函数：根据名称查找符号（模拟 getSymbolByName）
        function findSymbolByName(name: string) {
            return (
                sourceFile.getTypeAlias(name)?.getSymbol() ||
                sourceFile.getInterface(name)?.getSymbol() ||
                sourceFile.getEnum(name)?.getSymbol() ||
                // 查找标识符（适用于变量/参数中的类型引用）
                sourceFile
                    .getDescendantsOfKind(SyntaxKind.Identifier)
                    .find(id => id.getText() === name)
                    ?.getSymbol()
            );
        }

        // 收集变量声明的类型注解：const x: MyType = ...
        const typeNode = iifeDecl.getTypeNode();
        if (typeNode) {
            const typeName = typeNode.getText();
            const symbol = findSymbolByName(typeName);
            if (symbol) {
                const isUserDefined = symbol.getDeclarations().some(decl =>
                    decl.isKind(SyntaxKind.TypeAliasDeclaration) ||
                    decl.isKind(SyntaxKind.InterfaceDeclaration) ||
                    decl.isKind(SyntaxKind.EnumDeclaration)
                );
                if (isUserDefined) {
                    typeDependencies.add(typeName);
                }
            }
        }

        // 遍历 IIFE 初始化表达式，查找所有 TypeReference（如 ConfigType）
        iifeDecl.getInitializer()?.forEachChild(function walk(node) {
            if (node.isKind(SyntaxKind.TypeReference)) {
                const typeNameNode = node.getTypeName();
                const typeName = typeNameNode.getText();

                // 排除基础类型
                if (['string', 'number', 'boolean', 'void', 'any', 'unknown', 'object', 'never'].includes(typeName)) {
                    return;
                }

                const symbol = findSymbolByName(typeName);
                if (symbol) {
                    const isUserDefined = symbol.getDeclarations().some(decl =>
                        decl.isKind(SyntaxKind.TypeAliasDeclaration) ||
                        decl.isKind(SyntaxKind.InterfaceDeclaration) ||
                        decl.isKind(SyntaxKind.EnumDeclaration)
                    );
                    if (isUserDefined) {
                        typeDependencies.add(typeName);
                    }
                }
            }

            // 继续遍历子节点
            node.forEachChild(walk);
        });

        // ✅ 3. 生成所有依赖类型的声明文本
        const typeDecls = Array.from(typeDependencies)
            .map(typeName => {
                const typeAlias = sourceFile.getTypeAlias(typeName);
                const interfaceDecl = sourceFile.getInterface(typeName);
                const enumDecl = sourceFile.getEnum(typeName);
                return (
                    (typeAlias ? typeAlias.getFullText() : '') ||
                    (interfaceDecl ? interfaceDecl.getFullText() : '') ||
                    (enumDecl ? enumDecl.getFullText() : '')
                );
            })
            .filter(Boolean)
            .join('\n\n');

        // ✅ 4. 判断是否需要 import { resolve } from 'path'
        const needsPathResolve = iifeDecl.getFullText().includes('resolve(');
        const importDecls = needsPathResolve ? "import { resolve } from 'path';" : '';

        // ✅ 5. 收集所有原始导出语句
        const exportStatements: string[] = [];

        // named exports: export const, function, class
        sourceFile.getVariableDeclarations().forEach(decl => {
            if (decl.isExported()) {
                exportStatements.push(decl.getFullText());
            }
        });

        sourceFile.getFunctions().forEach(fn => {
            if (fn.isExported()) {
                exportStatements.push(fn.getFullText());
            }
        });

        sourceFile.getClasses().forEach(cls => {
            if (cls.isExported()) {
                exportStatements.push(cls.getFullText());
            }
        });

        // export default
        const defaultExport = sourceFile.getDefaultExportSymbol();
        if (defaultExport) {
            const declarations = defaultExport.getDeclarations();
            if (declarations.length > 0) {
                const node = declarations[0];
                if (node.isKind(SyntaxKind.FunctionDeclaration)) {
                    exportStatements.push(node.getFullText());
                } else {
                    const name = node.getSymbol()?.getName() || iifeVarName;
                    exportStatements.push(`export default ${name};`);
                }
            }
        }

        // export { ... } from '...'
        sourceFile.getExportDeclarations().forEach(decl => {
            exportStatements.push(decl.getFullText());
        });

        // ✅ 6. 生成最终文件内容
        const fileContent = [
            importDecls,
            typeDecls,
            iifeDecl.getFullText(), // 包含 const x = (() => {})() 整个声明
            ...exportStatements,
            `export default ${iifeVarName};`
        ]
            .filter(Boolean)
            .join('\n\n')
            .trim();

        // ✅ 7. 写入文件
        fs.writeFileSync(outputPath, fileContent, 'utf8');
        console.log(`🎉 成功生成单文件: ${outputPath}`);
        // createJson()//你实现一下参数
    }
}