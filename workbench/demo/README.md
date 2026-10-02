# 活动管控台 Demo

## 本地启动

在仓库根目录配置 `.env`（可参考 `.env.example`），填入 `DEEPSEEK_API_KEY` 和 `YOSHUB_API_KEY`。不要把 `.env` 或生成图片提交到 Git。

```powershell
node workbench/demo/server.mjs
```

打开终端显示的本地地址。服务只绑定 `127.0.0.1`；文案仅在点击“DeepSeek 起草”时发送，图片仅在点击“YosHub 生成图片”时发送。生成的图片保存在 `workbench/demo/generated/`。

登录后的首页是“我的项目”。本地演示身份和项目数据保存在浏览器，不构成真实账号认证或多人协作服务。
