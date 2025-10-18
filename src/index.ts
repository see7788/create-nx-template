import prompts from 'prompts';
import createProject from './scripts/create-template.js';
import releaseProject from './scripts/release.js';
import distpkg from './scripts/dist-pkg.js';

/**命令行界面类 - 处理命令行参数和用户交互*/
class CLI {
  /**命令行参数*/
  private readonly args: string[];
  
  /**构造函数 - 初始化命令行参数*/
  constructor() {
    this.args = process.argv.slice(2);
  }
  
  /**显示帮助信息*/
  private showHelp(): void {
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
  }
  
  /**处理命令行参数*/
  private async handleCommand(cmd: string, param: string): Promise<void> {
    switch (cmd) {
      case '--help':
      case '-h':
      case 'help':
        this.showHelp();
        break;
      case 'create':
      case 'template':
      case 'init':
        await createProject(param);
        break;
      case 'release':
      case 'r':
        await releaseProject();
        break;
      case 'dist':
        await distpkg();
        break;
      default:
        await this.showInteractiveMenu();
    }
  }
  
  /**显示交互式菜单*/
  private async showInteractiveMenu(): Promise<void> {
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
        await createProject();
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
  
  /**执行主程序逻辑*/
  public async run(): Promise<void> {
    try {
      const [cmd, param] = this.args;
      await this.handleCommand(cmd, param);
    } catch (err) {
      console.error('❌ 程序异常:', err);
      process.exit(1);
    }
  }
}

/**创建CLI实例并运行*/
const cli = new CLI();
cli.run();