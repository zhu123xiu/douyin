const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..', '..');
const target = path.join(base, 'cloudfunctions', 'importData', 'data', 'communication_topics.json');
const topics = JSON.parse(fs.readFileSync(target, 'utf8'));
const l1Map = {
  '饮食与进餐':'习惯与自理','睡眠与作息管理':'习惯与自理','习惯养成与自理能力':'习惯与自理','生活习惯与健康管理':'习惯与自理','生活作息与习惯养成':'习惯与自理','独立生活与自理能力':'习惯与自理',
  '情绪爆发与行为控制':'情绪与心理','情绪管理与心理支持':'情绪与心理','情绪管理与青春期前奏':'情绪与心理',
  '社交互动与分享意识':'社交能力','社交互动与同伴关系':'社交能力','社交与同伴关系':'社交能力',
  '亲子沟通与二胎家庭关系':'亲子沟通','分离焦虑与幼儿园适应':'亲子沟通','认知与学习启蒙':'学业与作业','学习与作业管理':'学业与作业','学业与作业管理':'学业与作业',
  '屏幕与电子产品管理':'屏幕与网络','电子产品与网络行为':'屏幕与网络','电子产品与娱乐管理':'屏幕与网络','消费与金钱观':'金钱与消费','安全规则与底线意识':'安全教育'
};
const l2Map = {'饮食与进餐':'进餐与饮食','睡眠与作息管理':'睡眠与作息','生活习惯与健康管理':'生活习惯与健康','生活作息与习惯养成':'作息与习惯养成','习惯养成与自理能力':'自理与独立','独立生活与自理能力':'自理与独立','认知与学习启蒙':'学习启蒙','学习与作业管理':'作业与学习习惯','学业与作业管理':'作业与学习习惯','屏幕与电子产品管理':'电子产品使用','电子产品与网络行为':'网络行为','电子产品与娱乐管理':'娱乐与游戏','情绪爆发与行为控制':'情绪爆发','情绪管理与心理支持':'情绪支持','情绪管理与青春期前奏':'青春期情绪','社交互动与分享意识':'分享与同伴相处','社交互动与同伴关系':'同伴关系','社交与同伴关系':'同伴关系','分离焦虑与幼儿园适应':'入园与分离','亲子沟通与二胎家庭关系':'二胎与手足'};
const money = new Set(['对金钱缺乏概念','毫无节约意识','零用钱挥霍无度','物质攀比心理','超市过度索取']);
const interest = new Set(['兴趣三分钟热度','抗拒枯燥练习','抱怨周末被占','逃避比赛考核','沉迷单一爱好']);
for (const topic of topics) {
  if ((topic.contentType || 'response') === 'proactive') { topic.level2 = ''; continue; }
  const oldL1 = topic.level1, oldL2 = topic.level2;
  let newL1 = l1Map[oldL1] || oldL1, newL2 = l2Map[oldL1] || '';
  if (oldL1 === '规则意识、金钱观与社会化发展') { newL1 = money.has(oldL2) ? '金钱与消费' : '规则与责任'; newL2 = ''; }
  if (oldL1 === '兴趣发展与家庭态度') { newL1 = interest.has(oldL2) ? '学业与作业' : '亲子沟通'; newL2 = interest.has(oldL2) ? '兴趣培养' : '家庭态度与冲突'; }
  if (oldL2 === '考前过度紧张') { newL1 = '学业与作业'; newL2 = '作业与学习习惯'; }
  topic.level1 = newL1; topic.level2 = newL2;
  topic.tags = Array.isArray(topic.tags) ? topic.tags : [];
  if (oldL2 && !topic.tags.includes(oldL2)) topic.tags.unshift(oldL2);
}
fs.writeFileSync(target, JSON.stringify(topics, null, 2) + '\n', 'utf8');
