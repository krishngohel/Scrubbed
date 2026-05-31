/* Scrubbed theme engine — applies saved/default theme before first paint */
(function(){
  function hexToRgb(hex){
    hex=hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i,'#$1$1$2$2$3$3');
    const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m?{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}:{r:0,g:0,b:0};
  }
  function rgbToHex(r,g,b){
    return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  }
  function hexToHsl(hex){
    let {r,g,b}=hexToRgb(hex);r/=255;g/=255;b/=255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b);
    let h=0,s=0,l=(max+min)/2;
    if(max!==min){
      const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);
      switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;break}h/=6;
    }
    return {h:h*360,s:s*100,l:l*100};
  }
  function hslToHex(h,s,l){
    h/=360;s/=100;l/=100;let r,g,b;
    if(s===0){r=g=b=l}else{
      const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
      const f=(t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<0.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p};
      r=f(h+1/3);g=f(h);b=f(h-1/3);
    }
    return rgbToHex(r*255,g*255,b*255);
  }
  function adjustL(hex,d){const {h,s,l}=hexToHsl(hex);return hslToHex(h,s,Math.max(0,Math.min(100,l+d)));}
  function mix(a,b,t){const ra=hexToRgb(a),rb=hexToRgb(b);return rgbToHex(ra.r+(rb.r-ra.r)*t,ra.g+(rb.g-ra.g)*t,ra.b+(rb.b-ra.b)*t);}
  function toRgba(hex,a){const {r,g,b}=hexToRgb(hex);return `rgba(${r},${g},${b},${a})`;}

  const DEFAULT={bg:'#F6F1E8',font:'#1F1B16',primary:'#B5563A',accent:'#5A6E4A'};

  window.THEME_PRESETS=[
    {name:'Forest',   bg:'#F6F1E8',font:'#1F1B16',primary:'#B5563A',accent:'#5A6E4A'},
    {name:'Midnight', bg:'#0d1117',font:'#cdd9e5',primary:'#388bfd',accent:'#f0883e'},
    {name:'Dusk',     bg:'#1c1814',font:'#f0ead6',primary:'#c9a96e',accent:'#e07575'},
    {name:'Arctic',   bg:'#eef4fa',font:'#1a2535',primary:'#2563a8',accent:'#d4621a'},
    {name:'Rose',     bg:'#fdf5f7',font:'#2a1a1d',primary:'#b5485a',accent:'#8b5cf6'},
    {name:'Obsidian', bg:'#1a1a2e',font:'#e0e0f0',primary:'#7c5cbf',accent:'#f97316'},
  ];
  window.THEME_DEFAULT=DEFAULT;

  function injectOverrides(colors, cardBg){
    const {bg, font, primary, accent}=colors;
    const {r:pr,g:pg,b:pb}=hexToRgb(primary);
    const {r:ir,g:ig,b:ib}=hexToRgb(font);
    const {r:ar,g:ag,b:ab}=hexToRgb(accent);
    const {r:cr,g:cg,b:cb}=hexToRgb(cardBg);
    const fa=(n)=>`rgba(${pr},${pg},${pb},${n})`;
    const ia=(n)=>`rgba(${ir},${ig},${ib},${n})`;
    const aa=(n)=>`rgba(${ar},${ag},${ab},${n})`;
    const ca=(n)=>`rgba(${cr},${cg},${cb},${n})`;

    // Determine if this is a light or dark overall theme
    const {l:bgLv}=hexToHsl(bg);
    const lightTheme=bgLv>=45;

    // For primary-bg sections (manifesto, get-started, footer use background:var(--forest)=primary):
    // Light themes → shift section bg to page bg, use dark text
    // Dark themes → keep primary bg, use contrast-appropriate text based on primary lightness
    const {l:pL}=hexToHsl(primary);
    // Dark-themed pages always need light text on primary-colored sections (manifesto/get-started/footer)
    // regardless of primary lightness. Light themes use pL threshold instead.
    const dark4primary=!lightTheme?true:pL<55;
    const onP    = dark4primary?'rgba(255,255,255,0.88)':'rgba(20,20,20,0.82)';
    const onPSub = dark4primary?'rgba(255,255,255,0.50)':'rgba(20,20,20,0.48)';
    const onPStr = dark4primary?'#ffffff':'#111111';
    const onPDiv = dark4primary?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)';

    const secBg   = lightTheme ? adjustL(bg,-5) : null;
    const secText = lightTheme ? toRgba(font,0.88) : onP;
    const secSub  = lightTheme ? toRgba(font,0.50) : onPSub;
    const secStr  = lightTheme ? font : onPStr;
    const secDiv  = lightTheme ? toRgba(font,0.10) : onPDiv;
    const secFooterLink  = lightTheme ? toRgba(font,0.45) : (dark4primary?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.32)');
    const secFooterLinkH = lightTheme ? toRgba(font,0.72) : (dark4primary?'rgba(255,255,255,0.72)':'rgba(0,0,0,0.68)');
    const secFooterCopy  = lightTheme ? toRgba(font,0.30) : (dark4primary?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.28)');
    const secFooterColT  = lightTheme ? toRgba(font,0.50) : (dark4primary?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.45)');
    const secBgRule = secBg ? `#manifesto,#get-started,footer{background:${secBg} !important;}` : '';

    let s=document.getElementById('theme-overrides');
    if(!s){s=document.createElement('style');s.id='theme-overrides';document.head.appendChild(s);}

    s.textContent=`
/* === SCRUBBED THEME OVERRIDES === */

/* Card & surface backgrounds */
.task-card-inner{background:${ca(0.93)} !important;border-color:${fa(0.12)} !important;}
.task-card-inner{box-shadow:0 2px 4px ${ia(0.04)},0 6px 16px ${ia(0.07)},0 18px 40px ${ia(0.06)},0 1px 0 ${ca(0.9)} inset !important;}
.task-card.active .task-card-inner{box-shadow:0 2px 4px ${ia(0.05)},0 8px 20px ${ia(0.10)},0 28px 60px ${ia(0.12)},0 44px 88px ${ia(0.06)},0 1px 0 ${ca(0.95)} inset !important;}
.task-card.peek .task-card-inner{box-shadow:0 1px 3px ${ia(0.03)},0 4px 12px ${ia(0.06)},0 12px 28px ${ia(0.05)} !important;}
.vpc-wrap{background:${ca(0.93)} !important;border-color:${fa(0.12)} !important;box-shadow:0 4px 8px ${ia(0.04)},0 14px 36px ${ia(0.10)},0 36px 80px ${ia(0.07)} !important;}
.hrc{background:${ca(0.93)} !important;border-color:${fa(0.12)} !important;box-shadow:0 4px 8px ${ia(0.04)},0 14px 36px ${ia(0.10)} !important;}
.step-card{background:${cardBg} !important;border-color:var(--misty) !important;box-shadow:0 2px 12px ${ia(0.05)} !important;}
.step-card:hover{box-shadow:0 6px 28px ${ia(0.10)} !important;}
.cn-popup{background:${cardBg} !important;}
.modal-panel{background:${cardBg} !important;box-shadow:0 20px 80px ${ia(0.26)} !important;}
.vf-card{background:${cardBg} !important;border-color:var(--misty) !important;box-shadow:0 2px 8px ${ia(0.04)} !important;}
.vf-card:hover{box-shadow:0 8px 28px ${ia(0.12)} !important;}
.tpl-card{background:${cardBg} !important;border-color:var(--misty) !important;box-shadow:0 2px 8px ${ia(0.04)} !important;}
.tpl-card:hover{border-color:${fa(0.22)} !important;box-shadow:0 8px 30px ${ia(0.13)} !important;}
.vault-empty-state{background:${cardBg} !important;border-color:var(--misty) !important;box-shadow:0 2px 12px ${ia(0.04)} !important;}
.doc-page{background:${cardBg} !important;}

/* Inputs */
.auth-field input,.smt-input{background:${cardBg} !important;color:var(--ink) !important;border-color:var(--border) !important;}
.auth-field input::placeholder,.smt-input::placeholder{color:var(--ink-faint);}

/* Auth modal & tabs */
#auth-modal{background:var(--off-white) !important;box-shadow:0 24px 80px rgba(0,0,0,0.18),0 4px 20px ${fa(0.1)} !important;}
#auth-tabs{background:${fa(0.07)} !important;border-radius:10px;}
.auth-tab.active{background:${cardBg} !important;color:var(--forest) !important;}

/* User dropdown */
#user-dropdown{background:var(--off-white) !important;border-color:var(--border) !important;box-shadow:0 8px 32px rgba(0,0,0,0.13),0 2px 8px ${fa(0.08)} !important;}

/* Primary/forest hover tints */
.btn-ghost:hover{background:${fa(0.08)} !important;}
#nav-user-btn:hover{background:${fa(0.06)} !important;border-color:var(--forest) !important;}
#audio-btn{background:${ca(0.92)} !important;border-color:var(--misty) !important;box-shadow:0 4px 20px ${ia(0.08)} !important;}
#audio-btn:hover{background:${cardBg} !important;box-shadow:0 6px 28px ${ia(0.2)} !important;}
#audio-btn.on{background:${fa(0.10)} !important;border-color:${fa(0.30)} !important;}
.hero-eyebrow,.vault-eyebrow{background:${fa(0.08)} !important;border-color:${fa(0.20)} !important;}
.card-tag{background:${fa(0.06)} !important;border-color:${fa(0.14)} !important;}
.vpc-badge,.prog-badge-pill{background:${fa(0.08)} !important;border-color:${fa(0.16)} !important;}
.hrc-action{background:${fa(0.09)} !important;}
.hrc-action:hover{background:${fa(0.16)} !important;}
.vpc-item:hover,.rf-item:hover{background:${fa(0.04)} !important;}
.vpc-add{border-color:${fa(0.28)} !important;}
.vpc-add:hover{background:${fa(0.04)} !important;border-color:var(--forest) !important;}
.user-dropdown-item:hover{background:${fa(0.07)} !important;color:var(--forest) !important;}
#pw-reqs{background:${fa(0.05)} !important;}
.sheet-table tbody tr:hover{background:${fa(0.025)} !important;}
.sheet-cell:focus{background:${fa(0.06)} !important;}
.add-row-btn{border-color:${fa(0.28)} !important;}
.add-row-btn:hover{background:${fa(0.06)} !important;}
.doc-section-content:focus{border-color:${fa(0.28)} !important;background:${fa(0.018)} !important;}

/* Accent hover tints */
.blank-doc-btn{border-color:${aa(0.28)} !important;}
.blank-doc-btn:hover{background:${aa(0.06)} !important;}
.doc-blank-area:focus{border-color:${aa(0.28)} !important;background:${aa(0.018)} !important;}

/* Button shadows */
.nav-logo-mark{box-shadow:0 2px 10px ${fa(0.30)} !important;}
.btn-nav{box-shadow:0 2px 14px ${fa(0.30)} !important;}
.btn-hp{box-shadow:0 2px 20px ${fa(0.28)} !important;}
.btn-hp:hover{box-shadow:0 6px 28px ${fa(0.38)} !important;}
.btn-upload-nav{border-color:${ia(0.26)} !important;}
.btn-upload-nav:hover{box-shadow:0 2px 14px ${fa(0.32)} !important;}
.auth-submit{box-shadow:0 2px 14px ${fa(0.28)} !important;}

/* Outline / ghost button borders */
.btn-ho{border-color:${fa(0.24)} !important;}
.vf-btn-edit,.vf-btn-addrow{border-color:${fa(0.28)} !important;}
.vf-btn-delete{border-color:${ia(0.16)} !important;}
.modal-cancel{border-color:${ia(0.18)} !important;}
.modal-cancel:hover{border-color:${ia(0.30)} !important;color:var(--ink) !important;}

/* File/template type badges — override inline bg set by JS */
.vf-card-type,.modal-badge{background:${fa(0.07)} !important;}

/* Feature visual */
.feature-visual-wrap{box-shadow:0 4px 20px ${ia(0.08)} !important;}
.feature-visual-wrap:hover{box-shadow:0 12px 40px ${ia(0.14)} !important;}

/* Wash orbs — tinted by primary/accent */
.wash-1{background:radial-gradient(circle,${fa(0.28)} 0%,${fa(0.10)} 45%,transparent 70%) !important;}
.wash-2{background:radial-gradient(circle,${aa(0.22)} 0%,${aa(0.08)} 45%,transparent 70%) !important;}
.wash-3{background:radial-gradient(circle,${fa(0.18)} 0%,${fa(0.06)} 50%,transparent 70%) !important;}

/* Manifesto & get-started section overlays */
#manifesto::before{background:radial-gradient(ellipse at 30% 50%,${aa(0.18)} 0%,transparent 60%) !important;}
#get-started::before{background:radial-gradient(ellipse at 50% -10%,${aa(0.28)} 0%,transparent 60%) !important;}
#get-started::after{background:radial-gradient(ellipse at 50% 120%,${fa(0.18)} 0%,transparent 70%) !important;}

/* Feature visual background */
.feature-visual-placeholder{background:linear-gradient(135deg,var(--forest-mist) 0%,${aa(0.08)} 100%) !important;}

/* Vault hero right panel — matches page bg */
.sr-panel{background:var(--warm-white) !important;border-color:var(--border) !important;}
.vault-login-wall{background:${cardBg} !important;border-color:var(--misty) !important;box-shadow:0 2px 12px ${ia(0.04)} !important;}

/* Manifesto / get-started / footer section backgrounds:
   light themes → slightly deepened page bg so sections remain distinct;
   dark themes  → leave as var(--forest) = primary (set by CSS) */
${secBgRule}

/* Manifesto section text */
.manifesto-text{color:${secText} !important;}
.manifesto-text strong{color:${secStr} !important;}
.manifesto-text em{color:var(--orange) !important;}
.manifesto-computer-works{color:var(--orange) !important;}
.gs-heading em{color:var(--orange) !important;}

/* Get-started CTA section */
.gs-heading{color:${secStr} !important;}
.gs-sub{color:${secSub} !important;}
.btn-cta{background:${lightTheme?primary:secStr} !important;color:${lightTheme?'#fff':'var(--forest)'} !important;}
.btn-cta:hover{background:${lightTheme?adjustL(primary,10):'var(--forest-mist)'} !important;color:${lightTheme?'#fff':'var(--forest)'} !important;}

/* Footer */
footer{border-color:${secDiv} !important;}
.footer-col-title{color:${secFooterColT} !important;}
.footer-link{color:${secFooterLink} !important;}
.footer-link:hover{color:${secFooterLinkH} !important;}
.footer-divider{border-color:${secDiv} !important;}
.footer-copyright{color:${secFooterCopy} !important;}
.footer-bottom>span:last-child{color:${secFooterCopy} !important;}

/* Manifesto decorative elements */
.manifesto-label{color:${secText} !important;}
.manifesto-rule{background:${secDiv} !important;}
`;
  }

  function applyTheme(colors,animate){
    if(animate===undefined)animate=true;
    const {bg,font,primary,accent}=colors;
    const root=document.documentElement;

    if(animate&&document.body){
      document.body.classList.add('theme-transition');
      setTimeout(()=>document.body.classList.remove('theme-transition'),700);
    }

    const {l:bgL}=hexToHsl(bg);
    const dark=bgL<45;

    // Card bg: slightly lighter than page bg for surface hierarchy (warm-tinted for light themes, lifted for dark)
    const cardBg=dark?adjustL(bg,12):adjustL(bg,6);

    root.style.setProperty('--white',         dark?adjustL(bg,20):'#ffffff');
    root.style.setProperty('--off-white',      dark?adjustL(bg,11):adjustL(bg,3));
    root.style.setProperty('--warm-white',     bg);
    root.style.setProperty('--paper',          bg);
    root.style.setProperty('--misty',          dark?adjustL(bg,-5):adjustL(bg,-4));
    root.style.setProperty('--ink',            font);
    root.style.setProperty('--ink-light',      mix(font,bg,0.2));
    root.style.setProperty('--ink-faint',      mix(font,bg,0.48));
    root.style.setProperty('--forest',         primary);
    root.style.setProperty('--forest-mid',     adjustL(primary,10));
    root.style.setProperty('--forest-light',   adjustL(primary,20));
    root.style.setProperty('--forest-pale',    mix(primary,bg,0.58));
    root.style.setProperty('--forest-mist',    mix(primary,bg,0.84));
    root.style.setProperty('--orange',         accent);
    root.style.setProperty('--orange-warm',    adjustL(accent,8));
    root.style.setProperty('--orange-light',   adjustL(accent,20));
    root.style.setProperty('--orange-pale',    mix(accent,bg,0.54));
    root.style.setProperty('--border',         toRgba(primary,0.14));
    root.style.setProperty('--card-bg',        cardBg);

    // Aliases used by vault.html and secondaries.html
    root.style.setProperty('--cream',    cardBg);
    root.style.setProperty('--rule',     dark ? adjustL(bg,9) : adjustL(bg,-8));
    root.style.setProperty('--graphite', mix(font,bg,0.34));
    root.style.setProperty('--stone',    mix(font,bg,0.56));
    root.style.setProperty('--clay',     primary);
    root.style.setProperty('--clay-d',   adjustL(primary,-8));
    root.style.setProperty('--clay-p',   adjustL(primary,-14));
    root.style.setProperty('--clay-s',   mix(primary,bg,0.74));
    root.style.setProperty('--moss',     accent);
    root.style.setProperty('--moss-s',   mix(accent,bg,0.78));
    root.style.setProperty('--rust',     adjustL(primary,-10));
    root.style.setProperty('--rust-s',   mix(primary,bg,0.84));

    // Navbar background with opacity so backdrop-filter blur is visible
    const {r:nbr,g:nbg,b:nbb}=hexToRgb(bg);
    const navBg=`rgba(${nbr},${nbg},${nbb},0.92)`;
    root.style.setProperty('--navbar-bg', navBg);
    const nb=document.getElementById('navbar');
    if(nb){nb.style.background=navBg;}

    // Inject element-level overrides for hardcoded rgba values
    injectOverrides(colors, cardBg);

    localStorage.setItem('scrubbed_theme',JSON.stringify(colors));
    if(typeof window.syncThemePicker==='function')window.syncThemePicker(colors);
  }

  window.applyTheme=applyTheme;

  // Apply saved theme immediately (before first paint)
  try{
    const saved=localStorage.getItem('scrubbed_theme');
    if(saved)applyTheme(JSON.parse(saved),false);
  }catch(e){applyTheme(DEFAULT,false);}

  // Re-apply after DOM ready to update navbar bg and inject overrides into document
  document.addEventListener('DOMContentLoaded',()=>{
    try{
      const saved=localStorage.getItem('scrubbed_theme');
      applyTheme(saved?JSON.parse(saved):DEFAULT,false);
    }catch(e){}
  });
})();
