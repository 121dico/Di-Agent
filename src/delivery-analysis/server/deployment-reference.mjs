// 来源为用户粘贴的六份BOSS详情，不是自动同步；编号仅表示粘贴顺序，不推断资源ID。
const cities='北京市,天津市,石家庄市,邯郸市,保定市,廊坊市,太原市,运城市,呼和浩特市,沈阳市,大连市,长春市,哈尔滨市,上海市,南京市,无锡市,徐州市,苏州市,南通市,盐城市,扬州市,泰州市,杭州市,宁波市,温州市,嘉兴市,湖州市,绍兴市,金华市,台州市,合肥市,福州市,厦门市,莆田市,泉州市,漳州市,龙岩市,宁德市,南昌市,赣州市,济南市,青岛市,烟台市,潍坊市,临沂市,菏泽市,郑州市,洛阳市,新乡市,商丘市,武汉市,宜昌市,孝感市,荆州市,长沙市,衡阳市,岳阳市,益阳市,郴州市,广州市,韶关市,深圳市,珠海市,汕头市,佛山市,江门市,茂名市,肇庆市,惠州市,梅州市,汕尾市,河源市,阳江市,清远市,东莞市,中山市,揭阳市,南宁市,柳州市,桂林市,海口市,三亚市,重庆市,成都市,德阳市,绵阳市,南充市,宜宾市,贵阳市,遵义市,昆明市,曲靖市,红河哈尼族彝族自治州,西安市,宝鸡市,咸阳市,兰州市,西宁市,银川市,乌鲁木齐市'.split(',');
const records=[
 ['1011337400','30-60','control_group','1533893795547197440','17:34:05','15:56:02','7.27-流失召回-top100城市-私家车流失30-60（对照组）2','7.27流失召回-top100城市-私家车流失30-60（单5折5元）'],
 ['1011337400','30-60','treatment_group','1531348692446228480','17:39:27','15:56:04','7.27-流失召回-top100城市-私家车流失30-60（实验组）2','7.27流失召回-top100城市-私家车流失30-60'],
 ['1011337415','60-90','control_group','1533894165925072896','17:42:34','15:56:07','7.27流失召回-top100城市-私家车流失60-90（对照组）2','7.27-流失召回-top100城市-私家车流失60-90（单5折5元）'],
 ['1011337415','60-90','treatment_group','1531349257259610112','17:46:30','15:56:09','7.27流失召回-top100城市-私家车流失60-90（实验组）2','7.27-流失召回-top100城市-私家车流失60-90'],
 ['1011337424','90-180','control_group','1533894437367959552','17:50:07','15:56:12','7.27-流失召回-top100城市-私家车流失90-180（对照组）2','7.27-流失召回-top100城市-私家车流失90-180（单5折5元）'],
 ['1011337424','90-180','treatment_group','1531350389759381504','17:52:39','15:56:14','7.27-流失召回-top100城市-私家车流失90-180（实验组）2','7.27-流失召回-top100城市-私家车流失90-180'],
];
export function deploymentReference(task) {
 if(task.kind!=='coupon'||task.sourceTaskId!=='184765378')return null;
 return {observedOn:'2026-09-21',captureMode:'用户提供的BOSS页面记录，非自动同步',business:'小桔充电',team:'充电中台运营',placeholderId:'10489',placeholderName:'首页天降红包（支持直塞）',toggle:'zhaohuifugou',abExperiment:true,
  schedule:{start:'2026-08-12 00:00:00',end:'2026-12-31 23:59:59',period:'所选周期内始终展示',hours:'00:00:00 - 23:59:59'},
  cities:[...cities],channels:['滴滴车主（APP）','滴滴出行（APP）','滴滴充电（微信小程序）','支付宝小程序','滴滴出行小程序','滴滴加油APP（充电）','小桔充电APP'],
  autoCoupon:true,excludeNewUsers:true,invertCrowd:false,blockRestriction:'无限制',frequency:{days:1,max:2},prompt:'专属超值优惠',businessTarget:null,
  proposalURL:'https://ddp.intra.xiaojukeji.com/material/story/M-ENERGY-4679?backUrl=/material/list?operationDirId=10091',
  records:records.map(([crowdId,cycle,group,redPacketId,created,offline,name,redPacketName],i)=>({ordinal:i+1,crowdId,cycle,group,redPacketId,name,description:name,redPacketName,resourceId:null,couponBatchIds:null,createdAt:'2026-08-12 '+created,offlineAt:'2026-08-24 '+offline,operator:'jocelynxue_i'})),
  notes:['配置关系已明确：三个Ditag包分别绑定同一Apollo接入的实验组、对照组；API用户成员与包内效果映射仍待核验。','配置起止、创建与下线记录不是完整在线日志，不据此推算实际持续投放时长。','对照组红包名称标注“单5折5元”，Apollo策略描述为“一张8折5元券”；需核对红包内部实际券配置。实验组券数量也不能仅凭红包名称确认。','红包ID不是券批次ID。页面应用PV/UV 20210/240不作为本活动曝光或点击。','粘贴详情未包含资源记录ID，未按六条链接的顺序猜配；整体目标值、曝光点击统计及历史画像仍缺。']};
}
