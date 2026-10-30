// 固件通道元数据（对齐 Lite html_ui）：按 PushType 决定 URL 标签与
// 参数1/参数2（k1/k2）是否显示及其语义。type 0（关闭）无条目 → 全隐藏。
export const channelTypes = ['关闭', 'Webhook/POST', 'Telegram', 'Bark', '钉钉', 'PushDeer', '飞书', '企微机器人', '企微应用', 'Gotify', 'ServerChan', 'PushPlus', 'WxPusher', 'Pushover', 'Inotify', 'Next SMTP Proxy'];

export interface ChannelFieldMeta {
  urlLabel: string;
  urlPh: string;
  k1?: [string, string];
  k2?: [string, string];
}

export const channelMetaMap: Record<number, ChannelFieldMeta> = {
  1: {urlLabel: 'Webhook URL', urlPh: '完整请求地址', k1: ['鉴权 Token（可选）', 'Bearer Token，留空表示无鉴权'], k2: ['备用参数（可选）', '']},
  2: {urlLabel: 'Telegram API URL', urlPh: 'https://api.telegram.org/bot<BOT_TOKEN>/sendMessage', k1: ['Chat ID', '接收人的 Chat ID']},
  3: {urlLabel: 'Bark 推送 URL', urlPh: '例如 https://api.day.app/设备Key'},
  4: {urlLabel: '钉钉机器人 Webhook', urlPh: '包含 access_token 的完整机器人地址', k1: ['加签密钥（Secret）', '未开启加签时留空']},
  5: {urlLabel: 'PushDeer API URL', urlPh: '填写包含 pushkey 的完整请求地址'},
  6: {urlLabel: '飞书机器人 Webhook', urlPh: '飞书自定义机器人 Webhook 地址'},
  7: {urlLabel: '企业微信机器人 Webhook', urlPh: '包含 key 的完整机器人地址'},
  8: {urlLabel: '企业微信应用推送 URL', urlPh: '企业微信应用推送接口地址', k1: ['AgentId', '应用 AgentId'], k2: ['接收人', '成员账号，多个用 | 分隔']},
  9: {urlLabel: 'Gotify 消息 URL', urlPh: '例如 https://域名/message?token=应用Token'},
  10: {urlLabel: 'Server 酱推送 URL', urlPh: 'SCT 开头：https://sctapi.ftqq.com/Key.send'},
  11: {urlLabel: 'PushPlus API URL', urlPh: '默认 https://www.pushplus.plus/send', k1: ['Token', 'PushPlus 用户 Token']},
  12: {urlLabel: 'WxPusher API URL', urlPh: '默认 https://wxpusher.zjiecode.com/api/send/message', k1: ['AppToken', '应用 AppToken'], k2: ['UID', '接收人 UID']},
  13: {urlLabel: 'Pushover API URL', urlPh: '默认 https://api.pushover.net/1/messages.json', k1: ['应用 Token', 'Application API Token'], k2: ['用户 Key', 'User Key']},
  14: {urlLabel: 'INotify API URL', urlPh: '填写 INotify 推送接口地址'},
  15: {urlLabel: 'SMTP 转发接口 URL', urlPh: '填写可接收邮件 JSON 的 HTTP 接口'},
};
