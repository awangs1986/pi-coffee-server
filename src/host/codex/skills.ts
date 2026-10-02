import { isAbsolute, resolve } from 'node:path';
import type { CommandInfo } from '../../shared/protocol.js';
import type { CodexAppServer, Obj } from './rpc.js';

/** Native discovery owns precedence, configured roots and enabled state. */
export async function codexSkills(server: CodexAppServer, cwd: string): Promise<Array<{name:string;description:string;path:string}>> {
  const result = await server.request('skills/list', {cwds:[cwd], forceReload:true},10000) as Obj;
  if (!Array.isArray(result.data)) throw new Error('Invalid native Codex Skill catalog');
  const entry = (result.data as Obj[]).find(item => typeof item.cwd==='string' && resolve(item.cwd)===resolve(cwd));
  if (!entry || !Array.isArray(entry.skills)) throw new Error('Native Codex Skill catalog missing this workspace');
  if (Array.isArray(entry.errors) && entry.errors.length) throw new Error('Codex could not load some Skills; inspect native SKILL.md metadata on the VM');
  const skills = (entry.skills as Obj[]).filter(skill => skill.enabled===true && typeof skill.name==='string' && /^[a-zA-Z0-9_-]+$/.test(skill.name) && typeof skill.path==='string' && isAbsolute(skill.path))
    .map(skill => ({name:String(skill.name),description:typeof skill.description==='string'?skill.description:'',path:String(skill.path)}));
  // Keep native discovery order: the first enabled entry is the selected source
  // for a name, both when displaying it and when resolving explicit input.
  return skills.filter((skill,index)=>skills.findIndex(other=>other.name===skill.name)===index);
}

export async function codexCommands(server: CodexAppServer, cwd: string): Promise<CommandInfo[]> {
  const skills = await codexSkills(server,cwd);
  return skills.map(({name,description})=>({name,description,source:'skill',invocation:'$'+name}));
}
