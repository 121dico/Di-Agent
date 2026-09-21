import {selectTask,unavailableCrowd} from './snapshot.mjs';
import {crowdReferences} from './crowd-reference.mjs';
import {crowdURL} from './analysis-config.mjs';
export function selectAnalysis(snapshot,analysis,selection){
  const crowdId=analysis.crowdId||analysis.experiment?.overallCrowdId;
  if(!crowdId)return selectTask(snapshot,analysis.sourceId,selection);
  const source=snapshot.tasks.find(t=>t.id===analysis.sourceId);if(!source)return null;
  const references=crowdReferences(source),known=references.find(c=>c.id===crowdId);
  // 用户录入关联不等于已核验成员映射。任何 URL 参数都不能绕过保存的人群范围。
  const crowd=known||{id:crowdId,name:analysis.name,prdLabel:analysis.name,sourceURL:crowdURL(crowdId),captureMode:'用户配置，成员关系待核验'};
  return unavailableCrowd(source,crowd,references);
}
