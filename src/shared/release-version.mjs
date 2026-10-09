// Formal releases use integer hundredths, independently of npm's SemVer notation.
export function releaseVersion(value){return typeof value==='string'&&/^(0|[1-9]\d{0,6})\.\d{2}$/.test(value)?value:'unknown';}
export function versionHundredths(value){if(releaseVersion(value)==='unknown')throw Error('Invalid formal release version');const [major,fraction]=value.split('.');return Number(major)*100+Number(fraction);}
export function nextReleaseVersion(value,kind){if(!['small','large'].includes(kind))throw Error('Choose small or large');const ticks=versionHundredths(value)+(kind==='small'?1:10),next=Math.floor(ticks/100)+'.'+String(ticks%100).padStart(2,'0');if(releaseVersion(next)==='unknown')throw Error('Release version limit exceeded');return next;}
export function npmReleaseVersion(value){versionHundredths(value);const [major,fraction]=value.split('.');return major+'.'+Number(fraction)+'.0';}
