export function createSidebarInteraction(container) {
  const doc=container.ownerDocument,win=doc.defaultView;
  let pressed=false,menuOpen=false,pending=null,timer=null;
  const flush=()=>{timer=null;if(!pressed&&!menuOpen&&pending){const work=pending;pending=null;work();}};
  const schedule=()=>{if(timer!==null)clearTimeout(timer);timer=setTimeout(flush,0);};
  const down=event=>{if(event.target.closest?.('.session-item, button, summary, [role="button"]'))pressed=true;};
  const release=()=>{pressed=false;schedule();};
  const key=event=>{if(['Enter',' '].includes(event.key))down(event);};
  container.addEventListener('pointerdown',down);container.addEventListener('keydown',key);
  doc.addEventListener('pointerup',release,true);doc.addEventListener('pointercancel',release,true);doc.addEventListener('keyup',release,true);doc.addEventListener('dragend',release,true);win?.addEventListener('blur',release);
  return {
    render(work){if(pressed||menuOpen){pending=work;return;}work();},
    menu(open){menuOpen=open;if(!open)schedule();},
    dispose(){if(timer!==null)clearTimeout(timer);pending=null;container.removeEventListener('pointerdown',down);container.removeEventListener('keydown',key);doc.removeEventListener('pointerup',release,true);doc.removeEventListener('pointercancel',release,true);doc.removeEventListener('keyup',release,true);doc.removeEventListener('dragend',release,true);win?.removeEventListener('blur',release);}
  };
}
