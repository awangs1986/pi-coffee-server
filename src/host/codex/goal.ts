import type {GoalState} from '../../shared/protocol.js';

/** Bounded engine-neutral display data; never exposes native thread IDs. */
export function codexGoal(value:unknown):GoalState|null {
  if(value===null)return null;
  if(!value||typeof value!=='object')throw Error('Native goal state is unavailable');
  const goal=value as Record<string,unknown>;
  if(typeof goal.objective!=='string'||goal.objective.length>4000||!['active','paused','blocked','usageLimited','budgetLimited','complete'].includes(String(goal.status)))throw Error('Native goal state is unavailable');
  const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:undefined;
  return {objective:goal.objective,status:goal.status as GoalState['status'],
    ...(count(goal.tokensUsed)===undefined?{}:{tokensUsed:count(goal.tokensUsed)}),
    ...(count(goal.timeUsedSeconds)===undefined?{}:{timeUsedSeconds:count(goal.timeUsedSeconds)}),
    ...(goal.tokenBudget===null?{tokenBudget:null}:count(goal.tokenBudget)===undefined?{}:{tokenBudget:count(goal.tokenBudget)})};
}
