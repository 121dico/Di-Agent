// 字段用途与查询证据一起保存；新增未知字段必须如实标为尚未接入。
export const AUDIENCE_DIMENSIONS = {
  axc_buy_status:'安心充购买状态', ds_freq_type:'安心充频次分层',
  charge_is_member_active:'会员有效标记', charge_most_order_city_id:'高频订单城市 ID',
  first_axc_date:'安心充首单日期', last_axc_date:'安心充最近订单日期',
};
const purposes = {
  duid:'去重人数、记录粒度校验；不返回用户明细',
  dt:'选择最新快照分区、展示数据新鲜度',
  group_type:'来源组人数、效果对比；不自动认定随机实验',
  crowd_id:'限定安心充人群包、记录来源标识',
  source_task_id:'限定召回任务、记录来源标识',
  entry_dt:'按进组日统计发券后 7 日复购，不跨日相加',
  stat_dt:'分日效果和日期筛选',
  activity_cycle:'流失周期分布和分日效果拆解',
  charge_life_cycle:'生命周期画像和分日拆解',
  charge_freq_type:'充电频次画像和分日拆解',
  charge_duid_role_name_v2_type:'用户身份画像和分日拆解',
  member_status:'会员状态画像和分日拆解',
  city_name:'城市画像和分日拆解',
  city_fenkuang:'城市分框画像和分日拆解',
  charge_region:'战区画像和分日拆解',
  axc_buy_status:'安心充购买状态画像',
  ds_freq_type:'安心充频次分层画像',
  charge_is_member_active:'会员有效标记画像；空值单独显示未知',
  charge_most_order_city_id:'高频订单城市 ID 画像；不等同投放城市',
  first_axc_date:'首单日期分布；不等同投放后新增首单',
  last_axc_date:'最近订单日期分布；不推断投放归因',
  first_axc_order_id:'仅校验非空覆盖人数，不拉取订单明细',
  last_axc_order_id:'仅校验非空覆盖人数，不拉取订单明细',
  axc_ord_cnt_30d:'单日快照近 30 天安心充订单合计，不能跨日累加',
  chg_ord_cnt_30d:'单日快照近 30 天充电订单合计，作为订单比率分母',
  is_entry:'校验进组标记，保证漏斗分母属于进组人群',
  is_coupon:'领券人数、主漏斗及领券后复购率分母',
  is_full_coupon:'完整发券子集人数',
  is_repurchase_7d:'整体复购人数、领券且复购人数',
  is_full_coupon_repurchase_7d:'源表完整发券后 7 日复购人数，不用推算值替代',
  achieved_flag:'源表个人达标人数',
  unmet_flag:'源表个人未达标人数及画像',
  target_rate:'源表个人目标及非空覆盖；只有全覆盖同值才显示统一目标',
  effect_rate:'个人渗透率均值、非空覆盖及原始范围；与整体订单比率分开',
};
export function describeCoverage(sources,queries) {
  return Object.entries(sources).map(([kind,source])=>{
    const sourceQueries=queries.filter(q=>q.sourceId===source.source_id);
    return {kind,name:source.name,sourceId:source.source_id,fields:source.fields.map(field=>{
      const evidence=sourceQueries.filter(q=>[...(q.query.fields||[]),...(q.query.filters||[])].some(f=>f.name===field.name));
      const used=!!purposes[field.name] && evidence.length>0;
      return {name:field.name,label:field.label || field.description,type:field.data_type || field.dataType,status:used?'已接入':'尚未接入',purpose:kind==='audience' && field.name==='group_type'?'来源组人数与当前快照画像分布':kind==='audience'?purposes[field.name]?.replace('画像和分日拆解','当前快照画像（不替代历史效果标签）') || '新增字段待确认业务口径':purposes[field.name] || '新增字段待确认业务口径',queryId:evidence[0]?.queryId || null};
    })};
  });
}
