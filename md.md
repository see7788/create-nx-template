# 1. 进入项目目录
cd F:\pro\1\app\create-7788-template

# 2. 确保在 master 分支
git checkout master

# 3. 拉取最新代码（防止冲突）
git pull origin master

# 4. 确认 package.json 已修改为：
#    "name": "@see7788/create-template"
#    "bin": { "create-template": "index.js" }
#    版本改为 1.1.7
#    用 VS Code 或记事本打开检查

# 5. 添加 package.json
git add package.json

# 6. 提交更改
git commit -m "release: v1.1.8"

# 7. 推送到 GitHub
git push origin master

# 8. 打标签 v1.1.8
git tag v1.1.8

# 9. 推送标签到 GitHub
git push origin v1.1.8