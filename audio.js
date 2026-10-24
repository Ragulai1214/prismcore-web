/* Unlock one Web Audio context from a user gesture, then reuse decoded sounds.
   file:// previews fall back to HTMLAudio because fetch is unavailable there. */
(function(root){
  'use strict';
  class PrismAudio {
    constructor(env=root){
      this.env=env;this.enabled=true;this.unlocked=false;this.track='';this.context=null;
      this._seVolume=.45;this._bgmVolume=.3;this.buffers=new Map();this.voices=new Set();this.lastSound=new Map();this.pool=new Map();
      this.bgm=null;this.musicNode=null;this.musicGain=null;this.generation=0;this.musicGeneration=0;
    }
    get seVolume(){return this._seVolume;}
    set seVolume(v){this._seVolume=Math.max(0,Math.min(1,v));}
    get bgmVolume(){return this._bgmVolume;}
    set bgmVolume(v){this._bgmVolume=Math.max(0,Math.min(1,v));if(this.musicGain)this.musicGain.gain.value=this._bgmVolume;if(this.bgm)this.bgm.volume=this._bgmVolume;}
    unlock(){
      this.unlocked=true;
      const Context=this.env.AudioContext||this.env.webkitAudioContext;
      if(!this.context&&Context&&this.env.location?.protocol!=='file:'){
        try{this.context=new Context();}catch{/* HTMLAudio fallback below. */}
      }
      if(this.context){
        this.context.resume().catch(()=>{});
        // A silent buffer started inside this gesture also unlocks older mobile implementations.
        const source=this.context.createBufferSource();source.buffer=this.context.createBuffer(1,1,this.context.sampleRate);source.connect(this.context.destination);source.start();
      }
    }
    buffer(url){
      if(!this.buffers.has(url)){
        const pending=this.env.fetch(url).then(r=>{if(!r.ok)throw new Error('Audio unavailable');return r.arrayBuffer();}).then(bytes=>this.context.decodeAudioData(bytes));
        this.buffers.set(url,pending);pending.catch(()=>{this.buffers.delete(url);});
      }
      return this.buffers.get(url);
    }
    sound(name){
      if(!this.enabled||!this.unlocked)return;
      const now=this.env.performance.now();if(now-(this.lastSound.get(name)??-1000)<65)return;this.lastSound.set(name,now);
      const url=`assets/sounds/se/${name}.wav`;
      if(this.context){
        const generation=this.generation;
        this.buffer(url).then(buffer=>{
          if(!this.enabled||generation!==this.generation||this.voices.size>=24)return;
          // Avoid a delayed hit sound if the first download was slow.
          if(this.env.performance.now()-now>600&&name!=='victory')return;
          const node=this.context.createBufferSource(),gain=this.context.createGain();node.buffer=buffer;gain.gain.value=this.seVolume;node.connect(gain);gain.connect(this.context.destination);
          this.voices.add(node);node.onended=()=>{this.voices.delete(node);node.disconnect();gain.disconnect();};node.start();
        }).catch(()=>{});
      }else{
        if(!this.pool.has(name))this.pool.set(name,Array.from({length:3},()=>new this.env.Audio(url)));
        const audio=this.pool.get(name).find(a=>a.paused||a.ended);if(!audio)return;
        audio.currentTime=0;audio.volume=this.seVolume;audio.play().catch(()=>{});
      }
    }
    stopMusic(){
      this.musicGeneration++;
      if(this.musicNode){this.musicNode.stop();this.musicNode.disconnect();this.musicNode=null;}
      if(this.musicGain){this.musicGain.disconnect();this.musicGain=null;}
      if(this.bgm)this.bgm.pause();
    }
    musicUrl(name){
      if(!this.musicFormat){
        const probe=typeof this.env.Audio==='function'?new this.env.Audio():null;
        this.musicFormat=probe&&typeof probe.canPlayType==='function'&&!probe.canPlayType('audio/ogg; codecs="vorbis"')?'wav':'ogg';
      }
      return `assets/sounds/bgm/${name}.${this.musicFormat}`;
    }
    music(name){
      const changed=name!==this.track;
      if(changed){this.stopMusic();this.track=name;this.bgm=null;}
      if(!name||!this.enabled||!this.unlocked)return;
      const url=this.musicUrl(name);
      if(this.context){
        if(this.musicNode)return;this.context.resume().catch(()=>{});
        const generation=++this.musicGeneration;
        this.buffer(url).catch(error=>{
          // Some browsers advertise OGG for media elements but cannot decode it in Web Audio.
          if(url.endsWith('.ogg')&&this.enabled&&generation===this.musicGeneration)return this.buffer(`assets/sounds/bgm/${name}.wav`);
          throw error;
        }).then(buffer=>{
          if(!this.enabled||generation!==this.musicGeneration||this.track!==name)return;
          const node=this.context.createBufferSource(),gain=this.context.createGain();node.buffer=buffer;node.loop=true;gain.gain.value=this.bgmVolume;node.connect(gain);gain.connect(this.context.destination);this.musicNode=node;this.musicGain=gain;node.start();
        }).catch(()=>{});
      }else{
        if(!this.bgm){
          this.bgm=new this.env.Audio(url);this.bgm.loop=true;this.bgm.preload='none';
          const element=this.bgm,generation=this.musicGeneration;
          element.onerror=()=>{
            if(url.endsWith('.ogg')&&this.enabled&&this.bgm===element&&generation===this.musicGeneration){
              element.onerror=null;element.src=`assets/sounds/bgm/${name}.wav`;element.play().catch(()=>{});
            }
          };
        }
        this.bgm.volume=this.bgmVolume;this.bgm.play().catch(()=>{});
      }
    }
    pause(){
      this.generation++;this.stopMusic();
      for(const node of this.voices)node.stop();this.voices.clear();
      for(const pool of this.pool.values())for(const audio of pool)audio.pause();
    }
    toggle(){this.enabled=!this.enabled;if(!this.enabled)this.pause();else{this.unlock();this.music(this.track);}return this.enabled;}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=PrismAudio;
  else root.PrismAudio=PrismAudio;
})(typeof globalThis!=='undefined'?globalThis:this);
