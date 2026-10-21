// WPlus Engine — github.com/KuchiSofts — MIT License
(function(){
  'use strict';
  // Allow re-injection by cleaning up previous instance
  if(window.__wplus&&window.__wplus.cleanup)try{window.__wplus.cleanup();}catch(e){}
  window.__wplus={version:'2.1.0',ready:false};  // Keep in sync with CURRENT_VERSION in service/wplus.py

  var MAX_MSGS=1000;
  var CC=null,CON=null,GRP=null;
  var _comp,_rec,_pres,_seen,_played,_proto,_mods={};
  var presInt=null;
  // Lifecycle: everything added to WhatsApp is tracked so cleanup() can take it all back
  var dead=false,_subs=[],_cols=[],_timers={},_onCleanup=[];
  function listen(col,ev,fn){col.on(ev,fn);_subs.push([col,ev,fn]);}
  function later(fn,ms){var id=setTimeout(function(){delete _timers[id];if(!dead)fn();},ms);_timers[id]=1;return id;}

  // ── Debug system ──────────────────────────────────────────
  // Off by default — the log contains message previews and phone numbers.
  // Enabled from the panel (Settings → Debug logging), stored as wplus_cfg.debugEnabled.
  var debugEnabled=false;
  var debugLog=[];
  var MAX_LOG=500;
  function dbg(category, msg, data){
    if(!debugEnabled)return;
    var entry={t:Date.now(),ts:new Date().toLocaleTimeString(),cat:category,msg:msg};
    if(data!==undefined)entry.data=typeof data==='object'?JSON.stringify(data).substring(0,2000):String(data).substring(0,2000);
    debugLog.push(entry);
    if(debugLog.length>MAX_LOG)debugLog=debugLog.slice(-MAX_LOG);
    // Batch save — only write to localStorage every 5 seconds max
    if(!dbg._timer){
      dbg._timer=setTimeout(function(){
        dbg._timer=null;
        try{localStorage.setItem('wplus_log',JSON.stringify(debugLog));}catch(e){}
      },5000);
    }
    console.log('[WPlus:'+category+'] '+msg+(data!==undefined?' | '+entry.data:''));
  }

  // ── Storage helpers ───────────────────────────────────────
  var LS={
    // A missing key must return the default too (JSON.parse(null) is null, not an error)
    get:function(k,d){try{var v=JSON.parse(localStorage.getItem(k));return v===null||v===undefined?(d===undefined?null:d):v;}catch(e){return d===undefined?null:d;}},
    // Never throws: a full localStorage (QuotaExceededError) must not break message capture
    set:function(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){dbg('storage','Write failed: '+k+' ('+(e&&e.name)+')');return false;}},
    del:function(k){try{localStorage.removeItem(k);}catch(e){}}
  };
  // Media kept in memory when it does not fit in localStorage (this session only)
  var _memMedia={},_memVO={};
  function saveDel(d){
    if(LS.set('wplus_del',d))return true;
    d.forEach(function(m){if(m&&m.media){if(m.id)_memMedia[m.id]={media:m.media,mime:m.mime};delete m.media;}});
    while(!LS.set('wplus_del',d)){if(d.length<2)return false;d.splice(0,Math.ceil(d.length/4));}
    return true;
  }

  function settings(k,v){
    var s=LS.get('wplus_cfg',{});
    if(v===undefined)return k?s[k]:s;
    s[k]=v;LS.set('wplus_cfg',s);return v;
  }

  debugEnabled=(LS.get('wplus_cfg',{})||{}).debugEnabled===true;
  if(!debugEnabled){try{localStorage.removeItem('wplus_log');}catch(e){}}

  // Merge all old storage keys into current key on first call
  var _merged=false;
  function mergeOldKeys(){
    if(_merged)return;_merged=true;
    var current=LS.get('wplus_del',[])||[];
    var ids=new Set(current.map(function(m){return m.id;}));
    var oldKeys=['wplus_deleted_msgs','wtplus_deleted_msgs','wtplus_del'];
    var added=0;
    oldKeys.forEach(function(key){
      try{
        var old=JSON.parse(localStorage.getItem(key)||'[]');
        if(Array.isArray(old)){
          old.forEach(function(m){if(m.id&&!ids.has(m.id)){current.push(m);ids.add(m.id);added++;}});
        }
      }catch(e){}
    });
    if(added>0){
      if(current.length>MAX_MSGS)current=current.slice(-MAX_MSGS);
      saveDel(current);
      dbg('storage','Merged '+added+' msgs from old keys. Total: '+current.length);
    }
  }

  function deletedMsgs(action,item){
    mergeOldKeys();
    var d=LS.get('wplus_del',[])||[];
    if(!Array.isArray(d))d=[];
    d.forEach(function(m){var x=m&&!m.media&&!m.mediaFile&&_memMedia[m.id];if(x){m.media=x.media;if(x.mime)m.mime=x.mime;}});
    if(action==='get')return d;
    if(action==='add'){
      // Deduplicate
      var exists=d.some(function(m){return m.id===item.id;});
      if(!exists){d.push(item);if(d.length>MAX_MSGS)d=d.slice(-MAX_MSGS);saveDel(d);}
    }
    if(action==='clear'){
      LS.del('wplus_del');_memMedia={};
      ['wplus_deleted_msgs','wtplus_deleted_msgs','wtplus_del'].forEach(function(k){LS.del(k);});
      serverPost('/deleted/clear',{});
    }
    return d;
  }

  // Server saved the media to disk — keep only the file reference in localStorage
  function noteMediaFile(id,r){
    if(!r||!r.mediaFile)return;
    var d=deletedMsgs('get');
    for(var i=d.length-1;i>=0;i--){
      if(d[i].id===id){d[i].mediaFile=r.mediaFile;delete d[i].media;delete _memMedia[id];saveDel(d);break;}
    }
  }

  function viewOnce(action,item){
    var d=LS.get('wplus_vo',[])||[];
    if(!Array.isArray(d))d=[];
    if(action==='get')return d;
    if(action==='add'){
      var idx=d.findIndex(function(x){return x.id===item.id;});
      if(idx>=0)d[idx]=item;else d.push(item);
      if(d.length>200)d=d.slice(-200);saveVO(d);
    }
    if(action==='clear'){LS.del('wplus_vo');_memVO={};}
    return d;
  }
  function saveVO(d){
    if(LS.set('wplus_vo',d))return true;
    // Too big for localStorage: keep the media in memory, store the entry without it
    d.forEach(function(x){if(x&&x.data){_memVO[x.id]=x.data;x.data=null;x.inMemory=true;}});
    return LS.set('wplus_vo',d);
  }

  // ── File Server API (localhost:18733) ────────────────────
  var SERVER='http://127.0.0.1:18733';
  // Per-session token set by the WPlus service at injection time — the server rejects requests without it
  var TOKEN=window.__WPLUS_TOKEN__||'';
  try{delete window.__WPLUS_TOKEN__;}catch(e){}
  // WhatsApp's Content-Security-Policy blocks fetch/img/media requests to 127.0.0.1,
  // so requests go through a DevTools binding instead: the WPlus service receives
  // window.__wplusBridge(json), forwards it to the file server and answers through
  // window.__wplusBridgeReply(id,result). Plain fetch is only a fallback.
  var _br={n:0,cb:{}};
  window.__wplusBridgeReply=function(id,res){var c=_br.cb[id];delete _br.cb[id];if(c)c(res);};
  function hasBridge(){return typeof window.__wplusBridge==='function';}
  function bridge(method,path,body,cb){
    var id=++_br.n;
    // Give up on a reply that never comes, so callbacks do not pile up
    var t=later(function(){var c=_br.cb[id];delete _br.cb[id];if(c)c(null);},120000);
    _br.cb[id]=function(r){clearTimeout(t);delete _timers[t];cb(r);};
    try{window.__wplusBridge(JSON.stringify({id:id,method:method,path:path,body:body===undefined?null:body}));}
    catch(e){var c=_br.cb[id];delete _br.cb[id];if(c)c(null);}
  }
  function serverPost(path,data,cb){
    if(hasBridge()){
      bridge('POST',path,data,function(r){
        var j=r&&r.json;dbg('server',path+' → '+(r?r.status:'no reply'));if(cb&&j)cb(j);
      });
      return;
    }
    try{
      fetch(SERVER+path,{method:'POST',headers:{'Content-Type':'application/json','X-WPlus-Token':TOKEN},body:JSON.stringify(data)})
      .then(function(r){return r.json();})
      .then(function(r){dbg('server',path+' → '+JSON.stringify(r));if(cb)cb(r);})
      .catch(function(e){dbg('server',path+' error: '+e.message);});
    }catch(e){dbg('server','fetch error: '+e.message);}
  }
  function serverGet(path,cb){
    if(hasBridge()){bridge('GET',path,null,function(r){if(cb)cb(r&&r.json||null);});return;}
    try{
      fetch(SERVER+path,{headers:{'X-WPlus-Token':TOKEN}}).then(function(r){return r.json();}).then(cb)
      .catch(function(e){dbg('server','GET '+path+' error');if(cb)cb(null);});
    }catch(e){if(cb)cb(null);}
  }
  function mediaPath(rel){return '/media/'+String(rel).split('/').map(encodeURIComponent).join('/');}
  // URL for a saved media file (data-relative path like "Images/x.jpg") — fallback only
  function mediaUrl(rel){
    return SERVER+mediaPath(rel)+'?t='+encodeURIComponent(TOKEN);
  }
  // Load a saved media file as a blob: URL (allowed by WhatsApp's CSP); cb(url|null)
  var _blobs={};
  function loadMedia(rel,cb){
    if(_blobs[rel]){cb(_blobs[rel]);return;}
    if(!hasBridge()){cb(mediaUrl(rel));return;}
    bridge('GET',mediaPath(rel),null,function(r){
      if(!r||r.status!==200||!r.b64){cb(null);return;}
      try{
        var bin=atob(r.b64),u8=new Uint8Array(bin.length);
        for(var i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
        _blobs[rel]=URL.createObjectURL(new Blob([u8],{type:r.mime||'application/octet-stream'}));
        cb(_blobs[rel]);
      }catch(e){cb(null);}
    });
  }

  // ── Module finder ─────────────────────────────────────────
  // One pass over the module map: {name: module object that exports it}
  function findExports(names){
    var out={},left=names.length;
    try{var ks=Object.keys(window.require("__debug").modulesMap);
    for(var i=0;i<ks.length&&left;i++){try{var m=window.require(ks[i]),d=m&&m.default||m;
    names.forEach(function(n){if(out[n])return;if(d&&typeof d[n]==='function'){out[n]=d;left--;}else if(m&&typeof m[n]==='function'){out[n]=m;left--;}});}catch(e){}}
    }catch(e){}return out;
  }
  // Replacements remember the original, so a re-injection that skipped cleanup still restores it
  function orig(f){return f&&f.__wpOrig||f;}
  function noop(o){var f=function(){return Promise.resolve();};f.__wpOrig=o;return f;}

  function init(){
    try{
      if(typeof window.require!=='function'){dbg('init','window.require not found');return false;}
      var c=window.require("WAWebChatCollection");
      if(!c||!c.ChatCollection||!c.ChatCollection._models){dbg('init','ChatCollection not ready');return false;}
      CC=c.ChatCollection;
      dbg('init','ChatCollection found',{chats:CC._models.length});
      try{CON=window.require("WAWebContactCollection").ContactCollection;dbg('init','ContactCollection found',{contacts:(CON._models||[]).length});}catch(e){dbg('init','ContactCollection failed',e.message);}
      try{GRP=window.require("WAWebGroupMetadataCollection").GroupMetadataCollection;dbg('init','GroupMetadata found',{groups:(GRP._models||[]).length});}catch(e){}
      var fx=findExports(["markComposing","sendPresenceAvailable","sendPresenceUnavailable","sendConversationSeen","markPlayed","sendPresenceStatusProtocol"]);
      _mods={comp:fx.markComposing,pres:fx.sendPresenceAvailable,unav:fx.sendPresenceUnavailable,seen:fx.sendConversationSeen,played:fx.markPlayed,proto:fx.sendPresenceStatusProtocol};
      if(_mods.proto){_proto=orig(_mods.proto.sendPresenceStatusProtocol);dbg('init','Presence protocol hook ready');}
      if(_mods.comp){_comp=orig(_mods.comp.markComposing);_rec=orig(_mods.comp.markRecording);dbg('init','Composing hooks ready');}
      if(_mods.pres){_pres=orig(_mods.pres.sendPresenceAvailable);dbg('init','Presence hook ready');}
      if(_mods.seen){_seen=orig(_mods.seen.sendConversationSeen);dbg('init','ConversationSeen hook ready');}
      if(_mods.played){_played=orig(_mods.played.markPlayed);dbg('init','markPlayed hook ready');}
      return true;
    }catch(e){dbg('init','FATAL',e.message);return false;}
  }

  // ── Message hooks ─────────────────────────────────────────
  var HEADER='\u{1F6AB} *This message was deleted:*\n';
  var MEDIA_T=['image','video','sticker','document','audio','ptt'];
  var CAPTURE_T=['chat','image','video','ptt','audio','document','sticker','vcard','location'];
  // Wids still carry _serialized; message keys (MsgKey) no longer do on current builds, only toString()
  function sid(w){if(!w)return '';if(w._serialized)return w._serialized;if(typeof w.toString==='function'&&w.toString!==Object.prototype.toString){var s=String(w);return /_/.test(s)?s:'';}return '';}
  function chatTitle(chat){return chat.__x_name||chat.__x_formattedTitle||(chat.id?chat.id.user:'?');}
  // Text for a deleted message that cannot be shown as media again (its media data is gone)
  function placeholder(type,caption,body,lat,lng){
    if(type==='location')return '\u{1F4CD} Location'+(lat!=null&&lng!=null?' '+lat+', '+lng:'');
    var lbl={image:'\u{1F4F7} Photo',video:'\u{1F3AC} Video',sticker:'\u{1F3A8} Sticker',document:'\u{1F4C4} Document',audio:'\u{1F3B5} Audio',ptt:'\u{1F3A4} Voice message'}[type];
    return lbl?lbl+(caption?'\n'+caption:''):(body||'');
  }
  function restoreMsg(msg){
    try{
      if(MEDIA_T.indexOf(msg.__x_backupType)!==-1&&msg.__x_backupMediaData){
        msg.__x_type=msg.__x_backupType;msg.__x_body=msg.__x_backupBody;
        msg.__x_text=HEADER+(msg.__x_backupText||'');
        msg.__x_caption=HEADER+(msg.__x_backupCaption||'');
        msg.__x_mediaData=msg.__x_backupMediaData;msg.__x_isMMS=true;msg.__x_isMedia=true;
      }else{
        var body=placeholder(msg.__x_backupType,msg.__x_backupCaption,msg.__x_backupBody||msg.__x_backupText||'',msg.__x_backupLat,msg.__x_backupLng);
        msg.__x_type='chat';msg.__x_body=HEADER+body;msg.__x_text=HEADER+body;
      }
      msg.__x_isRevoked=false;msg.__wpRestored=true;markDeleted(msg);
      dbg('restore','Msg restored: '+(msg.__x_backupType||'chat')+' | '+String(msg.__x_backupBody||'').substring(0,30));
    }catch(e){dbg('restore','Error: '+e.message);}
  }

  // ── "Deleted" badge on restored bubbles ──────────────────
  // Rows carry the short message id (id.id) in data-id; restored ones get a red ring + "Deleted" badge.
  var _delIds=new Set(),_delObs=null,_delTimer=null;
  var DEL_CSS='.wplus-del{box-shadow:0 0 0 2px rgba(239,68,68,.85)!important;border-radius:8px}'+
    '.wplus-del::after{content:"\u{1F6AB} Deleted";position:absolute;top:-9px;right:10px;z-index:3;background:#ef4444;color:#fff;'+
    'font:600 10px/16px system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 7px;border-radius:8px;pointer-events:none;'+
    'box-shadow:0 1px 2px rgba(0,0,0,.35);white-space:nowrap}';
  function markDeleted(msg){
    try{
      var k=msg&&msg.__x_id,i=k&&k.id;if(!i||dead)return;
      _delIds.add(String(i));
      if(!document.getElementById('wplus-del-style')){var st=document.createElement('style');st.id='wplus-del-style';st.textContent=DEL_CSS;document.head.appendChild(st);}
      if(!_delObs&&window.MutationObserver){
        var app=document.getElementById('app')||document.body;
        _delObs=new MutationObserver(scheduleDelPaint);_delObs.observe(app,{childList:true,subtree:true});
      }
      scheduleDelPaint();
    }catch(e){}
  }
  function scheduleDelPaint(){if(_delTimer||dead||!_delIds.size)return;_delTimer=later(function(){_delTimer=null;paintDeleted();},150);}
  function paintDeleted(){
    var main=document.getElementById('main');if(!main)return;
    main.querySelectorAll('[data-id]').forEach(function(r){
      if(!_delIds.has(r.getAttribute('data-id')))return;
      var c=r.querySelector('[data-testid="msg-container"]')||r;
      if(!c.classList.contains('wplus-del'))c.classList.add('wplus-del');
    });
  }

  // Keep a copy of an incoming message on the model itself (for every loaded message, not only new ones,
  // so a message that was already on screen when WPlus started can still be restored)
  function backup(msg){
    if(!msg||msg.__x_backupType||msg.__wpRestored)return false;
    var mid=msg.__x_id||msg.id;if(!mid||mid.fromMe)return false;
    if(CAPTURE_T.indexOf(msg.__x_type)===-1)return false;
    msg.__x_backupBody=msg.__x_body;msg.__x_backupText=msg.__x_text;msg.__x_backupType=msg.__x_type;
    msg.__x_backupCaption=msg.__x_caption;msg.__x_backupMediaData=msg.__x_mediaData;
    msg.__x_backupLat=msg.__x_lat;msg.__x_backupLng=msg.__x_lng;
    // In groups __x_from is the group JID; the actual sender is __x_author
    msg.__x_backupTime=Date.now();msg.__x_backupSender=sid(msg.__x_author)||sid(msg.__x_from)||'?';
    return true;
  }
  // An edit updates the same model: keep the latest text so a later delete saves what was last shown
  function noteEdit(msg){
    if(msg.__wpRestored||msg.__x_type!==msg.__x_backupType)return;
    if(msg.__x_body&&msg.__x_body!==msg.__x_backupBody){msg.__x_backupBody=msg.__x_body;msg.__x_backupText=msg.__x_text;}
    if(msg.__x_caption&&msg.__x_caption!==msg.__x_backupCaption)msg.__x_backupCaption=msg.__x_caption;
    if(msg.__x_mediaData&&!msg.__x_backupMediaData)msg.__x_backupMediaData=msg.__x_mediaData;
  }
  // Send a newly received message to the file server (once)
  function postNew(msg,chat){
    if(msg.__wpPosted||!(msg.isNewMsg||msg.__x_isNewMsg))return;msg.__wpPosted=true;
    var msgId=sid(msg.__x_id)||'?',sender=msg.__x_backupSender||'?';
    var isViewOnce=!!(msg.__x_isViewOnce||msg.__x_viewOnce);
    if(debugEnabled){
      var senderName='';
      try{var c=CON&&CON.get?CON.get(sender):null;if(c)senderName=c.__x_name||c.__x_pushname||c.__x_formattedName||'';}catch(e){}
      dbg('msg:new','NEW MESSAGE',{id:msgId.substring(0,50),type:msg.__x_type,chat:chatTitle(chat),sender:sender.split('@')[0],senderName:senderName,
        bodyLength:(msg.__x_body||'').length,bodyPreview:String(msg.__x_body||'').substring(0,50).replace(/[\n\r]/g,' '),
        hasMedia:!!(msg.__x_mediaData&&msg.__x_mediaData.mediaBlob),caption:String(msg.__x_caption||'').substring(0,50),isViewOnce:isViewOnce,
        isGroupMsg:!!(chat.id&&chat.id.server==='g.us'),msgTimestamp:msg.__x_t||0});
    }
    var entry={id:msgId,type:msg.__x_type,body:msg.__x_body||'',text:msg.__x_text||'',
      caption:msg.__x_caption||'',sender:sender,time:Date.now(),chat:chatTitle(chat)};
    var md=msg.__x_mediaData;
    if(md&&md.mediaBlob&&md.mediaBlob._blob){
      var blob=md.mediaBlob._blob;
      dbg('msg:new','Media blob captured: '+blob.type+' ('+Math.round(blob.size/1024)+'KB)');
      var reader=new FileReader();
      reader.onload=function(){entry.media=reader.result;serverPost('/msg/new',entry);};
      reader.onerror=function(){serverPost('/msg/new',entry);};
      reader.readAsDataURL(blob);
    }else serverPost('/msg/new',entry);
    if(isViewOnce){dbg('msg:new','VIEW-ONCE detected! Capturing...');captureViewOnce(msg);}
  }

  function onRevoked(msg,chat){
    if(msg.__wpSaved){restoreMsg(msg);return;}  // WhatsApp marked it revoked again — already saved
    msg.__wpSaved=true;
    var msgId=msg.__wpOrigId||sid(msg.__x_id)||'?';
    var sender=msg.__x_backupSender||'?';
    dbg('msg:del','MESSAGE DELETED',{id:msgId.substring(0,50),originalType:msg.__x_backupType,chat:chatTitle(chat),sender:sender.split('@')[0],
      bodyPreview:String(msg.__x_backupBody||msg.__x_backupText||'').substring(0,60).replace(/[\n\r]/g,' '),
      caption:String(msg.__x_backupCaption||'').substring(0,40),hasMediaBackup:!!(msg.__x_backupMediaData&&msg.__x_backupMediaData.mediaBlob),
      timeSinceReceived:Math.round((Date.now()-(msg.__x_backupTime||Date.now()))/1000)+'s'});

    // Message time (seconds → ms) lets later sessions match the revoked placeholder exactly
    var entry={id:msgId,type:msg.__x_backupType,body:msg.__x_backupBody,
      text:msg.__x_backupText,caption:msg.__x_backupCaption,sender:sender,
      time:msg.__x_t?msg.__x_t*1000:(msg.__x_backupTime||Date.now()),chat:chatTitle(chat),media:null};
    if(msg.__x_backupType==='location'&&msg.__x_backupLat!=null){entry.lat=msg.__x_backupLat;entry.lng=msg.__x_backupLng;}

    serverPost('/msg/deleted',entry,function(r){noteMediaFile(entry.id,r);});

    // Try to capture media blob for images/videos/audio
    if(['image','video','ptt','audio','sticker'].indexOf(msg.__x_backupType)!==-1){
      try{
        var md=msg.__x_backupMediaData||msg.__x_mediaData;
        if(md&&md.mediaBlob&&md.mediaBlob._blob){
          var blob=md.mediaBlob._blob;
          dbg('msg:del','Media blob found: '+blob.type+' ('+Math.round(blob.size/1024)+'KB)');
          var reader=new FileReader();
          reader.onload=function(){try{
            entry.media=reader.result;entry.mime=blob.type;
            var d=deletedMsgs('get');
            for(var i=d.length-1;i>=0;i--){if(d[i].id===entry.id){d[i].media=entry.media;d[i].mime=entry.mime;break;}}
            saveDel(d);
            serverPost('/msg/deleted',entry,function(r){noteMediaFile(entry.id,r);});
            dbg('msg:del','Media sent to file server');
          }catch(e){dbg('msg:del','Media save error: '+e.message);}};
          reader.readAsDataURL(blob);
        }else dbg('msg:del','No media blob available for '+msg.__x_backupType+' message');
      }catch(e){dbg('msg:del','Media capture error: '+e.message);}
    }

    deletedMsgs('add',entry);
    restoreMsg(msg);
    dbg('msg:del','Saved and restored in chat UI');
    fire('update');
  }

  // Current WhatsApp handles "delete for everyone" by REMOVING the original message and ADDING a new
  // 'revoked' message whose protocolMessageKey points to the original (WAWebDBProcessRevokeMsgs).
  // The two events can arrive in either order, so each side waits briefly for the other.
  var _removed={},_pendingRev={},PAIR_MS=120000;
  var BK_FIELDS=['__x_backupBody','__x_backupText','__x_backupType','__x_backupCaption','__x_backupMediaData','__x_backupLat','__x_backupLng','__x_backupTime','__x_backupSender'];
  function origKey(msg){var k=msg&&(msg.__x_protocolMessageKey||msg.protocolMessageKey);return k?(sid(k)||String(k)):null;}
  function prunePairs(){var t=Date.now()-PAIR_MS;[_removed,_pendingRev].forEach(function(o){Object.keys(o).forEach(function(k){if(o[k].t<t)delete o[k];});});}
  function takeOver(orig,rev,chat){
    if(rev.__wpSaved)return;
    BK_FIELDS.forEach(function(f){rev[f]=orig[f];});
    rev.__wpOrigId=sid(orig.__x_id);orig.__wpSaved=true;
    onRevoked(rev,chat);
    // The revoked model may already be on screen: tell WhatsApp's views to re-read it
    try{if(rev.trigger){rev.trigger('change:type',rev,rev.__x_type);rev.trigger('change:body',rev,rev.__x_body);}}catch(e){}
  }
  function onRevokedAdded(msg,chat){
    var k=origKey(msg);if(!k||msg.__wpSaved)return false;
    var r=_removed[k],orig=r&&r.m;
    if(!orig){try{var live=chat.msgs.get&&chat.msgs.get(k);if(live&&live!==msg)orig=live;}catch(e){}}
    if(orig&&orig.__x_backupType){delete _removed[k];takeOver(orig,msg,chat);return true;}
    _pendingRev[k]={m:msg,t:Date.now()};prunePairs();
    return false;
  }
  function onRemoved(msg,chat){
    if(!msg||!msg.__x_backupType||msg.__wpSaved)return;
    var k=sid(msg.__x_id);if(!k)return;
    var p=_pendingRev[k];if(p){delete _pendingRev[k];takeOver(msg,p.m,chat);return;}
    _removed[k]={m:msg,t:Date.now()};prunePairs();
  }

  // Runs inside WhatsApp's collection 'add' — must never throw
  function hookChat(chat){try{hookChatMsgs(chat);}catch(e){if(chat&&chat.msgs)delete chat.msgs.__wp;dbg('init','hookChat failed: '+e.message);}}
  function hookChatMsgs(chat){
    if(!chat||!chat.msgs||chat.msgs.__wp)return;chat.msgs.__wp=true;_cols.push(chat.msgs);
    (chat.msgs._models||[]).forEach(function(m){try{if(backup(m))postNew(m,chat);}catch(e){}});

    listen(chat.msgs,'add',function(msg){try{
      if(msg&&msg.__x_type==='revoked'){onRevokedAdded(msg,chat);return;}
      if(backup(msg))postNew(msg,chat);
    }catch(e){dbg('msg:new','ERROR: '+e.message);}});
    listen(chat.msgs,'remove',function(msg){try{onRemoved(msg,chat);}catch(e){dbg('msg:del','REMOVE HANDLER ERROR: '+e.message);}});

    // Older WhatsApp builds revoke by changing the type to 'revoked' on the same model.
    // A message can also arrive undecrypted ('ciphertext') and only become 'chat' later.
    listen(chat.msgs,'change',function(msg){try{
      if(!msg)return;
      if(msg.__x_type!=='revoked'){if(msg.__x_backupType)noteEdit(msg);else if(backup(msg))postNew(msg,chat);return;}
      if(msg.__x_backupType)onRevoked(msg,chat);
    }catch(e){dbg('msg:del','HANDLER ERROR: '+e.message);}});
  }

  // ── View-once capture ─────────────────────────────────────
  function captureViewOnce(msg){
    try{
      var type=msg.__x_type||'unknown',sender=(msg.__x_backupSender||sid(msg.__x_from)||'?').split('@')[0];
      var entry={id:sid(msg.__x_id),type:type,sender:sender,time:Date.now(),data:null,mime:null,size:0};
      var done=false;

      function saveEntry(){viewOnce('add',entry);fire('update');}

      function tryCapture(){
        if(done)return true;  // later retries stop once the media was read
        try{
          var md=msg.__x_mediaData;
          if(md&&md.mediaBlob&&md.mediaBlob._blob){
            done=true;
            var blob=md.mediaBlob._blob;
            var r=new FileReader();
            r.onload=function(){entry.data=r.result;entry.mime=blob.type;entry.size=blob.size;saveEntry();
              dbg('msg:new','View-once captured: '+type);};
            r.readAsDataURL(blob);return true;
          }
          // Try force-downloading via WhatsApp's internal API
          if(md&&typeof md.downloadMedia==='function'&&!md.__wplus_dl){
            md.__wplus_dl=true;
            Promise.resolve(md.downloadMedia()).then(function(){later(tryCapture,1000);}).catch(function(){});
          }
        }catch(e){}return false;
      }

      // Also try to prevent view-once flag from blocking re-views
      try{msg.__x_isViewOnce=false;msg.__x_viewOnce=false;}catch(e){}

      saveEntry();
      // Multiple retry attempts — media may load at different times
      if(!tryCapture()){
        [2000,5000,10000,20000,30000].forEach(function(d){later(tryCapture,d);});
      }
    }catch(e){}
  }

  // ── Hide online ───────────────────────────────────────────
  // Every "available" presence (focus, typing, reconnect, any caller) ends in
  // WASendPresenceStatusProtocol.sendPresenceStatusProtocol({status}); dropping only status
  // "available" there keeps you offline without re-sending "unavailable" every second.
  function sendUnavailable(){try{var u=_mods.unav,r=u&&u.sendPresenceUnavailable();if(r&&r.catch)r.catch(function(){});}catch(e){}}
  function toggleOnline(on){
    var p=_mods.pres,pr=_mods.proto;
    if(!(p&&_pres)&&!(pr&&_proto)){dbg('toggle','presence functions not available');return;}
    if(on){
      if(pr&&_proto){
        var f=function(a){if(a&&a.status==='available')return Promise.resolve();return _proto.apply(this,arguments);};
        f.__wpOrig=_proto;pr.sendPresenceStatusProtocol=f;
      }else if(!presInt){presInt=setInterval(sendUnavailable,30000);}  // older builds: periodic fallback
      if(p&&_pres)p.sendPresenceAvailable=noop(_pres);
      sendUnavailable();
      dbg('toggle','Online status hidden');
    }else{
      if(pr&&_proto)pr.sendPresenceStatusProtocol=_proto;
      if(p&&_pres)p.sendPresenceAvailable=_pres;
      if(presInt){clearInterval(presInt);presInt=null;}
      // Show as online again right away (WhatsApp would otherwise wait for the next focus)
      try{if(document.hasFocus()&&_pres){var r=_pres.call(p);if(r&&r.catch)r.catch(function(){});}}catch(e){}
      dbg('toggle','Online status restored');
    }
  }

  // ── Toggle features ───────────────────────────────────────
  function applyToggle(id,on){
    dbg('toggle',id+' → '+(on?'ON':'OFF'));
    // Replacements return a Promise like the originals, so WhatsApp's own .then() chains keep working
    try{
    if(id==='hideTyping'){var c=_mods.comp;if(c&&_comp){if(on){c.markComposing=noop(_comp);if(_rec)c.markRecording=noop(_rec);dbg('toggle','Typing indicator hooked');}else{c.markComposing=_comp;if(_rec)c.markRecording=_rec;dbg('toggle','Typing indicator restored');}}else dbg('toggle','markComposing not available');}
    if(id==='hideOnline')toggleOnline(on);
    if(id==='disableReceipts'){var s=_mods.seen;if(s&&_seen){if(on){s.sendConversationSeen=noop(_seen);dbg('toggle','Read receipts disabled');}else{s.sendConversationSeen=_seen;dbg('toggle','Read receipts restored');}}else dbg('toggle','sendConversationSeen not available');}
    if(id==='playAudioPrivate'){var pl=_mods.played;if(pl&&_played){if(on){pl.markPlayed=noop(_played);dbg('toggle','Audio play status hidden');}else{pl.markPlayed=_played;dbg('toggle','Audio play status restored');}}else dbg('toggle','markPlayed not available');}
    }catch(e){dbg('toggle',id+' failed: '+e.message);}
    // Blur: inject/remove <style> tags — CSS auto-applies to all elements including new ones
    var sidebarPreview='#pane-side [data-testid="cell-frame-secondary"] > :first-child';
    // Message bubbles: current WhatsApp marks them with data-testid="msg-container"
    // (the old .message-in/.message-out classes are gone); text spans can be nested.
    var bubble='#main [data-testid="msg-container"]';
    var bubbleText=bubble+' [data-testid~="selectable-text"]';
    var blurCSS={
      blurMessages:[
        // Message text in bubbles (chat area only)
        bubbleText,
        '.message-in .copyable-text','.message-out .copyable-text',
        // Chat list message preview text
        '._ak8k',sidebarPreview,
        // Media in messages (blob images >80px = photos, NOT emojis/reactions)
        bubble+' img[src^="blob:"]',bubble+' img[src^="data:image/jpeg"]',bubble+' video',
        '.message-in img[src^="blob:"]','.message-out img[src^="blob:"]',
        '.message-in img[src^="data:image/jpeg"]','.message-out img[src^="data:image/jpeg"]',
        '.message-in video','.message-out video'
      ],
      blurContacts:[
        // Contact names in chat list
        'span[title][dir]',
        // Sender names in group messages (colored)
        bubble+' [data-testid="author"]',
        'span._ahxt',
        // Chat header name
        'header span[dir="auto"]','header span.x1iyjqo2',
        // Contact/group info
        '[data-testid="conversation-header"] span','[data-testid="cell-frame-title"] span',
        // Maybe contacts
        'span[aria-label*="Maybe"]'
      ],
      blurPhotos:[
        // ONLY large media images in messages (>80px blob/data, NOT round avatars, NOT emojis)
        'img[src^="blob:"]:not([src*="whatsapp.net"])',
        'img[src^="data:image/jpeg"]',
        'img[src^="data:image/png"]'
      ],
      blurAvatar:[
        // CDN avatars and sidebar avatars, including blob/data URLs
        'img[src*=".whatsapp.net/v/t61"]',
        'img[src*="pps.whatsapp.net"]',
        '#pane-side [data-testid="cell-frame-container"] > :first-child img',
        // Avatars with a status ring or a badge (disappearing messages, group, etc.)
        // are drawn as a masked SVG <image>, not an <img> — blur the whole SVG
        'svg:has(image[*|href*=".whatsapp.net/"])',
        '#pane-side [data-testid="cell-frame-container"] > :first-child svg:has(image)'
      ]
    };
    // Build CSS — add blur + hover-reveal, exclude tiny images (<25px = emojis/reactions/icons)
    var _builtCSS={};
    Object.keys(blurCSS).forEach(function(k){
      var sels=blurCSS[k];
      var blurPx=k==='blurAvatar'?'10':k==='blurPhotos'?'8':'5';
      // For photos: add min-width/height filter to exclude emojis and reaction images
      var extraFilter=k==='blurPhotos'?':not([width="17"]):not([height="17"]):not([width="20"]):not([height="20"])':'';
      var sel=sels.map(function(x){return x+extraFilter;}).join(',');
      var hov=sels.map(function(x){return x+extraFilter+':hover';}).join(',');
      _builtCSS[k]=sel+'{filter:blur('+blurPx+'px)!important;transition:filter .15s!important}'+hov+'{filter:none!important}';
    });
    // Avoid stacked filters so hovering the preview reveals all of its text.
    _builtCSS.blurMessages+=sidebarPreview+' *{filter:none!important}';
    // Same for nested text spans in a bubble, and reveal the whole bubble on hover.
    _builtCSS.blurMessages+=bubbleText+' [data-testid~="selectable-text"]{filter:none!important}'+
      bubble+':hover [data-testid~="selectable-text"],'+bubble+':hover img,'+bubble+':hover video{filter:none!important}';
    if(_builtCSS[id]){
      var styleId='wplus-css-'+id;
      var existing=document.getElementById(styleId);
      if(on&&!existing){var st=document.createElement('style');st.id=styleId;st.textContent=_builtCSS[id];document.head.appendChild(st);dbg('toggle','CSS injected: '+id+' ('+blurCSS[id].length+' selectors)');}
      else if(!on&&existing){existing.remove();dbg('toggle','CSS removed: '+id);}
    }
  }

  function fire(name){window.dispatchEvent(new CustomEvent('wplus-'+name));}

  // ── Navigate to message + load older msgs + restore ─────
  function findChatByJid(jid){
    var user=jid.split('@')[0];
    try{var c=CC.get&&CC.get(jid);if(c)return c;}catch(e){}
    var models=CC._models||[];
    for(var i=0;i<models.length;i++){
      if(models[i].id&&(models[i].id._serialized===jid||models[i].id.user===user))return models[i];
    }
    return null;  // no substring guess: it could open somebody else's chat
  }

  function extractJid(msgId){
    var firstUs=msgId.indexOf('_');
    if(firstUs===-1)return null;
    var rest=msgId.substring(firstUs+1);
    var m=rest.match(/^(.+?@[cgs]\.us)/);
    return m?m[1]:rest.split('_')[0];
  }
  // Chat part ("123@c.us") of a serialized message id ("false_123@c.us_ABC[_author]")
  function idUser(msgId){return (String(msgId||'').split('_')[1]||'').split('@')[0];}

  function activeChat(){
    try{var a=CC.getActive&&CC.getActive();if(a)return a;}catch(e){}
    var models=CC._models||[];
    for(var i=0;i<models.length;i++)if(models[i].__x_active)return models[i];
    var headerName='';
    try{var hdr=document.querySelector('#main header span[dir="auto"], [data-testid="conversation-header"] span[dir="auto"]');if(hdr)headerName=hdr.textContent.trim();}catch(e){}
    if(headerName)for(var j=0;j<models.length;j++)if(models[j].__x_name===headerName||models[j].__x_formattedTitle===headerName)return models[j];
    return null;
  }

  function openChat(chat){
    // Method 1: Cmd.openChatAt
    try{
      var Cmd=window.require("WAWebCmd").Cmd;
      if(Cmd&&typeof Cmd.openChatAt==='function'){Cmd.openChatAt({chat:chat});return true;}
    }catch(e){}
    // Method 2: handleOpenChat
    try{
      var poc=window.require("WAWebPhoneNumberContactAction");
      if(poc&&poc.handleOpenChat){poc.handleOpenChat(null,chat.id,null);return true;}
    }catch(e){}
    return false;
  }

  function scrollToMsg(chat,msgObj){
    try{
      var Cmd=window.require("WAWebCmd").Cmd;
      var search=window.require("WAWebChatMessageSearch");
      if(Cmd&&Cmd.openChatAt&&search&&search.getSearchContext){
        // Current WhatsApp takes one options object: {chat, msgKey}
        var key=msgObj.__x_id||msgObj.id,ctx=search.getSearchContext.length===1?search.getSearchContext({chat:chat,msgKey:key}):search.getSearchContext(chat,key);
        Promise.resolve(Cmd.openChatAt({chat:chat,msgContext:ctx})).then(function(){
          // Flash highlight the message in the DOM
          later(function(){
            try{
              // Rows carry the short message id (id.id); older builds used the serialized id
              var k=msgObj.__x_id,esc=function(v){return window.CSS&&CSS.escape?CSS.escape(v):v;};
              var el=k&&((k.id&&document.querySelector('[data-id="'+esc(k.id)+'"]'))||(sid(k)&&document.querySelector('[data-id="'+esc(sid(k))+'"]')));
              if(el){
                el.classList.add('wplus-msg-highlight');
                el.scrollIntoView({behavior:'smooth',block:'center'});
                later(function(){el.classList.remove('wplus-msg-highlight');},3000);
                dbg('nav','Message highlighted');
              }
            }catch(e){}
          },500);
        }).catch(function(e){dbg('nav','openChatAt failed: '+(e&&e.message));});
        dbg('nav','Scrolled to message');
        return true;
      }
    }catch(e){dbg('nav','scrollToMsg failed: '+e.message);}
    return false;
  }

  // Find the message in the chat that matches our saved data
  function findRevokedInChat(chat,saved){
    if(!chat||!chat.msgs||!chat.msgs._models)return null;
    var msgTime=saved.time;
    var bestMatch=null,bestDiff=Infinity;
    for(var i=0;i<chat.msgs._models.length;i++){
      var m=chat.msgs._models[i];
      // Exact ID match — also when it was already restored (then it is no longer 'revoked')
      if(m.__x_id&&sid(m.__x_id)===saved.id)return m;
      if(m.__x_type!=='revoked')continue;
      // Time-based match — find the closest revoked message within 60 seconds
      var mTime=m.__x_t?m.__x_t*1000:0;
      if(mTime&&msgTime){
        var diff=Math.abs(mTime-msgTime);
        if(diff<60000&&diff<bestDiff){bestDiff=diff;bestMatch=m;}
      }
    }
    if(bestMatch)dbg('nav','Time-matched revoked msg (diff: '+Math.round(bestDiff/1000)+'s)');
    return bestMatch;
  }

  // Main navigation function — async, loads older messages if needed
  function goToMessage(savedMsgId){
    if(!CC){dbg('nav','No ChatCollection');return false;}

    // Find the saved message data
    var allSaved=deletedMsgs('get');
    var saved=null;
    for(var i=0;i<allSaved.length;i++){if(allSaved[i].id===savedMsgId){saved=allSaved[i];break;}}
    if(!saved){dbg('nav','Saved msg not found: '+String(savedMsgId).substring(0,30));return false;}

    var jid=extractJid(savedMsgId);
    if(!jid){dbg('nav','Bad ID');return false;}
    dbg('nav','Target: '+jid+' time='+saved.time+' type='+saved.type);

    var chat=findChatByJid(jid);
    if(!chat){dbg('nav','Chat not found');return false;}
    dbg('nav','Chat: '+(chat.__x_name||chat.__x_formattedTitle||'?'));

    // Open the chat first
    openChat(chat);

    // Wait for chat to render and have messages, then search
    function waitForChatReady(attempts){
      if(attempts>20){dbg('nav','Chat never loaded messages');return;}
      if(chat.msgs&&chat.msgs._models&&chat.msgs._models.length>0){
        dbg('nav','Chat has '+chat.msgs._models.length+' messages loaded, starting search');
        searchAndRestore(chat,saved,0,Date.now());
      } else {
        later(function(){waitForChatReady(attempts+1);},500);
      }
    }
    later(function(){waitForChatReady(0);},2000);
    return true;
  }

  // startTime is per search: a shared one went stale when a search ended early and starved the next one
  function searchAndRestore(chat,saved,attempt,startTime){
    var MAX_ATTEMPTS=100;  // Up to ~5000 messages
    var elapsed=Date.now()-startTime;
    var MAX_TIME=120000;  // 2 minute time budget

    if(attempt>MAX_ATTEMPTS||elapsed>MAX_TIME){
      dbg('nav','Gave up after '+attempt+' loads ('+Math.round(elapsed/1000)+'s, '+(chat.msgs._models?chat.msgs._models.length:0)+' msgs searched)');
      return;
    }

    // Search current messages for our target
    var found=findRevokedInChat(chat,saved);
    if(found){
      dbg('nav','FOUND after '+attempt+' loads! ('+Math.round(elapsed/1000)+'s)');
      if(found.__x_type==='revoked')applyRestore(found,saved);
      scrollToMsg(chat,found);
      fire('update');
      return;
    }

    // Not found — load earlier messages (no delay between loads for speed)
    if(attempt%20===0)dbg('nav','Loading... attempt '+attempt+', '+((chat.msgs._models||[]).length)+' msgs so far ('+Math.round(elapsed/1000)+'s)');
    try{
      var loader=window.require("WAWebChatLoadMessages");
      if(loader&&loader.loadEarlierMsgs){
        var msgsBefore=chat.msgs._models?chat.msgs._models.length:0;
        Promise.resolve(loader.loadEarlierMsgs(chat)).then(function(){
          if(dead)return;
          var msgsAfter=chat.msgs._models?chat.msgs._models.length:0;
          if(msgsAfter===msgsBefore){dbg('nav','No more history ('+msgsAfter+' msgs). Message not found.');return;}
          // Immediately search and load more — no delay
          searchAndRestore(chat,saved,attempt+1,startTime);
        }).catch(function(e){dbg('nav','Load error: '+(e&&e.message));});
        return;
      }
    }catch(e){dbg('nav','Loader error: '+e.message);}

    dbg('nav','Cannot load more messages');
  }

  // Apply restore to a found message
  function applyRestore(msg,saved){
    try{
      if(msg.__x_backupType){restoreMsg(msg);msg.__wpSavedId=saved.id;return true;}  // same session: full backup on the model
      // Rebuild as media only while WhatsApp still has the media data; a media message without it can break rendering
      if(MEDIA_T.indexOf(saved.type)!==-1&&msg.__x_mediaData){
        msg.__x_type=saved.type;msg.__x_body=saved.body||'';
        msg.__x_text=HEADER+(saved.text||'');msg.__x_caption=HEADER+(saved.caption||'');
        msg.__x_isMMS=true;msg.__x_isMedia=true;
      }else{
        var body=placeholder(saved.type,saved.caption,saved.body||saved.text||'',saved.lat,saved.lng);
        msg.__x_type='chat';msg.__x_body=HEADER+body;msg.__x_text=HEADER+body;
      }
      msg.__x_isRevoked=false;msg.__wpRestored=true;msg.__wpSavedId=saved.id;markDeleted(msg);
      dbg('restore','Applied: '+(saved.type||'chat')+' | '+String(saved.body||saved.text||'?').substring(0,30));
      return true;
    }catch(e){dbg('restore','Apply error: '+e.message);return false;}
  }

  // ── Force restore current chat ──────────────────────────
  function forceRestoreCurrentChat(callback){
    var done=false;
    function finish(n){if(done)return;done=true;if(callback)try{callback(n);}catch(e){}fire('update');}
    var currentChat=CC?activeChat():null;
    if(!currentChat||!currentChat.id){dbg('restore','No active chat found');finish(0);return;}
    dbg('restore','Force restoring: '+(currentChat.__x_name||currentChat.__x_formattedTitle||'?'));

    // Saved messages whose id belongs to this chat
    var chatUser=currentChat.id._serialized.split('@')[0];
    var chatSaved=deletedMsgs('get').filter(function(s){return s&&s.id&&idUser(s.id)===chatUser;});

    if(!chatSaved.length){dbg('restore','No saved messages for this chat');finish(0);return;}
    dbg('restore','Found '+chatSaved.length+' saved messages for this chat');

    // Load ALL messages then restore
    var totalRestored=0;
    function mark(s){if(!s.__restored){s.__restored=true;totalRestored++;}}
    function loadAndRestore(attempt){
      if(dead)return;
      if(attempt>20){dbg('restore','Force restore done: '+totalRestored+' restored');finish(totalRestored);return;}

      // Check current messages: revoked ones we can restore, and ones the live watcher already restored
      if(currentChat.msgs&&currentChat.msgs._models){
        currentChat.msgs._models.forEach(function(m){
          var mid=sid(m.__x_id);
          if(m.__x_type!=='revoked'){
            if(m.__wpRestored)chatSaved.forEach(function(s){if(s.id===m.__wpSavedId||s.id===mid)mark(s);});
            return;
          }
          var mTime=m.__x_t?m.__x_t*1000:0;
          for(var i=0;i<chatSaved.length;i++){
            var s=chatSaved[i];
            if(s.__restored)continue;
            // Match by exact ID or time within 5 seconds
            if(s.id===mid||(mTime&&s.time&&Math.abs(mTime-s.time)<5000)){
              if(applyRestore(m,s))mark(s);
              break;
            }
          }
        });
      }

      if(chatSaved.every(function(s){return s.__restored;})){dbg('restore','All '+totalRestored+' messages restored!');finish(totalRestored);return;}

      // Load more messages
      try{
        var loader=window.require("WAWebChatLoadMessages");
        if(loader&&loader.loadEarlierMsgs){
          var before=currentChat.msgs._models?currentChat.msgs._models.length:0;
          Promise.resolve(loader.loadEarlierMsgs(currentChat)).then(function(){
            var after=currentChat.msgs._models?currentChat.msgs._models.length:0;
            dbg('restore','Loaded '+(after-before)+' more (total: '+after+')');
            if(after===before){dbg('restore','No more history. Restored: '+totalRestored);finish(totalRestored);return;}
            later(function(){loadAndRestore(attempt+1);},300);
          }).catch(function(){finish(totalRestored);});
          return;
        }
      }catch(e){}
      finish(totalRestored);
    }

    loadAndRestore(0);
  }

  // ── Show media in overlay ─────────────────────────────────
  function showMedia(dataUrl, type){
    // Create fullscreen overlay
    var overlay=document.createElement('div');overlay.className='wplus-ov';
    overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:pointer';
    overlay.onclick=function(){overlay.remove();};

    if(type==='image'||type==='sticker'){
      var img=document.createElement('img');
      img.src=dataUrl;
      img.style.cssText='max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5)';
      overlay.appendChild(img);
    } else if(type==='video'){
      var vid=document.createElement('video');
      vid.src=dataUrl;
      vid.controls=true;vid.autoplay=true;
      vid.style.cssText='max-width:90vw;max-height:90vh;border-radius:8px';
      vid.onclick=function(e){e.stopPropagation();};
      overlay.appendChild(vid);
    } else if(type==='ptt'||type==='audio'){
      var aud=document.createElement('audio');
      aud.src=dataUrl;
      aud.controls=true;aud.autoplay=true;
      aud.style.cssText='width:400px';
      aud.onclick=function(e){e.stopPropagation();};
      overlay.appendChild(aud);
    }

    // Close button
    var close=document.createElement('div');
    close.textContent='\u2715';
    close.style.cssText='position:absolute;top:20px;right:30px;color:#fff;font-size:28px;cursor:pointer;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.1)';
    close.onclick=function(){overlay.remove();};
    overlay.appendChild(close);

    // Download button
    var dl=document.createElement('div');
    dl.textContent='\u2B73 Save';
    dl.style.cssText='position:absolute;bottom:30px;right:30px;color:#fff;font-size:14px;cursor:pointer;padding:8px 20px;border-radius:8px;background:rgba(37,211,102,.8);font-family:sans-serif';
    dl.onclick=function(e){
      e.stopPropagation();
      var a=document.createElement('a');a.href=dataUrl;
      a.download='WPlus_'+type+'_'+Date.now()+'.'+({image:'jpg',video:'mp4',ptt:'ogg',audio:'mp3',sticker:'webp'}[type]||'bin');
      a.click();
    };
    overlay.appendChild(dl);

    document.body.appendChild(overlay);
  }

  // ── Public API ────────────────────────────────────────────
  window.__wplus.settings=settings;
  window.__wplus.deletedMsgs=deletedMsgs;
  window.__wplus.viewOnce=viewOnce;
  window.__wplus.applyToggle=applyToggle;
  window.__wplus.goToMessage=goToMessage;
  window.__wplus.showMedia=showMedia;
  window.__wplus.mediaUrl=mediaUrl;
  window.__wplus.loadMedia=loadMedia;
  window.__wplus.serverGet=serverGet;
  window.__wplus.forceRestoreCurrentChat=forceRestoreCurrentChat;
  window.__wplus.exportContacts=function(){
    if(!CON){alert('Loading...');return;}var cs=[];
    (CON._models||[]).forEach(function(c){if(!c||!c.id||c.id.server!=='c.us')return;
    cs.push({p:'+'+c.id.user,n:c.__x_name||c.__x_pushname||c.__x_formattedName||'',b:c.__x_isBusiness||false});});
    if(!cs.length){alert('No contacts.');return;}
    // Names are chosen by other people: a leading = + - @ would run as a spreadsheet formula
    function cell(v){v=String(v==null?'':v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
    var csv='Phone,Name,Business\n';cs.forEach(function(c){csv+='"'+c.p+'",'+cell(c.n)+',"'+(c.b?'Yes':'No')+'"\n';});
    var url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));
    var a=document.createElement('a');a.href=url;
    a.download='WPlus_Contacts_'+new Date().toISOString().slice(0,10)+'.csv';a.click();alert('Exported '+cs.length+' contacts!');
    setTimeout(function(){try{URL.revokeObjectURL(url);}catch(e){}},10000);
  };
  window.__wplus.chatStats=function(){
    if(!CC)return'Loading...';var ch=CC._models||[],g=0,p=0,o=0,u=0,tm=0,top=[];
    // Status, broadcast lists and channels are neither personal chats nor groups
    ch.forEach(function(c){if(!c||!c.id)return;var sv=c.id.server;if(sv==='g.us')g++;else if(sv==='c.us'||sv==='lid')p++;else o++;if(c.__x_unreadCount>0)u++;
    var mc=c.msgs&&c.msgs._models?c.msgs._models.length:0;tm+=mc;
    top.push({n:c.__x_name||c.__x_formattedTitle||c.id.user||'?',m:mc,u:c.__x_unreadCount||0,g:c.id.server==='g.us'});});
    top.sort(function(a,b){return b.m-a.m;});
    var cc=CON?(CON._models||[]).filter(function(c){return c&&c.id&&c.id.server==='c.us';}).length:0;
    var t=ch.length+' chats ('+p+' personal, '+g+' groups'+(o?', '+o+' other':'')+')\n'+u+' unread \u00B7 '+cc+' contacts \u00B7 '+tm+' loaded msgs\n\n';
    top.slice(0,10).forEach(function(c,i){t+=(i+1)+'. '+String(c.n).substring(0,22)+(c.g?' [G]':'')+' \u2014 '+c.m+(c.u>0?' ('+c.u+')':'')+'\n';});
    return t;
  };
  window.__wplus.downloadVO=function(id){
    var list=viewOnce('get'),item=list.find(function(x){return x.id===id;});
    if(item&&!item.data&&_memVO[id])item.data=_memVO[id];
    if(!item||!item.data){alert('Media not available yet.');return;}
    var ext='bin';if(item.mime){if(item.mime.indexOf('image')!==-1)ext='jpg';else if(item.mime.indexOf('video')!==-1)ext='mp4';else if(item.mime.indexOf('audio')!==-1||item.mime.indexOf('ogg')!==-1)ext='ogg';}
    else{if(item.type==='image')ext='jpg';else if(item.type==='video')ext='mp4';else if(item.type==='ptt')ext='ogg';}
    var fn='WPlus_'+item.type+'_'+item.sender+'_'+new Date(item.time).toISOString().slice(0,19).replace(/[T:]/g,'-')+'.'+ext;
    var a=document.createElement('a');a.href=item.data;a.download=fn;a.click();
  };

  // ── Boot ──────────────────────────────────────────────────
  var att=0;
  function boot(){
    if(dead||++att>120)return;if(!init()){later(boot,1000);return;}
    (CC._models||[]).forEach(hookChat);listen(CC,'add',hookChat);
    // ── Smart Restore System ─────────────────────────────────
    // IDs change between sessions — match by sender+time or exact ID
    var restoredSet=new Set();

    function getSavedMsgs(){return deletedMsgs('get');}

    function matchSaved(msg,chatObj,list){
      if(!msg||!msg.__x_id)return null;
      var savedMsgs=list||getSavedMsgs();
      var msgId=sid(msg.__x_id);
      var okey=origKey(msg);
      var msgTime=msg.__x_t?msg.__x_t*1000:0;
      var msgChat=chatObj?chatObj.id._serialized:'';
      var msgChatUser=msgChat.split('@')[0];

      var bestMatch=null, bestScore=0;

      for(var i=0;i<savedMsgs.length;i++){
        var s=savedMsgs[i];
        if(restoredSet.has(s.id))continue;

        var score=0;

        // 1. Exact ID match — the original id (protocolMessageKey on current builds) or the same model
        if(s.id===msgId||(okey&&s.id===okey)){score=100;bestMatch=s;bestScore=100;break;}

        // 2. Same chat check (required)
        var savedChatUser=(s.id||'').split('_')[1]||'';
        savedChatUser=savedChatUser.split('@')[0];
        if(!savedChatUser||!msgChatUser||savedChatUser!==msgChatUser)continue;
        score+=30;  // Same chat

        // 3. Time matching — the closer the better
        if(msgTime&&s.time){
          var diff=Math.abs(msgTime-s.time);
          if(diff<3000)score+=50;       // Within 3 seconds — very likely same message
          else if(diff<10000)score+=40;  // Within 10 seconds — probable
          else if(diff<30000)score+=20;  // Within 30 seconds — possible
          else if(diff<60000)score+=10;  // Within 1 minute — weak match
          else continue;                 // More than 1 minute — skip
        }

        // 4. Same message type bonus
        if(s.type===msg.__x_type||s.type==='chat')score+=10;

        // 5. Body content match bonus (for text messages)
        if(s.type==='chat'&&msg.__x_type==='revoked'){
          // Can't compare body since it's revoked, but type match helps
          score+=5;
        }

        if(score>bestScore){bestScore=score;bestMatch=s;}
      }

      // Require minimum score of 50 (same chat + some time match)
      if(bestMatch&&bestScore>=50){
        restoredSet.add(bestMatch.id);
        dbg('restore','Score '+bestScore+' for '+(bestMatch.type||'?')+': '+(bestMatch.body||bestMatch.text||'?').substring(0,25));
        return bestMatch;
      }
      return null;
    }

    function doRestore(){
      var savedMsgs=getSavedMsgs();
      dbg('restore','Scan starting: '+savedMsgs.length+' saved, '+restoredSet.size+' already matched');
      if(!savedMsgs.length){dbg('restore','No saved messages');return;}
      var restored=0;
      (CC._models||[]).forEach(function(ch){
        if(!ch.msgs||!ch.msgs._models)return;
        ch.msgs._models.forEach(function(m){
          if(m.__x_type!=='revoked')return;
          var saved=matchSaved(m,ch,savedMsgs);
          if(saved&&applyRestore(m,saved)){
            restored++;
            dbg('restore','Restored: '+(saved.type||'chat')+' | '+(saved.body||saved.text||'?').substring(0,30)+' in '+(ch.__x_name||'?').substring(0,20));
          }
        });
      });
      dbg('restore','Scan done: '+restored+' restored this pass ('+restoredSet.size+'/'+savedMsgs.length+' total matched)');
    }

    // Watch for messages loading when user opens chats
    function watchChat(ch){try{
      if(!ch||!ch.msgs||ch.msgs.__wpR)return;
      listen(ch.msgs,'add',function(msg){
        try{
          if(!msg||msg.__x_type!=='revoked'||msg.__wpSaved)return;
          var ok=origKey(msg);if(ok&&_pendingRev[ok])return;  // live pairing still waiting for the original
          var saved=matchSaved(msg,ch);
          if(saved){
            applyRestore(msg,saved);
            dbg('restore','Live restored: '+(saved.type||'chat')+' | '+(saved.body||saved.text||'?').substring(0,30)+' in '+(ch.__x_name||'?').substring(0,20));
          }
        }catch(e){}
      });
      ch.msgs.__wpR=true;_cols.push(ch.msgs);
    }catch(e){dbg('restore','watchChat failed: '+e.message);}}
    (CC._models||[]).forEach(watchChat);
    listen(CC,'add',watchChat);

    // Try restore once at boot (same-session messages only)
    doRestore();
    later(doRestore,5000);
    dbg('restore','Live watcher active — new deletions will be caught instantly');
    var S=settings();Object.keys(S).forEach(function(k){if(S[k]){dbg('boot','Applying setting: '+k);try{applyToggle(k,true);}catch(e){}}});
    window.__wplus.ready=true;
    dbg('boot','READY — '+((CC._models||[]).length)+' chats, '+(CON?(CON._models||[]).length:0)+' contacts');
    fire('ready');

    // Migrate old messages — save their media to disk files
    later(function(){serverPost('/migrate',{});},5000);
  }

  // Debug API
  window.__wplus.debug={
    getLog:function(){return debugLog.slice();},
    getLogText:function(){return debugLog.map(function(e){return e.ts+' ['+e.cat+'] '+e.msg+(e.data?' | '+e.data:'');}).join('\n');},
    clear:function(){debugLog=[];dbg('debug','Log cleared');},
    enable:function(){debugEnabled=true;dbg('debug','Debug enabled');},
    disable:function(){debugEnabled=false;debugLog=[];try{localStorage.removeItem('wplus_log');}catch(e){}},
    isEnabled:function(){return debugEnabled;},
    status:function(){
      return{
        version:window.__wplus.version, ready:window.__wplus.ready,
        chats:CC?(CC._models||[]).length:0,
        contacts:CON?(CON._models||[]).length:0,
        groups:GRP?(GRP._models||[]).length:0,
        deletedMsgs:deletedMsgs('get').length,
        hookedChats:CC?(CC._models||[]).filter(function(c){return c.msgs&&c.msgs.__wp;}).length:0,
        hooks:{composing:!!_comp,presence:!!_pres,presenceProtocol:!!_proto,seen:!!_seen,played:!!_played},
        settings:settings(),
        logEntries:debugLog.length
      };
    }
  };

  // Full cleanup — restores WhatsApp to original state
  window.__wplus.onCleanup=function(fn){if(typeof fn==='function')_onCleanup.push(fn);};
  window.__wplus.cleanup=function(){
    dead=true;
    // Stop timers
    if(presInt){clearInterval(presInt);presInt=null;}
    Object.keys(_timers).forEach(function(id){clearTimeout(+id);});_timers={};
    try{if(_delObs)_delObs.disconnect();}catch(e){}_delObs=null;_delTimer=null;_delIds.clear();
    document.querySelectorAll('.wplus-del').forEach(function(e){e.classList.remove('wplus-del');});
    var dst=document.getElementById('wplus-del-style');if(dst)dst.remove();
    // Remove every collection listener and the "already hooked" markers
    _subs.forEach(function(s){try{s[0].off(s[1],s[2]);}catch(e){}});_subs=[];_removed={};_pendingRev={};
    _cols.forEach(function(c){try{delete c.__wp;delete c.__wpR;}catch(e){}});_cols=[];
    // UI teardown (listeners, observers, intervals registered by ui.js)
    _onCleanup.forEach(function(fn){try{fn();}catch(e){}});_onCleanup=[];

    // Remove injected CSS
    ['wplus-css-blurMessages','wplus-css-blurContacts','wplus-css-blurPhotos','wplus-css-blurAvatar','wplus-css'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});

    // Restore original WhatsApp functions
    try{if(_mods.comp&&_comp){_mods.comp.markComposing=_comp;if(_rec)_mods.comp.markRecording=_rec;}}catch(e){}
    try{if(_mods.pres&&_pres)_mods.pres.sendPresenceAvailable=_pres;}catch(e){}
    try{if(_mods.proto&&_proto)_mods.proto.sendPresenceStatusProtocol=_proto;}catch(e){}
    try{if(_mods.seen&&_seen)_mods.seen.sendConversationSeen=_seen;}catch(e){}
    try{if(_mods.played&&_played)_mods.played.markPlayed=_played;}catch(e){}

    // Remove ALL UI elements
    ['wplus-btn','wplus-panel','wplus-header-restore','wplus-css','wplus-style'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
    document.querySelectorAll('.wplus-restore-btn,.wplus-b,.wpp,.wplus-ov,[id*=wplus]').forEach(function(e){e.remove();});
    // These classes sit on WhatsApp's own elements — remove the class, never the element
    document.querySelectorAll('.wplus-blur-t,.wplus-blur-p,.wplus-msg-highlight').forEach(function(e){e.classList.remove('wplus-blur-t','wplus-blur-p','wplus-msg-highlight');});
    // Clear debug timer
    if(dbg._timer){clearTimeout(dbg._timer);dbg._timer=null;}
    // Release cached media blobs
    Object.keys(_blobs).forEach(function(k){try{URL.revokeObjectURL(_blobs[k]);}catch(e){}});_blobs={};

    // Remove event listeners by clearing the wplus object
    window.__wplus={version:'removed',ready:false,cleanup:function(){}};

    console.log('[WPlus] Uninjected — WhatsApp restored to original state');
  };

  later(boot,3000);
  dbg('boot','Engine v'+window.__wplus.version+' loaded');
})();
