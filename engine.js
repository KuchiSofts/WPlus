// WPlus Engine v1.2 — github.com/KuchiSofts — MIT License
(function(){
  'use strict';
  // Allow re-injection by cleaning up previous instance
  if(window.__wplus&&window.__wplus.cleanup)try{window.__wplus.cleanup();}catch(e){}
  window.__wplus={version:'1.2',ready:false};

  var MAX_MSGS=1000,hooked=false;
  var CC=null,CON=null,GRP=null;
  var _comp,_rec,_pres,_seen,_played;
  var presInt=null,blurObs={};

  // ── Debug system ──────────────────────────────────────────
  var debugEnabled=true;
  var debugLog=[];
  var MAX_LOG=500;
  function dbg(category, msg, data){
    if(!debugEnabled)return;
    var entry={t:Date.now(),ts:new Date().toLocaleTimeString(),cat:category,msg:msg};
    if(data!==undefined)entry.data=typeof data==='object'?JSON.stringify(data).substring(0,200):String(data);
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
    get:function(k,d){try{return JSON.parse(localStorage.getItem(k));}catch(e){return d||null;}},
    set:function(k,v){localStorage.setItem(k,JSON.stringify(v));},
    del:function(k){localStorage.removeItem(k);}
  };

  function settings(k,v){
    var s=LS.get('wplus_cfg',{});
    if(v===undefined)return k?s[k]:s;
    s[k]=v;LS.set('wplus_cfg',s);return v;
  }

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
      LS.set('wplus_del',current);
      dbg('storage','Merged '+added+' msgs from old keys. Total: '+current.length);
    }
  }

  function deletedMsgs(action,item){
    mergeOldKeys();
    var d=LS.get('wplus_del',[])||[];
    if(action==='get')return d;
    if(action==='add'){
      // Deduplicate
      var exists=d.some(function(m){return m.id===item.id;});
      if(!exists){d.push(item);if(d.length>MAX_MSGS)d=d.slice(-MAX_MSGS);LS.set('wplus_del',d);}
    }
    if(action==='clear'){LS.del('wplus_del');}
    return d;
  }

  function viewOnce(action,item){
    var d=LS.get('wplus_vo',[])||[];
    if(action==='get')return d;
    if(action==='add'){d.push(item);if(d.length>200)d=d.slice(-200);LS.set('wplus_vo',d);}
    if(action==='clear'){LS.del('wplus_vo');}
    return d;
  }

  // ── File Server API (localhost:18733) ────────────────────
  var SERVER='http://127.0.0.1:18733';
  function serverPost(path,data){
    try{
      fetch(SERVER+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
      .then(function(r){return r.json();})
      .then(function(r){dbg('server',path+' → '+JSON.stringify(r));})
      .catch(function(e){dbg('server',path+' error: '+e.message);});
    }catch(e){dbg('server','fetch error: '+e.message);}
  }
  function serverGet(path,cb){
    try{
      fetch(SERVER+path).then(function(r){return r.json();}).then(cb)
      .catch(function(e){dbg('server','GET '+path+' error');if(cb)cb(null);});
    }catch(e){if(cb)cb(null);}
  }

  // ── Module finder ─────────────────────────────────────────
  function findExport(name){
    try{var ks=Object.keys(window.require("__debug").modulesMap);
    for(var i=0;i<ks.length;i++){try{var m=window.require(ks[i]),d=m&&m.default||m;
    if(d&&typeof d[name]==='function')return d;if(m&&typeof m[name]==='function')return m;}catch(e){}}
    }catch(e){}return null;
  }

  function init(){
    try{
      if(typeof window.require!=='function'){dbg('init','window.require not found');return false;}
      var c=window.require("WAWebChatCollection");
      if(!c||!c.ChatCollection||!c.ChatCollection._models){dbg('init','ChatCollection not ready');return false;}
      CC=c.ChatCollection;
      dbg('init','ChatCollection found',{chats:CC._models.length});
      try{CON=window.require("WAWebContactCollection").ContactCollection;dbg('init','ContactCollection found',{contacts:(CON._models||[]).length});}catch(e){dbg('init','ContactCollection failed',e.message);}
      try{GRP=window.require("WAWebGroupMetadataCollection").GroupMetadataCollection;dbg('init','GroupMetadata found',{groups:(GRP._models||[]).length});}catch(e){}
      try{var x=findExport("markComposing");if(x){_comp=x.markComposing;_rec=x.markRecording;dbg('init','Composing hooks ready');}}catch(e){}
      try{var p=findExport("sendPresenceAvailable");if(p){_pres=p.sendPresenceAvailable;dbg('init','Presence hook ready');}}catch(e){}
      try{var s=findExport("sendConversationSeen");if(s){_seen=s.sendConversationSeen;dbg('init','ConversationSeen hook ready');}}catch(e){}
      try{var pl=findExport("markPlayed");if(pl){_played=pl.markPlayed;dbg('init','markPlayed hook ready');}}catch(e){}
      return true;
    }catch(e){dbg('init','FATAL',e.message);return false;}
  }

  // ── Message hooks ─────────────────────────────────────────
  function restoreMsg(msg){
    try{
      var header='\u{1F6AB} *This message was deleted:*\n';
      var mt=['image','video','sticker','document','audio','ptt'];
      if(mt.indexOf(msg.__x_backupType)!==-1){
        msg.__x_type=msg.__x_backupType;msg.__x_body=msg.__x_backupBody;
        msg.__x_text=header+(msg.__x_backupText||'');
        msg.__x_caption=header+(msg.__x_backupCaption||'');
        msg.__x_mediaData=msg.__x_backupMediaData;msg.__x_isMMS=true;msg.__x_isMedia=true;
      }else{
        msg.__x_type='chat';
        var body=msg.__x_backupBody||msg.__x_backupText||'';
        msg.__x_body=header+body;
        msg.__x_text=header+body;
      }
      msg.__x_isRevoked=false;
      dbg('restore','Msg restored: '+(msg.__x_backupType||'chat')+' | '+(msg.__x_backupBody||'').substring(0,30));
    }catch(e){dbg('restore','Error: '+e.message);}
  }

  function hookChat(chat){
    if(!chat||!chat.msgs||chat.msgs.__wp)return;chat.msgs.__wp=true;
    var chatName=chat.__x_name||chat.__x_formattedTitle||(chat.id?chat.id.user:'?');

    chat.msgs.on('add',function(msg){try{
      if(!msg||!msg.isNewMsg||(msg.id&&msg.id.fromMe))return;
      var ok=['chat','image','video','ptt','audio','document','sticker','vcard','location'];
      if(ok.indexOf(msg.__x_type)===-1)return;
      msg.__x_backupBody=msg.__x_body;msg.__x_backupText=msg.__x_text;msg.__x_backupType=msg.__x_type;
      msg.__x_backupCaption=msg.__x_caption;msg.__x_backupMediaData=msg.__x_mediaData;
      msg.__x_backupTime=Date.now();msg.__x_backupSender=msg.__x_from?msg.__x_from._serialized:'';

      // Save to file server (new_messages.json + media files)
      var entry={id:msg.__x_id._serialized,type:msg.__x_type,body:msg.__x_body||'',text:msg.__x_text||'',
        caption:msg.__x_caption||'',sender:msg.__x_backupSender,time:Date.now(),chat:chatName};

      // Try to capture media blob as base64
      var md=msg.__x_mediaData;
      if(md&&md.mediaBlob&&md.mediaBlob._blob){
        var blob=md.mediaBlob._blob;
        var reader=new FileReader();
        reader.onload=function(){entry.media=reader.result;serverPost('/msg/new',entry);};
        reader.readAsDataURL(blob);
      } else {
        serverPost('/msg/new',entry);
      }

      dbg('msg','Backed up: '+msg.__x_type+' in '+chatName);
      if(msg.__x_isViewOnce||msg.__x_viewOnce)captureViewOnce(msg);
    }catch(e){dbg('msg','Backup error',e.message);}});

    chat.msgs.on('change',function(msg){try{
      if(!msg||msg.__x_type!=='revoked'||!msg.__x_backupType)return;
      var entry={id:msg.__x_id._serialized,type:msg.__x_backupType,body:msg.__x_backupBody,
        text:msg.__x_backupText,caption:msg.__x_backupCaption,sender:msg.__x_backupSender,
        time:msg.__x_backupTime||Date.now(),chat:chatName,media:null};

      // Notify file server — move from new_messages to deleted_messages + save media
      serverPost('/msg/deleted',entry);

      // Try to capture media blob for images/videos/audio
      var mediaTypes=['image','video','ptt','audio','sticker'];
      if(mediaTypes.indexOf(msg.__x_backupType)!==-1){
        try{
          var md=msg.__x_backupMediaData||msg.__x_mediaData;
          if(md&&md.mediaBlob&&md.mediaBlob._blob){
            var blob=md.mediaBlob._blob;
            var reader=new FileReader();
            reader.onload=function(){
              entry.media=reader.result;entry.mime=blob.type;
              // Update in storage
              var d=deletedMsgs('get');
              for(var i=d.length-1;i>=0;i--){if(d[i].id===entry.id){d[i].media=entry.media;d[i].mime=entry.mime;break;}}
              LS.set('wplus_del',d);
            };
            reader.readAsDataURL(blob);
          }
        }catch(e){}
      }

      deletedMsgs('add',entry);
      restoreMsg(msg);fire('update');
    }catch(e){}});
  }

  // ── View-once capture ─────────────────────────────────────
  function captureViewOnce(msg){
    try{
      var type=msg.__x_type||'unknown',sender=(msg.__x_from?msg.__x_from._serialized:'?').split('@')[0];
      var entry={id:msg.__x_id._serialized,type:type,sender:sender,time:Date.now(),data:null,mime:null,size:0};

      function saveEntry(){
        var list=viewOnce('get');var idx=list.findIndex(function(x){return x.id===entry.id;});
        if(idx>=0)list[idx]=entry;else list.push(entry);
        if(list.length>200)list=list.slice(-200);
        LS.set('wplus_vo',list);fire('update');
      }

      function tryCapture(){
        try{
          var md=msg.__x_mediaData;
          if(md&&md.mediaBlob&&md.mediaBlob._blob){
            var blob=md.mediaBlob._blob;
            var r=new FileReader();
            r.onload=function(){entry.data=r.result;entry.mime=blob.type;entry.size=blob.size;saveEntry();
              console.log('[WPlus] View-once captured:',type,sender);};
            r.readAsDataURL(blob);return true;
          }
          // Try force-downloading via WhatsApp's internal API
          if(md&&typeof md.downloadMedia==='function'&&!md.__wplus_dl){
            md.__wplus_dl=true;
            md.downloadMedia().then(function(){setTimeout(tryCapture,1000);}).catch(function(){});
          }
        }catch(e){}return false;
      }

      // Also try to prevent view-once flag from blocking re-views
      try{msg.__x_isViewOnce=false;msg.__x_viewOnce=false;}catch(e){}

      viewOnce('add',entry);saveEntry();
      // Multiple retry attempts — media may load at different times
      if(!tryCapture()){
        [2000,5000,10000,20000,30000].forEach(function(d){setTimeout(tryCapture,d);});
      }
    }catch(e){}
  }

  // ── Toggle features ───────────────────────────────────────
  function applyToggle(id,on){
    if(id==='hideTyping'){var c=findExport("markComposing");if(c&&_comp){if(on){c.markComposing=function(){};c.markRecording=function(){};}else{c.markComposing=_comp;if(_rec)c.markRecording=_rec;}}}
    if(id==='hideOnline'){var p=findExport("sendPresenceAvailable");if(p&&_pres){if(on){p.sendPresenceAvailable=function(){};if(!presInt){var u=findExport("sendPresenceUnavailable");if(u)presInt=setInterval(function(){try{u.sendPresenceUnavailable();}catch(e){}},1000);}}else{p.sendPresenceAvailable=_pres;if(presInt){clearInterval(presInt);presInt=null;}}}}
    if(id==='disableReceipts'){var s=findExport("sendConversationSeen");if(s&&_seen){if(on)s.sendConversationSeen=function(){return Promise.resolve();};else s.sendConversationSeen=_seen;}}
    if(id==='playAudioPrivate'){var pl=findExport("markPlayed");if(pl&&_played){if(on)pl.markPlayed=function(){};else pl.markPlayed=_played;}}
    // Blur: inject/remove <style> tags — CSS auto-applies to all elements including new ones
    var blurCSS={
      blurMessages:'span.selectable-text,[data-pre-plain-text],.copyable-text,._ak8k,.message-in .copyable-text,.message-out .copyable-text{filter:blur(5px)!important;transition:filter .15s!important}span.selectable-text:hover,[data-pre-plain-text]:hover,.copyable-text:hover,._ak8k:hover,.message-in .copyable-text:hover,.message-out .copyable-text:hover{filter:none!important}',
      blurContacts:'span[title][dir],span._ahxt,header span[dir="auto"],header span.x1iyjqo2,[data-testid="conversation-header"] span,[data-testid="cell-frame-title"] span,.message-in span._ahxt,span[aria-label*="Maybe"]{filter:blur(5px)!important;transition:filter .15s!important}span[title][dir]:hover,span._ahxt:hover,header span[dir="auto"]:hover,header span.x1iyjqo2:hover,[data-testid="conversation-header"] span:hover,[data-testid="cell-frame-title"] span:hover,.message-in span._ahxt:hover,span[aria-label*="Maybe"]:hover{filter:none!important}',
      blurPhotos:'img[draggable="false"],img[src*="pps.whatsapp.net"],img[src*="mmg.whatsapp.net"]{filter:blur(8px)!important;transition:filter .15s!important}img[draggable="false"]:hover,img[src*="pps.whatsapp.net"]:hover,img[src*="mmg.whatsapp.net"]:hover{filter:none!important}',
      blurAvatar:'img[src*="pps.whatsapp.net"],div[data-testid="cell-frame-primary-detail"] img,div[data-testid="chat-row"] img[draggable="false"],header img[draggable="false"],[data-testid="contact-photo"] img,[data-testid="group-info-drawer"] img[draggable="false"],div[role="listitem"] img[draggable="false"],[style*="border-radius: 50%"] img,[style*="border-radius:50%"] img{filter:blur(10px)!important;transition:filter .15s!important}img[src*="pps.whatsapp.net"]:hover,div[data-testid="cell-frame-primary-detail"] img:hover,div[data-testid="chat-row"] img[draggable="false"]:hover,header img[draggable="false"]:hover,[data-testid="contact-photo"] img:hover,[data-testid="group-info-drawer"] img[draggable="false"]:hover,div[role="listitem"] img[draggable="false"]:hover,[style*="border-radius: 50%"] img:hover,[style*="border-radius:50%"] img:hover{filter:none!important}'
    };
    if(blurCSS[id]){
      var styleId='wplus-css-'+id;
      var existing=document.getElementById(styleId);
      if(on&&!existing){var s=document.createElement('style');s.id=styleId;s.textContent=blurCSS[id];document.head.appendChild(s);}
      else if(!on&&existing){existing.remove();}
    }
  }

  function fire(name){window.dispatchEvent(new CustomEvent('wplus-'+name));}

  // ── Navigate to message + load older msgs + restore ─────
  function findChatByJid(jid){
    var models=CC._models||[];
    for(var i=0;i<models.length;i++){
      if(models[i].id&&(models[i].id._serialized===jid||models[i].id.user===jid.split('@')[0]))return models[i];
    }
    // Partial match
    var user=jid.split('@')[0];
    for(var j=0;j<models.length;j++){
      if(models[j].id&&models[j].id._serialized&&models[j].id._serialized.indexOf(user)!==-1)return models[j];
    }
    return null;
  }

  function extractJid(msgId){
    var firstUs=msgId.indexOf('_');
    if(firstUs===-1)return null;
    var rest=msgId.substring(firstUs+1);
    var m=rest.match(/^(.+?@[cgs]\.us)/);
    return m?m[1]:rest.split('_')[0];
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
        var ctx=search.getSearchContext(chat,msgObj.__x_id||msgObj.id);
        Cmd.openChatAt({chat:chat,msgContext:ctx}).then(function(){
          // Flash highlight the message in the DOM
          setTimeout(function(){
            try{
              var mid=msgObj.__x_id?msgObj.__x_id._serialized:'';
              var el=document.querySelector('[data-id="'+mid+'"]');
              if(!el){
                // Try finding by approximate position — look for restored messages
                document.querySelectorAll('.message-in, .message-out, [data-id]').forEach(function(m){
                  var text=m.textContent||'';
                  if(text.indexOf('\u{1F6AB}')!==-1&&text.indexOf('This message was deleted')!==-1){
                    el=el||m;
                  }
                });
              }
              if(el){
                el.classList.add('wplus-msg-highlight');
                el.scrollIntoView({behavior:'smooth',block:'center'});
                setTimeout(function(){el.classList.remove('wplus-msg-highlight');},3000);
                dbg('nav','Message highlighted');
              }
            }catch(e){}
          },500);
        });
        dbg('nav','Scrolled to message');
        return true;
      }
    }catch(e){dbg('nav','scrollToMsg failed: '+e.message);}
    return false;
  }

  // Find a revoked message in chat that matches our saved data
  function findRevokedInChat(chat,saved){
    if(!chat||!chat.msgs||!chat.msgs._models)return null;
    var msgTime=saved.time;
    for(var i=0;i<chat.msgs._models.length;i++){
      var m=chat.msgs._models[i];
      if(m.__x_type!=='revoked')continue;
      var mTime=m.__x_t?m.__x_t*1000:0;
      // Match by time (within 5 seconds)
      if(mTime&&msgTime&&Math.abs(mTime-msgTime)<5000)return m;
      // Or exact ID match (same session)
      if(m.__x_id&&m.__x_id._serialized===saved.id)return m;
    }
    return null;
  }

  // Main navigation function — async, loads older messages if needed
  function goToMessage(savedMsgId){
    if(!CC){dbg('nav','No ChatCollection');return false;}

    // Find the saved message data
    var allSaved=deletedMsgs('get');
    var saved=null;
    for(var i=0;i<allSaved.length;i++){if(allSaved[i].id===savedMsgId){saved=allSaved[i];break;}}
    if(!saved){dbg('nav','Saved msg not found: '+savedMsgId.substring(0,30));return false;}

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
        searchAndRestore(chat,saved,0);
      } else {
        setTimeout(function(){waitForChatReady(attempts+1);},500);
      }
    }
    setTimeout(function(){waitForChatReady(0);},2000);
    return true;
  }

  function searchAndRestore(chat,saved,attempt){
    var MAX_ATTEMPTS=100;  // Up to ~5000 messages
    var startTime=searchAndRestore._startTime||(searchAndRestore._startTime=Date.now());
    var elapsed=Date.now()-startTime;
    var MAX_TIME=120000;  // 2 minute time budget

    if(attempt>MAX_ATTEMPTS||elapsed>MAX_TIME){
      searchAndRestore._startTime=null;
      dbg('nav','Gave up after '+attempt+' loads ('+Math.round(elapsed/1000)+'s, '+(chat.msgs._models?chat.msgs._models.length:0)+' msgs searched)');
      return;
    }

    // Search current messages for our target
    var found=findRevokedInChat(chat,saved);
    if(found){
      searchAndRestore._startTime=null;
      dbg('nav','FOUND after '+attempt+' loads! ('+Math.round(elapsed/1000)+'s)');
      applyRestore(found,saved);
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
        loader.loadEarlierMsgs(chat).then(function(){
          var msgsAfter=chat.msgs._models?chat.msgs._models.length:0;

          if(msgsAfter===msgsBefore){
            searchAndRestore._startTime=null;
            dbg('nav','No more history ('+msgsAfter+' msgs). Message not found.');
            return;
          }

          // Immediately search and load more — no delay
          searchAndRestore(chat,saved,attempt+1);
        }).catch(function(e){
          dbg('nav','Load error: '+e.message);
          searchAndRestore._startTime=null;
        });
        return;
      }
    }catch(e){dbg('nav','Loader error: '+e.message);}

    dbg('nav','Cannot load more messages');
  }

  // Apply restore to a found message
  function applyRestore(msg,saved){
    try{
      var header='\u{1F6AB} *This message was deleted:*\n';
      var mediaTypes=['image','video','sticker','document','audio','ptt'];
      if(mediaTypes.indexOf(saved.type)!==-1){
        msg.__x_type=saved.type;msg.__x_body=saved.body||'';
        msg.__x_text=header+(saved.text||'');msg.__x_caption=header+(saved.caption||'');
        msg.__x_isMMS=true;msg.__x_isMedia=true;
      }else{
        msg.__x_type='chat';
        msg.__x_body=header+(saved.body||saved.text||'');
        msg.__x_text=header+(saved.body||saved.text||'');
      }
      msg.__x_isRevoked=false;
      dbg('restore','Applied: '+(saved.type||'chat')+' | '+(saved.body||saved.text||'?').substring(0,30));
      return true;
    }catch(e){dbg('restore','Apply error: '+e.message);return false;}
  }

  // ── Force restore current chat ──────────────────────────
  function forceRestoreCurrentChat(callback){
    // Find which chat is currently open
    var currentChat=null;
    var headerName='';
    try{
      var hdr=document.querySelector('[data-testid="conversation-header"] span[dir="auto"], header span.x1iyjqo2');
      if(hdr)headerName=hdr.textContent.trim();
    }catch(e){}

    if(headerName){
      (CC._models||[]).forEach(function(ch){
        if(!currentChat&&(ch.__x_name===headerName||ch.__x_formattedTitle===headerName))currentChat=ch;
      });
    }
    if(!currentChat){
      // Try finding by checking which chat has focus/active
      (CC._models||[]).forEach(function(ch){
        if(!currentChat&&ch.__x_active)currentChat=ch;
      });
    }

    if(!currentChat){dbg('restore','No active chat found');if(callback)callback(0);return;}
    dbg('restore','Force restoring: '+(currentChat.__x_name||currentChat.__x_formattedTitle||'?'));

    // Get saved messages for this chat
    var allSaved=deletedMsgs('get');
    var chatJid=currentChat.id._serialized;
    var chatSaved=allSaved.filter(function(s){
      // Match by chat JID in the saved message ID
      return s.id&&s.id.indexOf(chatJid.split('@')[0])!==-1;
    });

    if(!chatSaved.length){dbg('restore','No saved messages for this chat');if(callback)callback(0);return;}
    dbg('restore','Found '+chatSaved.length+' saved messages for this chat');

    // Load ALL messages then restore
    var totalRestored=0;
    function loadAndRestore(attempt){
      if(attempt>20){
        dbg('restore','Force restore done: '+totalRestored+' restored');
        if(callback)callback(totalRestored);
        return;
      }

      // Check current messages for revoked ones we can restore
      if(currentChat.msgs&&currentChat.msgs._models){
        currentChat.msgs._models.forEach(function(m){
          if(m.__x_type!=='revoked')return;
          var mTime=m.__x_t?m.__x_t*1000:0;
          // Find matching saved message
          for(var i=0;i<chatSaved.length;i++){
            var s=chatSaved[i];
            if(s.__restored)continue;
            // Match by exact ID or time within 5 seconds
            if(s.id===m.__x_id._serialized||(mTime&&s.time&&Math.abs(mTime-s.time)<5000)){
              applyRestore(m,s);
              s.__restored=true;
              totalRestored++;
              break;
            }
          }
        });
      }

      // Check if all saved messages are restored
      var allDone=chatSaved.every(function(s){return s.__restored;});
      if(allDone){
        dbg('restore','All '+totalRestored+' messages restored!');
        if(callback)callback(totalRestored);
        fire('update');
        return;
      }

      // Load more messages
      try{
        var loader=window.require("WAWebChatLoadMessages");
        if(loader&&loader.loadEarlierMsgs){
          var before=currentChat.msgs._models?currentChat.msgs._models.length:0;
          loader.loadEarlierMsgs(currentChat).then(function(){
            var after=currentChat.msgs._models?currentChat.msgs._models.length:0;
            dbg('restore','Loaded '+(after-before)+' more (total: '+after+')');
            if(after===before){
              // No more messages to load
              dbg('restore','No more history. Restored: '+totalRestored);
              if(callback)callback(totalRestored);
              fire('update');
              return;
            }
            setTimeout(function(){loadAndRestore(attempt+1);},300);
          }).catch(function(){
            if(callback)callback(totalRestored);
          });
          return;
        }
      }catch(e){}
      if(callback)callback(totalRestored);
    }

    loadAndRestore(0);
  }

  // ── Show media in overlay ─────────────────────────────────
  function showMedia(dataUrl, type){
    // Create fullscreen overlay
    var overlay=document.createElement('div');
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
  window.__wplus.forceRestoreCurrentChat=forceRestoreCurrentChat;
  window.__wplus.exportContacts=function(){
    if(!CON){alert('Loading...');return;}var cs=[];
    (CON._models||[]).forEach(function(c){if(!c||!c.id||c.id.server!=='c.us')return;
    cs.push({p:'+'+c.id.user,n:c.__x_name||c.__x_pushname||c.__x_formattedName||'',b:c.__x_isBusiness||false});});
    if(!cs.length){alert('No contacts.');return;}
    var csv='Phone,Name,Business\n';cs.forEach(function(c){csv+='"'+c.p+'","'+(c.n||'').replace(/"/g,'""')+'","'+(c.b?'Yes':'No')+'"\n';});
    var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));
    a.download='WPlus_Contacts_'+new Date().toISOString().slice(0,10)+'.csv';a.click();alert('Exported '+cs.length+' contacts!');
  };
  window.__wplus.chatStats=function(){
    if(!CC)return'Loading...';var ch=CC._models||[],g=0,p=0,u=0,tm=0,top=[];
    ch.forEach(function(c){if(!c||!c.id)return;c.id.server==='g.us'?g++:p++;if(c.__x_unreadCount>0)u++;
    var mc=c.msgs&&c.msgs._models?c.msgs._models.length:0;tm+=mc;
    top.push({n:c.__x_name||c.__x_formattedTitle||c.id.user||'?',m:mc,u:c.__x_unreadCount||0,g:c.id.server==='g.us'});});
    top.sort(function(a,b){return b.m-a.m;});
    var cc=CON?(CON._models||[]).filter(function(c){return c&&c.id&&c.id.server==='c.us';}).length:0;
    var t=ch.length+' chats ('+p+' personal, '+g+' groups)\n'+u+' unread \u00B7 '+cc+' contacts \u00B7 '+tm+' loaded msgs\n\n';
    top.slice(0,10).forEach(function(c,i){t+=(i+1)+'. '+c.n.substring(0,22)+(c.g?' [G]':'')+' \u2014 '+c.m+(c.u>0?' ('+c.u+')':'')+'\n';});
    return t;
  };
  window.__wplus.downloadVO=function(id){
    var list=viewOnce('get'),item=list.find(function(x){return x.id===id;});
    if(!item||!item.data){alert('Media not available yet.');return;}
    var ext='bin';if(item.mime){if(item.mime.indexOf('image')!==-1)ext='jpg';else if(item.mime.indexOf('video')!==-1)ext='mp4';else if(item.mime.indexOf('audio')!==-1||item.mime.indexOf('ogg')!==-1)ext='ogg';}
    else{if(item.type==='image')ext='jpg';else if(item.type==='video')ext='mp4';else if(item.type==='ptt')ext='ogg';}
    var fn='WPlus_'+item.type+'_'+item.sender+'_'+new Date(item.time).toISOString().slice(0,19).replace(/[T:]/g,'-')+'.'+ext;
    var a=document.createElement('a');a.href=item.data;a.download=fn;a.click();
  };

  // ── Boot ──────────────────────────────────────────────────
  var att=0;
  function boot(){
    if(++att>120)return;if(!init()){setTimeout(boot,1000);return;}
    (CC._models||[]).forEach(hookChat);CC.on('add',hookChat);hooked=true;
    // ── Smart Restore System ─────────────────────────────────
    // IDs change between sessions — match by sender+time or exact ID
    var restoredSet=new Set();

    function getSavedMsgs(){return deletedMsgs('get');}

    function matchSaved(msg){
      if(!msg||!msg.__x_id)return null;
      var savedMsgs=getSavedMsgs();
      var sender=msg.__x_from?msg.__x_from._serialized:'';
      var msgTime=msg.__x_t?msg.__x_t*1000:0;

      for(var i=0;i<savedMsgs.length;i++){
        var s=savedMsgs[i];
        if(restoredSet.has(s.id))continue;

        // Match by chat/sender
        var savedSender=s.sender||'';
        var chatJid=msg.__x_id?msg.__x_id._serialized.split('_')[1]||'':'';
        var savedChat=s.id?s.id.split('_')[1]||'':'';
        var sameChat=chatJid&&savedChat&&chatJid.split('@')[0]===savedChat.split('@')[0];
        var sameSender=false;
        if(sender&&savedSender){
          sameSender=sender===savedSender||sender.split('@')[0].split('-')[0]===savedSender.split('@')[0].split('-')[0];
        }
        if(!sameChat&&!sameSender)continue;

        // Match by time (within 2 seconds for precise match)
        if(msgTime&&s.time){
          var diff=Math.abs(msgTime-s.time);
          if(diff>5000)continue; // More than 5 seconds = different message
        }

        // Exact ID match (same session)
        if(s.id===msg.__x_id._serialized){
          restoredSet.add(s.id);
          return s;
        }

        // Fuzzy match passed
        restoredSet.add(s.id);
        return s;
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
          var saved=matchSaved(m);
          if(saved&&applyRestore(m,saved)){
            restored++;
            dbg('restore','Matched: '+(saved.type||'chat')+' | '+(saved.body||saved.text||'?').substring(0,30)+' in '+(ch.__x_name||'?').substring(0,20));
          }
        });
      });
      dbg('restore','Scan done: '+restored+' restored this pass ('+restoredSet.size+'/'+savedMsgs.length+' total matched)');
    }

    // Watch for messages loading when user opens chats
    function watchChat(ch){
      if(!ch||!ch.msgs||ch.msgs.__wpR)return;
      ch.msgs.__wpR=true;
      ch.msgs.on('add',function(msg){
        try{
          if(!msg||msg.__x_type!=='revoked')return;
          var saved=matchSaved(msg);
          if(saved){applyRestore(msg,saved);dbg('restore','Live: '+(saved.type||'chat'));}
        }catch(e){}
      });
    }
    (CC._models||[]).forEach(watchChat);
    CC.on('add',watchChat);

    // Try restore once at boot (same-session messages only)
    doRestore();
    setTimeout(doRestore,5000);
    dbg('restore','Live watcher active — new deletions will be caught instantly');
    var S=settings();Object.keys(S).forEach(function(k){if(S[k]){dbg('boot','Applying setting: '+k);applyToggle(k,true);}});
    window.__wplus.ready=true;
    dbg('boot','READY — '+((CC._models||[]).length)+' chats, '+(CON?(CON._models||[]).length:0)+' contacts');
    fire('ready');

    // Migrate old messages — save their media to disk files
    setTimeout(function(){serverPost('/migrate',{});},5000);
  }

  // Debug API
  window.__wplus.debug={
    getLog:function(){return debugLog.slice();},
    getLogText:function(){return debugLog.map(function(e){return e.ts+' ['+e.cat+'] '+e.msg+(e.data?' | '+e.data:'');}).join('\n');},
    clear:function(){debugLog=[];dbg('debug','Log cleared');},
    enable:function(){debugEnabled=true;dbg('debug','Debug enabled');},
    disable:function(){debugEnabled=false;},
    isEnabled:function(){return debugEnabled;},
    status:function(){
      return{
        version:window.__wplus.version, ready:window.__wplus.ready,
        chats:CC?(CC._models||[]).length:0,
        contacts:CON?(CON._models||[]).length:0,
        groups:GRP?(GRP._models||[]).length:0,
        deletedMsgs:deletedMsgs('get').length,
        hookedChats:CC?(CC._models||[]).filter(function(c){return c.msgs&&c.msgs.__wp;}).length:0,
        hooks:{composing:!!_comp,presence:!!_pres,seen:!!_seen,played:!!_played},
        settings:settings(),
        logEntries:debugLog.length
      };
    }
  };

  // Full cleanup — restores WhatsApp to original state
  window.__wplus.cleanup=function(){
    // Stop timers
    if(presInt){clearInterval(presInt);presInt=null;}

    // Disconnect all MutationObservers
    Object.keys(blurObs).forEach(function(k){try{blurObs[k].disconnect();}catch(e){}});
    blurObs={};

    // Remove injected CSS
    ['wplus-css-blurMessages','wplus-css-blurContacts','wplus-css-blurPhotos','wplus-css-blurAvatar','wplus-css'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});

    // Restore original WhatsApp functions
    try{var c=findExport("markComposing");if(c&&_comp){c.markComposing=_comp;if(_rec)c.markRecording=_rec;}}catch(e){}
    try{var p=findExport("sendPresenceAvailable");if(p&&_pres)p.sendPresenceAvailable=_pres;}catch(e){}
    try{var s=findExport("sendConversationSeen");if(s&&_seen)s.sendConversationSeen=_seen;}catch(e){}
    try{var pl=findExport("markPlayed");if(pl&&_played)pl.markPlayed=_played;}catch(e){}

    // Remove ALL UI elements
    ['wplus-btn','wplus-panel','wplus-header-restore','wplus-css','wplus-style'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
    document.querySelectorAll('.wplus-restore-btn,.wplus-b,.wpp,[id*=wplus],.wplus-msg-highlight').forEach(function(e){e.remove();});
    document.querySelectorAll('.wplus-blur-t,.wplus-blur-p').forEach(function(e){e.classList.remove('wplus-blur-t','wplus-blur-p');});
    // Clear debug timer
    if(dbg._timer){clearTimeout(dbg._timer);dbg._timer=null;}

    // Remove event listeners by clearing the wplus object
    window.__wplus={version:'removed',ready:false,cleanup:function(){}};

    console.log('[WPlus] Uninjected — WhatsApp restored to original state');
  };

  setTimeout(boot,3000);
  dbg('boot','Engine v1.2 loaded');
})();
