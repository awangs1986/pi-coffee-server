export interface GiteaTransport {url:string;token:string;owner:string;userId?:number}
export function verifyGiteaIdentity(credential:GiteaTransport):Promise<void>;
