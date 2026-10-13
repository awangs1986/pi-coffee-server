/** Pi owns native MISHU commands; unsupported engines never forward them as prompts. */
export function initMishuCommands({context,toast,configureButton}) {
 const unavailable=()=>toast('MISHU 仅支持 Pi Chat 担任秘书；其他 Agent 可以作为管理目标');
 function handle(text){
  if((context()?.engine||'pi')==='pi'||!/^\/mishu(?:-|\s|$)/.test(text.trim()))return false;
  unavailable();return true;
 }
 function setup(){if((context()?.engine||'pi')!=='pi')unavailable();}
 if(configureButton){configureButton.hidden=true;configureButton.disabled=true;}
 return {handle,setup,close(){}};
}
