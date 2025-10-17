// index.js
import createProject from './scripts/create-template.js';
import releaseProject from './scripts/release.js';
console.log(`
🔖 发布新版本:
  pnpm create nx-template -- --release
  pnpm create nx-template -- -r
  发布新版本（自动递增 )

✨ 创建新项目:
  pnpm create nx-template
  pnpm create nx-template my-app
`.trim());
const args = process.argv.slice(2);

// 👉 更健壮的 release 判断
const hasReleaseFlag = args.some(arg => arg === '-r' || arg === '--release');

if (hasReleaseFlag) {
  releaseProject();
} else {
  const projectName = args?.[0];
  createProject(projectName);
}

