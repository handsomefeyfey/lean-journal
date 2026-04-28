# 体重周报

一个可本地打开、可安装到手机主屏幕、支持可选 Supabase 云同步的体重记录应用。

## 本地使用

1. 在当前目录启动静态服务：

```bash
cd /Users/didiao666/Documents/Codex/2026-04-28/hi
python3 -m http.server 4173
```

2. 电脑浏览器打开 `http://127.0.0.1:4173/`
3. 手机和电脑连同一个 Wi‑Fi 后，手机浏览器打开 `http://你的电脑局域网IP:4173/`

## 添加到手机主屏幕

- Android:
  使用 Chrome 打开页面，点页面里的“安装到主屏幕”，或使用浏览器原生安装入口。
- iPhone:
  用 Safari 打开页面，点“分享”，再选“添加到主屏幕”。

## 开启多设备同步

### 1. 创建 Supabase 项目

在 Supabase 控制台创建项目后，记下：

- `Project URL`
- `anon public key`

### 2. 启用邮箱密码登录

在 `Authentication -> Providers -> Email` 中启用 Email 登录。

### 3. 创建同步表

在 `SQL Editor` 中执行 [supabase-setup.sql](/Users/didiao666/Documents/Codex/2026-04-28/hi/supabase-setup.sql)。

### 4. 在应用里填同步配置

在页面的“多设备同步”区域填写：

- `Supabase URL`
- `Anon Key`
- 同步邮箱
- 同步密码

### 5. 直接注册或登录

- 如果还没有账号，点“注册并同步”
- 如果已经有账号，点“登录并同步”

### 6. 忘记密码或改密码

- 忘记密码时，先填同步邮箱，再点“发送重置邮件”
- 打开邮件里的链接后，会自动回到当前页面，并进入“更新密码”流程
- 已登录时，也可以直接输入新密码和确认密码，然后点“更新密码”

### 7. 当前部署说明

- 这个仓库当前已默认预配到 `kovicgsdezkylimczijg` 这个 Supabase 项目，所以公开站点打开后会自动带上 `Project URL` 和 `Publishable Key`
- 如果你以后把项目迁到新的 Supabase，请同步更新 [app.js](/Users/didiao666/Documents/Codex/2026-04-28/hi/app.js) 里的 `DEFAULT_SYNC_CONFIG`

## 同步策略

- 应用把整份数据快照同步到云端，而不是逐条同步。
- 这样删除记录也能正确同步到另一台设备。
- 登录时会自动比较“本地最近修改时间”和“云端最近更新时间”，优先保留更新的一侧。

## 离线说明

- 主要页面、样式、脚本、图表库和图标都已缓存到 Service Worker。
- 即使手机暂时断网，纯本地记录和查看历史仍可继续使用。
- 云同步和 Supabase 登录仍然需要网络。
