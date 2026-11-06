import {lowRiskPlan} from './verification-risk.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {optionalArtifacts,sha256} from './artifacts.mjs';
// A single consumer contract for publication and staging; fixtures relax only the plan.
export async function requireVerification(repo,identity,receipt,{fixture=false,reviewBytes}={}){
 if(receipt.status!=='passed'||receipt.commit!==identity.commit||receipt.sourceFingerprint!==identity.sourceFingerprint||receipt.node!==process.version||!receipt.steps?.length||receipt.steps.some(step=>step.exitCode!==0)||JSON.stringify(receipt.artifacts)!==JSON.stringify(await optionalArtifacts(join(repo,'dist'))))throw Error('Current successful verification required');
 if(!fixture){const plan=receipt.risk==='low'?JSON.stringify(await lowRiskPlan(repo,receipt.baseCommit)):await readFile(join(repo,'scripts/verification-plan.json'));if(receipt.planSha256!==sha256(plan))throw Error('Approved verification plan required');}
 if(reviewBytes){const review=JSON.parse(reviewBytes);if(review.status!=='passed'||review.sourceFingerprint!==identity.sourceFingerprint||receipt.reviewSha256!==sha256(reviewBytes))throw Error('Final verification must follow this review');}
}
