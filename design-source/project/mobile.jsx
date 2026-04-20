/* global React, MASTISK_DATA, IOSDevice, IOSGlassPill */

// ─── Mobile (PWA) view ─────────────────────────────────
function MobileView() {
  return (
    <div className="view" style={{maxWidth:1100}}>
      <div className="view-h">System · Mobile companion</div>
      <h1 className="view-title">The wiki in your pocket.</h1>
      <p className="view-sub">A PWA you can install from the web — no app store. Swipe through today's digest like a card stack, tap any concept to open its page, hold to ask. Everything syncs back to desktop.</p>

      <div className="mobile-section">
        <MobileDigest/>
        <MobileArticle/>
        <MobileAsk/>
      </div>

      <div style={{textAlign:'center', marginTop:-16, fontFamily:'var(--mono)', fontSize:11, color:'var(--fg-faint)'}}>
        <span>Digest · swipe cards</span>
        <span style={{margin:'0 60px'}}>Reader · tap to ask</span>
        <span>Ask · voice or text</span>
      </div>
    </div>
  );
}

function MobilePhone({ dark, children, title }) {
  return (
    <IOSDevice width={300} height={620} dark={dark} title={title}>
      {children}
    </IOSDevice>
  );
}

function MobileDigest() {
  return (
    <MobilePhone dark={false} title="Today">
      <div style={{padding:'0 16px 40px'}}>
        <div style={{fontFamily:'var(--mono)',fontSize:10,textTransform:'uppercase',color:'#8e8e93',letterSpacing:'0.08em',marginBottom:8}}>Apr 20 · 47 sources read</div>

        {/* card 1 */}
        <div style={{background:'#fff',borderRadius:18,padding:18,boxShadow:'0 8px 24px rgba(0,0,0,0.06)',marginBottom:12}}>
          <div style={{fontFamily:'var(--mono)',fontSize:9,color:'#ff8c42',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Thread 1 · 5 sources</div>
          <div style={{fontFamily:'var(--serif)',fontSize:19,lineHeight:1.2,fontWeight:500,color:'#000',marginBottom:8}}>Test-time compute is the new scaling axis</div>
          <div style={{fontFamily:'var(--serif)',fontSize:13,lineHeight:1.45,color:'#555'}}>Three papers and two podcasts argue inference-time search is wide open while training-time scaling plateaus.</div>
          <div style={{display:'flex',gap:5,marginTop:12,flexWrap:'wrap'}}>
            {['Test-time compute','o-series','AlphaProof'].map(c => (
              <span key={c} style={{fontSize:10,padding:'3px 8px',borderRadius:10,background:'#f2f2f7',color:'#636366'}}>{c}</span>
            ))}
          </div>
        </div>

        {/* card 2 */}
        <div style={{background:'#fff',borderRadius:18,padding:18,boxShadow:'0 8px 24px rgba(0,0,0,0.06)',marginBottom:12,transform:'translateY(-2px) rotate(-0.4deg)'}}>
          <div style={{fontFamily:'var(--mono)',fontSize:9,color:'#ff8c42',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Thread 2 · 4 sources</div>
          <div style={{fontFamily:'var(--serif)',fontSize:19,lineHeight:1.2,fontWeight:500,color:'#000'}}>Sutton: "LLMs are a dead end"</div>
        </div>

        <div style={{background:'#fff',borderRadius:18,padding:14,boxShadow:'0 8px 24px rgba(0,0,0,0.06)',opacity:0.5,transform:'translateY(-4px)'}}>
          <div style={{fontFamily:'var(--mono)',fontSize:9,color:'#8e8e93'}}>Thread 3</div>
        </div>

        {/* tab bar */}
        <div style={{position:'absolute',bottom:36,left:16,right:16}}>
          <div style={{background:'rgba(255,255,255,0.85)',backdropFilter:'blur(20px)',borderRadius:24,padding:'10px 14px',display:'flex',justifyContent:'space-around',boxShadow:'0 4px 16px rgba(0,0,0,0.06)',border:'0.5px solid rgba(0,0,0,0.06)'}}>
            {[{l:'Today',a:true},{l:'Wiki'},{l:'Ask'},{l:'Queue'}].map(t => (
              <div key={t.l} style={{fontSize:10,fontWeight:t.a?600:400,color:t.a?'#ff8c42':'#8e8e93',padding:'2px 4px'}}>{t.l}</div>
            ))}
          </div>
        </div>
      </div>
    </MobilePhone>
  );
}

function MobileArticle() {
  return (
    <MobilePhone dark={true} title="">
      <div style={{padding:'0 16px 40px'}}>
        <div style={{fontFamily:'var(--mono)',fontSize:9,color:'#ff8c42',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6,display:'flex',gap:8,alignItems:'center'}}>
          <span style={{width:5,height:5,borderRadius:'50%',background:'#ff8c42'}}/>Concept · 86% conf
        </div>
        <div style={{fontFamily:'var(--serif)',fontSize:30,fontWeight:500,lineHeight:1.05,color:'#fff',letterSpacing:'-0.02em'}}>Test-time compute</div>
        <div style={{fontFamily:'var(--serif)',fontSize:14,fontStyle:'italic',lineHeight:1.45,color:'rgba(255,255,255,0.65)',borderLeft:'2px solid #ff8c42',paddingLeft:10,marginTop:14}}>
          A scaling axis that trades extra compute at inference time for higher capability, without training a larger model.
        </div>
        <div style={{fontFamily:'var(--serif)',fontSize:14,lineHeight:1.55,color:'rgba(255,255,255,0.85)',marginTop:18}}>
          Three families dominate: <span style={{borderBottom:'1px dashed #ff8c42',color:'#fff'}}>parallel sampling</span> with verifier; <span style={{background:'rgba(255,140,66,0.28)',borderRadius:3,padding:'1px 2px'}}>tree search</span> over partial generations; and iterative refinement…
        </div>

        {/* selection popover */}
        <div style={{position:'absolute',top:320,left:52,background:'#fff',color:'#000',borderRadius:10,padding:'4px',display:'flex',gap:2,boxShadow:'0 12px 32px rgba(0,0,0,0.4)',fontSize:11,fontWeight:500}}>
          <div style={{padding:'6px 10px'}}>✦ Ask</div>
          <div style={{padding:'6px 10px',borderLeft:'1px solid #eee'}}>＋ Expand</div>
          <div style={{padding:'6px 10px',borderLeft:'1px solid #eee'}}>⚭ Link</div>
        </div>

        <div style={{position:'absolute',bottom:36,left:16,right:16}}>
          <div style={{background:'rgba(40,40,48,0.8)',backdropFilter:'blur(20px)',borderRadius:24,padding:'10px 14px',display:'flex',justifyContent:'space-around',border:'0.5px solid rgba(255,255,255,0.1)'}}>
            {[{l:'Today'},{l:'Wiki',a:true},{l:'Ask'},{l:'Queue'}].map(t => (
              <div key={t.l} style={{fontSize:10,fontWeight:t.a?600:400,color:t.a?'#ff8c42':'rgba(235,235,245,0.6)',padding:'2px 4px'}}>{t.l}</div>
            ))}
          </div>
        </div>
      </div>
    </MobilePhone>
  );
}

function MobileAsk() {
  return (
    <MobilePhone dark={false} title="Ask">
      <div style={{padding:'0 16px 40px'}}>
        {/* context chip */}
        <div style={{fontFamily:'var(--mono)',fontSize:10,color:'#8e8e93',padding:'6px 10px',background:'#f2f2f7',borderRadius:14,display:'inline-flex',alignItems:'center',gap:6,marginBottom:14}}>
          ✦ from "Test-time compute"
        </div>

        <div style={{alignSelf:'flex-end',marginLeft:40,background:'rgba(255,140,66,0.15)',padding:'10px 14px',borderRadius:14,fontSize:13,color:'#000',marginBottom:16}}>
          What's the simplest explanation for why test-time compute works?
        </div>

        <div style={{fontFamily:'var(--serif)',fontSize:14,lineHeight:1.5,color:'#000'}}>
          From your wiki: more samples = more shots at a correct answer, <em>if</em> you can tell which one is right. The magic is in the <span style={{borderBottom:'1px dashed #ff8c42'}}>verifier</span>, not the sampler.
        </div>

        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:12}}>
          {['Test-time compute','Verifier gap','Best-of-N'].map(c => (
            <span key={c} style={{fontSize:10,padding:'3px 8px',borderRadius:10,background:'#f2f2f7',color:'#636366',fontFamily:'var(--mono)'}}>◊ {c}</span>
          ))}
        </div>

        <div style={{marginTop:20,display:'flex',flexDirection:'column',gap:8}}>
          {['Why doesn\'t it work on open-ended tasks?','Show the counter-arguments','Add as a new note'].map(s => (
            <div key={s} style={{padding:'10px 12px',background:'#fff',borderRadius:12,fontSize:12,color:'#3c3c43',border:'0.5px solid rgba(0,0,0,0.06)'}}>{s}</div>
          ))}
        </div>

        {/* input */}
        <div style={{position:'absolute',bottom:44,left:16,right:16,background:'#fff',borderRadius:22,padding:'10px 14px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 4px 16px rgba(0,0,0,0.06)',border:'0.5px solid rgba(0,0,0,0.08)'}}>
          <span style={{fontSize:12,color:'#8e8e93',flex:1}}>Ask a follow-up…</span>
          <div style={{width:28,height:28,borderRadius:'50%',background:'#ff8c42',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12}}>↑</div>
        </div>
      </div>
    </MobilePhone>
  );
}

Object.assign(window, { MobileView });
