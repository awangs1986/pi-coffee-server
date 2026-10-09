import {githubOAuthResponse,githubSecret,type GitHubCredentials} from '../shared/github-credentials.js';
/** Web retains the App secret; Host alone retains refresh credentials. */
export function githubRenewalClient(endpoint:string,transportToken:string,user?:string){
  const url=new URL(endpoint);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/internal/github-refresh'||!transportToken)throw Error('Invalid GitHub renewal broker configuration');
  return async(refreshToken:string):Promise<GitHubCredentials>=>{
    const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+transportToken,'content-type':'application/json',...(user?{'x-pi-coffee-user':user}:{})},body:JSON.stringify({refreshToken}),signal:AbortSignal.timeout(18000),redirect:'error'});
    if(response.status===409)throw Error('github_reconnect_required');
    if(!response.ok)throw Error('github_refresh_unavailable');
    const result=await githubOAuthResponse(response) as GitHubCredentials;
    if(!githubSecret(result.token)||!githubSecret(result.refreshToken))throw Error('github_refresh_unavailable');
    return result;
  };
}
