import prompts from 'prompts';
import createProject from './scripts/create-template';
import releaseProject from './scripts/release';
import distpkg from './scripts/dist-pkg';

const args = process.argv.slice(2);

async function main() {
  const [cmd, param] = args;
  switch (cmd) {
    case '--help':
    case '-h':
      console.log(`
            create <name>    创建新项目
            init <name>      创建新项目
            template <name>  创建新项目
            release          发布版本
            r                发布版本
            dist             抽取npm包
            help             显示帮助
            h                显示帮助
      `);
      process.exit(0);
    case 'create':
    case 'template':
    case "init":
      const projectName = param;
      await createProject(projectName);
      break;
    case 'release':
    case 'r':
      await releaseProject();
      break;
    case 'dist':
      await distpkg();
      break;
    default:
      const response = await prompts({
        type: 'select',
        name: 'action',
        message: '请选择操作',
        choices: [
          { title: '🆕 创建新项目', value: 'create' },
          { title: '📦 发布版本', value: 'release' },
          { title: '🎯 抽取 npm 包', value: 'dist' },
        ],
      });

      switch (response.action) {
        case 'create':
          const projectResponse = await prompts({
            type: 'text',
            name: 'name',
            message: '请输入项目名称',
            validate: (v) => (v ? true : '项目名称不能为空'),
          });
          await createProject(projectResponse.name);
          break;

        case 'release':
          await releaseProject();
          break;

        case 'dist':
          await distpkg();
          break;

        default:
          console.log('取消');
          process.exit(0);
      }
  }
}

main().catch((err) => {
  console.error('❌ 程序异常:', err);
  process.exit(1);
});