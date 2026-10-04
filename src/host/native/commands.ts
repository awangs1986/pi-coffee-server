/** These native terminal commands would move the process away from the Host's durable binding. */
const sessionControls=new Set(['clear','new','new-chat','resume','fork','rewind','exit','quit','logout','login','model','effort','rename','title','sessions','import']);
export function nativeCommandAllowed(name:string){return !sessionControls.has(name.replace(/^\//,''));}
export function assertNativePrompt(text:string){const command=/^\/([^\s]+)(?:\s|$)/.exec(text.trimStart())?.[1];if(command&&!nativeCommandAllowed(command))throw new Error('Use the Web task/model controls for this native session command');}
