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
        const entryExt = path.extname(this.entryFilePath);
        const entryBasename = path.basename(this.entryFilePath, entryExt);
        const outputDirForEntry = path.join(this.distPath, entryBasename);

        fs.mkdirSync(outputDirForEntry, { recursive: true });

        const emittedFileNames = new Set<string>();
        const processedFiles = new Set<string>();

        // ========== 工具函数 ==========

        /**
         * 判断文件是否在 node_modules 中（即外部依赖）
         */
        const isExternalModule = (filePath: string): boolean => {
            return filePath.includes(path.sep + 'node_modules' + path.sep) ||
                path.basename(path.dirname(filePath)) === 'node_modules';
        };

        /**
         * 判断是否为本地包（在 monorepo 中，比如 packages/*）
         * 可根据项目结构调整
         */
        const isLocalPackage = (filePath: string): boolean => {
            // 示例：你的 monorepo 结构是 packages/pkg-a/src/index.ts
            const relative = path.relative(this.cwdProjectInfo.pkgPath, filePath);
            return !relative.startsWith('..') && !isExternalModule(filePath);
        };

        /**
         * 解析 tsconfig paths 别名（如 "@/utils" -> "./src/utils"）
         */
        const resolvePathAlias = (specifier: string): string | null => {
            const tsConfigPath = path.join(this.cwdProjectInfo.pkgPath, 'tsconfig.json');
            if (!fs.existsSync(tsConfigPath)) return null;

            const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf8'));
            const paths: Record<string, string[]> | undefined = tsConfig.compilerOptions?.paths;

            if (!paths) return null;

            for (const [alias, mappings] of Object.entries(paths)) {
                // 处理通配符，例如: "@/*": ["src/*"]
                if (alias.endsWith('/*')) {
                    const prefix = alias.slice(0, -2);
                    if (specifier.startsWith(prefix + '/')) {
                        const suffix = specifier.slice(prefix.length + 1);
                        const target = mappings[0]?.replace('*', suffix);
                        if (target) {
                            return path.resolve(this.cwdProjectInfo.pkgPath, target);
                        }
                    }
                } else if (alias === specifier) {
                    const target = mappings[0];
                    if (target) {
                        return path.resolve(this.cwdProjectInfo.pkgPath, target);
                    }
                }
            }
            return null;
        };

        /**
         * 解析相对模块路径（只处理本地文件，跳过 node_modules）
         */
        const resolveModulePath = (specifier: string, fromDir: string): string | null => {
            if (!specifier.startsWith('.')) {
                // 非相对路径：可能是 paths 别名 或 外部依赖
                const resolvedAlias = resolvePathAlias(specifier);
                if (resolvedAlias) return resolvedAlias;
                return null; // 外部依赖，由 collectExternalDeps 处理
            }

            let resolved = path.resolve(fromDir, specifier);

            // 尝试 index 和扩展名
            for (const ext of ['.js', '.mjs', '.cjs', '.json', '.ts', '.mts', '.cts']) {
                const indexPath = path.join(resolved, `index${ext}`);
                if (fs.existsSync(indexPath) && !isExternalModule(indexPath)) {
                    return indexPath;
                }
                const fullPath = resolved + ext;
                if (fs.existsSync(fullPath) && !isExternalModule(fullPath)) {
                    return fullPath;
                }
            }

            return null;
        };

        /**
         * 移除注释
         */
        const removeComments = (code: string, filePath: string): string => {
            const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
            const printer = ts.createPrinter({ removeComments: true });
            return printer.printFile(sf);
        };

        /**
         * Tree Shaking：只对本地文件生效
         */
        const treeShaking = (f: SourceFile) => {
            if (isExternalModule(f.getFilePath())) return; // 外部包不做 shaking

            // （原有 shaking 逻辑不变）
            f.getImportDeclarations().forEach(decl => {
                const namedImports = decl.getNamedImports();
                const unused = namedImports.filter(imp => {
                    const name = imp.getName();
                    const refs = f.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === name);
                    return refs.length === 0;
                });
                unused.forEach(imp => imp.remove());
                if (!decl.getNamedImports().length && !decl.getDefaultImport() && !decl.getNamespaceImport()) {
                    decl.remove();
                }
            });

            // ... 其他 shaking 逻辑（变量、函数、类等）
            // （保持不变）
        };

        /**
         * 生成输出文件名
         */
        const getOutputFileName = (filePath: string): string => {
            if (filePath === this.entryFilePath) {
                return `index${entryExt}`;
            }
            const relative = path.relative(this.cwdProjectInfo.pkgPath, filePath);
            const ext = path.extname(relative);
            return relative.replace(/\\/g, '/').replace(/[\\/]/g, '_').replace(ext, '') + ext;
        };

        /**
         * 收集外部依赖（package name）
         */
        const collectExternalDeps = (file: SourceFile) => {
            [...file.getImportDeclarations(), ...file.getExportDeclarations()]
                .map(decl => decl.getModuleSpecifierValue())
                .filter((mod): mod is string => !!mod)
                .filter(mod => !mod.startsWith('.') && !mod.startsWith('/') && !mod.startsWith('@myorg/')) // 示例：跳过内部包
                .forEach(mod => {
                    const pkgName = mod.split('/')[0].startsWith('@')
                        ? mod.split('/').slice(0, 2).join('/')
                        : mod.split('/')[0];
                    this.dependencies[pkgName] = '';
                });
        };

        /**
         * 处理文件
         */
        const processFile = (file: SourceFile) => {
            const filePath = file.getFilePath();

            if (processedFiles.has(filePath)) return;
            processedFiles.add(filePath);

            // 如果是 node_modules 中的文件，只收集依赖，不输出
            if (isExternalModule(filePath)) {
                collectExternalDeps(file);
                return;
            }

            const fileName = getOutputFileName(filePath);
            const outputPath = path.join(outputDirForEntry, fileName);

            if (emittedFileNames.has(fileName)) {
                console.warn(`⚠️ 同名文件已存在，跳过: ${fileName}`);
                return;
            }

            const dirPath = path.dirname(filePath);

            // 重写 import/export（只对本地相对路径）
            file.getImportDeclarations().forEach(decl => {
                const specifier = decl.getModuleSpecifierValue();
                if (!specifier || !specifier.startsWith('.')) return;
                const resolvedPath = resolveModulePath(specifier, dirPath);
                if (!resolvedPath) {
                    // 保留原样，可能是外部包或别名
                    return;
                }
                const importedFileName = getOutputFileName(resolvedPath);
                const importPathWithoutExt = importedFileName.replace(/\.(js|mjs|cjs|ts|mts|cts)$/, '');
                const relativeImport = path.relative(path.dirname(outputPath), path.join(outputDirForEntry, importPathWithoutExt));
                decl.setModuleSpecifier(relativeImport.startsWith('.') ? relativeImport : `./${relativeImport}`);
            });

            file.getExportDeclarations().forEach(decl => {
                if (!decl.hasModuleSpecifier()) return;
                const specifier = decl.getModuleSpecifierValue();
                if (!specifier || !specifier.startsWith('.')) return;
                const resolvedPath = resolveModulePath(specifier, dirPath);
                if (!resolvedPath) return;
                const exportedFileName = getOutputFileName(resolvedPath);
                const exportPathWithoutExt = exportedFileName.replace(/\.(js|mjs|cjs|ts|mts|cts)$/, '');
                const relativeImport = path.relative(path.dirname(outputPath), path.join(outputDirForEntry, exportPathWithoutExt));
                decl.setModuleSpecifier(relativeImport.startsWith('.') ? relativeImport : `./${relativeImport}`);
            });

            collectExternalDeps(file);
            treeShaking(file);

            const code = removeComments(file.getFullText(), filePath);
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, code, 'utf8');
            emittedFileNames.add(fileName);

            const displayPath = path.relative(this.distPath, outputPath);
            console.log(`📄 已输出: ${displayPath}`);
        };

        /**
         * 深度遍历依赖图
         */
        const traverse = (file: SourceFile) => {
            if (processedFiles.has(file.getFilePath())) return;

            const dirPath = path.dirname(file.getFilePath());

            // 只处理本地文件的导入
            file.getImportDeclarations()
                .map(decl => decl.getModuleSpecifierValue())
                .filter((s): s is string => !!s && s.startsWith('.'))
                .map(specifier => resolveModulePath(specifier, dirPath))
                .filter((p): p is string => !!p)
                .filter(p => !isExternalModule(p)) // 只深入本地文件
                .forEach(resolvedPath => {
                    const depFile = project.addSourceFileAtPath(resolvedPath);
                    traverse(depFile);
                });

            file.getExportDeclarations()
                .filter(decl => decl.hasModuleSpecifier())
                .map(decl => decl.getModuleSpecifierValue())
                .filter((s): s is string => !!s && s.startsWith('.'))
                .map(specifier => resolveModulePath(specifier, dirPath))
                .filter((p): p is string => !!p)
                .filter(p => !isExternalModule(p))
                .forEach(resolvedPath => {
                    const depFile = project.addSourceFileAtPath(resolvedPath);
                    traverse(depFile);
                });

            processFile(file);
        };

        // ========== 主流程 ==========
        traverse(sourceFile);
        console.log(`✅ 抽取完成，共输出 ${emittedFileNames.size} 个文件`);
        console.log(`📁 入口文件路径: ${entryBasename}/index${entryExt}`);
        console.log(`📦 外部依赖: ${Object.keys(this.dependencies).join(', ')}`);
    }
}