import type { GitHubForge, GitHubRepository, Project, PullRequest } from "./workspaces.js";

/**
 * Thin GitHub REST adapter for Work tasks (ADR-0022). The token is used only for
 * API calls made by the Host (list repositories, look one up, open a PR); Git
 * clone/push keeps using the VM owner's own Git credentials, as with Gitea.
 */
export interface GitHubOptions { token:string; apiUrl?:string }
interface ApiRepository { id:number; name?:string; full_name?:string; private?:boolean; archived?:boolean; default_branch?:string; clone_url?:string; html_url?:string; pushed_at?:string|null; description?:string|null; permissions?:{push?:boolean;maintain?:boolean;admin?:boolean} }
interface ApiPull { number:number; html_url:string; state:string; head?:{ref?:string;repo?:{id?:number}|null}; base?:{ref?:string;repo?:{id?:number}|null} }

const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})";
const REPO = "[A-Za-z0-9._-]{1,100}";
export const GITHUB_FULL_NAME = new RegExp(`^${OWNER}/${REPO}$`);
/** GitHub lists at most this many of the token's most recently pushed repositories. */
const REPOSITORY_PAGES = 5;

/** Web host that serves repository pages for an API base: api.github.com → github.com; GHES serves both. */
export function githubWebHost(apiUrl="https://api.github.com"):string {
  const host=new URL(apiUrl).host.toLowerCase();
  return host==="api.github.com" ? "github.com" : host;
}

/** Accept `owner/repo`, a repository page URL, a clone URL or an SSH remote; return `owner/repo`. */
export function parseGitHubRepository(input:unknown,webHost="github.com"):string {
  if(typeof input!=="string")throw new Error("Enter a GitHub repository as owner/repo or its URL");
  let value=input.trim();
  const ssh=new RegExp(`^git@${webHost.replace(/[.]/g,"\\.")}:(.+)$`,"i").exec(value);
  if(ssh)value=ssh[1];
  else if(/^[a-z]+:\/\//i.test(value)) {
    let url:URL;try{url=new URL(value);}catch{throw new Error("Enter a GitHub repository as owner/repo or its URL");}
    if(url.host.toLowerCase()!==webHost.toLowerCase())throw new Error(`Only ${webHost} repositories can be added`);
    value=url.pathname.split("/").filter(Boolean).slice(0,2).join("/");
  }
  value=value.replace(/\.git$/i,"").replace(/^\/+|\/+$/g,"");
  if(!GITHUB_FULL_NAME.test(value) || value.split("/")[1].startsWith("."))throw new Error("Enter a GitHub repository as owner/repo or its URL");
  return value;
}

export class GitHubClient implements GitHubForge {
  private readonly api:URL;
  readonly webHost:string;
  constructor(private readonly options:GitHubOptions) {
    this.api=new URL(options.apiUrl?.trim() || "https://api.github.com");
    if(!["http:","https:"].includes(this.api.protocol) || this.api.username || this.api.password || this.api.search || this.api.hash)throw new Error("GitHub API URL must be credential-free HTTP(S)");
    if(!options.token || /\s/.test(options.token))throw new Error("GitHub token is required");
    this.webHost=githubWebHost(this.api.href);
  }
  async listRepositories():Promise<GitHubRepository[]> {
    const all:GitHubRepository[]=[];
    for(let page=1;page<=REPOSITORY_PAGES;page++) {
      const query=new URLSearchParams({per_page:"100",page:String(page),sort:"pushed",affiliation:"owner,collaborator,organization_member"});
      const rows=await this.request(`/user/repos?${query}`,"GET") as ApiRepository[];
      if(!Array.isArray(rows))throw new Error("GitHub returned an unexpected repository list");
      for(const row of rows){const repo=this.toRepository(row);if(repo)all.push(repo);}
      if(rows.length<100)break;
    }
    return all;
  }
  async repository(fullName:string):Promise<GitHubRepository> {
    if(!GITHUB_FULL_NAME.test(fullName))throw new Error("Invalid GitHub repository name");
    const [owner,name]=fullName.split("/");
    const repo=this.toRepository(await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,"GET") as ApiRepository);
    if(!repo)throw new Error("GitHub repository identity unavailable");
    return repo;
  }
  async createPullRequest(project:Project,source:string,target:string,title:string):Promise<PullRequest> {
    // Resolve the stable repository ID so a renamed or transferred repository still works.
    let fullName=project.name;
    if(project.repoId) {
      const repo=this.toRepository(await this.request(`/repositories/${encodeURIComponent(project.repoId)}`,"GET") as ApiRepository);
      if(!repo)throw new Error("GitHub repository identity unavailable");
      fullName=repo.fullName;
    }
    if(!GITHUB_FULL_NAME.test(fullName))throw new Error("GitHub repository identity unavailable");
    const [owner,name]=fullName.split("/");
    const path=`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
    const matches=(pull:ApiPull)=>pull.head?.ref===source && pull.base?.ref===target && (!project.repoId || String(pull.head?.repo?.id)===project.repoId && String(pull.base?.repo?.id)===project.repoId);
    const query=new URLSearchParams({state:"open",head:`${owner}:${source}`,base:target,per_page:"100"});
    const open=await this.request(`${path}?${query}`,"GET") as ApiPull[];
    const pull=(Array.isArray(open) ? open.find(matches) : undefined) ?? await this.request(path,"POST",{title,head:source,base:target}) as ApiPull;
    if(!matches(pull))throw new Error("GitHub pull request does not match the Conversation branches");
    return {number:Number(pull.number),url:String(pull.html_url),state:String(pull.state),source,target};
  }
  private toRepository(row:ApiRepository|undefined):GitHubRepository|undefined {
    if(!row || typeof row.id!=="number" || typeof row.full_name!=="string" || !GITHUB_FULL_NAME.test(row.full_name))return undefined;
    const permissions=row.permissions ?? {};
    return {
      id:String(row.id),fullName:row.full_name,private:Boolean(row.private),archived:Boolean(row.archived),
      defaultBranch:String(row.default_branch || "main"),cloneUrl:String(row.clone_url || ""),webUrl:String(row.html_url || ""),
      canPush:Boolean(permissions.push || permissions.maintain || permissions.admin),
      ...(row.pushed_at ? {pushedAt:row.pushed_at} : {}),...(row.description ? {description:row.description.slice(0,200)} : {}),
    };
  }
  private async request(path:string,method:string,body?:unknown):Promise<unknown> {
    // Join rather than resolve: a GitHub Enterprise base keeps its /api/v3 prefix.
    const url=new URL(this.api.href);
    const [pathname,search]=path.split("?");
    url.pathname=url.pathname.replace(/\/+$/,"")+pathname;url.search=search ? "?"+search : "";
    const response=await fetch(url,{method,headers:{
      authorization:`Bearer ${this.options.token}`,accept:"application/vnd.github+json","x-github-api-version":"2022-11-28","user-agent":"pi-coffee-host",
      ...(body===undefined ? {} : {"content-type":"application/json"}),
    },...(body===undefined ? {} : {body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000),redirect:"error"});
    const text=await response.text();let value:unknown={};try{value=text ? JSON.parse(text) : {};}catch{}
    if(!response.ok) {
      const data=value as {message?:unknown;errors?:Array<{message?:unknown}>};
      const detail=[data.message,...(Array.isArray(data.errors) ? data.errors.map(item=>item?.message) : [])].filter(item=>typeof item==="string" && item).join("; ").replace(/\s+/g," ").slice(0,300);
      throw new Error(`GitHub ${method} ${url.pathname} failed (${response.status})${detail ? ": "+detail : ""}`);
    }
    return value;
  }
}
