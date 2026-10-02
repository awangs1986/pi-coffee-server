import type { CodeForge, ForgeRepository, Project, PullRequest } from "./workspaces.js";

export interface RepositoryRegistration {repoId:string;name:string;repoUrl:string;webUrl:string;branch:string}
export interface GiteaOptions {baseUrl:string;token:string;owner:string}
interface GiteaPull {number:number;html_url:string;state:string;head:{ref:string;repo_id?:number};base:{ref:string;repo_id?:number}}

export class GiteaClient implements CodeForge {
  private readonly base:URL;
  constructor(private readonly options:GiteaOptions) {
    this.base=new URL(options.baseUrl);
    if(!['http:','https:'].includes(this.base.protocol) || this.base.username || this.base.password)throw new Error('Gitea base URL must be credential-free HTTP(S)');
    if(!options.token || !/^[A-Za-z0-9_.-]+$/.test(options.owner))throw new Error('Gitea token and owner are required');
  }
  async listRepositories():Promise<ForgeRepository[]> {
    const repositories=new Map<string,ForgeRepository>();
    for(let page=1;;page++){
      const rows=await this.request(`/api/v1/user/repos?limit=50&page=${page}`,'GET');
      if(!Array.isArray(rows))throw new Error('Gitea returned an invalid repository list');
      for(const row of rows){const repo=this.repositoryView(row);repositories.set(repo.id,repo);}
      // Continue to an empty page: the server may cap the requested page size.
      if(!rows.length)break;
    }
    return [...repositories.values()];
  }
  async repository(input:unknown):Promise<ForgeRepository> {
    if(typeof input!=='string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(input))throw new Error('Choose a Gitea repository as owner/repo');
    const [owner,name]=input.split('/');
    return this.repositoryView(await this.request(`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,'GET'));
  }
  private repositoryView(value:unknown):ForgeRepository {
    const repo=value as Record<string,unknown>;
    if(!repo || !Number.isSafeInteger(repo.id) || Number(repo.id)<=0 || typeof repo.full_name!=='string' || typeof repo.clone_url!=='string' || typeof repo.html_url!=='string')throw new Error('Gitea returned invalid repository metadata');
    const permissions=repo.permissions as {push?:boolean;admin?:boolean}|undefined;
    return {id:String(repo.id),fullName:repo.full_name,private:repo.private===true,archived:repo.archived===true,defaultBranch:typeof repo.default_branch==='string' && repo.default_branch ? repo.default_branch : 'main',cloneUrl:repo.clone_url,webUrl:repo.html_url,canPush:permissions?.push===true || permissions?.admin===true,...(typeof repo.description==='string'?{description:repo.description}:{})};
  }
  async createRepository(name:string):Promise<RepositoryRegistration> {
    const repo=await this.request('/api/v1/user/repos','POST',{name,private:true,auto_init:false}) as Record<string,unknown>;
    return this.registration(repo);
  }
  async migrateRepository(name:string,sourceUrl:string):Promise<RepositoryRegistration> {
    const repo=await this.request('/api/v1/repos/migrate','POST',{clone_addr:sourceUrl,repo_name:name,repo_owner:this.options.owner,mirror:false,service:'git'}) as Record<string,unknown>;
    return this.registration(repo);
  }
  async createPullRequest(project:Project,source:string,target:string,title:string):Promise<PullRequest> {
    let owner=this.options.owner,name=project.name;
    if(project.repoId){
      const repo=await this.request(`/api/v1/repositories/${encodeURIComponent(project.repoId)}`,'GET') as {owner?:{login?:string};name?:string};
      if(!repo.owner?.login || !repo.name)throw new Error('Gitea repository identity unavailable');
      owner=repo.owner.login;name=repo.name;
    }
    const path=`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
    const query=new URLSearchParams({state:'open',head:`${owner}:${source}`,base:target});
    const matches=(pull:GiteaPull)=>pull.head?.ref===source && pull.base?.ref===target && (!project.repoId || String(pull.head.repo_id)===project.repoId && String(pull.base.repo_id)===project.repoId);
    let existing:GiteaPull|undefined;
    for(let page=1;;page++){
      const candidates=await this.request(`${path}?${query}&page=${page}&limit=50`,'GET') as GiteaPull[];
      existing=candidates.find(matches);
      if(existing || candidates.length<50)break;
    }
    const pull=existing ?? await this.request(path,'POST',{head:source,base:target,title}) as GiteaPull;
    if(!matches(pull))throw new Error('Gitea pull request does not match the Conversation branches');
    return {number:Number(pull.number),url:String(pull.html_url),state:String(pull.state),source,target};
  }
  private registration(repo:Record<string,unknown>):RepositoryRegistration {
    const branch=String(repo.default_branch || 'main');
    return {repoId:String(repo.id),name:String(repo.name),repoUrl:String(repo.clone_url),webUrl:String(repo.html_url),branch};
  }
  private async request(path:string,method:string,body?:unknown):Promise<unknown> {
    const url=new URL(path,this.base);
    const response=await fetch(url,{method,headers:{authorization:`token ${this.options.token}`,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000),redirect:'error'});
    const text=await response.text();let value:unknown={};try{value=text ? JSON.parse(text) : {};}catch{}
    if(!response.ok)throw new Error(`Gitea ${method} ${url.pathname} failed (${response.status})`);
    return value;
  }
}
