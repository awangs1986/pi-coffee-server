/** Verify the credential owner before a scoped API, Git or Skill request. */
export async function verifyGiteaIdentity({url,token,owner,userId}) {
 if(userId===undefined)return; // Retain explicitly configured legacy single-owner installations.
 if(!Number.isSafeInteger(userId)||userId<=0||typeof owner!=='string'||!owner||typeof token!=='string'||!token)throw Error('Invalid scoped Gitea credential');
 const base=new URL(url);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Invalid Gitea service URL');
 const response=await fetch(base.href.replace(/\/$/,'')+'/api/v1/user',{headers:{authorization:'token '+token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Gitea authorization unavailable for this account; ask the administrator to check its binding');
 const identity=await response.json();
 if(identity.id!==userId||typeof identity.login!=='string'||identity.login.toLowerCase()!==owner.toLowerCase()||identity.active===false||identity.prohibit_login===true)throw Error('Gitea credential identity does not match this account');
}
