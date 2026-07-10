const { useState, useEffect, useRef } = React;
const cx = (...xs) => xs.filter(Boolean).join(' ');

const IC = {
  arrow: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  check: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  plus:  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  edit:  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>,
  clock: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  file:  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  spark: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  logout:<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  vault: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  grid:  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  lock:  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>,
  trash: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>,
  theme: <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
};

function Nav({ onEnter, onSignIn, user, onLogout }) {
  const [dropOpen, setDropOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setDropOpen(false);
    }
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (user && window.AccountMenu) window.AccountMenu.refresh();
    else if (window.NavBar) window.NavBar.sync();
  }, [user]);

  const closeDrop = () => setDropOpen(false);
  const display = user
    ? (user.display_name || user.first_name || (user.username || '').split('@')[0] || user.username)
    : '';

  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="wordmark">Scrubbed.</span>
        <div className="nav-links">
          <a className="nav-link" href="/vault">The Vault</a>
          <a className="nav-link" href="/dashboard">Dashboard</a>
          {user && <a className="nav-link" href="/secondaries">Secondary AI</a>}
        </div>
        <div className="nav-right">
          {user ? (
            <>
              <span className="nav-user">{display}</span>
              <div className="user-menu-wrapper" ref={wrapRef}>
                <div className="nav-avatar" onClick={() => setDropOpen(o => !o)}>
                  {(display || '?')[0].toUpperCase()}
                </div>
                <div id="user-dropdown" className={cx('user-dropdown', dropOpen && 'open')}>
                  <div className="user-dropdown-header">
                    <div className="user-dropdown-greeting">{user.email || user.username || 'Signed in as'}</div>
                    <div className="user-dropdown-username">{display}</div>
                  </div>
                  <div className="user-dropdown-list">
                    <a href="/vault" className="user-dropdown-item">{IC.vault} My Vault</a>
                    <a href="/dashboard" className="user-dropdown-item">{IC.grid} Dashboard</a>
                    {user && <a href="/secondaries" className="user-dropdown-item">{IC.spark} Secondary AI</a>}
                    <div className="plan-row">
                      <span className="plan-badge" id="plan-badge">—</span>
                      <button type="button" className="plan-action-btn" id="plan-action-btn" style={{display:'none'}}></button>
                    </div>
                    <a href="#" className="user-dropdown-item" data-account-settings onClick={(e) => { e.preventDefault(); closeDrop(); window.openAccountSettings && window.openAccountSettings(); }}>Account settings</a>
                    <hr className="user-dropdown-divider"/>
                    <button type="button" className="user-dropdown-item user-dropdown-logout" onClick={() => { closeDrop(); onLogout(); }}>
                      {IC.logout} Log out
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <a className="nav-link" onClick={onSignIn} style={{cursor:'pointer'}}>Sign in</a>
              <button className="btn-primary btn-sm" onClick={onEnter}>Get started {IC.arrow}</button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function HeroMockup() {
  const sections = [
    { key:'clinical', title:'Clinical hours', icon: IC.clock, count: 3, meta: <>Total <strong>408</strong> hrs</>, rows: [
      { name:'Emergency department volunteer', org:"St. Joseph's Hospital · Phoenix, AZ", meta:<><strong>240</strong> hrs</>, tag:'Most meaningful', tagTone:'clay', selected:true },
      { name:'Physician shadowing – cardiology', org:'Dr. R. Patel · Banner Heart Hospital', meta:<><strong>48</strong> hrs</>, tag:'Shadowing', tagTone:'neutral' },
      { name:'Pediatric oncology assistant', org:'Phoenix Children’s Hospital', meta:<><strong>120</strong> hrs</>, tag:'Paid', tagTone:'neutral' },
    ]},
    { key:'volunteer', title:'Volunteer hours', icon: IC.spark, count: 2, meta: <>Total <strong>335</strong> hrs</>, rows: [
      { name:'Crisis Call line counselor', org:'Crisis Text Line · remote · ongoing', meta:<><strong>195</strong> hrs</>, tag:'Most meaningful', tagTone:'clay' },
      { name:'Free clinic intake volunteer', org:'Mountain Park Health Center', meta:<><strong>140</strong> hrs</>, tag:'Service', tagTone:'neutral' },
    ]},
    { key:'letters', title:'Recommendation letters', icon: IC.file, count: 3, meta: <><strong>2</strong> received · <strong>1</strong> pending</>, rows: [
      { name:'Dr. M. Hwang – PI, pediatric oncology research', org:'Requested Jan 14 · submitted Feb 2', meta:'Received', tag:'Science', tagTone:'moss' },
      { name:'Dr. R. Patel – shadowing physician', org:'Requested Feb 4 · submitted Feb 19', meta:'Received', tag:'Clinical', tagTone:'moss' },
      { name:'Prof. L. Alvarez – org. chem', org:'Requested Feb 4 · reminder sent Mar 3', meta:'Pending', tag:'Non-science', tagTone:'amber' },
    ]},
    { key:'essays', title:'Essays & statements', icon: IC.edit, count: 3, meta: <><strong>1</strong> final · <strong>2</strong> in progress</>, rows: [
      { name:'Personal statement', org:'5,300 / 5,300 chars · last edited yesterday', meta:'Final', tag:'AMCAS', tagTone:'moss' },
      { name:'Stanford – diversity of experience', org:'Outline ready · drawn from 2 activities', meta:'Outlined', tag:'Secondary', tagTone:'neutral' },
      { name:'Johns Hopkins – meaningful failure', org:'First draft · 310 / 500 words', meta:'Drafting', tag:'Secondary', tagTone:'amber' },
    ]},
  ];
  return (
    <div className="mockup-shell">
      <div className="mockup-chrome">
        <span className="dot dot-r"/><span className="dot dot-y"/><span className="dot dot-g"/>
        <span className="mockup-url">Scrubbed / TheVault</span>
      </div>
      <div className="mockup-body">
        <aside className="mock-sidebar">
          <div className="mock-logo">Scrubbed.</div>
          <div className="mock-sidebar-label">Application</div>
          <div className="mock-nav-item is-active">{IC.file}<span>Your record</span><span className="mock-nav-count">12</span></div>
          <div className="mock-nav-item">{IC.spark}<span>Secondaries</span><span className="mock-nav-count">4</span></div>
          <div className="mock-nav-item">{IC.clock}<span>Schools</span><span className="mock-nav-count">18</span></div>
          <div className="mock-sidebar-label">Documents</div>
          <div className="mock-nav-item">{IC.file}<span>Letters</span></div>
          <div className="mock-nav-item">{IC.edit}<span>Essays</span></div>
          <div className="mock-nav-item">{IC.check}<span>Transcripts</span></div>
        </aside>
        <main className="mock-main">
          <div className="mock-header-row">
            <div>
              <div className="mock-eyebrow">Your record · 2026 cycle</div>
              <div className="mock-title">Everything in one place.</div>
            </div>
            <div className="mock-stats">
              <div className="mock-stat"><div className="mock-stat-n">743</div><div className="mock-stat-l">Total hrs</div></div>
              <div className="mock-stat"><div className="mock-stat-n">12</div><div className="mock-stat-l">Activities</div></div>
              <div className="mock-stat"><div className="mock-stat-n">2/3</div><div className="mock-stat-l">Letters in</div></div>
            </div>
          </div>
          <div className="mock-sections">
            {sections.map(s => (
              <div className="mock-section" key={s.key}>
                <div className="mock-sec-head">
                  <div className="mock-sec-title">{s.icon}<span>{s.title}</span><span className="mock-sec-count">· {s.count}</span></div>
                  <div className="mock-sec-meta">{s.meta}</div>
                </div>
                <div className="mock-sec-body">
                  {s.rows.map((r,i) => (
                    <div className={cx('mock-row', r.selected && 'is-selected')} key={i}>
                      <div className="mock-row-bullet"/>
                      <div>
                        <div className="mock-row-name">{r.name}</div>
                        <div className="mock-row-sub">{r.org}</div>
                      </div>
                      <div className="mock-row-meta">{r.meta}</div>
                      <div className={cx('mock-tag', `mock-tag--${r.tagTone}`)}>{r.tag}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function OutlineCard() {
  const sources = [
    { name: 'Crisis text line counselor', note: '195 hrs – mental health access angle' },
    { name: 'ED volunteer', note: "240 hrs – acute care meets patients' fuller stories" },
  ];
  const beats = [
    { n:'01', beat:'Open with a specific moment', note:'A waiting-room conversation, not a thesis.' },
    { n:'02', beat:'Trace the through-line', note:'Crisis line → ED: same posture, different medium.' },
    { n:'03', beat:'Name what care taught you', note:'Concrete language. Stay out of abstraction.' },
    { n:'04', beat:'Land on Stanford', note:'One specific thing in their curriculum.' },
  ];
  return (
    <div className="outline-card">
      <div className="outline-card-header">
        <div>
          <div className="oc-eyebrow">Stanford SOM · Prompt 1 of 4</div>
          <div className="oc-title">Diversity of experience</div>
        </div>
        <div className="oc-badge">350 word limit</div>
      </div>
      <div className="oc-sources">
        <div className="oc-sources-label">Drawn from your record</div>
        {sources.map((s,i)=>(
          <div className="oc-source" key={i}>
            <div className="oc-dot"/>
            <div>
              <div className="oc-src-name">{s.name}</div>
              <div className="oc-src-note">{s.note}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="oc-outline">
        {beats.map((o,i)=>(
          <div className="oc-beat" key={i}>
            <div className="oc-beat-n">{o.n}</div>
            <div>
              <div className="oc-beat-t">{o.beat}</div>
              <div className="oc-beat-d">{o.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Marketing({ onEnter, user, onLogout }) {
  const openSignIn = () => window._openAuthModal && window._openAuthModal('login');
  return (
    <div className="marketing">
      <Nav onEnter={onEnter} onSignIn={openSignIn} user={user} onLogout={onLogout}/>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-eyebrow">For pre-med applicants</div>
          <h1 className="hero-h1">One record.<br/><em>Every</em> secondary.</h1>
          <p className="hero-lead">Enter your activities, hours, letters, and essays once. Scrubbed gives every piece of your application a home — and builds school-specific outlines from your real record, not from guesses.</p>
          <div className="hero-ctas">
            <button className="btn-primary btn-lg" onClick={onEnter}>Start your record {IC.arrow}</button>
            <a className="btn-ghost btn-lg" href="#how-it-works">See how it works</a>
          </div>
          <div className="hero-contrast">
            <div className="hc-row"><span className="hc-from">ChatGPT</span><span className="hc-v">guesses at your story.</span></div>
            <div className="hc-row"><span className="hc-from">Advisors</span><span className="hc-v">work from memory.</span></div>
            <div className="hc-row hc-us"><span className="hc-from">Scrubbed</span><span className="hc-v"><em>knows</em> your full record.</span></div>
          </div>
        </div>
      </section>
      <section className="hero-mockup-wrap"><HeroMockup/></section>

      <section id="how-it-works" className="how scroll-target">
        <div className="how-inner">
          <div className="how-head">
            <div className="section-eyebrow">How it works</div>
            <h2 className="section-h2">Three steps. One record.</h2>
          </div>
          <div className="how-stages">
            <div className="stage stage--active"><div className="stage-n">01</div><div className="stage-label">Enter your record once.</div><div className="stage-sub">Activities, hours, research, employment. Structured fields, not a blank page.</div></div>
            <div className="stage"><div className="stage-n">02</div><div className="stage-label">Pick your schools.</div><div className="stage-sub">Each school has its own prompts and limits. We carry that for you.</div></div>
            <div className="stage"><div className="stage-n">03</div><div className="stage-label">Get your outlines.</div><div className="stage-sub">Drawn from what you have actually done. The writing is yours — we give you the shape.</div></div>
          </div>
        </div>
      </section>

      <section className="feature">
        <div className="feature-inner">
          <div>
            <div className="section-eyebrow">School-specific outlines</div>
            <h2 className="feature-h2">Every prompt, mapped to your record.</h2>
            <p className="feature-p">For each secondary prompt, Scrubbed identifies which of your activities and experiences are most relevant — and builds an outline from them. Not from a generic template.</p>
            <ul className="feature-list">
              <li>{IC.check} Pulls from your real activities, hours, and dates</li>
              <li>{IC.check} Matched to each school's specific angle</li>
              <li>{IC.check} The outline is a scaffold — the writing stays yours</li>
            </ul>
          </div>
          <OutlineCard/>
        </div>
      </section>

      <section className="quote-section">
        <div className="quote-inner">
          <div className="q-kicker">From an applicant</div>
          <blockquote className="q-text">"The first time I opened a secondary and the structure was already there — drawn from things I'd actually done — I cried a little. In a good way."</blockquote>
          <div className="q-attr">— Priya R., 2025 cycle</div>
        </div>
      </section>

      <section id="pricing" className="pricing scroll-target">
        <div className="pricing-inner">
          <div className="section-eyebrow">Simple pricing</div>
          <h2 className="section-h2">Start free. Upgrade when you're ready.</h2>
          <p className="pricing-trust-bar">Encrypted storage · Automated backups on all paid plans</p>
          <div className="pricing-cards">
            <div className="price-card">
              <div className="price-name">Free</div>
              <div className="price-amt">$0</div>
              <div className="price-sub">The full Vault, free forever.</div>
              <ul className="price-list">
                <li>{IC.check} All 9 record templates</li>
                <li>{IC.check} Unlimited files &amp; entries</li>
                <li>{IC.check} XLSX &amp; PDF export</li>
                <li>{IC.check} Application &amp; LOR trackers</li>
                <li>{IC.check} No AI generation</li>
              </ul>
              <button className="btn-secondary btn-md" onClick={onEnter}>Start free</button>
            </div>
            <div className="price-card">
              <div className="price-name">Starter</div>
              <div className="price-amt">$10<span style={{fontSize:'20px',fontFamily:'var(--font-sans)',letterSpacing:'0',fontWeight:500,verticalAlign:'bottom',paddingBottom:'6px',display:'inline-block'}}>/mo</span></div>
              <div className="price-sub">Try Secondary AI on a budget.</div>
              <ul className="price-list">
                <li>{IC.check} Everything in Free</li>
                <li>{IC.check} 10 outlines / month (up to 3 regenerations per outline included)</li>
                <li>{IC.check} School-specific prompt mapping</li>
                <li>{IC.check} Built from your real Vault data</li>
                <li>{IC.check} Encrypted storage · Automated backups</li>
              </ul>
              <button className="btn-primary btn-md" onClick={()=>window.startCheckout('starter')}>Choose Starter {IC.arrow}</button>
            </div>
            <div className="price-card">
              <div className="price-name">Pro Monthly</div>
              <div className="price-amt">$25<span style={{fontSize:'20px',fontFamily:'var(--font-sans)',letterSpacing:'0',fontWeight:500,verticalAlign:'bottom',paddingBottom:'6px',display:'inline-block'}}>/mo</span></div>
              <div className="price-sub">Cancel anytime.</div>
              <ul className="price-list">
                <li>{IC.check} Everything in Free</li>
                <li>{IC.check} Unlimited Secondary AI outlines</li>
                <li>{IC.check} School-specific prompt mapping</li>
                <li>{IC.check} Built from your real Vault data</li>
                <li>{IC.check} Encrypted storage · Automated backups</li>
              </ul>
              <button className="btn-primary btn-md" onClick={()=>window.startCheckout('monthly')}>Choose Pro {IC.arrow}</button>
            </div>
            <div className="price-card price-card--badge">
              <div className="price-badge">Most flexible</div>
              <div className="price-name">Cycle Pass</div>
              <div className="price-amt">$99<span style={{fontSize:'16px',fontFamily:'var(--font-sans)',letterSpacing:'0',fontWeight:500,verticalAlign:'bottom',paddingBottom:'8px',display:'inline-block'}}> once</span></div>
              <div className="price-sub">One price. Covers your whole application cycle. No auto-renew.</div>
              <ul className="price-list">
                <li>{IC.check} Everything in Free</li>
                <li>{IC.check} Unlimited Secondary AI outlines</li>
                <li>{IC.check} School-specific prompt mapping</li>
                <li>{IC.check} Built from your real Vault data</li>
                <li>{IC.check} Encrypted storage · Automated backups</li>
              </ul>
              <button className="btn-primary btn-md" onClick={()=>window.startCheckout('cycle')}>Get Cycle Pass {IC.arrow}</button>
            </div>
            <div className="price-card price-card--featured">
              <div className="price-badge price-badge--value">Best value</div>
              <div className="price-name">Pro Annual</div>
              <div className="price-amt">$199<span style={{fontSize:'16px',fontFamily:'var(--font-sans)',letterSpacing:'0',fontWeight:500,verticalAlign:'bottom',paddingBottom:'8px',display:'inline-block'}}>/yr</span></div>
              <div className="price-sub">~$16.60/mo · save 34% vs monthly</div>
              <ul className="price-list">
                <li>{IC.check} Everything in Free</li>
                <li>{IC.check} Unlimited Secondary AI outlines</li>
                <li>{IC.check} Priority generation during peak season (Aug–Oct)</li>
                <li>{IC.check} Built from your real Vault data</li>
                <li>{IC.check} Encrypted storage · Automated backups</li>
              </ul>
              <button className="btn-primary btn-md" onClick={()=>window.startCheckout('annual')}>Choose Annual {IC.arrow}</button>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <span className="wordmark">Scrubbed.</span>
          <div className="footer-links">
            <a href="#how-it-works">How it works</a><a href="/vault">The Vault</a><a href="/dashboard">Dashboard</a><a href="/secondaries">Secondary AI</a><a href="#pricing">Pricing</a><a href="/privacy">Privacy Policy</a>
          </div>
          <div className="footer-legal">© 2026 Scrubbed</div>
        </div>
      </footer>
    </div>
  );
}

const ACTS = [
  { id:'a1', name:'Emergency department volunteer', org:"St. Joseph's, Phoenix", dates:'06/2023 – present', hrs:240, cat:'Clinical', meaningful:true, desc:"Worked alongside triage nurses during intake, reset rooms between patients, sat with families during long waits. Two shifts a week now." },
  { id:'a2', name:'Pediatric oncology research', org:'Hwang Lab, ASU', dates:'09/2022 – 05/2024', hrs:880, cat:'Research', meaningful:true, desc:"Co-authored two posters on supportive-care outcomes. Ran weekly chart reviews and maintained the de-identified patient registry." },
  { id:'a3', name:'Crisis text line counselor', org:'Crisis Text Line', dates:'01/2023 – present', hrs:195, cat:'Service', meaningful:true, desc:"30-hour training, then regular text-based crisis intervention shifts. Supervisor-reviewed every conversation in the first three months." },
  { id:'a4', name:'Org. chem teaching assistant', org:'ASU Chemistry', dates:'08/2023 – 05/2024', hrs:220, cat:'Teaching', meaningful:false, desc:"Led weekly recitation sections of 18 students and held two office hours per week. Built a problem set bank the department adopted." },
  { id:'a5', name:'Physician shadowing – cardiology', org:'Dr. Patel', dates:'Summer 2024', hrs:48, cat:'Shadowing', meaningful:false, desc:"Shadowed in clinic and rounding. Noted patient interactions especially in chronic disease management conversations." },
];

const SCHOOLS = [
  { id:'s1', school:'Stanford SOM', prompts:4, drafted:2, promptN:1, prompt:{ title:'Diversity of experience', limit:350, text:'Stanford values students who bring perspectives shaped by their lived experience. What about your background has shaped how you think about medicine?', sources:[ { name:'Crisis text line counselor (195 hrs)', why:'First-person view of mental health systems from the support side.' }, { name:'ED volunteer (240 hrs)', why:"Direct contact where acute care meets patients' fuller stories." } ], outline:[ { n:'01', beat:'Open with a specific moment', note:'A waiting-room conversation from the ED. ~50 words.' }, { n:'02', beat:'Trace the through-line', note:'Crisis line → ED → same posture, different medium. ~120 words.' }, { n:'03', beat:'Name what care taught you', note:'Stay concrete. Avoid abstraction. ~120 words.' }, { n:'04', beat:'Land on Stanford', note:'One specific program feature or community. ~60 words.' } ] } },
  { id:'s2', school:'Johns Hopkins', prompts:5, drafted:1, promptN:1, prompt:{ title:'Tell us about a meaningful failure.', limit:500, text:'Describe a time you failed and what you learned from it.', sources:[], outline:[] } },
  { id:'s3', school:'Mount Sinai', prompts:3, drafted:0, promptN:1, prompt:{ title:'Why Sinai?', limit:250, text:'Why do you want to attend Mount Sinai specifically?', sources:[], outline:[] } },
  { id:'s4', school:'UCSF', prompts:6, drafted:1, promptN:1, prompt:{ title:'A community you belong to', limit:400, text:'Describe a community you are part of and your role in it.', sources:[], outline:[] } },
];

function AppNav({ view, setView, user, onLogout }) {
  const [dropOpen, setDropOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setDropOpen(false);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const display = user
    ? (user.display_name || user.first_name || (user.username || '').split('@')[0] || user.username)
    : '';
  const initial = (display || '?')[0].toUpperCase();

  return (
    <nav className="nav nav--app">
      <div className="nav-inner">
        <span className="wordmark" onClick={()=>setView('marketing')}>Scrubbed.</span>
        <div className="nav-links">
          <a className="nav-link" href="/vault">The Vault</a>
          <a className="nav-link" href="/dashboard">Dashboard</a>
          {user && <a className="nav-link" href="/secondaries">Secondary AI</a>}
        </div>
        <div className="nav-right">
          {user && <span className="nav-user">{display}</span>}
          <div className="user-menu-wrapper" ref={wrapRef}>
            <div className="nav-avatar" onClick={()=>setDropOpen(o=>!o)}>{initial}</div>
            <div className={cx('user-dropdown', dropOpen && 'open')}>
              <div className="user-dropdown-header">
                <div className="user-dropdown-greeting">{user?.email || user?.username || 'Signed in as'}</div>
                <div className="user-dropdown-username">{display}</div>
              </div>
              <div className="user-dropdown-list">
                <a href="/vault" className="user-dropdown-item">
                  {IC.vault} My Vault
                </a>
                <a href="/dashboard" className="user-dropdown-item">
                  {IC.grid} Dashboard
                </a>
                {user && (
                <a href="/secondaries" className="user-dropdown-item">
                  {IC.spark} Secondary AI
                </a>
                )}
                <a href="#" className="user-dropdown-item" data-account-settings onClick={(e) => { e.preventDefault(); window.openAccountSettings && window.openAccountSettings(); }}>Account settings</a>
                <hr className="user-dropdown-divider"/>
                <button className="user-dropdown-item user-dropdown-logout" onClick={onLogout}>
                  {IC.logout} Log out
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

function RecordView({ onSelect }) {
  return (
    <div className="app-main">
      <div className="record-header">
        <div>
          <div className="page-eyebrow">Your record</div>
          <h1 className="page-h1">Activities &amp; experience</h1>
          <div className="page-sub">{ACTS.length} entries · last edited 12 minutes ago</div>
        </div>
        <button className="btn-primary btn-sm">{IC.plus} Add activity</button>
      </div>
      <div className="record-list">
        {ACTS.map((a) => (
          <button className="record-row" key={a.id} onClick={()=>onSelect(a)}>
            <div>
              <div className="rr-name">{a.name}</div>
              <div className="rr-sub">{a.org} · {a.dates}</div>
            </div>
            <div className="rr-hrs">{a.hrs} <span>hrs</span></div>
            <div className={cx('rr-tag', a.meaningful?'rr-tag--clay':'rr-tag--neutral')}>{a.cat}</div>
            <div className="rr-edit">{IC.edit}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ActivityView({ act, onBack }) {
  const [desc, setDesc] = useState(act.desc);
  return (
    <div className="app-main">
      <button className="back-btn" onClick={onBack}>← back to record</button>
      <div className="act-head">
        <div className="act-eyebrow">{act.cat}{act.meaningful ? ' · most meaningful' : ''}</div>
        <h1 className="act-h1">{act.name}</h1>
        <div className="act-meta">
          <span><strong>{act.hrs}</strong> hrs</span>
          <span>{act.dates}</span>
          <span>{act.org}</span>
        </div>
      </div>
      <div className="act-grid">
        <div className="field"><label>Activity name</label><input defaultValue={act.name}/></div>
        <div className="field"><label>Organization</label><input defaultValue={act.org}/></div>
        <div className="field"><label>Total hours</label><input defaultValue={String(act.hrs)} className="is-focus"/></div>
        <div className="field"><label>Dates</label><input defaultValue={act.dates}/></div>
      </div>
      <div className="act-section">
        <label className="act-label">Description <span className="act-label-hint">700 chars</span></label>
        <textarea rows={4} value={desc} onChange={e=>setDesc(e.target.value)}/>
        <div className="char-counter"><span/><span className={desc.length>700?'over':''}>{desc.length} / 700</span></div>
      </div>
      <div className="act-section">
        <label className="act-label">Why it mattered <span className="act-label-hint">internal · never published</span></label>
        <textarea rows={3} placeholder="One or two sentences. Used to draft school-specific angles."/>
      </div>
      <div className="act-actions">
        <button className="btn-primary btn-sm">{IC.check} Save</button>
        <button className="btn-ghost btn-sm">Discard</button>
      </div>
    </div>
  );
}

function SecView() {
  const [active, setActive] = useState('s1');
  const school = SCHOOLS.find(s=>s.id===active);
  const [draft, setDraft] = useState('');
  const wc = draft.split(/\s+/).filter(Boolean).length;
  return (
    <div className="app-main">
      <div className="sec-layout">
        <aside className="sec-sidebar">
          <div className="sec-sidebar-head">Secondaries <button className="btn-ghost btn-xs">{IC.plus}</button></div>
          {SCHOOLS.map(s=>(
            <button key={s.id} className={cx('sec-item', active===s.id&&'is-active')} onClick={()=>setActive(s.id)}>
              <div className="sec-item-name">{s.school}</div>
              <div className="sec-item-sub">{s.prompts} prompts · {s.drafted} drafted</div>
            </button>
          ))}
        </aside>
        {school && (
          <div>
            <div className="ws-head">
              <div className="page-eyebrow">{school.school} · prompt {school.promptN} of {school.prompts}</div>
              <h2 className="ws-title">{school.prompt.title}</h2>
              <div className="ws-meta">
                <span className="ws-badge">{school.prompt.limit} words</span>
                {school.drafted > 0 && <span className="ws-badge ws-badge--moss">Outline ready</span>}
              </div>
            </div>
            <div className="ws-grid">
              <div className="ws-col">
                <div className="ws-label">Prompt</div>
                <div className="prompt-card"><em>{school.prompt.text}</em></div>
                {school.prompt.sources.length > 0 && (<>
                  <div className="ws-label" style={{marginTop:24}}>Drawn from your record</div>
                  <div className="ws-sources">
                    {school.prompt.sources.map((s,i)=>(
                      <div className="ws-source" key={i}>
                        <div className="ws-dot"/>
                        <div>
                          <div className="ws-src-name">{s.name}</div>
                          <div className="ws-src-note">{s.why}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>)}
                {school.prompt.outline.length > 0 && (<>
                  <div className="ws-label" style={{marginTop:24}}>Outline</div>
                  <div className="ws-outline">
                    {school.prompt.outline.map((o,i)=>(
                      <div className="ws-beat" key={i}>
                        <div className="ws-beat-n">{o.n}</div>
                        <div>
                          <div className="ws-beat-t">{o.beat}</div>
                          <div className="ws-beat-d">{o.note}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>)}
              </div>
              <div className="ws-col">
                <div className="ws-label">Your draft</div>
                <textarea className="ws-textarea" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="The writing is yours. Start anywhere — the outline is a scaffold, not a script." rows={14}/>
                <div className="char-counter">
                  <span>Aim for {school.prompt.limit - 50}–{school.prompt.limit} words</span>
                  <span className={wc > school.prompt.limit ? 'over' : ''}>{wc} / {school.prompt.limit}</span>
                </div>
                <div className="act-actions">
                  <button className="btn-primary btn-sm">{IC.check} Save draft</button>
                  <button className="btn-ghost btn-sm">Regenerate outline</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    window.__scrubbedLogin = (u) => {
      if (u && typeof u === 'object') setUser(u);
      else if (typeof u === 'string') {
        setUser({
          username: u,
          email: u,
          display_name: u.includes('@') ? u.split('@')[0] : u,
        });
      }
    };
    window.__scrubbedLogout = () => { setUser(null); };
    if (window._checkSession) window._checkSession();
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    // React renders after the browser's native hash scroll attempt, so scroll manually
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }));
  }, []);

  const handleEnter = () => {
    if (user) window.location.href = '/vault';
    else if (window._openAuthModal) window._openAuthModal('signup');
  };

  const handleLogout = () => {
    localStorage.removeItem('scrubbed_token');
    localStorage.removeItem('scrubbed_refresh');
    setUser(null);
  };

  return <Marketing onEnter={handleEnter} user={user} onLogout={handleLogout}/>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
