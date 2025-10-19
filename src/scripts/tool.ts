import type { PackageJson } from 'type-fest';
import path from 'path';
import fs from "fs"
import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';

/**应用程序退出错误类 - 用于表示程序无法处理的致命异常情况*/
export class Appexit extends Error {
    /**
     * 构造应用程序退出错误
     * @param message 错误消息，描述发生的错误
     */
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**基类 - 提供通用的工具方法和项目信息访问*/
export class LibBase {
    protected readonly cwdProjectInfo: { pkgPath: string; pkgJson: PackageJson; cwdPath: string }
    
    constructor() {
        this.cwdProjectInfo = this.getcwdProjectInfo()
    }
    
    /**获取当前工作目录的项目信息 - 递归查找package.json*/
    private getcwdProjectInfo(): { pkgPath: string; pkgJson: PackageJson; cwdPath: string } {
        // 保存初始工作目录，确保后续操作始终使用同一个路径
        const cwdPath = process.cwd();
        let dir = cwdPath;
        while (dir !== path.parse(dir).root) {
            const pkgPath = path.join(dir, 'package.json');
            if (fs.existsSync(pkgPath)) {
                const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
                const pkgJson: PackageJson = JSON.parse(pkgContent);
                return { pkgPath, pkgJson, cwdPath };
            }
            dir = path.dirname(dir);
        }
        throw new Appexit('不存在 package.json 文件');
    }
    
    /**执行Git命令并处理错误 - 统一Git操作的错误处理（工具方法）*/
    protected runGitCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError: boolean = true): string | null {
        try {
            const result = execSync(`git ${cmd}`, {
                stdio: 'pipe',
                cwd: process.cwd(),
                ...(options || {})
            });
            return result.toString().trim();
        } catch (error: any) {
            if (throwOnError) {
                // 致命错误
                throw new Appexit(`Git命令执行失败: ${cmd}`);
            }
            // 非致命错误，返回null
            return null;
        }
    }
    
    /**执行交互式命令 - 用于需要用户交互的命令（工具方法）*/
    protected runInteractiveCommand(cmd: string, throwOnError: boolean = true): void {
        try {
            execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
        } catch (error: any) {
            if (throwOnError) {
                // 交互式命令执行失败是致命错误
                throw new Appexit('交互式命令执行失败');
            }
            // 非致命错误，静默失败
        }
    }
    
    /**执行通用命令并返回结果 - 支持非致命错误模式（工具方法）*/
    protected runCommand(cmd: string, options?: ExecSyncOptionsWithStringEncoding, throwOnError: boolean = true): string | null {
        try {
            const result = execSync(cmd, {
                stdio: 'pipe',
                cwd: process.cwd(),
                ...(options || {})
            });
            return result.toString().trim();
        } catch (error: any) {
            if (throwOnError) {
                // 致命错误
                throw new Appexit(`命令执行失败: ${cmd}`);
            }
            // 非致命错误，返回null
            return null;
        }
    }
}