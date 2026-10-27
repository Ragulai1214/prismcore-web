/* Browser shell: rendering, responsive UI, multi-touch, audio and tab-scoped records. */
(() => {
  'use strict';
  const DEBUG_TOOLS=true; // Release checklist: disable/remove temporary debug controls.
  const {Game,TYPES,EXP,TAU,clamp}=Prism;
  const $=id=>document.getElementById(id),canvas=$('world'),ctx=canvas.getContext('2d');
  const game=new Game();let lang='ja',page=null,last=0,accumulator=0,toastUntil=0;
  let width=innerWidth,height=innerHeight,scale=1,camera={x:0,y:0},mapExpanded=false;
  const keys=new Set(),mouse={x:0,y:0,down:false};
  const move={x:0,y:0,id:null},aim={x:0,y:0,id:null,angle:-Math.PI/2};
  const storageKey='prism-core-tab-v1';
  let archive={records:[],kills:{},trophies:{}};
  // sessionStorage survives reloads in this tab, but is not a persistent save.
  try{const saved=JSON.parse(sessionStorage.getItem(storageKey));if(saved&&Array.isArray(saved.records)&&saved.kills&&saved.trophies)archive=saved;}catch{}
  function saveArchive(){try{sessionStorage.setItem(storageKey,JSON.stringify(archive));}catch{/* Private/blocked storage: retain this page's in-memory records. */}}
  const tr=(ja,en)=>lang==='ja'?ja:en;
  const time=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const descriptions={
    triangle:['高速で接近し、接触で攻撃。赤トークンは攻撃力＋1。','Rushes toward you. Red tokens grant +1 ATK.'],
    square:['短時間追尾する弾を発射。緑トークンは最大HP＋2。','Fires homing shots. Green tokens grant +2 max HP.'],
    heart:['周囲の敵を回復。状況によってプレイヤーも回復。桃トークンはHPを100回復。','Healing waves help enemies, or you if no enemy is healed first. Pink tokens restore 100 HP.'],
    pentagon:['10方向に回転する弾幕。紫トークンは特殊弾の効果時間＋0.2秒。','Rotating ten-way volleys. Purple tokens extend power-ups by 0.2 seconds.'],
    hexagon:['12方向に分裂する爆発弾。水色トークンは移動速度＋0.05。','Explosive shots split into twelve bullets. Cyan tokens grant +0.05 speed.'],
    octagon:['波動で周囲の敵を無敵にする。橙トークンは被弾後の無敵時間＋8フレーム。','Shields nearby enemies. Orange tokens add eight frames of invulnerability after a hit.'],
    star_boss:['10階のボス。HPが半分になると弾幕が激しくなる。','The floor 10 guardian. Its bullet patterns intensify below half health.'],
    true_boss:['1〜9階の敵を全滅させ、300秒以内に10階へ。バリア展開中は装置を狙おう。','Clear all enemies on floors 1–9 and reach floor 10 within 300 seconds. Destroy its barrier device to break the shield.']
  };
  const names={triangle:'TRIANGLE',square:'SQUARE',heart:'HEART',pentagon:'PENTAGON',hexagon:'HEXAGON',octagon:'OCTAGON',star_boss:'STAR GUARDIAN',true_boss:'PRISM'};
  const audio=new PrismAudio();
  function translate(){document.documentElement.lang=lang;document.querySelectorAll('[data-ja]').forEach(el=>el.textContent=el.dataset[lang]);$('language').textContent=lang==='ja'?'EN':'日本語';if(page)renderPanel();}
  function notify(text){$('toast').textContent=text;$('toast').hidden=false;toastUntil=performance.now()+2400;}
  function resetInput(){keys.clear();mouse.down=false;for(const [stick,obj] of [['moveStick',move],['aimStick',aim]]){obj.x=0;obj.y=0;obj.id=null;$(stick).classList.remove('held');$(stick).querySelector('i').style.transform='';}}
  function syncShell(){
    const inRun=!!game.player&&game.state!=='home';
    $('home').hidden=inRun;$('brandbar').hidden=inRun;$('hud').hidden=!inRun;
    $('touchControls').hidden=game.state!=='playing';$('panel').hidden=!page;
    document.querySelector('.ambient').style.opacity=inRun?'0':'1';
  }
  function start(){audio.pause();audio.unlock();audio.music('');resetInput();page=null;game.events=[];game.start();accumulator=0;syncShell();handleEvents();}
  function home(){resetInput();game.state='home';page=null;audio.pause();audio.unlock();audio.music('home');syncShell();}
  function openPanel(which){
    resetInput();
    if(game.state==='playing'){game.state='paused';audio.pause();}
    page=which;mapExpanded=which==='map';renderPanel();syncShell();$('closePanel').focus();
  }
  function closePanel(){
    if(game.state==='paused')game.state='playing';page=null;mapExpanded=false;accumulator=0;
    if(game.state==='playing'){audio.unlock();audio.music(game.floor===10&&game.enemies.some(e=>e.type.includes('boss')&&e.hp>0)?(game.trueBoss?'true_boss':'star_boss'):'');}
    syncShell();
  }
  const button=(id,label,primary=false)=>`<button id="${id}" class="${primary?'primary':''}">${label}</button>`;
  function debugJumpToBoss(trueBoss){
    if(!DEBUG_TOOLS||game.state!=='paused'||page!=='pause')return;
    resetInput();audio.unlock();game.events=[];game.trueBoss=trueBoss;
    // Base stats plus nine level-ups; discard all token and temporary bonuses.
    Object.assign(game.player,{level:10,exp:0,maxHp:200+20*9,hp:200+20*9,atk:20+5*9,speed:6,
      atkBonus:0,hpBonus:0,speedBonus:0,duration:0,invBonus:0,inv:0,homing:0,explosive:0});
    game.loadFloor(10);game.state='playing';page=null;mapExpanded=false;accumulator=0;
    syncShell();handleEvents();notify(tr('DEBUG · ボス部屋へ移動しました','DEBUG · Entered boss room'));
  }
  const stat=(label,value)=>`<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
  function renderPanel(){
    const body=$('panelContent');document.querySelector('.panel-card').scrollTop=0;$('panelEyebrow').textContent='PRISM CORE / '+page.toUpperCase();$('closePanel').hidden=page==='result';
    if(page==='help'){
      $('panelTitle').textContent=tr('探索ガイド','Expedition guide');
      body.innerHTML=`<div class="cards"><div class="info-card"><h3>01 / ${tr('移動と射撃','Move & fire')}</h3><p>${tr('左スティックをドラッグして移動。右スティックは倒した方向へ連射します。指を離すと止まります。','Drag the left stick to move. Drag the right stick to aim and fire. Release to stop.')}</p></div><div class="info-card"><h3>02 / ${tr('出口を開く','Open the exit')}</h3><p>${tr('黄色いスイッチをすべて踏むと、ワープが出現。マップで位置を確認できます。次の階でHP全回復。','Step on every yellow switch to reveal the portal. Check your map for locations. Each new floor fully heals you.')}</p></div><div class="info-card"><h3>03 / ${tr('光を集める','Gather light')}</h3><p>${tr('敵が落とすトークンで成長。黄色い円は追尾弾、ひし形は爆発弾です。強化はその探索中に有効。','Collect enemy tokens to grow stronger. Yellow circles grant homing fire; diamonds grant explosive fire. Upgrades last for this expedition.')}</p></div><div class="info-card"><h3>04 / ${tr('最深部へ','Reach the core')}</h3><p>${tr('10階のボスを倒し、ワープへ。1〜9階の敵を全滅させて300秒以内に到達すると、真ボスが出現。','Defeat the floor 10 boss and enter its portal. Clear all enemies on floors 1–9 within 300 seconds to face the true boss.')}</p></div></div><p class="muted" style="margin-top:16px">${tr('PC：WASD / 矢印キーで移動、左クリック長押しで射撃、Space / Esc / Pで一時停止。別タブへの切替時は自動停止。','PC: WASD / arrows to move, hold left click to fire, Space / Esc / P to pause. Switching tabs automatically pauses play.')}</p>`;
    }else if(page==='records'){
      $('panelTitle').textContent=tr('このタブの戦績','This tab’s records');
      body.innerHTML=`<p class="muted">${tr('タブを閉じて開き直すとリセット。同じタブの再読み込みでは保持します。','Records reset when this tab is closed and reopened. Reloading the same tab retains them.')}</p>`;
      if(!archive.records.length)body.innerHTML+=`<div class="info-card"><h3>${tr('まだ記録がありません','No expeditions yet')}</h3><p>${tr('探索を終えると、ここに戦績が表示されます。','Complete an expedition to see your results here.')}</p></div>`;
      for(const r of [...archive.records].reverse()){
        const total=Object.values(r.kills||{}).reduce((a,b)=>a+Number(b),0);
        // Values rendered from storage are coerced to numeric data; never inject saved HTML.
        body.innerHTML+=`<div class="record"><span>${r.win?'◇ CLEAR':'↘ '+tr('探索終了','RUN ENDED')}<small>${r.trueBoss?'PRISM':'PRISM CORE'}</small></span><span>F ${Number(r.floor)||1}<small>FLOOR</small></span><span>${time(Number(r.time)||0)}<small>TIME</small></span><span>${total}<small>${tr('撃破','KILLS')} / LV ${Number(r.level)||1}</small></span></div>`;
      }
    }else if(page==='bestiary'){
      $('panelTitle').textContent=tr('敵図鑑','Bestiary');body.innerHTML='<div class="cards">'+Object.entries(TYPES).map(([key,t])=>`<div class="info-card enemy-card"><canvas width="100" height="100" data-enemy="${key}"></canvas><div><h3 style="color:${t.color}">${names[key]} ${archive.trophies[key]?'◇':''}</h3><div class="enemy-info">HP ${t.hp} / ATK ${t.atk} · ${tr('撃破','DEFEATED')} ${Number(archive.kills[key])||0}</div><p>${descriptions[key][lang==='ja'?0:1]}</p></div></div>`).join('')+'</div>';
      body.querySelectorAll('canvas').forEach(c=>drawShape(c.getContext('2d'),c.dataset.enemy,50,50,30,0));
    }else if(page==='pause'){
      const p=game.player;$('panelTitle').textContent=tr('探索を一時停止中','Expedition paused');
      body.innerHTML=`<div class="stat-grid">${stat('HP',`${Math.ceil(p.hp)} / ${p.maxHp}`)}${stat('ATTACK',p.atk)}${stat('LEVEL',p.level)}${stat('SPEED',p.speed.toFixed(2))}${stat('FLOOR',`${game.floor} / 10`)}${stat('TIME',time(game.elapsed))}</div><p class="muted">${tr('トークン強化','Token bonuses')}: ATK +${p.atkBonus} / HP +${p.hpBonus} / SPD +${p.speedBonus.toFixed(2)} / DUR +${p.duration.toFixed(1)}s / INV +${p.invBonus}F</p><div class="sliders"><label>SE <input id="seVolume" aria-label="効果音の音量" type="range" min="0" max="1" step=".05" value="${audio.seVolume}"></label><label>BGM <input id="bgmVolume" aria-label="BGM音量" type="range" min="0" max="1" step=".05" value="${audio.bgmVolume}"></label></div><div class="button-row">${button('resume',tr('探索を続ける','Resume'),true)}${button('retire',tr('探索を終了','End expedition'))}</div>`;
      if(DEBUG_TOOLS){
        body.innerHTML+=`<p class="muted" style="margin-top:16px">${tr('DEBUG · Lv10 / トークンボーナスなし','DEBUG · Level 10 / No token bonuses')}</p><div class="button-row">${button('debugBoss','STAR BOSS')}${button('debugTrueBoss','PRISM CORE')}</div>`;
        $('debugBoss').onclick=()=>debugJumpToBoss(false);
        $('debugTrueBoss').onclick=()=>debugJumpToBoss(true);
      }
      $('resume').onclick=closePanel;
      $('retire').onclick=()=>{page='retire';renderPanel();};
      $('seVolume').oninput=e=>audio.seVolume=Number(e.target.value);
      $('bgmVolume').oninput=e=>{audio.bgmVolume=Number(e.target.value);if(audio.bgm)audio.bgm.volume=audio.bgmVolume;};
    }else if(page==='retire'){
      $('panelTitle').textContent=tr('探索を終了しますか？','End this expedition?');body.innerHTML=`<p>${tr('今回の到達階層と撃破数を戦績に記録して、タイトルへ戻ります。','Record this expedition’s progress and return to the title screen.')}</p><div class="button-row">${button('cancelRetire',tr('戻る','Go back'),true)}${button('confirmRetire',tr('終了する','End expedition'))}</div>`;
      $('cancelRetire').onclick=()=>{page='pause';renderPanel();};$('confirmRetire').onclick=()=>{game.state='playing';game.finish(false);handleEvents();home();};
    }else if(page==='map'){
      $('panelTitle').textContent=tr('探索マップ','Sector map');body.innerHTML=`<canvas id="largeMap" class="large-map" width="500" height="500"></canvas><div class="map-legend"><span style="color:#ffe589">■ ${tr('スイッチ','SWITCH')}</span><span style="color:#82f0cd">◇ ${tr('ワープ','PORTAL')}</span><span>● ${tr('現在地','YOU')}</span></div>`;drawMap($('largeMap'));
    }else if(page==='result'){
      const win=game.state==='victory',total=Object.values(game.kills).reduce((a,b)=>a+b,0);
      $('panelTitle').textContent=win?tr('最深部、到達。','Core reached.'):tr('光は、また集まる。','The light returns.');
      body.innerHTML=`<div class="result-symbol">${win?'◇':'◌'}</div><p>${win?tr('全10階クリア。探索、おつかれさまでした。','All ten floors cleared. Expedition complete.'):tr('探索終了。次の迷宮が、あなたを待っています。','Expedition ended. Another labyrinth awaits.')}</p><div class="stat-grid">${stat('FLOOR',`${game.floor} / 10`)}${stat('TIME',time(game.elapsed))}${stat('KILLS',total)}</div><div class="button-row">${button('again',tr('もう一度探索','Explore again'),true)}${button('toHome',tr('タイトルへ','Title screen'))}</div>`;
      $('again').onclick=start;$('toHome').onclick=home;
    }
  }
  function handleEvents(){
    for(const event of game.events){
      if(event.type==='sound')audio.sound(event.name);
      if(event.type==='floor'){audio.pause();audio.music(event.floor===10?(event.trueBoss?'true_boss':'star_boss'):'');notify(event.floor===10?(event.trueBoss?'WARNING / PRISM':'WARNING / STAR GUARDIAN'):`SECTOR ${String(event.floor).padStart(2,'0')} / 10`);}
      if(event.type==='portal')notify(tr('ワープが開きました · マップを確認','Portal open · Check your map'));
      if(event.type==='kill'){archive.kills[event.enemy]=(Number(archive.kills[event.enemy])||0)+1;if(event.enemy.includes('boss')){archive.trophies[event.enemy]=true;audio.music('');}saveArchive();}
      if(event.type==='finish'){
        archive.records.push({win:event.win,floor:event.floor,time:event.time,level:event.level,kills:event.kills,trueBoss:event.trueBoss});saveArchive();audio.pause();audio.music('');audio.sound(event.win?'victory':'player_defeat');resetInput();page='result';renderPanel();syncShell();
      }
    }
    game.events.length=0;
  }
  function bindStick(id,state){
    const el=$(id),knob=el.querySelector('i');
    const update=e=>{const r=el.getBoundingClientRect(),radius=r.width*.34,dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,length=Math.hypot(dx,dy),m=Math.min(1,length/radius);
      state.x=length>4?dx/length*m:0;state.y=length>4?dy/length*m:0;
      if(id==='aimStick'&&length>4)state.angle=Math.atan2(dy,dx);
      knob.style.transform=`translate(${state.x*radius}px,${state.y*radius}px)`;
    };
    el.addEventListener('pointerdown',e=>{if(game.state!=='playing'||state.id!==null)return;e.preventDefault();audio.unlock();state.id=e.pointerId;el.setPointerCapture(e.pointerId);el.classList.add('held');update(e);});
    el.addEventListener('pointermove',e=>{if(state.id===e.pointerId){e.preventDefault();update(e);}});
    const release=e=>{if(state.id!==e.pointerId)return;state.id=null;state.x=state.y=0;knob.style.transform='';el.classList.remove('held');};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(type,release);
  }
  bindStick('moveStick',move);bindStick('aimStick',aim);
  // Install before the first gesture; Safari can start selection from the page
  // ancestor even when the individual stick has user-select disabled.
  const playSurfaces=[canvas,$('touchControls'),$('moveStick'),$('aimStick')];
  const startsOnPlaySurface=e=>playSurfaces.some(el=>(e.composedPath?.()||[]).includes(el)||e.target===el);
  const capturePlayGesture=e=>{if(startsOnPlaySurface(e))e.preventDefault();};
  for(const type of ['touchstart','touchmove','touchend','gesturestart','gesturechange','gestureend'])document.addEventListener(type,capturePlayGesture,{capture:true,passive:false});
  for(const type of ['selectstart','contextmenu'])document.addEventListener(type,e=>{
    if(game.state==='playing'||startsOnPlaySurface(e))e.preventDefault();
  },{capture:true});
  document.addEventListener('selectionchange',()=>{
    if(game.state==='playing')window.getSelection?.()?.removeAllRanges();
  });
  // Safari can still start native touch gestures despite pointer-event handling.
  // Scope cancellation to the play surface so menus retain normal scrolling.
  for(const surface of [canvas,$('touchControls'),$('moveStick'),$('aimStick')]){
    const preventNative=e=>{if(game.state==='playing')e.preventDefault();};
    for(const type of ['touchstart','touchmove','touchend','gesturestart','gesturechange','gestureend'])surface.addEventListener(type,preventNative,{passive:false});
    for(const type of ['contextmenu','selectstart','dragstart'])surface.addEventListener(type,preventNative);
  }
  canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button===0&&game.state==='playing'){mouse.down=true;mouse.x=e.clientX;mouse.y=e.clientY;canvas.setPointerCapture(e.pointerId);}});
  canvas.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'){mouse.x=e.clientX;mouse.y=e.clientY;}});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>mouse.down=false);
  window.addEventListener('keydown',e=>{
    if(e.target instanceof HTMLInputElement)return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
    if(['Space','Escape','KeyP'].includes(e.code)&&!e.repeat){if(game.state==='playing')openPanel('pause');else if(game.state==='paused')closePanel();else if(page&&page!=='result')closePanel();return;}
    keys.add(e.code);
  });window.addEventListener('keyup',e=>keys.delete(e.code));
  function backgroundPause(){resetInput();if(game.state==='playing')openPanel('pause');audio.pause();}
  window.addEventListener('blur',backgroundPause);document.addEventListener('visibilitychange',()=>{if(document.hidden)backgroundPause();});
  window.addEventListener('pagehide',()=>{saveArchive();backgroundPause();});
  $('start').onclick=start;$('brand').onclick=e=>{e.preventDefault();home();};
  document.querySelectorAll('[data-page]').forEach(el=>el.onclick=()=>{audio.unlock();audio.music('home');openPanel(el.dataset.page);});
  $('language').onclick=()=>{lang=lang==='ja'?'en':'ja';translate();};$('sound').onclick=()=>{audio.unlock();audio.toggle();$('sound').textContent=audio.enabled?'♪ ON':'♪ OFF';if(audio.enabled&&game.state==='home')audio.music('home');};
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('app').requestFullscreen)await $('app').requestFullscreen();else notify(tr('このブラウザは全画面表示に未対応です','Fullscreen is not available in this browser'));}catch{notify(tr('全画面表示を開始できませんでした','Fullscreen could not be started'));}};
  $('pause').onclick=()=>openPanel('pause');$('details').onclick=()=>openPanel('help');$('mapButton').onclick=()=>openPanel('map');$('closePanel').onclick=closePanel;
  // Keep keyboard focus inside a modal. Escape is handled with the pause shortcut above.
  $('panel').addEventListener('keydown',e=>{if(e.key!=='Tab')return;const list=[...$('panel').querySelectorAll('button:not([hidden]),input')];if(!list.length)return;const first=list[0],end=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();end.focus();}else if(!e.shiftKey&&document.activeElement===end){e.preventDefault();first.focus();}});
  function resize(){
    width=innerWidth;height=innerHeight;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    scale=width<height?Math.min(width/600,height/900):Math.min(width/1000,height/650);
  }
  window.addEventListener('resize',resize);resize();
  function drawShape(c,type,x,y,r,rotation=0){
    const t=TYPES[type];c.save();c.translate(x,y);c.rotate(rotation);c.strokeStyle=t.color;c.fillStyle=t.color+'25';c.lineWidth=1.8;
    c.beginPath();
    if(type==='heart'){
      c.moveTo(0,r*.75);c.bezierCurveTo(-r*1.7,-r*.2,-r*.7,-r*1.5,0,-r*.55);c.bezierCurveTo(r*.7,-r*1.5,r*1.7,-r*.2,0,r*.75);
    }else{
      const star=type==='star_boss',n=star?10:t.sides;
      for(let i=0;i<n;i++){const a=i*TAU/n-Math.PI/2,rr=star&&i%2?r*.45:r;const px=Math.cos(a)*rr,py=Math.sin(a)*rr;i?c.lineTo(px,py):c.moveTo(px,py);}c.closePath();
    }
    c.fill();c.stroke();
    if(type==='true_boss'){c.rotate(Math.PI/4);c.strokeStyle='#b78aff';c.strokeRect(-r*.5,-r*.5,r,r);c.rotate(Math.PI/4);c.strokeStyle='#82f0cd';c.strokeRect(-r*.32,-r*.32,r*.64,r*.64);}
    c.restore();
  }
  function circle(c,x,y,r,color,filled=true){c.beginPath();c.arc(x,y,r,0,TAU);c[filled?'fillStyle':'strokeStyle']=color;filled?c.fill():c.stroke();}
  function drawMap(target){
    if(!target||!game.dungeon)return;const c=target.getContext('2d'),w=target.width,m=w/2000;
    c.clearRect(0,0,w,w);c.fillStyle='#0b101c';c.fillRect(0,0,w,w);
    const d=game.dungeon;c.fillStyle='#364159';for(let y=0;y<100;y++)for(let x=0;x<100;x++)if(!d.grid[y*100+x]&&d.seen[y*100+x])c.fillRect(x*20*m,y*20*m,Math.ceil(20*m),Math.ceil(20*m));
    for(const sw of game.switches){c.fillStyle=sw.active?'#49725f':'#ffe589';const r=Math.max(2,w/100);c.fillRect(sw.x*m-r,sw.y*m-r,r*2,r*2);}
    if(game.portal)circle(c,game.portal.x*m,game.portal.y*m,Math.max(3,w/80),'#82f0cd',false);
    if(game.device&&game.device.hp>0)circle(c,game.device.x*m,game.device.y*m,Math.max(2,w/100),'#6ce3ff');
    circle(c,game.player.x*m,game.player.y*m,Math.max(2.5,w/100),'#ffffff');
  }
  function updateHud(){
    const p=game.player;$('hpText').textContent=`${Math.ceil(p.hp)} / ${p.maxHp}`;$('hpFill').style.width=`${100*p.hp/p.maxHp}%`;$('hpFill').style.background=p.hp/p.maxHp<.3?'#ff6178':'#82f0cd';
    $('levelText').textContent=`LV ${String(p.level).padStart(2,'0')}`;$('expFill').style.width=`${p.level===10?100:100*p.exp/EXP[p.level-1]}%`;
    $('floorText').innerHTML=`${String(game.floor).padStart(2,'0')} <small>/ 10</small>`;$('timerText').textContent=time(game.elapsed);
    const activated=game.switches.filter(s=>s.active).length;
    $('objective').textContent=game.portal?tr('◇ ワープへ向かおう','◇ Enter the portal'):game.floor===10?tr('◇ ボスを倒そう','◇ Defeat the guardian'):`${tr('スイッチ','SWITCHES')} ${activated} / ${game.switches.length}\n${tr('残りの敵','ENEMIES')} ${game.enemies.length}`;
    $('powerText').textContent=[p.homing?`◎ HOMING ${(p.homing/60).toFixed(1)}s`:'',p.explosive?`◇ EXPLOSIVE ${(p.explosive/60).toFixed(1)}s`:''].filter(Boolean).join('\n');
    const boss=game.enemies.find(e=>e.type.includes('boss'));$('bossHealth').hidden=!boss;
    if(boss){$('bossName').textContent=names[boss.type]+(boss.barrier?' / BARRIER':'');$('bossFill').style.width=`${100*boss.hp/boss.maxHp}%`;}
    drawMap($('minimap'));if(mapExpanded)drawMap($('largeMap'));
  }
  function render(now){
    ctx.clearRect(0,0,width,height);if(game.state==='home'||!game.player)return;
    ctx.fillStyle='#080e19';ctx.fillRect(0,0,width,height);
    const p=game.player,viewW=width/scale,viewH=height/scale;
    camera.x=clamp(p.x-viewW/2,0,Math.max(0,2000-viewW));camera.y=clamp(p.y-viewH/2,0,Math.max(0,2000-viewH));
    ctx.save();ctx.scale(scale,scale);ctx.translate(-camera.x,-camera.y);
    const d=game.dungeon,x0=Math.max(0,Math.floor(camera.x/20)),x1=Math.min(100,Math.ceil((camera.x+viewW)/20)),y0=Math.max(0,Math.floor(camera.y/20)),y1=Math.min(100,Math.ceil((camera.y+viewH)/20));
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(d.grid[y*100+x]===0){
      ctx.fillStyle=(x+y)%2?'#121e30':'#132033';ctx.fillRect(x*20,y*20,20,20);
      ctx.strokeStyle='#203349';ctx.lineWidth=1;
      if(y===0||d.grid[(y-1)*100+x]){ctx.beginPath();ctx.moveTo(x*20,y*20);ctx.lineTo(x*20+20,y*20);ctx.stroke();}
      if(x===0||d.grid[y*100+x-1]){ctx.beginPath();ctx.moveTo(x*20,y*20);ctx.lineTo(x*20,y*20+20);ctx.stroke();}
    }
    for(const sw of game.switches){ctx.fillStyle=sw.active?'#82f0cd25':'#ffe58922';ctx.strokeStyle=sw.active?'#82f0cd':'#ffe589';ctx.lineWidth=2;ctx.fillRect(sw.x-20,sw.y-10,40,20);ctx.strokeRect(sw.x-20,sw.y-10,40,20);if(sw.active){ctx.font='14px sans-serif';ctx.fillStyle='#82f0cd';ctx.fillText('✓',sw.x-5,sw.y+5);}}
    if(game.portal){const q=game.portal;ctx.lineWidth=2;circle(ctx,q.x,q.y,24+Math.sin(now/250)*3,'#82f0cd',false);circle(ctx,q.x,q.y,16,'#82f0cd22');ctx.save();ctx.translate(q.x,q.y);ctx.rotate(now/1000);ctx.strokeStyle='#82f0cd';ctx.strokeRect(-12,-12,24,24);ctx.restore();}
    for(const t of game.tokens){ctx.save();ctx.translate(t.x,t.y);ctx.rotate(Math.PI/4);ctx.fillStyle=t.color;ctx.fillRect(-4,-4,8,8);ctx.restore();}
    if(game.power){const q=game.power;ctx.strokeStyle='#ffe589';ctx.lineWidth=2;circle(ctx,q.x,q.y,20+Math.sin(now/200)*2,'#ffe58920');if(q.type==='homing')circle(ctx,q.x,q.y,12,'#ffe589',false);else{ctx.save();ctx.translate(q.x,q.y);ctx.rotate(Math.PI/4);ctx.strokeRect(-9,-9,18,18);ctx.restore();}}
    if(game.device&&game.device.hp>0){const q=game.device;ctx.strokeStyle='#6ce3ff';ctx.lineWidth=2;ctx.strokeRect(q.x-20,q.y-20,40,40);circle(ctx,q.x,q.y,12,'#6ce3ff',false);ctx.fillStyle='#6ce3ff';ctx.fillRect(q.x-24,q.y-30,48*q.hp/q.maxHp,4);}
    for(const e of game.enemies){
      if(e.x<camera.x-120||e.x>camera.x+viewW+120||e.y<camera.y-120||e.y>camera.y+viewH+120)continue;
      if(e.wave>0){const heal=e.type==='heart',duration=heal?30:60,r=(duration-e.wave)/duration*(heal?300:400);ctx.lineWidth=2;circle(ctx,e.x,e.y,r,e.color+'80',false);}
      if(e.inv>0||e.barrier){ctx.lineWidth=2;circle(ctx,e.x,e.y,e.radius+8,'#b7bdff80',false);}
      drawShape(ctx,e.type,e.x,e.y,e.radius,e.type.includes('boss')?now/5000:0);
      if(e.hp<e.maxHp&&!e.type.includes('boss')){ctx.fillStyle='#060c16';ctx.fillRect(e.x-e.radius,e.y-e.radius-10,e.radius*2,3);ctx.fillStyle=e.color;ctx.fillRect(e.x-e.radius,e.y-e.radius-10,e.radius*2*e.hp/e.maxHp,3);}
    }
    for(const b of game.bullets){const color=b.enemy?(b.homing>0?'#ff9cc4':'#ff657b'):b.homing>0?'#b78aff':'#83e8ff';circle(ctx,b.x,b.y,b.radius,b.explosive?color+'66':color);if(b.explosive){ctx.lineWidth=2;circle(ctx,b.x,b.y,b.radius,color,false);}}
    if(p.inv===0||Math.floor(p.inv/4)%2){circle(ctx,p.x,p.y,13,'#ffffff12');circle(ctx,p.x,p.y,8,'#f6f9ff');}
    const a=aim.id!==null?aim.angle:Math.atan2(mouse.y/scale+camera.y-p.y,mouse.x/scale+camera.x-p.x);
    ctx.strokeStyle='#f6f9ff88';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x+Math.cos(a)*15,p.y+Math.sin(a)*15);ctx.lineTo(p.x+Math.cos(a)*23,p.y+Math.sin(a)*23);ctx.stroke();
    for(const fx of game.effects){ctx.globalAlpha=Math.min(1,fx.life/15);ctx.fillStyle=fx.color;if(fx.text){ctx.font='12px monospace';ctx.textAlign='center';ctx.fillText(fx.text,fx.x,fx.y-15);}else ctx.fillRect(fx.x,fx.y,3,3);}ctx.globalAlpha=1;ctx.restore();
  }
  let hudFrame=0;
  function loop(now){
    const delta=last?Math.min((now-last)/1000,.1):0;last=now;
    if(game.state==='playing'){
      accumulator+=delta;
      const keyX=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),keyY=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);
      const input={x:move.id!==null?move.x:keyX,y:move.id!==null?move.y:keyY,shoot:aim.id!==null&&Math.hypot(aim.x,aim.y)>.15||mouse.down,angle:aim.id!==null?aim.angle:Math.atan2(mouse.y/scale+camera.y-game.player.y,mouse.x/scale+camera.x-game.player.x)};
      while(accumulator>=1/60&&game.state==='playing'){game.step(input);accumulator-=1/60;handleEvents();}
    }else accumulator=0;
    render(now);if(game.player&&game.state!=='home'&&hudFrame++%6===0)updateHud();
    if(now>toastUntil)$('toast').hidden=true;
    requestAnimationFrame(loop);
  }
  translate();syncShell();requestAnimationFrame(loop);
})();
