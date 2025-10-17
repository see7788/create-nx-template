#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { build as esbuild } from 'esbuild'
import { build as tsupbuild } from 'tsup';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from "fs"
import tool from "./tool.js";
import prompts from 'prompts';

/**
 * 查找项目入口文件
 */
async function findEntryFilePath(cwdPath: string) {
  const entryOptions = [
    'index.ts',
    'index.tsx',
    'index.js',
    'index.jsx',
  ]
  const availableFiles = entryOptions
    .map(file => ({ file, fullPath: path.join(cwdPath, file) }))
    .filter(({ fullPath }) => fs.existsSync(fullPath));

  // 如果只有一个，直接用，不提问
  if (availableFiles.length === 1) {
    return availableFiles[0].file;
  }

  // 如果有多个，让用户选
  if (availableFiles.length > 1) {
    const response = await prompts({
      type: 'select',
      name: 'entry',
      message: '请选择入口文件',
      choices: availableFiles.map(({ file, fullPath }) => ({
        title: file,           // 显示相对路径
        value: file,
        description: fullPath, // 鼠标悬停或下拉时显示完整路径
      })),
    });
    return response.entry;
  }

  // 一个都没有
  throw new Error('entryFilePath undefind error');
}
export default async function distpkg() {
  try {
    const { pkgJson, cwdPath } = tool()
    const entryName = await findEntryFilePath(cwdPath)
    const entryFilePath = path.join(cwdPath, entryName)
    const distPath = path.join(cwdPath, "dist")
    const distPackagepath=path.join(distPath, 'package.json')
    mkdirSync(distPath, { recursive: true })
    await tsupbuild({
      entry: [entryFilePath],
      format: ['esm'],
      target: 'node18',
      outDir: distPath,
      dts: true,
      clean: true,
      sourcemap: true,
      external: ['node:*'],
    });
    const result = await esbuild({
      entryPoints: [entryFilePath],
      bundle: true,
      platform: 'node',
      target: 'node18',
      metafile: true,
      write: false,
      external: ['node:*'],
    })
    const imported = new Set<string>()
    for (const key in result.metafile.inputs) {
      const segs = key.match(/node_modules[/\\](?:\.pnpm[/\\])?(?:@[^/\\]+[/\\][^/\\]+|[^/\\]+)/g)
      if (!segs) continue
      for (const seg of segs) {
        const name = seg.includes('@')
          ? seg.split(/[/\\]/).slice(-2).join('/')
          : seg.split(/[/\\]/).pop()
        imported.add(name as any)
        console.log(name)
      }
    }

    const usedDeps: Record<string, string> = {}
    const usedDevDeps: Record<string, string> = {}
    for (const name of imported) {
      if (pkgJson.dependencies?.[name]) {
        usedDeps[name as any] = pkgJson.dependencies[name]
      } else if (pkgJson.devDependencies?.[name]) {
        usedDevDeps[name as any] = pkgJson.devDependencies[name]
      }
    }
    console.log('used deps:', usedDeps)
    console.log('used dev deps:', usedDevDeps)

    const distPkg = {
      name: pkgJson.name,
      version: pkgJson.version,
      description: pkgJson.description,
      keywords: pkgJson.keywords,
      author: pkgJson.author,
      license: pkgJson.license,
      repository: pkgJson.repository,
      main: './index.js',
      module: './index.js',
      types: './index.d.ts',
      exports: {
        '.': {
          types: './index.d.ts',
          import: './index.js',
          require: './index.js',
        },
      },
      dependencies: usedDeps,
      devDependencies: usedDevDeps,
    }
    writeFileSync(distPackagepath, JSON.stringify(distPkg, null, 2))
    console.log('done')
  } catch (error: any) {
    console.error(error)
  }
}



// ✅ 检查是否直接执行此脚本
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  distpkg().catch((error: any) => {
    console.error('❌ 发布过程中发生错误:', error.message);
    if (error.stack) {
      console.error('详细错误信息:', error.stack);
    }
    process.exit(1);
  });
}