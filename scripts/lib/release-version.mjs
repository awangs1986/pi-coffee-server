import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {releaseVersion,npmReleaseVersion,versionHundredths} from '../../src/shared/release-version.mjs';
export {releaseVersion,npmReleaseVersion,versionHundredths};
export async function checkedReleaseVersion(repo){
 const version=(await readFile(join(repo,'VERSION'),'utf8')).trim();
 if(releaseVersion(version)==='unknown')throw Error('Invalid release VERSION');
 const pkg=JSON.parse(await readFile(join(repo,'package.json'),'utf8')),lock=JSON.parse(await readFile(join(repo,'package-lock.json'),'utf8')),npm=npmReleaseVersion(version);
 if(pkg.version!==npm||lock.version!==npm||lock.packages?.['']?.version!==npm)throw Error('Release metadata versions differ');
 return version;
}
export function assertReleaseIncrement(previous,current){
 if(previous===undefined){if(current!=='0.11')throw Error('Initial formal release must be 0.11');return;}
 const delta=versionHundredths(current)-versionHundredths(previous);
 if(![1,10].includes(delta))throw Error('Use a small (+0.01) or large (+0.10) release increment');
}
