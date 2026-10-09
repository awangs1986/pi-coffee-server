/** Private transport shape. Never spread this into browser account metadata. */
export interface GitHubCredentials {token:string;refreshToken?:string;expiresAt?:number;refreshExpiresAt?:number;}
export function githubSecret(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=4096&&!/\s/.test(value);}
export function oauthCredentials(value:unknown,now=Date.now()):GitHubCredentials {
  if(!value||typeof value!=='object')throw Error('Invalid GitHub OAuth response');
  const row=value as Record<string,unknown>;
  if(row.error||!githubSecret(row.access_token))throw Error('GitHub OAuth rejected');
  if(row.refresh_token===undefined&&row.expires_in===undefined&&row.refresh_token_expires_in===undefined)return {token:row.access_token};
  const duration=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<=0||v>366*86400)throw Error('Invalid GitHub OAuth expiry');return v*1000;};
  if(!githubSecret(row.refresh_token))throw Error('Invalid GitHub refresh credential');
  return {token:row.access_token,refreshToken:row.refresh_token,expiresAt:now+duration(row.expires_in),refreshExpiresAt:now+duration(row.refresh_token_expires_in)};
}

/** OAuth replies contain secrets; bound them before parsing and never echo them. */
export async function githubOAuthResponse(response:Response):Promise<unknown>{
  if(!response.body)throw Error('Empty GitHub OAuth response');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384)throw Error('Invalid GitHub OAuth response');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>undefined);throw error;}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
