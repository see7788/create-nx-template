import type { PackageJson } from 'type-fest';
import path from 'path';
import fs from "fs"

export default function tool() {
    const cwdPath = process.cwd()
    let dir = cwdPath
    while (dir !== path.parse(dir).root) {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
            const pkgJson: PackageJson = JSON.parse(pkgContent)
            return { pkgPath, pkgJson, cwdPath }
        }
        dir = path.dirname(dir);
    }
    throw new Error('package.json not found');
}