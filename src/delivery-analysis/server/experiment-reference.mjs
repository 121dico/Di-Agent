// 经用户授权读取的历史页面记录；不参与API漏斗计算，不当作自动同步数据。
const source='https://x.intra.xiaojukeji.com/exp/501026732376065?globalBusinessId=6300&globalProjectId=432395315052545';
const samples=[
  ['2026-08-12',152823,153178],['2026-08-13',152041,152492],['2026-08-14',156851,156879],
  ['2026-08-15',160697,160947],['2026-08-16',159454,159811],['2026-08-17',156818,157861],
  ['2026-08-18',153962,153822],['2026-08-19',154913,155097],['2026-08-20',152684,152717],
  ['2026-08-21',156747,157047],['2026-08-22',160202,160569],['2026-08-23',157040,157184],
  ['2026-08-24',117098,117218],
];
export function experimentReference(task) {
  if(task.kind!=='coupon'||task.sourceTaskId!=='184765378')return null;
  return {
    experimentId:'501026732376065',name:'召回复购策略实验30–60天',toggle:'zhaohuifugou',
    observedOn:'2026-09-21',captureMode:'人工核验历史记录，非自动同步',status:'已结束',unit:'DUID',
    sourceURL:source+'&expFlowTab=design',monitoringURL:source+'&expFlowTab=monitoring&monitoringTab=everyday',
    scopeNote:'Apollo实验分流样本；与当前召回目标人群的包含关系尚未核验，不参与漏斗转化率，各日不可相加。',
    identityNote:'平台按DUID分流；PRD将apollo_key按UID转换，离线字段口径仍待核验。',
    groups:[{key:'control_group',name:'对照组',allocation:.5,strategy:'仅发一张8折5元券'},{key:'treatment_group',name:'实验组',allocation:.5,strategy:'发三张券'}],
    records:samples.map(([date,control_group,treatment_group])=>({date,control_group,treatment_group})),
  };
}
