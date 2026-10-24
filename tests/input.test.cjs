// Exercise the actual browser shell with a minimal DOM event fixture, without a browser dependency.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Prism=require('../core.js');
function fixture(){
  const elements=new Map(),windowHandlers={},documentHandlers={},storage=new Map();let raf,now=0,instance,audio;
  const context=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
  function element(id){
    if(elements.has(id))return elements.get(id);
    const handlers={},knob={style:{}};
    const el={id,style:{},dataset:{},hidden:false,width:150,height:150,handlers,classList:{add(){},remove(){}},getContext:()=>context,
      getBoundingClientRect:()=>({left:id==='aimStick'?500:0,top:200,width:124,height:124}),
      addEventListener:(name,fn)=>{(handlers[name]??=[]).push(fn);},
      querySelector:()=>knob,querySelectorAll:()=>[],setPointerCapture(){},focus(){},
      fire(name,opts={}){for(const fn of handlers[name]||[])fn({preventDefault(){},pointerId:1,...opts});}
    };elements.set(id,el);return el;
  }
  class ObservedGame extends Prism.Game{constructor(){super(()=>.51);instance=this;}step(input){this.lastInput={...input};super.step(input);}}
  const document={documentElement:{},getElementById:element,querySelector:()=>element('ambient'),querySelectorAll:()=>[],addEventListener:(n,f)=>documentHandlers[n]=f,hidden:false};
  const sandbox={Prism:{...Prism,Game:ObservedGame},document,innerWidth:844,innerHeight:390,devicePixelRatio:1,HTMLInputElement:class{},
    window:{addEventListener:(n,f)=>windowHandlers[n]=f},performance:{now:()=>now},requestAnimationFrame:f=>raf=f,
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    Audio:class{constructor(){this.paused=true;}play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}},console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../audio.js'),'utf8'),sandbox);
  const AudioClass=sandbox.PrismAudio;
  sandbox.PrismAudio=class extends AudioClass{constructor(){super(sandbox);audio=this;this.unlocks=0;}unlock(){this.unlocks++;super.unlock();}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),sandbox);
  element('start').onclick();instance.loadFloor(10);instance.enemies=[];instance.events=[];
  function tick(){now+=17;raf(now);}
  tick();tick();
  return {element,game:instance,audio,tick,windowHandlers,documentHandlers,document};
}
test('two fingers can move and aim/fire simultaneously; lifting aim does not stop movement',()=>{
  const f=fixture(),left=f.element('moveStick'),right=f.element('aimStick');
  left.fire('pointerdown',{pointerId:10,clientX:100,clientY:262});
  right.fire('pointerdown',{pointerId:20,clientX:562,clientY:222});f.tick();
  assert.ok(f.game.lastInput.x>.5);assert.equal(f.game.lastInput.shoot,true);assert.ok(Math.abs(f.game.lastInput.angle+Math.PI/2)<.01);
  right.fire('pointerup',{pointerId:20});f.tick();assert.equal(f.game.lastInput.shoot,false);assert.ok(f.game.lastInput.x>.5);
  left.fire('pointercancel',{pointerId:10});f.tick();assert.equal(f.game.lastInput.x,0);
});
test('a second pointer cannot hijack an already-held stick; lost capture stops input',()=>{
  const f=fixture(),left=f.element('moveStick');left.fire('pointerdown',{pointerId:10,clientX:100,clientY:262});
  left.fire('pointerdown',{pointerId:11,clientX:20,clientY:262});left.fire('pointerup',{pointerId:11});f.tick();assert.ok(f.game.lastInput.x>.5);
  left.fire('lostpointercapture',{pointerId:10});f.tick();assert.equal(f.game.lastInput.x,0);
});
test('backgrounding freezes time and clears held movement and fire before resume',()=>{
  const f=fixture();f.element('moveStick').fire('pointerdown',{pointerId:10,clientX:100,clientY:262});
  f.element('aimStick').fire('pointerdown',{pointerId:20,clientX:590,clientY:262});f.tick();
  f.document.hidden=true;f.documentHandlers.visibilitychange();const frame=f.game.frame;f.tick();assert.equal(f.game.state,'paused');assert.equal(f.game.frame,frame);
  f.document.hidden=false;f.element('resume').onclick();f.tick();f.tick();assert.equal(f.game.lastInput.x,0);assert.equal(f.game.lastInput.shoot,false);
});
test('resume explicitly unlocks audio even without BGM or a stick gesture',()=>{
  const f=fixture();f.game.loadFloor(1);f.windowHandlers.blur();const before=f.audio.unlocks;
  f.element('resume').onclick();assert.ok(f.audio.unlocks>before);
});
test('restarting after defeat stops the previous result sound',()=>{
  const f=fixture();f.game.player.hp=0;f.tick();assert.equal(f.game.state,'gameover');
  const sound=f.audio.pool.get('player_defeat')[0];assert.equal(sound.paused,false);
  f.element('again').onclick();assert.equal(sound.paused,true);assert.equal(f.game.state,'playing');
});
