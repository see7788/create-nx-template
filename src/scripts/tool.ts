import type { PackageJson } from 'type-fest';
import path from 'path';
import fs from "fs"

/**项目工具类 - 提供项目信息获取功能*/
export class ProjectTool {
  /**当前工作目录路径*/
  private readonly cwdPath: string;
  
  /**构造函数 - 初始化工具类*/
  constructor() {
    this.cwdPath = process.cwd();
  }
  
  /**查找package.json文件并返回项目信息*/
  public getProjectInfo(): { pkgPath: string; pkgJson: PackageJson; cwdPath: string } {
    let dir = this.cwdPath;
    
    while (dir !== path.parse(dir).root) {
      const pkgPath = path.join(dir, 'package.json');
      
      if (fs.existsSync(pkgPath)) {
        const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
        const pkgJson: PackageJson = JSON.parse(pkgContent);
        return { pkgPath, pkgJson, cwdPath: this.cwdPath };
      }
      
      dir = path.dirname(dir);
    }
    
    console.error('❌ 找不到 package.json 文件');
    console.error('\n💡 解决方法:');
    console.error('  1. 确保在正确的项目目录中运行命令');
    console.error('  2. 如果这是新项目，请先初始化 npm:');
    console.error('     npm init -y');
    throw new Error('找不到 package.json 文件');
  }
}

// 保留默认导出以保持向后兼容
// 在实际使用中，建议直接使用 ProjectTool 类
export default function tool() {
  return new ProjectTool().getProjectInfo();
}