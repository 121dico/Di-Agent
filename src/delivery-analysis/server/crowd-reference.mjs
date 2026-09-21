// 用户授权从已登录 Ditag 页面读取；当前人数与历史规则分别记录，不推算历史人数。
const commonRules=[
 '充电-交易-历史累计总订单数 ≥ 1',
 '用户身份二级分类(新)为私家车、泛私家车，或三级分类(新)为顺风认证、顺风拉单',
];
const records=[
 {id:'1011337400',prdLabel:'私家车流失30～60天',name:'私家车流失30-60天',currentUsers:2458957,updatedAt:'2026-09-21 11:31:55',version:'V7',versionAt:'2026-09-18 18:14:39',dayRule:'自然人最近完成订单距离昨天的天数 ≥ 29 且 < 57',whitelistCount:1,historical:{version:'V3',name:'私家车流失30-60天',versionAt:'2026-08-11 11:09:37',users:null}},
 {id:'1011337415',prdLabel:'私家车流失60～90天',name:'私家车流失31-60天',currentUsers:1781910,updatedAt:'2026-09-21 11:03:17',version:'V7',versionAt:'2026-09-18 15:20:02',dayRule:'自然人最近完成订单距离昨天的天数 ≥ 58 且 < 87',whitelistCount:null,historical:{version:'V4',name:'私家车流失60-90天',versionAt:'2026-08-11 11:11:36',users:null}},
 {id:'1011337424',prdLabel:'私家车流失90～180天',name:'私家车流失61-180天',currentUsers:5109498,updatedAt:'2026-09-21 11:03:17',version:'V4',versionAt:'2026-09-18 15:24:10',dayRule:'自然人最近完成订单距离昨天的天数 ≥ 88 且 ≤ 207',whitelistCount:null,historical:{version:'V2',name:'私家车流失90-180天',versionAt:'2026-08-11 11:11:23',users:null}},
];
export function crowdReferences(task) {
 if(task.kind!=='coupon'||task.sourceTaskId!=='184765378')return [];
 return records.map(record=>({...record,observedOn:'2026-09-21',captureMode:'人工核验页面记录，非自动同步',status:'可使用',type:'筛选人群 · 离线',entity:null,creator:null,
  validFrom:'2026-03-05 00:00:00',validUntil:'2026-12-31 23:59:59',
  sourceURL:'https://ditag.intra.xiaojukeji.com/new-system/#/application/crowdDetail?id='+record.id+'&crowdUserType=normal&view=filter',
  rules:[commonRules[0],record.dayRule,commonRules[1],'历史至今未过期绑券量 = 0'],
  historical:{...record.historical,rules:[],whitelistCount:null},
  note:'PRD按包ID关联；当前名称和规则可能已变更。当前人数不是8月投放人数，不参与漏斗、分组占比或均衡检验；API明细与具体包成员映射仍待核验。',
 }));
}
