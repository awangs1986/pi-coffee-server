import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export function releaseCommit(value:unknown):string {return typeof value==='string'&&/^[a-f0-9]{7,40}$/.test(value)?value:'unknown';}
/** Whitelist public commit identity; paths, tokens and arbitrary manifest fields never escape. */
export async function readReleaseCommit(directory:string,file='release.json'):Promise<string>{
 try{return releaseCommit(JSON.parse(await readFile(join(directory,file),'utf8')).sourceCommit);}catch{return 'unknown';}
}
