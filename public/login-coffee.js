// One locally bundled transparent retro visual-novel character, with two short compositor
// animations. No video, canvas loop, audio, tracking or third-party image request.
export const LOGIN_COFFEE_ART='/login-coffee-art.webp';

export function createLoginCoffee({document:doc=globalThis.document,matchMedia=query=>globalThis.matchMedia?.(query)}={}) {
  let shownUser=null,overlay=null,timer=null,disposed=false;
  const dismiss=()=>{
    if(timer!==null){clearTimeout(timer);timer=null;}
    doc.removeEventListener('keydown',escape,true);
    overlay?.remove();overlay=null;
  };
  const escape=event=>{if(overlay&&(event.key==='Escape'||event.key==='Enter')){event.preventDefault();event.stopImmediatePropagation();dismiss();}};
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
      const skip=doc.createElement('button');skip.type='button';skip.className='login-coffee-skip';skip.textContent='跳过动画';skip.setAttribute('aria-label','跳过欢迎动画');skip.onclick=dismiss;
      overlay.append(scene,skip);overlay.addEventListener('click',event=>{event.stopPropagation();dismiss();});doc.body.append(overlay);
      // Do not focus or inert the actual app. Authentication and data loading
      // continue independently; a click dismisses this layer rather than activating
      // an unseen app control underneath it.
      doc.addEventListener('keydown',escape,true);
      timer=setTimeout(dismiss,reduced?750:2200);return true;
    },
    reset(){dismiss();shownUser=null;},
    dispose(){dismiss();shownUser=null;disposed=true;}
  };
}
