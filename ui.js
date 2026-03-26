// WPlus UI v1.1 — github.com/KuchiSofts — MIT
(function(){
  ['wplus-btn','wplus-panel','wplus-css'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
  var W=window.__wplus||{};
  function cfg(k){try{return(JSON.parse(localStorage.getItem('wplus_cfg')||'{}')||{})[k]||false;}catch(e){return false;}}
  function setCfg(k,v){try{var s=JSON.parse(localStorage.getItem('wplus_cfg')||'{}');s[k]=v;localStorage.setItem('wplus_cfg',JSON.stringify(s));}catch(e){}}
  function delC(){try{return(W.deletedMsgs?W.deletedMsgs('get'):JSON.parse(localStorage.getItem('wplus_del')||'[]')).length;}catch(e){return 0;}}
  function H(s){return(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  // Exact WhatsApp font stack
  var FF='"Segoe UI","Helvetica Neue",Helvetica,"Lucida Grande",Arial,Ubuntu,Cantarell,"Fira Sans",sans-serif';

  var css=document.createElement('style');css.id='wplus-css';
  css.textContent='\
.wplus-b{position:fixed;left:12px;top:0;z-index:999999;width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s;background:0 0;border-radius:12px;border:0;padding:0;outline:0}\
.wplus-b:hover,.wplus-b.on{background:rgba(255,255,255,.1)}\
.wplus-b svg{width:24px;height:24px;fill:#aebac1;transition:fill .15s}\
.wplus-b:hover svg,.wplus-b.on svg{fill:#e9edef}\
.wplus-b .wd{position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#25D366;border:2px solid #222e35}\
.wplus-b .wc{position:absolute;top:0;right:0;background:#25D366;color:#fff;font-size:9px;font-weight:700;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:8px;padding:0 3px;font-family:'+FF+';display:none;border:2px solid #222e35}\
\
.wpp{position:fixed;left:65px;top:39px;z-index:999998;width:413px;height:calc(100vh - 39px);background:rgb(22,23,23);display:none;flex-direction:column;font-family:'+FF+';-webkit-font-smoothing:antialiased}\
.wpp.open{display:flex}\
\
.wpp-h{height:64px;min-height:64px;background:rgb(22,23,23);display:flex;align-items:center;padding:10px 20px;box-sizing:border-box;flex-shrink:0}\
.wpp-hb{width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;margin-right:16px;transition:background .12s;flex-shrink:0}\
.wpp-hb:hover{background:rgba(255,255,255,.1)}\
.wpp-hb svg{width:24px;height:24px;fill:rgba(255,255,255,.6)}\
.wpp-ht{font-size:22px;font-weight:400;color:rgb(250,250,250);line-height:28px}\
\
.wpp-sc{flex:1;overflow-y:auto;overflow-x:hidden;background:rgb(22,23,23)}\
.wpp-sc::-webkit-scrollbar{width:6px}\
.wpp-sc::-webkit-scrollbar-thumb{background:rgba(255,255,255,.13);border-radius:3px}\
\
.wpp-r{display:flex;align-items:center;padding:16px 20px 16px 36px;cursor:pointer;transition:background .08s;min-height:24px}\
.wpp-r:hover{background:rgba(255,255,255,.04)}\
.wpp-r:active{background:rgba(255,255,255,.06)}\
.wpp-ri{width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-right:26px}\
.wpp-ri svg{width:20px;height:20px;fill:rgba(255,255,255,.6)}\
.wpp-rn{flex:1;min-width:0}\
.wpp-rt{font-size:16px;font-weight:400;color:rgb(250,250,250);line-height:24px}\
.wpp-rd{font-size:14px;font-weight:400;color:rgba(255,255,255,.6);line-height:20px}\
.wpp-rv{flex-shrink:0;font-size:14px;color:rgba(255,255,255,.45);margin-left:12px}\
\
.wpp-tg{position:relative;width:40px;height:22px;border-radius:11px;background:rgba(255,255,255,.2);cursor:pointer;transition:background .2s;flex-shrink:0;margin-left:12px}\
.wpp-tg.on{background:#25D366}\
.wpp-tg::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}\
.wpp-tg.on::after{transform:translateX(18px)}\
\
.wpp-sec{padding:20px 20px 8px 36px;font-size:14px;font-weight:400;color:rgb(0,168,132);line-height:20px}\
.wpp-div{margin:0 20px 0 82px;border-bottom:1px solid rgba(255,255,255,.08)}\
\
.wpp-sub{max-height:0;overflow:hidden;transition:max-height .25s ease;background:rgb(18,19,19)}\
.wpp-sub.open{max-height:6000px}\
\
.wpp-dm{padding:10px 20px 10px 36px;border-bottom:1px solid rgba(255,255,255,.04)}\
.wpp-dm:hover{background:rgba(255,255,255,.015)}\
.wpp-dmh{display:flex;justify-content:space-between;margin-bottom:2px}\
.wpp-dms{color:rgb(0,168,132);font-weight:500;font-size:13px}\
.wpp-dmt{color:rgba(255,255,255,.45);font-size:12px}\
.wpp-dmb{color:rgb(209,215,219);line-height:1.3;word-break:break-word;font-size:14px}\
.wpp-dmtp{display:inline-block;font-size:11px;color:rgba(255,255,255,.45);background:rgba(255,255,255,.06);padding:1px 6px;border-radius:3px;margin-top:3px}\
.wpp-dme{padding:24px 36px;text-align:center;color:rgba(255,255,255,.45);font-size:14px}\
\
.wpp-vo{padding:8px 20px 8px 36px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,.04)}\
.wpp-vo:hover{background:rgba(255,255,255,.015)}\
.wpp-vodl{color:rgb(83,189,235);font-size:13px;cursor:pointer;margin-left:auto;white-space:nowrap}\
.wpp-vodl:hover{text-decoration:underline}\
\
.wpp-st{padding:14px 36px;font-size:13px;color:rgb(209,215,219);white-space:pre-wrap;font-family:Consolas,"SF Mono",monospace;line-height:1.4}\
\
.wpp-ft{padding:10px 20px;text-align:center;flex-shrink:0;border-top:1px solid rgba(255,255,255,.08)}\
.wpp-ft a{color:rgba(255,255,255,.35);font-size:12px;text-decoration:none;font-family:'+FF+'}\
.wpp-ft a:hover{color:rgba(255,255,255,.5)}\
\
.wplus-blur-t{filter:blur(5px)!important;transition:filter .15s}.wplus-blur-t:hover{filter:blur(0)!important}\
.wplus-blur-p{filter:blur(8px)!important;transition:filter .15s}.wplus-blur-p:hover{filter:blur(0)!important}\
\
#wplus-header-restore svg{width:20px;height:20px;fill:rgba(255,255,255,.6);transition:fill .15s}\
#wplus-header-restore:hover svg{fill:#25D366}\
@keyframes wplus-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}\
#wplus-header-restore .wplus-tip{display:none;position:absolute;bottom:-30px;left:50%;transform:translateX(-50%);background:rgb(22,23,23);color:rgba(255,255,255,.8);font-size:11px;padding:4px 10px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;z-index:99999}\
#wplus-header-restore:hover .wplus-tip{display:block}\
\
.wplus-msg-highlight{animation:wplus-flash 3s ease}@keyframes wplus-flash{0%,20%,40%,60%{box-shadow:0 0 0 3px #25D366;background:rgba(37,211,102,.08)}10%,30%,50%,100%{box-shadow:none;background:transparent}}\
\
#wplus-scroll-up{position:fixed;z-index:999997;bottom:78px;right:65px;width:42px;height:42px;border-radius:50%;background:rgb(32,44,51);border:0;cursor:pointer;display:none;align-items:center;justify-content:center;box-shadow:rgba(0,0,0,.4) 0px 2px 8px 0px;transition:background .15s}\
#wplus-scroll-up:hover{background:rgb(42,57,66)}\
#wplus-scroll-up svg{width:20px;height:20px;fill:rgba(255,255,255,.85)}\
#wplus-scroll-up.loading svg{animation:wplus-spin 1s linear infinite}\
#wplus-scroll-up .wplus-count{position:absolute;top:-4px;left:50%;transform:translateX(-50%);background:#25D366;color:#fff;font-size:9px;font-weight:700;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:8px;padding:0 3px;font-family:sans-serif;display:none}';
  document.head.appendChild(css);

  var I={
    sh:'<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 16v-2h2v2h-2zm0-4V7h2v6h-2z"/></svg>',
    bk:'<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
    dl:'<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    eo:'<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92C19.14 16.38 20 14.26 20 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z"/></svg>',
    lk:'<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg>',
    bl:'<svg viewBox="0 0 24 24"><path d="M6 13c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0 4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0-8c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg>',
    ck:'<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    cl:'<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8.46 11.88l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    ex:'<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
    ch:'<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>',
    ph:'<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
    au:'<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>',
    vo:'<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>'
  };

  var dc=delC();

  function R(a,ic,t,d,rv){return'<div class="wpp-r" data-a="'+a+'"><div class="wpp-ri">'+ic+'</div><div class="wpp-rn"><div class="wpp-rt">'+t+'</div>'+(d?'<div class="wpp-rd">'+d+'</div>':'')+'</div>'+(rv||'')+'</div>';}
  function T(id,ic,t,d,on){return'<div class="wpp-r"><div class="wpp-ri">'+ic+'</div><div class="wpp-rn"><div class="wpp-rt">'+t+'</div>'+(d?'<div class="wpp-rd">'+d+'</div>':'')+'</div><div class="wpp-tg'+(on?' on':'')+'" data-t="'+id+'"></div></div>';}

  var btn=document.createElement('div');btn.className='wplus-b';btn.id='wplus-btn';btn.title='WPlus';
  btn.innerHTML=I.sh+'<span class="wd"></span><span class="wc" id="wplus-c">'+(dc||0)+'</span>';
  if(dc>0)btn.querySelector('.wc').style.display='';
  document.body.appendChild(btn);

  var P=document.createElement('div');P.className='wpp';P.id='wplus-panel';
  P.innerHTML=
    '<div class="wpp-h"><div class="wpp-hb" id="wp-x">'+I.bk+'</div><div class="wpp-ht">WPlus</div></div>'+
    '<div class="wpp-sc">'+

    '<div class="wpp-sec">Privacy</div>'+
    T('blurMessages',I.bl,'Blur messages','Hover to reveal',cfg('blurMessages'))+
    '<div class="wpp-div"></div>'+
    T('blurContacts',I.eo,'Blur contacts','Hides names everywhere',cfg('blurContacts'))+
    '<div class="wpp-div"></div>'+
    T('blurPhotos',I.ph,'Blur photos','Hides profile pictures',cfg('blurPhotos'))+
    '<div class="wpp-div"></div>'+
    T('hideTyping',I.lk,'Hide typing','Others can\'t see you type',cfg('hideTyping'))+
    '<div class="wpp-div"></div>'+
    T('hideOnline',I.eo,'Hide online','Appear offline',cfg('hideOnline'))+
    '<div class="wpp-div"></div>'+
    T('disableReceipts',I.ck,'No blue ticks','Read without receipts',cfg('disableReceipts'))+
    '<div class="wpp-div"></div>'+
    T('playAudioPrivate',I.au,'Private listen','No play notification',cfg('playAudioPrivate'))+

    '<div class="wpp-sec">Deleted messages</div>'+
    R('del',I.dl,'Saved messages','Tap to view','<div class="wpp-rv" id="wp-dc">'+dc+'</div>')+
    '<div class="wpp-sub" id="wp-dl"></div>'+
    '<div class="wpp-div"></div>'+
    R('del-clear',I.cl,'Clear all','Remove saved messages','')+


    '<div class="wpp-sec">Tools</div>'+
    R('export',I.ex,'Export contacts','Download as CSV','')+
    '<div class="wpp-div"></div>'+
    R('stats',I.ch,'Chat stats','View analytics','')+
    '<div class="wpp-sub" id="wp-sp"></div>'+
    '<div class="wpp-div"></div>'+

    '<div class="wpp-sec">Debug</div>'+
    T('debugEnabled',I.ch,'Debug logging','Track all WPlus events',cfg('debugEnabled')!==false)+
    '<div class="wpp-div"></div>'+
    R('debug-status',I.ch,'System status','Engine, hooks, storage info','')+
    '<div class="wpp-sub" id="wp-ds"></div>'+
    '<div class="wpp-div"></div>'+
    R('debug-log',I.ch,'View debug log','All events and errors','')+
    '<div class="wpp-sub" id="wp-dlog"></div>'+
    '<div class="wpp-div"></div>'+
    R('debug-clear',I.cl,'Clear debug log','','')+

    '</div>'+
    '<div class="wpp-ft"><a href="https://github.com/KuchiSofts" target="_blank">WPlus v1.2 by KuchiSofts</a></div>';
  document.body.appendChild(P);

  function open(){P.classList.add('open');btn.classList.add('on');refresh();}
  function close(){P.classList.remove('open');btn.classList.remove('on');}
  function closeAll(){P.querySelectorAll('.wpp-sub.open').forEach(function(e){e.classList.remove('open');});}
  function refresh(){
    var d=delC();
    var a=document.getElementById('wp-dc');if(a)a.textContent=d;
    var c=document.getElementById('wplus-c');if(c){c.textContent=d;c.style.display=d>0?'':'none';}
  }

  btn.onclick=function(e){e.stopPropagation();P.classList.contains('open')?close():open();};
  document.getElementById('wp-x').onclick=close;
  document.addEventListener('click',function(e){
    if(!P.classList.contains('open'))return;
    if(P.contains(e.target)||btn.contains(e.target))return;
    var preview=document.getElementById('wplus-preview');
    if(preview&&preview.contains(e.target))return;
    close();
  });
  window.addEventListener('wplus-update',refresh);

  P.querySelectorAll('.wpp-tg').forEach(function(el){el.onclick=function(e){e.stopPropagation();var id=this.dataset.t,on=!this.classList.contains('on');this.classList.toggle('on');setCfg(id,on);if(W.applyToggle)W.applyToggle(id,on);localStorage.setItem('wplus_sync_now','1');};});

  P.querySelector('[data-a="del"]').onclick=function(){var el=document.getElementById('wp-dl');if(el.classList.contains('open')){el.classList.remove('open');return;}closeAll();
    var msgs=W.deletedMsgs?W.deletedMsgs('get'):JSON.parse(localStorage.getItem('wplus_del')||'[]');
    if(!msgs.length){el.innerHTML='<div class="wpp-dme">No deleted messages yet</div>';el.classList.add('open');return;}
    var h='';msgs.slice().reverse().forEach(function(m,idx){
      var t=new Date(m.time).toLocaleString();
      var s=m.sender?(m.sender+'').split('@')[0]:'?';
      var hasBlob=!!m.media;
      var typeIcon={image:'\u{1F4F7}',video:'\u{1F3AC}',ptt:'\u{1F3A4}',audio:'\u{1F3B5}',sticker:'\u{1F3A8}',vcard:'\u{1F464}',location:'\u{1F4CD}'}[m.type]||'\u{1F4AC}';

      // Compact body preview — detect base64 and show type instead
      var rawBody=m.body||m.text||'';
      var body='';
      var isBase64=rawBody.length>100&&(rawBody.indexOf('/9j/')===0||rawBody.indexOf('data:')===0||rawBody.indexOf('AAAA')===0||/^[A-Za-z0-9+/=]{50,}/.test(rawBody));
      if(isBase64||['image','video','ptt','audio','sticker','document'].indexOf(m.type)!==-1){
        body=typeIcon+' '+(m.type==='ptt'?'Voice message':m.type.charAt(0).toUpperCase()+m.type.slice(1))+(m.caption?' — '+m.caption.substring(0,40):'');
      } else {
        body=rawBody.substring(0,80);
      }
      if(!body)body='(empty)';

      h+='<div class="wpp-dm" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px 20px 8px 36px" data-idx="'+idx+'">';
      h+='<span style="font-size:18px;width:24px;text-align:center;flex-shrink:0">'+typeIcon+'</span>';
      h+='<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between"><span class="wpp-dms" style="font-size:12px">+'+H(s)+'</span><span class="wpp-dmt">'+t+'</span></div>';
      h+='<div style="font-size:13px;color:#d1d7db;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+H(body)+'</div></div>';
      h+='<span style="font-size:10px;color:rgb(83,189,235);cursor:pointer;white-space:nowrap;flex-shrink:0" data-nav="'+H(m.id)+'">\u{2192}</span>';
      h+='</div>';
    });
    el.innerHTML=h;

    // Click row: media → fullscreen viewer, text → preview popup
    el.querySelectorAll('[data-idx]').forEach(function(row){
      row.onclick=function(e){
        if(e.target.dataset.nav)return;
        var idx=parseInt(this.dataset.idx);
        var allMsgs=W.deletedMsgs?W.deletedMsgs('get'):JSON.parse(localStorage.getItem('wplus_del')||'[]');
        var m=allMsgs.slice().reverse()[idx];
        if(!m)return;

        // Always open in chat bubble preview — media viewer opens from inside it
        showPreview(m);
      };
    });

    // Go to chat arrow
    el.querySelectorAll('[data-nav]').forEach(function(btn){
      btn.onclick=function(e){
        e.stopPropagation();
        var id=this.dataset.nav;
        if(W.goToMessage){
          this.textContent='\u{23F3}';
          var self=this;
          W.goToMessage(id);
          setTimeout(function(){self.textContent='\u{2192}';},5000);
        }
      };
    });

    el.classList.add('open');
  };

  P.querySelector('[data-a="del-clear"]').onclick=function(){var c=delC();if(!c)return;if(confirm('Delete '+c+' saved messages?')){if(W.deletedMsgs)W.deletedMsgs('clear');else localStorage.removeItem('wplus_del');document.getElementById('wp-dl').classList.remove('open');refresh();}};

  P.querySelector('[data-a="export"]').onclick=function(){if(W.exportContacts)W.exportContacts();else alert('Loading...');};

  P.querySelector('[data-a="stats"]').onclick=function(){var el=document.getElementById('wp-sp');if(el.classList.contains('open')){el.classList.remove('open');return;}closeAll();
    el.innerHTML='<div class="wpp-st">'+H(W.chatStats?W.chatStats():'Loading...')+'</div>';el.classList.add('open');};

  // ── Debug handlers ────────────────────────────────────────
  P.querySelector('[data-a="debug-status"]').onclick=function(){
    var el=document.getElementById('wp-ds');
    if(el.classList.contains('open')){el.classList.remove('open');return;}closeAll();
    var s=W.debug?W.debug.status():{error:'Engine not loaded'};
    var t='WPlus Debug Status\n'+'\u2500'.repeat(30)+'\n\n';
    t+='Version: '+(s.version||'?')+'\n';
    t+='Ready: '+(s.ready?'YES':'NO')+'\n';
    t+='Chats: '+(s.chats||0)+'\n';
    t+='Contacts: '+(s.contacts||0)+'\n';
    t+='Groups: '+(s.groups||0)+'\n';
    t+='Hooked chats: '+(s.hookedChats||0)+'\n';
    t+='Deleted msgs: '+(s.deletedMsgs||0)+'\n';
    t+='Log entries: '+(s.logEntries||0)+'\n\n';
    t+='Hooks:\n';
    if(s.hooks){
      t+='  Composing: '+(s.hooks.composing?'\u2705':'\u274C')+'\n';
      t+='  Presence: '+(s.hooks.presence?'\u2705':'\u274C')+'\n';
      t+='  ConvSeen: '+(s.hooks.seen?'\u2705':'\u274C')+'\n';
      t+='  MarkPlayed: '+(s.hooks.played?'\u2705':'\u274C')+'\n';
    }
    t+='\nSettings:\n'+JSON.stringify(s.settings||{},null,2);
    el.innerHTML='<div class="wpp-st" style="font-size:12px;line-height:1.5">'+H(t)+'</div>';
    el.classList.add('open');
  };

  P.querySelector('[data-a="debug-log"]').onclick=function(){
    var el=document.getElementById('wp-dlog');
    if(el.classList.contains('open')){el.classList.remove('open');return;}closeAll();
    if(!W.debug){el.innerHTML='<div class="wpp-dme">Engine not loaded</div>';el.classList.add('open');return;}
    var log=W.debug.getLog();
    if(!log.length){el.innerHTML='<div class="wpp-dme">No log entries yet</div>';el.classList.add('open');return;}
    var h='';
    var colors={init:'#25D366',boot:'#25D366',msg:'#53bdeb',nav:'#f5a623',cleanup:'#ef4444',debug:'#8696a0'};
    log.slice().reverse().forEach(function(e){
      var c=colors[e.cat]||'#8696a0';
      h+='<div style="padding:4px 20px 4px 36px;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;font-family:Consolas,monospace">';
      h+='<span style="color:#667781">'+e.ts+'</span> ';
      h+='<span style="color:'+c+';font-weight:600">['+e.cat+']</span> ';
      h+='<span style="color:#d1d7db">'+H(e.msg)+'</span>';
      if(e.data)h+=' <span style="color:#667781">'+H(e.data)+'</span>';
      h+='</div>';
    });
    el.innerHTML=h;
    el.classList.add('open');
  };

  P.querySelector('[data-a="debug-clear"]').onclick=function(){
    if(W.debug){W.debug.clear();document.getElementById('wp-dlog').classList.remove('open');document.getElementById('wp-dlog').innerHTML='';}
  };

  // Debug toggle controls engine logging
  // Already handled by the generic toggle handler — just wire it up
  var origToggleHandler=null;
  P.querySelectorAll('.wpp-tg').forEach(function(el){
    if(el.dataset.t==='debugEnabled'){
      el.onclick=function(e){
        e.stopPropagation();
        var on=!this.classList.contains('on');
        this.classList.toggle('on');
        setCfg('debugEnabled',on);
        if(W.debug){if(on)W.debug.enable();else W.debug.disable();}
      };
    }
  });

  // ── Message Preview Popup ──────────────────────────────
  function showPreview(m){
    var old=document.getElementById('wplus-preview');if(old)old.remove();

    var sender=m.sender?(m.sender+'').split('@')[0]:'Unknown';
    var time=new Date(m.time).toLocaleString();
    var hasMedia=!!m.media;
    var typeIcon={image:'\u{1F4F7}',video:'\u{1F3AC}',ptt:'\u{1F3A4}',audio:'\u{1F3B5}',sticker:'\u{1F3A8}'}[m.type]||'';

    var overlay=document.createElement('div');
    overlay.id='wplus-preview';
    overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif';
    overlay.onclick=function(e){if(e.target===overlay)overlay.remove();};

    var popup=document.createElement('div');
    popup.style.cssText='background:rgb(22,23,23);border-radius:12px;width:420px;max-width:90vw;max-height:80vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);display:flex;flex-direction:column';

    // Header
    var hdr='<div style="padding:12px 16px;background:rgb(30,31,31);display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,.06)">';
    hdr+='<div style="width:36px;height:36px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#fff;font-size:14px;font-weight:600">+</span></div>';
    hdr+='<div style="flex:1"><div style="color:#e9edef;font-size:14px;font-weight:500">+'+H(sender)+'</div>';
    hdr+='<div style="color:#8696a0;font-size:11px">'+time+'</div></div>';
    hdr+='<div style="cursor:pointer;color:#8696a0;font-size:20px;padding:4px 8px" id="wplus-preview-close">\u{2715}</div></div>';

    // Body — chat bubble style
    var body='<div style="padding:16px;overflow-y:auto;flex:1;background:url(data:image/svg+xml,) rgb(17,20,20)">';
    body+='<div style="max-width:320px;background:rgb(32,44,51);border-radius:0 8px 8px 8px;padding:6px 8px 4px;position:relative">';

    // Deleted indicator
    body+='<div style="color:#ef4444;font-size:12px;font-weight:600;margin-bottom:4px">\u{1F6AB} This message was deleted</div>';

    // Detect media data — could be in m.media OR in m.body as raw base64
    var mediaData=m.media||null;
    var rawBody=m.body||m.text||'';
    var isBase64Body=rawBody.length>200&&(/^\/9j\/|^data:|^AAAA|^UklG|^iVBOR|^JVBER|^T2dn/i.test(rawBody)||/^[A-Za-z0-9+\/=]{200,}$/.test(rawBody.substring(0,300)));
    if(!mediaData&&isBase64Body){
      // Body IS the media data — construct a data URL
      var mimeMap={image:'image/jpeg',video:'video/mp4',ptt:'audio/ogg',audio:'audio/mpeg',sticker:'image/webp',document:'application/octet-stream'};
      mediaData='data:'+(mimeMap[m.type]||'application/octet-stream')+';base64,'+rawBody;
    }
    var hasMediaData=!!mediaData;

    // Render media
    if(hasMediaData&&(m.type==='image'||m.type==='sticker')){
      body+='<img id="wplus-preview-img" src="'+mediaData+'" style="max-width:100%;max-height:250px;border-radius:6px;margin:6px 0;cursor:pointer;object-fit:contain">';
      body+='<div style="text-align:center;font-size:10px;color:#667781;margin-bottom:4px">Click image to zoom</div>';
    } else if(hasMediaData&&m.type==='video'){
      body+='<video id="wplus-preview-vid" controls playsinline style="max-width:100%;max-height:250px;border-radius:6px;margin:6px 0;background:#000"><source src="'+mediaData+'"></video>';
      body+='<div id="wplus-preview-fullscreen" style="text-align:center;margin:2px 0"><span style="color:#53bdeb;font-size:11px;cursor:pointer">\u{26F6} Fullscreen</span></div>';
    } else if(hasMediaData&&(m.type==='ptt'||m.type==='audio')){
      body+='<div style="padding:8px 0;display:flex;align-items:center;gap:8px">';
      body+='<span style="font-size:22px">\u{1F3A4}</span>';
      body+='<audio controls src="'+mediaData+'" style="flex:1;height:36px"></audio></div>';
    } else if(m.type!=='chat'&&!hasMediaData){
      // Try loading from file server
      var fileUrl=m.mediaFile?('http://127.0.0.1:18733/media/'+m.mediaFile):null;
      if(fileUrl&&(m.type==='image'||m.type==='sticker')){
        body+='<img id="wplus-preview-img" src="'+fileUrl+'" style="max-width:100%;max-height:250px;border-radius:6px;margin:6px 0;cursor:pointer;object-fit:contain">';
        hasMediaData=true; mediaData=fileUrl;
      } else if(fileUrl&&m.type==='video'){
        body+='<video id="wplus-preview-vid" controls playsinline style="max-width:100%;max-height:250px;border-radius:6px;margin:6px 0;background:#000"><source src="'+fileUrl+'"></video>';
        body+='<div id="wplus-preview-fullscreen" style="text-align:center;margin:2px 0"><span style="color:#53bdeb;font-size:11px;cursor:pointer">\u{26F6} Fullscreen</span></div>';
        hasMediaData=true; mediaData=fileUrl;
      } else if(fileUrl&&(m.type==='ptt'||m.type==='audio')){
        body+='<audio controls src="'+fileUrl+'" style="width:100%;margin:6px 0"></audio>';
        hasMediaData=true; mediaData=fileUrl;
      } else {
        var typeLabel={image:'\u{1F4F7} Image',video:'\u{1F3AC} Video',ptt:'\u{1F3A4} Voice',audio:'\u{1F3B5} Audio',sticker:'\u{1F3A8} Sticker',document:'\u{1F4C4} Document',vcard:'\u{1F464} Contact',location:'\u{1F4CD} Location'}[m.type]||m.type;
        body+='<div style="color:#8696a0;font-size:13px;font-style:italic;padding:12px 0;text-align:center">'+typeLabel+' \u2014 media not available</div>';
      }
    }

    // Caption for media
    if(m.caption&&hasMediaData){
      body+='<div style="color:#d1d7db;font-size:13px;line-height:1.3;margin:4px 0">'+H(m.caption.substring(0,300))+'</div>';
    }

    // Text content — only show for text messages (not base64 media)
    if(!isBase64Body&&rawBody.length>0&&rawBody.length<5000&&(m.type==='chat'||m.type==='vcard'||m.type==='location'||!hasMediaData)){
      body+='<div style="color:#e9edef;font-size:14px;line-height:1.4;word-break:break-word;margin:4px 0">'+H(rawBody.substring(0,2000))+'</div>';
    }
    if(m.caption){
      body+='<div style="color:#8696a0;font-size:12px;margin-top:2px">'+H(m.caption.substring(0,500))+'</div>';
    }

    // Time + type badge
    body+='<div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:2px">';
    body+='<span style="font-size:10px;color:#667781;background:rgba(255,255,255,.06);padding:1px 6px;border-radius:3px">'+m.type+'</span>';
    body+='<span style="font-size:10px;color:#667781">'+new Date(m.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+'</span>';
    body+='</div></div></div>';

    // Footer with actions
    var footer='<div style="padding:10px 16px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;justify-content:flex-end">';
    footer+='<button id="wplus-preview-goto" style="background:transparent;border:1px solid rgba(255,255,255,.15);color:#53bdeb;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">\u{2192} Go to chat</button>';
    if(hasMediaData){
      footer+='<button id="wplus-preview-dl" style="background:#25D366;border:0;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">\u{2B73} Save file</button>';
    }
    footer+='</div>';

    popup.innerHTML=hdr+body+footer;
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Events
    document.getElementById('wplus-preview-close').onclick=function(){overlay.remove();};
    document.getElementById('wplus-preview-goto').onclick=function(){
      overlay.remove();
      if(W.goToMessage)W.goToMessage(m.id);
    };

    // Image click → fullscreen viewer with zoom
    var previewImg=document.getElementById('wplus-preview-img');
    if(previewImg){
      previewImg.onclick=function(){openMediaViewer(mediaData,m.type,sender,m.time);};
    }

    // Video fullscreen button
    var fsBtn=document.getElementById('wplus-preview-fullscreen');
    if(fsBtn){
      fsBtn.onclick=function(){openMediaViewer(mediaData,'video',sender,m.time);};
    }

    // Download button
    var dlBtn=document.getElementById('wplus-preview-dl');
    if(dlBtn&&hasMediaData){
      dlBtn.onclick=function(){
        var ext={image:'jpg',video:'mp4',ptt:'ogg',audio:'mp3',sticker:'webp'}[m.type]||'bin';
        var a=document.createElement('a');a.href=mediaData;
        a.download='WPlus_'+m.type+'_'+sender+'_'+new Date(m.time).toISOString().slice(0,10)+'.'+ext;
        a.click();
      };
    }
  }

  // ── Fullscreen Media Viewer (image zoom + video player) ──
  function openMediaViewer(dataUrl,type,sender,time){
    var oldViewer=document.getElementById('wplus-media-viewer');
    if(oldViewer)oldViewer.remove();

    var viewer=document.createElement('div');
    viewer.id='wplus-media-viewer';
    viewer.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999999;background:rgba(0,0,0,.95);display:flex;flex-direction:column;font-family:Segoe UI,sans-serif';

    // Top bar
    var topBar=document.createElement('div');
    topBar.style.cssText='height:48px;display:flex;align-items:center;padding:0 16px;flex-shrink:0;background:rgba(0,0,0,.5);z-index:1';
    topBar.innerHTML='<div style="color:#fff;font-size:14px;flex:1">+'+(sender||'?')+' \u00B7 '+new Date(time).toLocaleString()+'</div>';

    // Download button
    var dlDiv=document.createElement('span');
    dlDiv.style.cssText='color:#53bdeb;font-size:13px;cursor:pointer;margin-right:16px';
    dlDiv.textContent='\u{2B73} Save';
    dlDiv.onclick=function(e){
      e.stopPropagation();
      var ext={image:'jpg',video:'mp4',ptt:'ogg',audio:'mp3',sticker:'webp'}[type]||'bin';
      var a=document.createElement('a');a.href=dataUrl;
      a.download='WPlus_'+type+'_'+(sender||'media')+'_'+new Date(time).toISOString().slice(0,10)+'.'+ext;
      a.click();
    };
    topBar.appendChild(dlDiv);

    // Close button
    var closeBtn=document.createElement('span');
    closeBtn.style.cssText='color:#fff;font-size:24px;cursor:pointer;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:background .15s';
    closeBtn.textContent='\u{2715}';
    closeBtn.onmouseenter=function(){this.style.background='rgba(255,255,255,.1)';};
    closeBtn.onmouseleave=function(){this.style.background='transparent';};
    closeBtn.onclick=function(){viewer.remove();};
    topBar.appendChild(closeBtn);
    viewer.appendChild(topBar);

    // Media container
    var container=document.createElement('div');
    container.style.cssText='flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative';

    if(type==='image'||type==='sticker'){
      var img=document.createElement('img');
      img.src=dataUrl;
      img.style.cssText='max-width:95vw;max-height:calc(100vh - 100px);object-fit:contain;cursor:grab;transition:transform .2s;user-select:none;-webkit-user-drag:none';

      // Zoom controls
      var scale=1,posX=0,posY=0,isDragging=false,startX,startY;

      img.onwheel=function(e){
        e.preventDefault();
        var delta=e.deltaY>0?-0.15:0.15;
        scale=Math.max(0.5,Math.min(5,scale+delta));
        img.style.transform='scale('+scale+') translate('+posX+'px,'+posY+'px)';
      };

      img.onmousedown=function(e){
        if(scale<=1)return;
        isDragging=true;startX=e.clientX-posX;startY=e.clientY-posY;
        img.style.cursor='grabbing';e.preventDefault();
      };
      container.onmousemove=function(e){
        if(!isDragging)return;
        posX=e.clientX-startX;posY=e.clientY-startY;
        img.style.transform='scale('+scale+') translate('+posX+'px,'+posY+'px)';
      };
      container.onmouseup=function(){isDragging=false;img.style.cursor=scale>1?'grab':'default';};

      // Double click to zoom in/out
      img.ondblclick=function(){
        if(scale>1){scale=1;posX=0;posY=0;}else{scale=2.5;}
        img.style.transform='scale('+scale+') translate(0px,0px)';
        posX=0;posY=0;
      };

      container.appendChild(img);

      // Zoom hint
      var hint=document.createElement('div');
      hint.style.cssText='position:absolute;bottom:12px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.5);font-size:11px;pointer-events:none';
      hint.textContent='Scroll to zoom \u00B7 Double-click to fit \u00B7 Drag to pan';
      container.appendChild(hint);

    } else if(type==='video'){
      var vid=document.createElement('video');
      vid.src=dataUrl;
      vid.controls=true;vid.autoplay=true;
      vid.style.cssText='max-width:95vw;max-height:calc(100vh - 100px);outline:none;border-radius:4px';
      vid.onclick=function(e){e.stopPropagation();};

      // Fullscreen on double-click
      vid.ondblclick=function(){
        if(vid.requestFullscreen)vid.requestFullscreen();
        else if(vid.webkitRequestFullscreen)vid.webkitRequestFullscreen();
      };

      // Mouse wheel volume control
      var volIndicator=document.createElement('div');
      volIndicator.style.cssText='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.7);color:#fff;font-size:16px;padding:8px 16px;border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none;font-family:sans-serif';
      var volTimer=null;
      vid.onwheel=function(e){
        e.preventDefault();
        var delta=e.deltaY>0?-0.05:0.05;
        vid.volume=Math.max(0,Math.min(1,vid.volume+delta));
        volIndicator.textContent='\u{1F50A} '+Math.round(vid.volume*100)+'%';
        volIndicator.style.opacity='1';
        if(volTimer)clearTimeout(volTimer);
        volTimer=setTimeout(function(){volIndicator.style.opacity='0';},1500);
      };

      container.appendChild(vid);
      container.appendChild(volIndicator);

      var hint2=document.createElement('div');
      hint2.style.cssText='position:absolute;bottom:12px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.5);font-size:11px;pointer-events:none';
      hint2.textContent='Double-click for fullscreen \u00B7 Scroll to adjust volume';
      container.appendChild(hint2);

    } else if(type==='ptt'||type==='audio'){
      var aud=document.createElement('audio');
      aud.src=dataUrl;aud.controls=true;aud.autoplay=true;
      aud.style.cssText='width:400px;max-width:90vw';
      aud.onclick=function(e){e.stopPropagation();};
      container.appendChild(aud);
    }

    viewer.appendChild(container);

    // Click background to close (not on media)
    viewer.onclick=function(e){if(e.target===viewer||e.target===container)viewer.remove();};

    // Escape key to close
    var escHandler=function(e){if(e.key==='Escape'){viewer.remove();document.removeEventListener('keydown',escHandler);}};
    document.addEventListener('keydown',escHandler);

    document.body.appendChild(viewer);
  }

  // ── Sidebar icon positioning ───────────────────────────
  function pos(){var mb=null;document.querySelectorAll('button,[role=button]').forEach(function(e){if(e.getBoundingClientRect().left<60&&(e.title==='Media'||e.ariaLabel==='Media'))mb=e;});
    if(mb){var r=mb.getBoundingClientRect();btn.style.top=(r.top-48)+'px';btn.style.left=Math.round(r.left)+'px';}
    else{var a=[];document.querySelectorAll('button,[role=button]').forEach(function(e){var r=e.getBoundingClientRect();if(r.left<60&&r.width>20&&r.width<55&&r.height>20)a.push({y:r.top,x:r.left});});a.sort(function(a,b){return a.y-b.y;});if(a.length>=3){var t=a[a.length-3];btn.style.top=(t.y-48)+'px';btn.style.left=Math.round(t.x)+'px';}}}
  pos();window.addEventListener('resize',pos);setInterval(pos,10000); // Check every 10s instead of 3s

  // ── Chat header restore button ────────────────────────
  var restoreSvg='<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 16v-2h2v2h-2zm0-4V7h2v6h-2z"/></svg>';

  // Restore button — find the flex container that holds Search+Menu, insert as first child
  function injectRestoreBtn(){
    var old=document.getElementById('wplus-header-restore');

    // Find Search button in right panel header
    var searchBtn=null;
    document.querySelectorAll('button').forEach(function(el){
      var r=el.getBoundingClientRect();
      var t=(el.title||el.ariaLabel||'').toLowerCase();
      if(r.x>500&&r.y>30&&r.y<90&&r.width>=30&&t.indexOf('search')!==-1)searchBtn=el;
    });
    if(!searchBtn){if(old)old.remove();return;}

    // Walk UP from Search button to find the flex container that holds all header action buttons
    // It's the div with display:flex that has 2+ direct children (Search wrapper + Menu wrapper + optional Call)
    var flexContainer=null;
    var el=searchBtn;
    for(var i=0;i<6;i++){
      el=el.parentElement;
      if(!el)break;
      var cs=getComputedStyle(el);
      var r=el.getBoundingClientRect();
      // The flex container: display:flex, reasonable width (80-300px), in header area, has 2+ children
      if(cs.display==='flex'&&cs.flexDirection==='row'&&r.height<80&&el.children.length>=2){
        flexContainer=el;break;
      }
    }
    if(!flexContainer){if(old)old.remove();return;}

    // Check if already inserted in this container
    if(old&&old.parentElement===flexContainer)return;
    if(old)old.remove();

    // Create a wrapper div matching the same structure as Search/Menu wrappers
    var wrapper=document.createElement('div');
    wrapper.id='wplus-header-restore';
    wrapper.style.cssText='display:flex;align-items:center;justify-content:center';

    var rb=document.createElement('button');
    rb.style.cssText='width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;border:0;background:transparent;padding:0;outline:0;transition:background .15s;position:relative';
    rb.innerHTML=restoreSvg+'<span class="wplus-tip">Restore deleted</span>';
    rb.onmouseenter=function(){this.style.background='rgba(255,255,255,.1)';};
    rb.onmouseleave=function(){this.style.background='transparent';};

    rb.onclick=function(e){
      e.stopPropagation();
      if(!W||!W.forceRestoreCurrentChat)return;
      rb.querySelector('svg').style.animation='wplus-spin 1s linear infinite';
      rb.querySelector('.wplus-tip').textContent='Restoring...';
      W.forceRestoreCurrentChat(function(count){
        rb.querySelector('svg').style.animation='';
        rb.querySelector('.wplus-tip').textContent=count>0?count+' restored!':'No deleted found';
        rb.querySelector('svg').style.fill=count>0?'#25D366':'#ef4444';
        setTimeout(function(){rb.querySelector('.wplus-tip').textContent='Restore deleted';rb.querySelector('svg').style.fill='';},3000);
      });
    };

    wrapper.appendChild(rb);
    // Insert as FIRST child of the flex container (before Search and Menu)
    flexContainer.insertBefore(wrapper,flexContainer.firstChild);
  }

  // Watch for chat changes — inject header button + position scroll-up
  var _injDebounce=null;
  new MutationObserver(function(){
    if(_injDebounce)clearTimeout(_injDebounce);
    _injDebounce=setTimeout(function(){injectRestoreBtn();checkScrollUp();},500);
  }).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
  injectRestoreBtn();

  // ── Scroll Up / Load Older Messages button ────────────
  var upArrowSvg='<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>';
  var scrollUpBtn=document.createElement('button');
  scrollUpBtn.id='wplus-scroll-up';
  scrollUpBtn.title='Load older messages';
  scrollUpBtn.innerHTML=upArrowSvg+'<span class="wplus-count"></span>';
  document.body.appendChild(scrollUpBtn);

  var _loadingOlder=false;
  scrollUpBtn.onclick=function(e){
    e.stopPropagation();
    if(_loadingOlder)return;
    _loadingOlder=true;
    scrollUpBtn.classList.add('loading');

    try{
      // Find active chat via engine
      var CC=window.require("WAWebChatCollection").ChatCollection;
      var chat=null;

      // Method 1: Find by header name
      var headers=document.querySelectorAll('header');
      headers.forEach(function(h){
        var r=h.getBoundingClientRect();
        if(r.x>400&&r.width>200){
          h.querySelectorAll('span[dir="auto"],span.x1iyjqo2').forEach(function(s){
            var name=s.textContent.trim();
            if(name&&!chat)(CC._models||[]).forEach(function(c){
              if(c.__x_name===name||c.__x_formattedTitle===name)chat=c;
            });
          });
        }
      });

      // Method 2: Find by checking which chat has active/focus
      if(!chat)(CC._models||[]).forEach(function(c){if(c.__x_active)chat=c;});

      if(!chat){_loadingOlder=false;scrollUpBtn.classList.remove('loading');return;}

      var loader=window.require("WAWebChatLoadMessages");
      var before=chat.msgs&&chat.msgs._models?chat.msgs._models.length:0;

      loader.loadEarlierMsgs(chat).then(function(){
        var after=chat.msgs&&chat.msgs._models?chat.msgs._models.length:0;
        var loaded=after-before;
        _loadingOlder=false;
        scrollUpBtn.classList.remove('loading');

        var badge=scrollUpBtn.querySelector('.wplus-count');
        if(loaded>0){
          badge.textContent='+'+loaded;
          badge.style.display='';
          setTimeout(function(){badge.style.display='none';},3000);

          // Scroll to top — try multiple scroll container selectors
          setTimeout(function(){
            var scrolled=false;
            document.querySelectorAll('[role="application"] div, #main div, [data-tab] div').forEach(function(el){
              if(scrolled)return;
              if(el.scrollHeight>el.clientHeight+100&&el.clientHeight>200){
                var r=el.getBoundingClientRect();
                if(r.x>400&&r.width>300){
                  el.scrollTop=0;
                  scrolled=true;
                }
              }
            });
          },300);
        } else {
          badge.textContent='\u{2714}';
          badge.style.display='';
          scrollUpBtn.title='No more messages';
          setTimeout(function(){badge.style.display='none';scrollUpBtn.title='Load older messages';},2000);
        }
      }).catch(function(){_loadingOlder=false;scrollUpBtn.classList.remove('loading');});

    }catch(ex){_loadingOlder=false;scrollUpBtn.classList.remove('loading');}
  };

  // Show/hide scroll-up button based on whether a chat is open
  function checkScrollUp(){
    var hasChat=false;
    document.querySelectorAll('header').forEach(function(h){
      if(h.getBoundingClientRect().x>400&&h.getBoundingClientRect().width>200)hasChat=true;
    });
    scrollUpBtn.style.display=hasChat?'flex':'none';
  }
  checkScrollUp();

  return'ok';
})();
