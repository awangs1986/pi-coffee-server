import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {workspaceGitTransport,type WorkspaceGitTransport} from './workspace-git-transport.js';
import type {ManagedNativeCustody} from './managed-native.js';

const exec=promisify(execFile);
export function workspaceGitCommand(args:string[]){let index=0;while(args[index]==='-c')index+=2;return args[index];}
interface GitOptions {cwd:string;env:NodeJS.ProcessEnv;timeout:number;maxBuffer:number;custody?:ManagedNativeCustody;managedRequired:boolean;transport?:WorkspaceGitTransport;identity?:{name:string;email:string}}
type Files={kind:'copy-index'|'remove-index';index:string}|{kind:'exclude'};

// This program is passed as argv to an immutable interpreter inside the same
// mandatory namespace as native writers. Repository checks are defense in depth:
// a concurrent config/symlink replacement still cannot gain Host authority.
const managedProgram=String.raw`
import json,os,re,stat,subprocess,sys,shutil
from urllib.parse import urlparse
from pathlib import Path
request=json.loads(sys.argv[1]); cwd=Path.cwd(); gitdir=cwd/'.git'
def deny():
    sys.stderr.write('Managed workspace Git configuration or path is unsupported\n');sys.exit(78)
def checked(path,directory=False,missing=False):
    try: info=path.lstat()
    except FileNotFoundError:
        if missing:return
        deny()
    if stat.S_ISLNK(info.st_mode) or path.resolve()!=path or (directory and not stat.S_ISDIR(info.st_mode)) or (not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink!=1)):deny()
if cwd.resolve()!=cwd:deny()
env={'PATH':'/usr/bin:/bin','HOME':os.environ['HOME'],'LANG':'C.UTF-8','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_SYSTEM':'/dev/null','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_LITERAL_PATHSPECS':request.get('literal','1'),'GIT_CEILING_DIRECTORIES':str(cwd.parent),'GIT_ATTR_NOSYSTEM':'1'}
command=['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','protocol.allow=never','-c','protocol.file.allow=always','-c','protocol.ext.allow=never','-c','protocol.ssh.allow=never','-c','credential.helper=','-c','core.askPass=/bin/false']
transport=request.get('transport')
if transport:
    command+=['-c','protocol.http.allow=always','-c','http.followRedirects=false','-c','url.http://127.0.0.1:'+str(transport['port'])+'/repository.insteadOf='+transport['repository']]
identity=request.get('identity')
if identity:
    env.update(GIT_AUTHOR_NAME=identity['name'],GIT_AUTHOR_EMAIL=identity['email'],GIT_COMMITTER_NAME=identity['name'],GIT_COMMITTER_EMAIL=identity['email'])
if gitdir.exists() or gitdir.is_symlink():
    checked(gitdir,True)
    for name in ['config','HEAD','index','packed-refs','shallow']:
        checked(gitdir/name,missing=True)
    for name in ['objects','objects/info','info','refs']:
        checked(gitdir/name,True,True)
    for name in ['commondir','gitdir','config.worktree','objects/info/alternates','objects/info/http-alternates']:
        if (gitdir/name).exists() or (gitdir/name).is_symlink():deny()
    result=subprocess.run(command+['config','--local','--no-includes','--null','--list'],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    if result.returncode or len(result.stdout)>1048576:deny()
    safe=re.compile(r'^(core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|quotepath|abbrev|bigfilethreshold|ignorestat|trustctime|checkstat)|remote\.[^.]+\.(url|pushurl|fetch)|branch\..+\.(remote|merge|rebase)|user\.(name|email)|init\.defaultbranch|extensions\.objectformat)$')
    for row in result.stdout.split(b'\0'):
        if not row:continue
        key,_,value=row.partition(b'\n');key=key.decode('utf8').lower()
        if not safe.fullmatch(key) or key=='core.bare' and value.lower()!=b'false':deny()
        if key.endswith(('.url','.pushurl')):
            value=value.decode('utf8')
            # No credential/SSH/ext helpers or ungranted local transport paths.
            if value.startswith(('http://','https://')):
                parsed=urlparse(value)
                if parsed.username or parsed.password or parsed.query or parsed.fragment:deny()
                continue
            if '://' in value or re.match(r'^[^/]+:',value):deny()
            target=Path(value) if value.startswith('/') else cwd/value
            if not any(target.resolve()==Path(root) or Path(root) in target.resolve().parents for root in request['sources']):deny()
index=request.get('index')
if index:
    if Path(index).parent!=gitdir or not re.fullmatch(r'pi-coffee-(snapshot|file)-[a-f0-9-]+\.index',Path(index).name):deny()
    checked(Path(index),missing=True);checked(Path(index+'.lock'),missing=True)
    env['GIT_INDEX_FILE']=index
operation=request.get('files')
if operation:
    checked(gitdir,True)
    if operation=='copy-index':
        try:shutil.copyfile(gitdir/'index',index)
        except FileNotFoundError:pass
    elif operation=='remove-index':
        for path in [Path(index),Path(index+'.lock')]:path.unlink(missing_ok=True)
    elif operation=='exclude':
        info=gitdir/'info';info.mkdir(exist_ok=True);checked(info,True)
        path=info/'exclude';checked(path,missing=True)
        content=path.read_text() if path.exists() else ''
        if '/.pi-coffee/' not in content.splitlines():
            with path.open('a') as file:file.write('\n/.pi-coffee/\n')
    else:deny()
    sys.exit(0)
os.execve('/usr/bin/git',command+request['args'],env)
`;

async function managed(custody:ManagedNativeCustody,options:GitOptions,request:Record<string,unknown>){
  const args=request.args as string[]|undefined;
  const relay=options.transport?await workspaceGitTransport(custody.profile.lock,options.transport,args?workspaceGitCommand(args)==='push':false):undefined;
  try {
    const prepared=await custody.prepare({executable:'/usr/bin/python3',cwd:options.cwd,httpTransport:relay,args:['-c',managedProgram,JSON.stringify({...request,identity:options.identity,...(relay?{transport:{repository:relay.repository,port:relay.port}}:{}),sources:custody.profile.sources.map(source=>source.destination)})]});
    return await exec(process.execPath,[prepared.cliPath],{cwd:options.cwd,env:{PATH:'/usr/bin:/bin',...prepared.env},timeout:options.timeout,maxBuffer:options.maxBuffer,encoding:'buffer'});
  } finally {await relay?.close();}
}

/** Host Git never evaluates workspace state with greater authority than the
 * native writer that supplied it. Legacy account wrappers remain unchanged. */
export async function executeWorkspaceGit(args:string[],options:GitOptions):Promise<{stdout:Buffer;stderr:Buffer}>{
  if(options.managedRequired&&!options.custody)throw Error('Managed workspace Git executor is unavailable');
  try {
    if(options.custody)return await managed(options.custody,options,{args,literal:options.env.GIT_LITERAL_PATHSPECS,index:options.env.GIT_INDEX_FILE});
    return await exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd:options.cwd,env:options.env,timeout:options.timeout,maxBuffer:options.maxBuffer,encoding:'buffer'});
  } catch(error){
    const failure=error as Error & {stdout?:Buffer|string;stderr?:Buffer|string;code?:number|string};
    // Policy failures must not become an empty successful bounded diff/result.
    if(options.custody&&failure.code===78)throw Error('Managed workspace Git configuration or path is unsupported');
    if(Buffer.isBuffer(failure.stdout))failure.stdout=failure.stdout.toString('utf8');
    if(Buffer.isBuffer(failure.stderr))failure.stderr=failure.stderr.toString('utf8');
    throw error;
  }
}

/** Git metadata writes stay inside custody too; validating a Git-returned path
 * before a privileged Host write would leave a symlink/config replacement race. */
export async function managedWorkspaceGitFiles(custody:ManagedNativeCustody,cwd:string,files:Files){
  await managed(custody,{cwd,env:{},timeout:20000,maxBuffer:65536,custody,managedRequired:true},{files:files.kind,...('index' in files?{index:files.index}:{})});
}
