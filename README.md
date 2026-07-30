# Weather Ping 后台推送版

这是“真正后台推送版”的天气提醒 PWA：

- 手机订阅 Web Push
- 后端保存位置、多个定时、规则和行程
- Netlify Scheduled Function 每 15 分钟检查一次
- 到点后由服务器查询天气并主动推送
- 通知会包含：是否下雨、几点左右下雨、是否带伞、穿衣/添衣/减衣、防晒、大风、湿度体感等建议

## Netlify 环境变量

在 Netlify 项目中设置：

```txt
VAPID_PUBLIC_KEY=填你的公钥
VAPID_PRIVATE_KEY=填你的私钥
VAPID_SUBJECT=mailto:你的邮箱
```

生成密钥：

```bash
npm install
npm run gen:vapid
```

## 部署方式

推荐：GitHub + Netlify 自动部署。

1. 把 `netlify-push-app` 目录作为一个仓库推到 GitHub
2. Netlify 新建项目，连接这个仓库
3. Build command 留空或使用 `npm run build`
4. Publish directory 设置为 `public`
5. Functions directory 使用 `netlify/functions`
6. 添加上面的 VAPID 环境变量
7. 部署

部署完成后：

1. 用手机打开 Netlify 的 HTTPS 地址
2. 点“开启手机通知”
3. 添加多个定时推送时间
4. 点“测试详细推送”

## 限制

Netlify Scheduled Functions 的 cron 使用 UTC，并且此项目设置为每 15 分钟检查一次，所以定时推送可能有几分钟误差。手机系统也可能基于省电策略延迟展示通知，但不需要网页保持打开。
