import {releaseVersion} from './release-version.mjs';
export {releaseVersion};
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export function releaseCommit(value:unknown):string {return typeof value==='string'&&/^[a-f0-9]{7,40}$/.test(value)?value:'unknown';}
/** Whitelist public commit identity; paths, tokens and arbitrary manifest fields never escape. */
export async function readReleaseCommit(directory:string,file='release.json'):Promise<string>{
 return (await readReleaseIdentity(directory,file)).commit;
}

/** Older releases keep an unknown formal version; never infer it from main. */
export async function readReleaseIdentity(directory:string,file='release.json'):Promise<{commit:string;version:string}>{
 try{const value=JSON.parse(await readFile(join(directory,file),'utf8'));return {commit:releaseCommit(value.sourceCommit),version:releaseVersion(value.version)};}catch{return {commit:'unknown',version:'unknown'};}
}
