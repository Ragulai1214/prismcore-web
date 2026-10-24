const test=require('node:test'),assert=require('node:assert/strict');
const PrismAudio=require('../audio.js');
function fixture(){
  let now=0;const pending=new Map(),nodes=[];
  class Context{
    constructor(){this.destination={};this.sampleRate=44100;this.resumes=0;}
    resume(){this.resumes++;return Promise.resolve();}
    createBuffer(){return {};}
    decodeAudioData(){return Promise.resolve({decoded:true});}
    createBufferSource(){const node={start(){this.started=true;},stop(){this.stopped=true;this.onended?.();},connect(){},disconnect(){}};nodes.push(node);return node;}
    createGain(){return {gain:{value:0},connect(){},disconnect(){}};}
  }
  const env={AudioContext:Context,location:{protocol:'http:'},performance:{now:()=>now},fetch:url=>new Promise(resolve=>pending.set(url,(ok=true)=>resolve({ok,arrayBuffer:async()=>new ArrayBuffer(8)})))};
  const audio=new PrismAudio(env);
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  return {audio,env,nodes,pending,flush,advance:()=>now+=100};
}
test('gesture unlocks a single context and decoded effects are reused',async()=>{
  const f=fixture();f.audio.sound('player_shoot');assert.equal(f.pending.size,0);
  f.audio.unlock();const context=f.audio.context;f.audio.unlock();assert.equal(f.audio.context,context);assert.equal(context.resumes,2);
  f.audio.sound('player_shoot');f.pending.get('assets/sounds/se/player_shoot.wav')();await f.flush();assert.equal(f.audio.voices.size,1);
  f.advance();f.audio.sound('player_shoot');await f.flush();assert.equal(f.pending.size,1);assert.equal(f.audio.voices.size,2);
});
test('pause cancels an effect whose download is still pending',async()=>{
  const f=fixture();f.audio.unlock();f.audio.sound('player_damage');f.audio.pause();f.pending.get('assets/sounds/se/player_damage.wav')();await f.flush();assert.equal(f.audio.voices.size,0);
});
test('changing scene discards an older pending BGM and volume changes apply live',async()=>{
  const f=fixture();f.audio.unlock();f.audio.music('home');f.audio.music('true_boss');
  f.pending.get('assets/sounds/bgm/home.ogg')();await f.flush();assert.equal(f.audio.musicNode,null);
  f.pending.get('assets/sounds/bgm/true_boss.ogg')();await f.flush();assert.ok(f.audio.musicNode.started);
  f.audio.bgmVolume=.7;assert.equal(f.audio.musicGain.gain.value,.7);const playing=f.audio.musicNode;f.audio.pause();assert.equal(playing.stopped,true);assert.equal(f.audio.musicNode,null);
});
test('browsers without OGG request the PCM WAV version directly',async()=>{
  const f=fixture();f.env.Audio=class{canPlayType(){return '';}};f.audio.unlock();f.audio.music('home');
  assert.equal(f.pending.has('assets/sounds/bgm/home.ogg'),false);
  f.pending.get('assets/sounds/bgm/home.wav')();await f.flush();assert.ok(f.audio.musicNode.started);
});
test('an OGG loading/decoding failure falls back to PCM WAV',async()=>{
  const f=fixture();f.audio.unlock();f.audio.music('star_boss');f.pending.get('assets/sounds/bgm/star_boss.ogg')(false);await f.flush();
  assert.ok(f.pending.has('assets/sounds/bgm/star_boss.wav'));f.pending.get('assets/sounds/bgm/star_boss.wav')();await f.flush();assert.ok(f.audio.musicNode.started);
});
