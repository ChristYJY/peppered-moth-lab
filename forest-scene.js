/* Forest geometry is in world space. Photographs remain reference/texture assets,
   never camera-facing scenery. Moth vertices sample the actual trunk triangles. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const SEGMENTS = 32, RINGS = 24;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const add = (a, b, s = 1) => a.map((x, i) => x + b[i] * s);
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const ident = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const multiply = (a, b) => {
    const r = new Float32Array(16);
    for (let c=0;c<4;c++) for (let y=0;y<4;y++)
      r[c*4+y]=a[y]*b[c*4]+a[4+y]*b[c*4+1]+a[8+y]*b[c*4+2]+a[12+y]*b[c*4+3];
    return r;
  };
  function data() { return { p: [], n: [], uv: [], c: [] }; }
  function vertex(d,p,n,uv,c=[1,1,1]) { d.p.push(...p); d.n.push(...n); d.uv.push(...uv); d.c.push(...c); }
  function triangle(d,a,b,c,color,uvs=[[0,0],[1,0],[.5,1]]) {
    const n=norm(cross(sub(b,a),sub(c,a)));
    [a,b,c].forEach((p,i)=>vertex(d,p,n,uvs[i],color));
  }
  function trunkVertex(u,v,seed) {
    const a=u*TAU;
    const top=clamp((v-.62)/.38,0,1),crown=top*top*(3-2*top);
    const taper=(1.14-.38*v)*(1-.965*crown)+.055*Math.exp(-v*32);
    const radius=taper*(1+.045*Math.sin(a*5+v*9+seed)+.024*Math.sin(a*11-v*16+seed));
    const bend=trunkBend(v,seed);
    return [Math.cos(a)*radius+bend[0],v,Math.sin(a)*radius+bend[1]];
  }
  function trunkBend(v,seed){return [1.12*v*(Math.sin(v*2.6+seed)-Math.sin(seed)),
    .72*v*(Math.sin(v*2.2+seed*.7)-Math.sin(seed*.7))];}
  function trunkData(seed) {
    const d=data();
    const put=(u,v)=>{const p=trunkVertex(u,v,seed);vertex(d,p,norm([Math.cos(u*TAU),.02,Math.sin(u*TAU)]),[u,v]);};
    for(let y=0;y<RINGS;y++)for(let x=0;x<SEGMENTS;x++) {
      const u=x/SEGMENTS,v=y/RINGS,U=(x+1)/SEGMENTS,V=(y+1)/RINGS;
      put(u,v);put(U,v);put(u,V);put(u,V);put(U,v);put(U,V);
    }
    // Closed ends prevent sky showing through when looking along a trunk.
    for(const v of [0,1])for(let x=0;x<SEGMENTS;x++) {
      const a=trunkVertex(x/SEGMENTS,v,seed),b=trunkVertex((x+1)/SEGMENTS,v,seed);
      triangle(d,[0,v,0],a,b,[1,1,1]);
    }
    return d;
  }
  function treeTransform(tree,p) {
    const c=Math.cos(tree.lean),s=Math.sin(tree.lean);
    const x=p[0]*tree.radius,y=p[1]*tree.height;
    return [tree.x+c*x-s*y,y*c+s*x-.12,tree.z+p[2]*tree.radius];
  }
  function trunkCenter(tree,t){const b=trunkBend(t,tree.seed);return treeTransform(tree,[b[0],t,b[1]]);}
  function surface(tree,angle,t,offset=0) {
    // Barycentric interpolation follows exactly the diagonal used by trunkData.
    const u=((angle/TAU)%1+1)%1*SEGMENTS,v=clamp(t,0,.99999)*RINGS;
    const x=Math.floor(u),y=Math.floor(v),a=u-x,b=v-y;
    const A=trunkVertex(x/SEGMENTS,y/RINGS,tree.seed);
    const B=trunkVertex((x+1)/SEGMENTS,y/RINGS,tree.seed);
    const C=trunkVertex(x/SEGMENTS,(y+1)/RINGS,tree.seed);
    const D=trunkVertex((x+1)/SEGMENTS,(y+1)/RINGS,tree.seed);
    const p=a+b<=1?add(add(A,sub(B,A),a),sub(C,A),b):add(add(D,sub(C,D),1-a),sub(B,D),1-b);
    p[0]+=Math.cos(angle)*offset/tree.radius;
    p[2]+=Math.sin(angle)*offset/tree.radius;
    return treeTransform(tree,p);
  }
  function branch(d,a,b,r,color) {
    const axis=norm(sub(b,a));
    const right=norm(cross(axis,Math.abs(axis[1])>.94?[1,0,0]:[0,1,0]));
    const up=cross(axis,right);
    for(let i=0;i<7;i++) {
      const radial=t=>add(right.map(x=>x*Math.cos(t)),up,Math.sin(t));
      const n=radial(i/7*TAU),m=radial((i+1)/7*TAU);
      const p=add(a,n,r),q=add(a,m,r),s=add(b,n,r*.26),t=add(b,m,r*.26);
      triangle(d,p,q,s,color);triangle(d,s,q,t,color);
    }
  }
  function leaf(d,center,length,width,yaw,tilt,color) {
    const axis=[Math.cos(yaw)*Math.cos(tilt),Math.sin(tilt),Math.sin(yaw)*Math.cos(tilt)];
    const right=[-Math.sin(yaw),0,Math.cos(yaw)];
    const ridge=add(center,[0,1,0],width*.06);
    const outline=[[-.5,0],[-.30,.38],[0,.5],[.27,.34],[.5,0],[.27,-.34],[0,-.5],[-.30,-.38]];
    const points=outline.map(([a,b])=>add(add(center,axis,a*length),right,b*width));
    for(let i=0;i<8;i++){
      const j=(i+1)%8,n=norm(cross(sub(points[j],points[i]),sub(ridge,points[i])));
      const tint=i<4?color:color.map(x=>x*.94);
      vertex(d,points[i],n,[outline[i][0]+.5,outline[i][1]+.5],tint);
      vertex(d,points[j],n,[outline[j][0]+.5,outline[j][1]+.5],tint);
      vertex(d,ridge,n,[.5,.5],tint);
    }
  }
  const vertexShader=`
    attribute vec3 aPosition,aNormal,aColor;
    attribute vec2 aUv;
    uniform mat4 uVP,uModel;
    uniform mat3 uNormal;
    varying vec3 vWorld,vNormal,vColor;
    varying vec2 vUv;
    void main(){ vec4 p=uModel*vec4(aPosition,1.0); vWorld=p.xyz;
      vNormal=normalize(uNormal*aNormal);vColor=aColor;vUv=aUv;gl_Position=uVP*p; }
  `;
  const noiseShader=`
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){return .55*noise(p)+.28*noise(p*2.07)+.17*noise(p*4.13);}
  `;
  const fragmentShader=`
    precision highp float;
    uniform vec3 uCamera,uFog;
    uniform float uTheme,uKind,uSeed;
    uniform sampler2D uTexture;
    varying vec3 vWorld,vNormal,vColor;
    varying vec2 vUv;
    ${noiseShader}
    void main(){
      vec3 N=normalize(vNormal),sun=normalize(vec3(-.48,.79,.38));
      float direct=max(dot(N,sun),0.0),hemi=.5+.5*N.y;
      float dapple=smoothstep(.32,.76,fbm(vWorld.xz*.38+vWorld.y*.16));
      vec3 color=vColor;float alpha=1.0;
      if(uKind<.5){
        // Continuous bark detail; no mirrored full-forest photographs on trunks.
        // Both halves are the original bark samples from the lesson document.
        // The pale lower half avoids moths baked into the supplied photograph.
        vec2 tile=fract(vec2(vUv.x*2.4+uSeed*.13,vWorld.y*mix(.85,.43,uTheme)+uSeed*.31));
        vec2 uv=vec2(mix(.035,.525,uTheme)+tile.x*mix(.43,.445,uTheme),
          .035+tile.y*mix(.43,.925,uTheme));
        vec3 detail=texture2D(uTexture,uv).rgb;
        float height0=dot(detail,vec3(.30,.59,.11));
        float bumpX=dot(texture2D(uTexture,uv+vec2(.002,0)).rgb,vec3(.30,.59,.11))-height0;
        float bumpY=dot(texture2D(uTexture,uv+vec2(0,.002)).rgb,vec3(.30,.59,.11))-height0;
        vec3 tangent=normalize(cross(vec3(0,1,0),N));
        N=normalize(N+tangent*bumpX*1.8+normalize(cross(N,tangent))*bumpY*1.8);
        direct=max(dot(N,sun),0.0);
        float birch=noise(vec2(vUv.x*48.0,vWorld.y*23.0)+uSeed);
        float rough=fbm(vec2(vUv.x*34.0,vWorld.y*3.1)+uSeed*3.0);
        vec3 pale=mix(vec3(.91,.90,.85),detail*vec3(1.03,1.02,.98),.71)*(.96+.08*birch);
        float scars=smoothstep(.67,.88,noise(vec2(vUv.x*8.0+uSeed*3.0,vWorld.y*20.0)));
        pale=mix(pale,vec3(.22,.22,.19),scars*.18);
        vec3 dark=detail*(.88+.22*rough)+vec3(.015,.019,.020);
        color=mix(pale,dark,uTheme)*vColor;
        float moss=(1.0-smoothstep(.12,1.8,vWorld.y))*smoothstep(.35,.66,rough);
        color=mix(color,vec3(.19,.25,.10),moss*.52);
        color*=.46+.45*direct+.15*dapple;
      }else if(uKind<1.5){
        float patch=fbm(vWorld.xz*.47),grain=noise(vWorld.xz*39.0);
        float path=1.0-smoothstep(.55,2.7,abs(vWorld.x-sin(vWorld.z*.10)*2.0));
        vec3 moss=mix(vec3(.16,.21,.10),vec3(.30,.36,.15),patch);
        vec3 soil=mix(vec3(.22,.18,.115),vec3(.34,.29,.18),patch);
        color=mix(moss,soil,path*.75+smoothstep(.65,.85,patch)*.2);
        float litter=smoothstep(.81,.94,grain)*noise(vWorld.xz*6.0);
        color=mix(color,vec3(.45,.36,.17),litter*.45);
        color*=.65+.47*dapple; color*=mix(1.0,.71,uTheme);
        color*=.75+.35*noise(vWorld.xz*17.0)+.18*noise(vWorld.xz*83.0);
      }else if(uKind<2.5){
        float diffuse=.54+.32*abs(dot(N,sun))+.22*hemi;
        color*=diffuse*(.79+.31*dapple);
        float midrib=1.0-smoothstep(.006,.020,abs(vUv.y-.5));
        float veins=1.0-smoothstep(.015,.040,abs(fract(vUv.x*7.0-abs(vUv.y-.5)*4.5)-.5));
        color*=.89+.10*midrib+.035*veins+.07*noise(vUv*48.0);
      }else if(uKind<3.5){
        float r=length(vUv*2.0-1.0);
        alpha=(1.0-smoothstep(.08,1.0,r))*.34;
        color=vec3(.035,.046,.025);
      }else if(uKind<4.5){
        vec4 moth=texture2D(uTexture,vUv);
        if(moth.a<.42)discard;
        color=moth.rgb*(.80+.16*direct+.04*dapple);
      }else{
        color*=.61+.35*direct;
      }
      float d=distance(vWorld,uCamera);
      float fog=1.0-exp(-pow(d*.016,1.75));
      fog=clamp(fog+(1.0-smoothstep(0.0,5.5,vWorld.y))*.045*smoothstep(12.0,60.0,d),0.0,.985);
      gl_FragColor=vec4(mix(color,uFog,fog),alpha);
    }
  `;
  class ForestScene {
    constructor(canvas){
      this.canvas=canvas;this.theme='pale';this.trees=[];this.moths=[];this.meshes=[];
      this.camera={position:[0,1.85,4],yaw:0,pitch:.1,fov:58};
      this.gl=canvas.getContext('webgl',{alpha:false,antialias:true,powerPreference:'high-performance'});
      this.supported=!!this.gl;if(!this.gl)return;
      const gl=this.gl;
      this.main=this.program(vertexShader,fragmentShader,['aPosition','aNormal','aColor','aUv'],['uVP','uModel','uNormal','uCamera','uFog','uTheme','uKind','uSeed','uTexture']);
      this.sky=this.program(`attribute vec2 aPosition;varying vec2 vScreen;void main(){vScreen=aPosition;gl_Position=vec4(aPosition,1,1);}`,
        `precision highp float;varying vec2 vScreen;uniform vec3 uForward,uRight,uUp,uFog;uniform vec2 uLens;uniform float uTheme;
        ${noiseShader}
        void main(){vec3 ray=normalize(uForward+uRight*vScreen.x*uLens.x+uUp*vScreen.y*uLens.y);
        vec3 zenith=mix(vec3(.48,.67,.72),vec3(.26,.38,.43),uTheme);
        vec3 sky=mix(uFog,zenith,smoothstep(-.02,.85,ray.y));
        vec3 sun=normalize(vec3(-.48,.79,.38));float glow=pow(max(dot(ray,sun),0.0),18.0);
        float cloud=fbm(ray.xz/max(.18,ray.y+.25)*1.8);
        sky=mix(sky,mix(vec3(.94,.94,.84),vec3(.65,.72,.69),uTheme),smoothstep(.49,.76,cloud)*smoothstep(.08,.8,ray.y)*.45);
        sky+=vec3(.16,.13,.07)*glow*mix(1.0,.4,uTheme);gl_FragColor=vec4(sky,1);}`,
        ['aPosition'],['uForward','uRight','uUp','uFog','uLens','uTheme']);
      this.skyBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.skyBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      this.trunks=[0,1.7,3.4,5.1].map(s=>this.mesh(trunkData(s)));
      const ground=data();triangle(ground,[-130,-.06,-130],[-130,-.06,130],[130,-.06,-130],[1,1,1]);
      triangle(ground,[130,-.06,-130],[-130,-.06,130],[130,-.06,130],[1,1,1]);
      this.ground=this.mesh(ground);this.identity=ident();this.normalIdentity=new Float32Array([1,0,0,0,1,0,0,0,1]);
      this.textureLoads={};
      this.textures={light:this.texture('./assets/moth-light-cutout.png'),dark:this.texture('./assets/moth-dark-cutout.png'),
        bark:this.texture('./assets/bark-clean.png')};
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
      this.animate=this.animate.bind(this);requestAnimationFrame(this.animate);
    }
    program(vs,fs,attributes,uniforms){
      const gl=this.gl,p=gl.createProgram();
      for(const [type,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
        const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
        if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
        gl.attachShader(p,s);gl.deleteShader(s);
      }
      gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
      const out={program:p};for(const k of attributes)out[k]=gl.getAttribLocation(p,k);
      for(const k of uniforms)out[k]=gl.getUniformLocation(p,k);return out;
    }
    mesh(d){
      const gl=this.gl,m={count:d.p.length/3,buffers:[]};
      for(const [key,values] of [['p',d.p],['n',d.n],['uv',d.uv],['c',d.c]]){
        m[key]=gl.createBuffer();m.buffers.push(m[key]);gl.bindBuffer(gl.ARRAY_BUFFER,m[key]);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);
      }return m;
    }
    texture(url){
      const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([120,130,110,url.includes('moth-')?0:255]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      this.textureLoads[url]=new Promise(resolve=>{
        const image=new Image();let attempts=0;
        image.onload=()=>{gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);resolve(true);};
        image.onerror=()=>{if(++attempts<3){window.setTimeout(()=>{image.src=url+'?retry='+attempts;},350);}else resolve(false);};
        image.src=url;
      });
      return t;
    }
    whenMothsReady(){return this.supported?Promise.all(['./assets/moth-light-cutout.png','./assets/moth-dark-cutout.png'].map(url=>this.textureLoads[url])).then(results=>results.every(Boolean)):Promise.resolve(false);}
    direction(){const c=Math.cos(this.camera.pitch);return [Math.sin(this.camera.yaw)*c,Math.sin(this.camera.pitch),-Math.cos(this.camera.yaw)*c];}
    updateViewProjection(){
      const eye=this.camera.position,forward=this.direction(),right=norm(cross(forward,[0,1,0])),up=cross(right,forward);
      this.basis={forward,right,up};const z=forward.map(x=>-x);
      const view=new Float32Array([right[0],up[0],z[0],0,right[1],up[1],z[1],0,right[2],up[2],z[2],0,-dot(right,eye),-dot(up,eye),-dot(z,eye),1]);
      const aspect=this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight),f=1/Math.tan(this.camera.fov*Math.PI/360),near=.06,far=150;
      this.viewProjection=multiply(new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]),view);
      const m=this.viewProjection;
      this.frustum=[0,1,2].flatMap(row=>[1,-1].map(sign=>[m[3]+sign*m[row],m[7]+sign*m[4+row],m[11]+sign*m[8+row],m[15]+sign*m[12+row]]));
    }
    resize(){if(!this.supported)return;const ratio=Math.min(devicePixelRatio||1,1.5),w=Math.round(this.canvas.clientWidth*ratio),h=Math.round(this.canvas.clientHeight*ratio);
      if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.gl.viewport(0,0,w,h);}
    randomizeScene(theme,moths){
      if(!this.supported)return;
      const buildStart=performance.now();
      const reuse=this.theme===theme&&this.trees.length>0&&this.moths===moths;
      const dispose=reuse?this.targetMeshes||[]:this.meshes;
      for(const mesh of dispose)for(const b of mesh.buffers)this.gl.deleteBuffer(b);
      this.meshes=reuse?[...this.forestMeshes]:[];this.targetMeshes=[];
      this.theme=theme;this.moths=moths;this.camera={position:[0,1.85,4],yaw:0,pitch:.105,fov:58};
      const dark=theme==='dark';let anchorIndex=0;
      if(reuse){
        // New viewpoint after each capture; reuse static geometry to avoid a long rebuild hitch.
        const candidates=this.trees.map((t,i)=>({t,i})).filter(({t})=>Math.abs(t.x)<10&&t.z>-13&&t.z<10);
        for(let attempt=0;attempt<80;attempt++){
          const {t,i}=candidates[Math.floor(rand(0,candidates.length))],yaw=rand(-Math.PI,Math.PI);
          const eye=[t.x-Math.sin(yaw)*10.6,1.85,t.z+Math.cos(yaw)*10.6];
          if(Math.abs(eye[0])>14||eye[2]<-21||eye[2]>22||this.trees.some(other=>Math.hypot(eye[0]-other.x,eye[2]-other.z)<other.radius+2.1))continue;
          const vx=t.x-eye[0],vz=t.z-eye[2],length2=vx*vx+vz*vz;
          if(this.trees.some(other=>{
            if(other===t)return false;
            const f=clamp(((other.x-eye[0])*vx+(other.z-eye[2])*vz)/length2,0,1);
            return f>.02&&f<.97&&Math.hypot(eye[0]+f*vx-other.x,eye[2]+f*vz-other.z)<other.radius*1.25+.35;
          }))continue;
          this.camera.position=eye;this.camera.yaw=yaw;anchorIndex=i;break;
        }
      }else{
      this.trees=[];
      const plant=(x,z,r,height,lean)=>{
        if(this.trees.some(t=>Math.hypot(t.x-x,t.z-z)<(t.radius+r)*1.3+1.7+Math.abs(t.lean-lean)*22))return false;
        const variant=Math.floor(rand(0,4)),c=Math.cos(lean),s=Math.sin(lean);
        const tree={x,z,radius:r,height,lean,variant,seed:[0,1.7,3.4,5.1][variant],shade:rand(.92,1.04)};
        tree.model=new Float32Array([c*r,s*r,0,0,-s*height,c*height,0,0,0,0,r,0,x,-.12,z,1]);
        tree.normal=new Float32Array([c/r,s/r,0,-s/height,c/height,0,0,0,1/r]);
        this.trees.push(tree);return true;
      };
      plant(.15,-6.6,.42,23,.006);
      for(const [x,z,r] of [[-4.4,-2.5,.48],[4.8,-4.8,.52],[-2.8,-13,.39],[3.2,-15,.44],[-8,-11,.43],[8,-10,.4]])
        plant(x+rand(-.22,.22),z,r,rand(21,27),rand(-.022,.022));
      for(let i=0;i<155;i++)for(let attempt=0;attempt<35;attempt++){
        const a=rand(0,TAU),distance=i<70?rand(10,35):rand(35,74),x=Math.cos(a)*distance,z=4+Math.sin(a)*distance;
        if(plant(x,z,rand(.21,.49),rand(18,29),rand(-.038,.038)))break;
      }
      const wood=data(),foliage=data(),understory=data(),shadows=data();
      const canopyColor=(brightness)=>dark?[.115*brightness,.205*brightness,.115*brightness]:[.225*brightness,.32*brightness,.105*brightness];
      this.trees.forEach((tree,index)=>{
        const a=tree.x,z=tree.z,r=tree.radius;
        const shadow=(sx,sz,rx,rz)=>{
          const y=-.046;triangle(shadows,[sx-rx,y,sz-rz],[sx-rx,y,sz+rz],[sx+rx,y,sz-rz],[1,1,1],[[0,0],[0,1],[1,0]]);
          triangle(shadows,[sx+rx,y,sz-rz],[sx-rx,y,sz+rz],[sx+rx,y,sz+rz],[1,1,1],[[1,0],[0,1],[1,1]]);
        };shadow(a,z,r*2.8,r*2.8);shadow(a+1.5,z-1.1,r*3.5,3.5);
        const color=dark?[.115,.12,.105]:[.31,.32,.24];
        for(let root=0;root<5;root++){
          const angle=root/5*TAU+tree.seed,tip=[a+Math.cos(angle)*r*2.2,-.09,z+Math.sin(angle)*r*2.2];
          branch(wood,[a,.20,z],tip,r*.20,dark?[.085,.096,.080]:[.20,.22,.15]);
        }
        for(let j=0;j<(index<35?5:index<75?3:2);j++){
          const yaw=rand(0,TAU),y=j<(index<35?2:1)?rand(7.8,11.5):rand(tree.height*.56,tree.height*.90),start=surface(tree,yaw,y/tree.height,-r*.10);
          const length=rand(2.1,4.0)*(1-clamp((y/tree.height-.7)*1.6,0,.4)),tip=add(start,[Math.cos(yaw),rand(.35,.7),Math.sin(yaw)],length);
          // Keep separate crowns away from other trunks; branch junctions meet their host.
          const safe=!this.trees.some(other=>other!==tree&&[.25,.5,.75,1].some(t=>{const p=add(start,sub(tip,start),t);return Math.hypot(p[0]-(other.x-Math.sin(other.lean)*p[1]),p[2]-other.z)<other.radius*1.2+.22;}));
          if(!safe)continue;
          branch(wood,start,tip,r*rand(.13,.19),color);
          const cluster=(center,size,count)=>{
            for(let k=0;k<Math.ceil(count/10);k++){
              const angle=k/Math.ceil(count/10)*TAU+rand(-.3,.3),axis=[Math.cos(angle),rand(-.35,.6),Math.sin(angle)];
              const end=add(center,axis,size*rand(.7,1.1));branch(wood,center,end,.013,color);
              for(let node=1;node<=10;node++){
                const side=node%2?1:-1,p=add(center,sub(end,center),(node+rand(-.3,.3))/10),yaw=angle+side*rand(.6,1.3);
                const length=rand(.22,.36);p[0]+=Math.cos(yaw)*length*.35;p[2]+=Math.sin(yaw)*length*.35;
                leaf(foliage,p,length,length*.60,yaw,rand(-.65,.65),canopyColor(rand(.72,1.40)));
              }
            }
          };
          cluster(tip,rand(1.10,1.75),index<35?60:index<75?35:15);
          for(let fork=0;fork<2;fork++){
            const root=add(start,sub(tip,start),.6),side=yaw+(fork?-.65:.65),end=add(root,[Math.cos(side),.45,Math.sin(side)],length*.8);
            branch(wood,root,end,r*.045,color);cluster(end,1.10,index<35?35:index<75?20:10);
          }
        }
      });
      // Low saplings form a distant green understory, never photographic billboards.
      for(let i=0;i<65;i++){
        const angle=rand(0,TAU),distance=rand(30,63),x=Math.cos(angle)*distance,z=4+Math.sin(angle)*distance;
        if(this.trees.some(t=>Math.hypot(x-t.x,z-t.z)<2))continue;
        const h=rand(1.8,4.2),center=[x,h*.62,z];
        branch(wood,[x,0,z],[x,h,z],.042,[.14,.17,.09]);
        for(let twig=0;twig<9;twig++){
          const yaw=twig/9*TAU,end=add(center,[Math.cos(yaw),rand(-.2,.7),Math.sin(yaw)],rand(.8,1.8));
          branch(wood,center,end,.013,[.17,.21,.10]);
          for(let n=0;n<9;n++){
            const p=add(center,sub(end,center),(n+1)/9),side=n%2?1:-1;
            leaf(foliage,p,.32,.22,yaw+side*.8,rand(-.4,.4),canopyColor(rand(.7,1.3)));
          }
        }
      }
      // Ferns and grass stay near the ground, leaving the experimental targets clear.
      for(let i=0;i<230;i++){
        const angle=rand(0,TAU),distance=rand(2.5,34),x=Math.cos(angle)*distance,z=4+Math.sin(angle)*distance;
        if(Math.abs(x-Math.sin(z*.1)*2)<1.35||Math.hypot(x,z-4)<2.0)continue;
        if(this.trees.some(t=>Math.hypot(x-t.x,z-t.z)<t.radius*1.3+.2))continue;
        const height=rand(.18,.56);
        for(let frond=0;frond<5;frond++){
          const yaw=frond/5*TAU+rand(-.2,.2),axis=[Math.cos(yaw),0,Math.sin(yaw)];
          for(let n=1;n<7;n++){
            const t=n/7,p=add([x,.015,z],axis,t*height),h=Math.sin(t*Math.PI*.8)*height*.7;p[1]+=h;
            const width=(1-t)*height*.55;
            leaf(understory,p,width,width*.24,yaw+1.0,-.15,canopyColor(rand(.8,1.25)));
            leaf(understory,p,width,width*.24,yaw-1.0,-.15,canopyColor(rand(.8,1.25)));
          }
        }
      }
      // Short grass blades break up the ground plane without transparent cards.
      for(let i=0;i<740;i++){
        const angle=rand(0,TAU),distance=rand(2.0,42),x=Math.cos(angle)*distance,z=4+Math.sin(angle)*distance;
        if(Math.abs(x-Math.sin(z*.1)*2)<1.3||this.trees.some(t=>Math.hypot(x-t.x,z-t.z)<t.radius*1.25))continue;
        for(let j=0;j<7;j++){
          const yaw=rand(0,TAU),h=rand(.08,.30),base=[x+rand(-.18,.18),-.048,z+rand(-.18,.18)];
          const w=.014,tip=add(base,[Math.cos(yaw)*.08,h,Math.sin(yaw)*.08]);
          triangle(understory,add(base,[Math.sin(yaw)*w,0,-Math.cos(yaw)*w]),add(base,[-Math.sin(yaw)*w,0,Math.cos(yaw)*w]),tip,canopyColor(rand(.7,1.3)));
        }
      }
      this.wood=this.mesh(wood);this.foliage=this.mesh(foliage);this.understory=this.mesh(understory);this.shadows=this.mesh(shadows);
      this.meshes.push(this.wood,this.foliage,this.understory,this.shadows);
      this.forestMeshes=[...this.meshes];
      }
      const living=moths.filter(m=>m.alive),anchor=living[Math.floor(rand(0,living.length))];
      const eye=this.camera.position,yaw=this.camera.yaw;
      const eligible=this.trees.map((t,i)=>({t,i})).filter(({t,i})=>{
        const dx=t.x-eye[0],dz=t.z-eye[2],ahead=dx*Math.sin(yaw)-dz*Math.cos(yaw),side=dx*Math.cos(yaw)+dz*Math.sin(yaw);
        return i!==anchorIndex&&ahead>3&&ahead<27&&Math.abs(side)<ahead*.78;
      });
      if(!eligible.length)eligible.push({t:this.trees[anchorIndex],i:anchorIndex});
      for(let i=eligible.length-1;i>0;i--){const j=Math.floor(rand(0,i+1));[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}
      let cursor=0;const occupied=new Map();
      living.forEach(moth=>{
        const target=moth===anchor?{t:this.trees[anchorIndex],i:anchorIndex}:eligible[cursor++%eligible.length];
        const tree=target.t,slot=occupied.get(target.i)||0;occupied.set(target.i,slot+1);
        const y=moth===anchor?2.95:1.8+slot*.9+rand(0,.3);
        const angle=Math.atan2(this.camera.position[2]-tree.z,this.camera.position[0]-tree.x)+rand(-.24,.24);
        moth.treeIndex=target.i;moth.scale=rand(.59,.75);moth.width=Math.min(.64*moth.scale*2.06,tree.radius*2.15);
        const h=moth.width/2.06,rotation=rand(-.12,.12),cs=Math.cos(rotation),sn=Math.sin(rotation);
        moth.world=surface(tree,angle,y/tree.height,.018);
        moth.normal=norm([Math.cos(angle)*Math.cos(tree.lean),Math.cos(angle)*Math.sin(tree.lean),Math.sin(angle)]);
        const d=data(),put=(u,v)=>{
          const x=(u-.5)*moth.width,z=(v-.5)*h,arc=(x*cs-z*sn)/(tree.radius*(1.14-.38*y/tree.height));
          const height=y+x*sn+z*cs;
          vertex(d,surface(tree,angle+arc,height/tree.height,.018),moth.normal,[u,v]);
        };
        for(let row=0;row<8;row++)for(let col=0;col<32;col++){
          const u=col/32,U=(col+1)/32,v=row/8,V=(row+1)/8;
          put(u,v);put(U,v);put(u,V);put(u,V);put(U,v);put(U,V);
        }
        moth.mesh=this.mesh(d);this.meshes.push(moth.mesh);this.targetMeshes.push(moth.mesh);
      });
      this.resize();this.updateViewProjection();
      this.canvas.dataset.sceneBuildMs=String(Math.round(performance.now()-buildStart));
      this.canvas.dataset.sceneTriangles=String(Math.round(this.meshes.reduce((n,m)=>n+m.count/3,0)+this.trees.length*this.trunks[0].count/3));
    }
    rotate(dx,dy){this.camera.yaw=((this.camera.yaw-dx*.0031+Math.PI)%TAU+TAU)%TAU-Math.PI;this.camera.pitch=clamp(this.camera.pitch-dy*.0027,-.72,1.18);}
    move(forward,strafe){
      const steps=Math.max(1,Math.ceil(Math.hypot(forward,strafe)/.16));
      for(let s=0;s<steps;s++){
        let x=clamp(this.camera.position[0]+(Math.sin(this.camera.yaw)*forward+Math.cos(this.camera.yaw)*strafe)/steps,-16,16);
        let z=clamp(this.camera.position[2]+(-Math.cos(this.camera.yaw)*forward+Math.sin(this.camera.yaw)*strafe)/steps,-23,24);
        for(let pass=0;pass<3;pass++)for(const tree of this.trees){
          const center=trunkCenter(tree,(this.camera.position[1]+.12)/tree.height);
          const dx=x-center[0],dz=z-center[2],r=tree.radius*1.22+.44,dist=Math.hypot(dx,dz);
          if(dist<r){x=center[0]+(dist>.0001?dx/dist:1)*r;z=center[2]+(dist>.0001?dz/dist:0)*r;}
        }
        this.camera.position[0]=clamp(x,-16,16);this.camera.position[2]=clamp(z,-23,24);
      }
    }
    zoom(delta){this.camera.fov=clamp(this.camera.fov+delta,38,72);}
    draw(mesh,kind,model=this.identity,normal=this.normalIdentity,seed=0){
      if(!mesh||!mesh.count)return;const gl=this.gl,p=this.main;
      for(const [key,attribute,size] of [['p','aPosition',3],['n','aNormal',3],['uv','aUv',2],['c','aColor',3]]){
        gl.bindBuffer(gl.ARRAY_BUFFER,mesh[key]);gl.enableVertexAttribArray(p[attribute]);gl.vertexAttribPointer(p[attribute],size,gl.FLOAT,false,0,0);
      }
      gl.uniformMatrix4fv(p.uModel,false,model);gl.uniformMatrix3fv(p.uNormal,false,normal);
      gl.uniform1f(p.uKind,kind);gl.uniform1f(p.uSeed,seed);gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    }
    render(){
      if(!this.supported||!this.canvas.clientWidth||!this.canvas.clientHeight)return;
      this.resize();this.updateViewProjection();const gl=this.gl,dark=this.theme==='dark',fog=dark?[.43,.51,.49]:[.72,.77,.68];
      gl.depthMask(true);gl.clearColor(...fog,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.useProgram(this.sky.program);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.skyBuffer);gl.enableVertexAttribArray(this.sky.aPosition);gl.vertexAttribPointer(this.sky.aPosition,2,gl.FLOAT,false,0,0);
      for(const [key,value] of [['uForward',this.basis.forward],['uRight',this.basis.right],['uUp',this.basis.up],['uFog',fog]])gl.uniform3fv(this.sky[key],value);
      const lens=Math.tan(this.camera.fov*Math.PI/360);gl.uniform2f(this.sky.uLens,lens*this.canvas.clientWidth/this.canvas.clientHeight,lens);gl.uniform1f(this.sky.uTheme,dark?1:0);gl.drawArrays(gl.TRIANGLES,0,3);
      gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.useProgram(this.main.program);
      gl.uniformMatrix4fv(this.main.uVP,false,this.viewProjection);gl.uniform3fv(this.main.uCamera,this.camera.position);
      gl.uniform3fv(this.main.uFog,fog);gl.uniform1f(this.main.uTheme,dark?1:0);gl.uniform1i(this.main.uTexture,0);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures.bark);
      this.draw(this.ground,1);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);this.draw(this.shadows,3);gl.depthMask(true);gl.disable(gl.BLEND);
      for(const tree of this.trees){
        const center=[tree.x-Math.sin(tree.lean)*tree.height*.5,tree.height*.5,tree.z];
        const ext=[tree.radius*1.3+Math.abs(Math.sin(tree.lean))*tree.height*.5+.7,tree.height*.5+.3,tree.radius*1.3+.5];
        if(this.frustum.some(p=>dot(p,center)+p[3]+Math.abs(p[0])*ext[0]+Math.abs(p[1])*ext[1]+Math.abs(p[2])*ext[2]<0))continue;
        this.draw(this.trunks[tree.variant],0,tree.model,tree.normal,tree.seed+tree.x*.37+tree.z*.13);
      }
      this.draw(this.wood,5);this.draw(this.foliage,2);this.draw(this.understory,2);
      // Alpha-tested moths write depth just like bark and leaves; no transparent sorting artifacts.
      for(const moth of this.moths)if(moth.alive&&moth.mesh){gl.bindTexture(gl.TEXTURE_2D,this.textures[moth.type]);this.draw(moth.mesh,4);}
    }
    animate(now){this.render();
      if(this.canvas.clientWidth&&this.canvas.clientHeight){
        if(!this.frameStart){this.frameStart=now;this.frameCount=0;}
        if(++this.frameCount>=90){this.canvas.dataset.renderFps=String(Math.round(this.frameCount*1000/(now-this.frameStart)));this.frameStart=now;this.frameCount=0;}
      }else{this.frameStart=0;}
      requestAnimationFrame(this.animate);
    }
    project(world){
      const m=this.viewProjection,[x,y,z]=world,w=m[3]*x+m[7]*y+m[11]*z+m[15];if(w<=0)return null;
      const nx=(m[0]*x+m[4]*y+m[8]*z+m[12])/w,ny=(m[1]*x+m[5]*y+m[9]*z+m[13])/w,nz=(m[2]*x+m[6]*y+m[10]*z+m[14])/w;
      if(nz<-1||nz>1||Math.abs(nx)>1.18||Math.abs(ny)>1.18)return null;
      return {x:(nx*.5+.5)*this.canvas.clientWidth,y:(.5-ny*.5)*this.canvas.clientHeight,depth:nz};
    }
    mothVisible(moth){
      const eye=this.camera.position;if(dot(moth.normal,sub(eye,moth.world))<=.01)return false;
      return !this.trees.some((tree,index)=>{
        if(index===moth.treeIndex)return false;
        const local=p=>{const x=p[0]-tree.x,y=p[1]+.12;return [x*Math.cos(tree.lean)+y*Math.sin(tree.lean),-x*Math.sin(tree.lean)+y*Math.cos(tree.lean),p[2]-tree.z];};
        const a=local(eye),b=local(moth.world),ray=sub(b,a),den=ray[0]*ray[0]+ray[2]*ray[2];if(den<.00001)return false;
        const t=clamp(-(a[0]*ray[0]+a[2]*ray[2])/den,0,1),y=a[1]+ray[1]*t;
        if(t<=.001||t>=.997||y<0||y>tree.height)return false;
        const radius=tree.radius*(1.18-.38*y/tree.height);
        const bend=trunkBend(y/tree.height,tree.seed);
        return Math.hypot(a[0]+ray[0]*t-bend[0]*tree.radius,a[2]+ray[2]*t-bend[1]*tree.radius)<radius;
      });
    }
    nearestMoth(moths){return moths.filter(m=>m.alive&&m.world&&this.mothVisible(m)).map(moth=>{const point=this.project(moth.world);return point?{moth,point,distance:Math.hypot(point.x-this.canvas.clientWidth/2,point.y-this.canvas.clientHeight/2)}:null;}).filter(Boolean).sort((a,b)=>a.distance-b.distance)[0]||null;}
  }
  window.ForestScene=ForestScene;
})();

