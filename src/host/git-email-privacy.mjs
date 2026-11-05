// Rejected GitHub pushes only. Never rewrite an already-published commit.
export const isEmailPrivacyRejection = error => /\bGH007\b/.test(String(error?.stderr ?? error?.message ?? error));
export function githubPrivateEmail(account) {
  if(!account)return 'pi-coffee@users.noreply.github.com';
  if(!/^[1-9][0-9]*$/.test(account.githubId)||!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(account.login))throw Error('GitHub anonymous identity unavailable');
  return `${account.githubId}+${account.login}@users.noreply.github.com`;
}
export async function repairGitEmailPrivacy({git,branch,expectedHead,email}) {
  const text=async args=>(await git(args)).toString('utf8').trim();
  const ref='refs/heads/'+branch;
  if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedHead)||!/^coffee\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(branch)||!/^[a-zA-Z0-9+_.-]+@users\.noreply\.github\.com$/.test(email))throw Error('Email repair requires an owned task branch and anonymous identity');
  if(await text(['symbolic-ref','HEAD'])!==ref||await text(['rev-parse','HEAD'])!==expectedHead)throw Error('Task branch changed before email repair');
  if(await text(['remote','get-url','origin'])!==await text(['remote','get-url','--push','origin']))throw Error('Email repair requires the same fetch and push repository');
  await git(['fetch','--no-tags','--prune','origin','+refs/heads/*:refs/remotes/origin/*','+refs/tags/*:refs/coffee/email-remote-tags/*']);
  const unpublished=(await text(['rev-list','--reverse','--topo-order','--max-count=101',expectedHead,'--not','--remotes=origin','--glob=refs/coffee/email-remote-tags/*'])).split('\n').filter(Boolean);
  if(unpublished.length>100)throw Error('Email repair exceeds 100 unpublished commits; inspect the task history');
  const replacements=new Map();let head,rewritten=0;
  if(!unpublished.length) {
    const tree=await text(['rev-parse',expectedHead+'^{tree}']);
    head=await anonymousGitCommit(git,{tree,parent:expectedHead,email,message:'Initialize task branch with an anonymous Git identity'});
  } else {
    for(const oid of unpublished) {
      const raw=await git(['cat-file','commit',oid]),separator=raw.indexOf('\n\n');
      if(separator<0||raw.length>1024*1024)throw Error('Commit metadata exceeds email repair limits');
      const header=raw.subarray(0,separator).toString('latin1');
      if(/^(?:gpgsig(?:-sha256)?|mergetag) /m.test(header))throw Error('Signed unpublished commits require explicit re-signing before email repair');
      let identities=0;
      const repaired=header.replace(/^parent ([a-f0-9]{40}(?:[a-f0-9]{24})?)$/gm,(_line,parent)=>'parent '+(replacements.get(parent)??parent))
        .replace(/^(author|committer) (.*) <([^<>\r\n]*)> ([0-9]+ [+-][0-9]{4})$/gm,(_line,role,name,oldEmail,date)=>{identities++;return `${role} ${name} <${oldEmail.endsWith('@users.noreply.github.com')?oldEmail:email}> ${date}`;});
      if(identities!==2)throw Error('Unsupported Git identity metadata; original commits retained');
      const next=Buffer.concat([Buffer.from(repaired,'latin1'),raw.subarray(separator)]);
      const replacement=next.equals(raw)?oid:(await git(['hash-object','-w','-t','commit','--stdin'],next)).toString().trim();
      replacements.set(oid,replacement);if(replacement!==oid)rewritten++;
    }
    head=replacements.get(expectedHead);
    if(!head||head===expectedHead)throw Error('GH007 persisted with anonymous commit identities; original commits retained');
  }
  const backupRef='refs/coffee/email-privacy/'+expectedHead;
  const previous=await text(['rev-parse','--verify',backupRef]).catch(()=>undefined);
  if(previous&&previous!==expectedHead)throw Error('Email recovery reference changed; original commits retained');
  await git(['update-ref',backupRef,expectedHead,previous??'0'.repeat(expectedHead.length)]);
  if(await text(['symbolic-ref','HEAD'])!==ref)throw Error('Task branch changed during email repair');
  await git(['update-ref','-m','PI Coffee: anonymize rejected task push',ref,head,expectedHead]);
  return {originalHead:expectedHead,head,backupRef,rewritten,anchor:!unpublished.length};
}

export async function anonymousGitCommit(git,{tree,parent,email,message}) {
  if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree)||parent&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(parent)||!/^[a-zA-Z0-9+_.-]+@users\.noreply\.github\.com$/.test(email))throw Error('Anonymous commit metadata is invalid');
  const date=Math.floor(Date.now()/1000)+' +0000';
  const raw=Buffer.from(`tree ${tree}\n${parent?'parent '+parent+'\n':''}author PI Coffee <${email}> ${date}\ncommitter PI Coffee <${email}> ${date}\n\n${message}\n`);
  return (await git(['hash-object','-w','-t','commit','--stdin'],raw)).toString().trim();
}
