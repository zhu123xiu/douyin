# -*- coding: utf-8 -*-
import json, os, sys
from collections import Counter, defaultdict
BASE = os.path.join(os.path.dirname(__file__), '..', '..')
TOPICS = os.path.join(BASE, 'cloudfunctions', 'importData', 'data', 'communication_topics.json')
SNAPSHOT = os.path.join(os.path.dirname(__file__), 'topics_before_transform.json')
EXPECTED_L1 = {'习惯与自理':70,'学业与作业':56,'屏幕与网络':40,'情绪与心理':35,'社交能力':34,'亲子沟通':30,'金钱与消费':15,'规则与责任':10,'安全教育':10}
EXPECTED_L2 = {'习惯与自理':{'进餐与饮食':10,'睡眠与作息':10,'生活习惯与健康':15,'作息与习惯养成':15,'自理与独立':20},'学业与作业':{'作业与学习习惯':41,'学习启蒙':10,'兴趣培养':5},'屏幕与网络':{'电子产品使用':10,'网络行为':15,'娱乐与游戏':15},'情绪与心理':{'情绪爆发':10,'情绪支持':10,'青春期情绪':15},'社交能力':{'分享与同伴相处':10,'同伴关系':24},'亲子沟通':{'入园与分离':10,'二胎与手足':10,'家庭态度与冲突':10},'金钱与消费':{'':15},'规则与责任':{'':10},'安全教育':{'':10}}
def fail(msg): print('FAIL:', msg); sys.exit(1)
def main():
    topics=json.load(open(TOPICS,encoding='utf-8')); snapshot=json.load(open(SNAPSHOT,encoding='utf-8'))
    if len(topics)!=600 or len(snapshot)!=600: fail('话题总数或基线快照异常')
    for i,(a,b) in enumerate(zip(topics,snapshot)):
        if a['_id']!=b['_id']: fail(f'第 {i} 条顺序/ID 变了')
    types=[t.get('contentType','response') for t in topics]
    if types.count('response')!=300 or types.count('proactive')!=300: fail('contentType 构成应为 response/proactive 各 300')
    l1=Counter(); l2=defaultdict(Counter)
    for t in topics:
        if t.get('contentType','response')=='response': l1[t['level1']]+=1; l2[t['level1']][t['level2']]+=1
    if dict(l1)!=EXPECTED_L1: fail(f'level1 分布不符。实际: {dict(l1)}')
    for k, exp in EXPECTED_L2.items():
        if dict(l2[k])!=exp: fail(f'level2 分布不符 [{k}]。实际: {dict(l2[k])}')
    mutable={'level1','level2','tags'}
    for now,before in zip(topics,snapshot):
        changed={k for k in set(now)|set(before) if now.get(k)!=before.get(k)}
        if changed-mutable: fail(f"{now['_id']} 改了不允许改的字段: {sorted(changed-mutable)}")
    for now,before in zip(topics,snapshot):
        if now.get('contentType','response')=='response':
            if not now['tags'] or now['tags'][0]!=before['level2']: fail(f"{now['_id']} tags 首位错误")
            if len(set(now['tags']))!=len(now['tags']): fail(f"{now['_id']} tags 存在重复项")
        elif now.get('level2')!='': fail(f"{now['_id']} proactive 的 level2 应为空字符串")
    for now in topics:
        if now.get('contentType','response')=='response' and '考前过度紧张' in now['tags'][:1] and (now['level1']!='学业与作业' or now['level2']!='作业与学习习惯'): fail('考前过度紧张分类错误')
    print('ALL PASS')
    print('  - 600 条数量与顺序不变，response/proactive 各 300')
    print('  - level1 九类分布与预期一致（学业与作业 56 / 社交能力 34 含错分类修正）')
    print('  - level2 子分类分布与预期一致，三类置空正常')
    print('  - 除 level1/level2/tags 外所有字段与快照逐字节一致')
    print('  - response 的 tags[0] = 旧 level2，无重复项；proactive level2 全空')
if __name__=='__main__': main()
