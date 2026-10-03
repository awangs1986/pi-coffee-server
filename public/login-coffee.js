// A compact chibi version of the original cat maid; the workbench stays interactive.
export const LOGIN_COFFEE_ART='/login-coffee-maid-chibi.webp';

export function createLoginCoffee({document:doc=globalThis.document,matchMedia=query=>globalThis.matchMedia?.(query)}={}) {
  let shownUser=null,overlay=null,timer=null,disposed=false;
  const dismiss=()=>{
    if(timer!==null){clearTimeout(timer);timer=null;}
    doc.removeEventListener('keydown',escape,true);
    overlay?.remove();overlay=null;
  };
  const escape=event=>{if(overlay&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();dismiss();}};
  return {
    play(user){
      if(disposed||typeof user!=='string'||!user||shownUser===user)return false;
      dismiss();shownUser=user;
      const reduced=Boolean(matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
      overlay=doc.createElement('div');overlay.className='login-coffee'+(reduced?' reduced-motion':'');
      overlay.setAttribute('role','status');overlay.setAttribute('aria-live','polite');
      const scene=doc.createElement('div');scene.className='login-coffee-scene';
      const picture=doc.createElement('div');picture.className='login-coffee-picture';
      const art=doc.createElement('img');art.className='coffee-offer';art.src=LOGIN_COFFEE_ART;art.alt='';art.setAttribute('aria-hidden','true');art.decoding='async';art.fetchPriority='low';art.onerror=dismiss;picture.append(art);scene.append(picture);
      const caption=doc.createElement('p');caption.className='login-coffee-dialogue';caption.textContent='咖啡好了，欢迎回来。';scene.append(caption);
      const skip=doc.createElement('button');skip.type='button';skip.className='login-coffee-skip';skip.textContent='×';skip.setAttribute('aria-label','关闭欢迎提示');skip.onclick=dismiss;
      overlay.append(scene,skip);overlay.addEventListener('click',event=>{event.stopPropagation();dismiss();});doc.body.append(overlay);
      // The compact greeting does not focus or block the workbench.
      doc.addEventListener('keydown',escape,true);
      timer=setTimeout(dismiss,reduced?750:1400);return true;
    },
    reset(){dismiss();shownUser=null;},
    dispose(){dismiss();shownUser=null;disposed=true;}
  };
}
