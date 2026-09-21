import {selectTask} from '../server/snapshot.mjs';
// 离线文件只查询随文件保存的聚合快照，不访问账号、网络或实时服务。
const saved=JSON.parse(document.getElementById('deliverySnapshot').textContent);
window.deliveryOffline=saved;
window.deliveryAPI={
  async bootstrap(selection){
    const task=selectTask(saved.snapshot,saved.analysisTask.sourceId,selection);
    if(!task)throw new Error('报告中没有此数据');
    return {env:'live',builtAt:saved.snapshot.builtAt,status:{},task,analysisTask:saved.analysisTask,moduleOptions:saved.modules};
  },
};
