// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {initMishuCommands} from '../public/mishu-commands.js';
it.each(['codex','claude','cursor','grok'])('consumes unsupported %s MISHU commands without a request or a dialog',async(engine)=>{
 document.body.innerHTML='<button id="setup"></button>';
 const request=vi.fn(),toast=vi.fn(),configureButton=document.querySelector<HTMLButtonElement>('#setup')!;
 const ui=initMishuCommands({context:()=>({id:'source',engine,busy:false}),request,toast,configureButton});
 for(const command of ['/mishu-setup','/mishu status','/mishu-disable'])expect(ui.handle(command)).toBe(true);
 expect(ui.handle('ordinary message')).toBe(false);expect(ui.handle('/mishumore')).toBe(false);
 await ui.setup();ui.close();expect(toast).toHaveBeenCalledWith(expect.stringContaining('Pi Chat'));
 expect(request).not.toHaveBeenCalled();expect(document.querySelector('[role="dialog"]')).toBeNull();
 expect(configureButton.hidden).toBe(true);expect(configureButton.disabled).toBe(true);
});
it('leaves Pi native setup and status commands available to the plugin',()=>{
 const toast=vi.fn(),request=vi.fn();const ui=initMishuCommands({context:()=>({id:'pi',engine:'pi'}),request,toast});
 expect(ui.handle('/mishu-setup')).toBe(false);expect(ui.handle('/mishu status')).toBe(false);
 expect(request).not.toHaveBeenCalled();expect(toast).not.toHaveBeenCalled();
});
