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
  function trunkData(seed,segments=SEGMENTS,rings=RINGS) {
    const d=data();
    const put=(u,v)=>{const p=trunkVertex(u,v,seed);vertex(d,p,norm([Math.cos(u*TAU),.02,Math.sin(u*TAU)]),[u,v]);};
    for(let y=0;y<rings;y++)for(let x=0;x<segments;x++) {
      const u=x/segments,v=y/rings,U=(x+1)/segments,V=(y+1)/rings;
      put(u,v);put(U,v);put(u,V);put(u,V);put(U,v);put(U,V);
    }
    // Closed ends prevent sky showing through when looking along a trunk.
    for(const v of [0,1])for(let x=0;x<segments;x++) {
      const a=trunkVertex(x/segments,v,seed),b=trunkVertex((x+1)/segments,v,seed);
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
  const trunkGrids=new Map();
  function trunkGrid(seed){
    if(!trunkGrids.has(seed)){
      const grid=[];
      for(let y=0;y<=RINGS;y++)for(let x=0;x<=SEGMENTS;x++)grid.push(trunkVertex(x/SEGMENTS,y/RINGS,seed));
      trunkGrids.set(seed,grid);
    }
    return trunkGrids.get(seed);
  }
  function surface(tree,angle,t,offset=0) {
    // Barycentric interpolation follows exactly the diagonal used by trunkData.
    const u=((angle/TAU)%1+1)%1*SEGMENTS,v=clamp(t,0,.99999)*RINGS;
    const x=Math.floor(u),y=Math.floor(v),a=u-x,b=v-y;
    const grid=trunkGrid(tree.seed),first=y*(SEGMENTS+1)+x;
    const A=grid[first],B=grid[first+1],C=grid[first+SEGMENTS+1],D=grid[first+SEGMENTS+2];
    const p=[0,0,0];
    for(let i=0;i<3;i++)p[i]=a+b<=1?A[i]+(B[i]-A[i])*a+(C[i]-A[i])*b:D[i]+(C[i]-D[i])*(1-a)+(B[i]-D[i])*(1-b);
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
      float dapple=smoothstep(.32,.76,noise(vWorld.xz*.38+vWorld.y*.16));
      float surfaceLight=(.82+.18*direct)*(.97+.03*dapple);
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
        float rough=noise(vec2(vUv.x*34.0,vWorld.y*3.1)+uSeed*3.0);
        // Calibrated to the supplied moth photos; bark and moths share the same light.
        vec3 pale=mix(detail,vec3(height0),.88)*.80+vec3(.18);
        vec3 dark=detail*.75;
        color=mix(pale,dark,uTheme)*vColor;
        float moss=(1.0-smoothstep(.12,1.8,vWorld.y))*smoothstep(.35,.66,rough);
        color=mix(color,vec3(.19,.25,.10),moss*.52);
        color*=surfaceLight;
      }else if(uKind<1.5){
        float patch=noise(vWorld.xz*.47),grain=noise(vWorld.xz*39.0);
        float path=1.0-smoothstep(.55,2.7,abs(vWorld.x-sin(vWorld.z*.10)*2.0));
        vec3 moss=mix(vec3(.16,.21,.10),vec3(.30,.36,.15),patch);
        vec3 soil=mix(vec3(.22,.18,.115),vec3(.34,.29,.18),patch);
        color=mix(moss,soil,path*.75+smoothstep(.65,.85,patch)*.2);
        float litter=smoothstep(.81,.94,grain)*noise(vWorld.xz*6.0);
        color=mix(color,vec3(.45,.36,.17),litter*.45);
        color*=.65+.47*dapple; color*=mix(1.0,.71,uTheme);
        color*=.85+.25*grain;
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
        color=moth.rgb*surfaceLight;
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
      this.active=true;
      this.renderScale=Math.min(typeof devicePixelRatio==='number'?devicePixelRatio:1,window.matchMedia&&window.matchMedia('(pointer: coarse)').matches?1:1.25);
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
      this.farTrunks=[0,1.7,3.4,5.1].map(s=>this.mesh(trunkData(s,12,12)));
      const ground=data();triangle(ground,[-130,-.06,-130],[-130,-.06,130],[130,-.06,-130],[1,1,1]);
      triangle(ground,[130,-.06,-130],[-130,-.06,130],[130,-.06,130],[1,1,1]);
      this.ground=this.mesh(ground);this.identity=ident();this.normalIdentity=new Float32Array([1,0,0,0,1,0,0,0,1]);
      this.textureLoads={};
      this.mothTextureUrls={light:'./assets/moth-light-game.png',dark:'./assets/moth-dark-game.png'};
      this.textures={light:this.texture(this.mothTextureUrls.light),dark:this.texture(this.mothTextureUrls.dark),
        bark:this.texture('./assets/bark-game.jpg')};
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
    chunkMeshes(source,kind){
      const cells=new Map();
      for(let p=0;p<source.p.length;p+=9){
        const x=(source.p[p]+source.p[p+3]+source.p[p+6])/3,z=(source.p[p+2]+source.p[p+5]+source.p[p+8])/3;
        const key=Math.floor(x/18)+','+Math.floor(z/18);
        let cell=cells.get(key);
        if(!cell){cell={data:data(),min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};cells.set(key,cell);}
        const first=p/3;
        for(const [attribute,size] of [['p',3],['n',3],['uv',2],['c',3]])
          for(let i=first*size;i<(first+3)*size;i++)cell.data[attribute].push(source[attribute][i]);
        for(let v=p;v<p+9;v+=3)for(let axis=0;axis<3;axis++){
          cell.min[axis]=Math.min(cell.min[axis],source.p[v+axis]);cell.max[axis]=Math.max(cell.max[axis],source.p[v+axis]);
        }
      }
      return [...cells.values()].map(cell=>({kind,mesh:this.mesh(cell.data),center:cell.min.map((v,i)=>(v+cell.max[i])/2),extent:cell.min.map((v,i)=>(cell.max[i]-v)/2)}));
    }
    inFrustum(center,extent){return !this.frustum.some(p=>dot(p,center)+p[3]+Math.abs(p[0])*extent[0]+Math.abs(p[1])*extent[1]+Math.abs(p[2])*extent[2]<0);}
    texture(url){
      const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([120,130,110,url.includes('moth-')?0:255]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      this.textureLoads[url]=new Promise(resolve=>{
        let image,timeout,attempts=0,finished=false;
        const fail=()=>{
          if(finished)return;
          window.clearTimeout(timeout);image.onload=image.onerror=null;
          if(attempts<2)window.setTimeout(load,300);
          else{finished=true;resolve(false);}
        };
        const load=()=>{
          if(finished)return;
          attempts+=1;image=new Image();
          image.onload=()=>{
            if(finished)return;
            window.clearTimeout(timeout);
            try{gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
              gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);finished=true;resolve(true);}
            catch(_){fail();}
          };
          image.onerror=fail;
          timeout=window.setTimeout(fail,12000);
          image.src=url+(attempts>1?'?retry='+attempts:'');
        };
        load();
      });
      return t;
    }
    whenMothsReady(){return this.supported?Promise.all(Object.values(this.mothTextureUrls).map(url=>this.textureLoads[url])).then(results=>results.every(Boolean)):Promise.resolve(false);}
    reloadMoths(){
      if(!this.supported)return;
      for(const [type,url] of Object.entries(this.mothTextureUrls)){
        this.gl.deleteTexture(this.textures[type]);
        this.textures[type]=this.texture(url);
      }
    }
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
    resize(){if(!this.supported)return;const ratio=Math.min(this.renderScale,Math.sqrt(1200000/Math.max(1,this.canvas.clientWidth*this.canvas.clientHeight))),w=Math.round(this.canvas.clientWidth*ratio),h=Math.round(this.canvas.clientHeight*ratio);
      if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.gl.viewport(0,0,w,h);}
    randomizeScene(theme,moths){
      if(!this.supported)return;
      const buildStart=performance.now();
      const reuse=this.theme===theme&&this.trees.length>0&&this.moths===moths;
      const dispose=reuse?this.targetMeshes||[]:this.meshes;
      for(const mesh of dispose)for(const b of mesh.buffers)this.gl.deleteBuffer(b);
      this.meshes=reuse?[...this.forestMeshes]:[];this.targetMeshes=[];
      this.theme=theme;this.moths=moths;
      if(!reuse)this.camera={position:[0,1.85,4],yaw:0,pitch:.045,fov:58};
      const dark=theme==='dark';
      if(reuse){
        // Change the surroundings while preserving the student's viewing direction.
        const previous=[...this.camera.position];
        for(let attempt=0;attempt<80;attempt++){
          const angle=rand(0,TAU),step=rand(2.5,5.0),eye=[previous[0]+Math.cos(angle)*step,1.85,previous[2]+Math.sin(angle)*step];
          if(Math.abs(eye[0])>12||eye[2]<-14||eye[2]>18||this.trees.some(other=>Math.hypot(eye[0]-other.x,eye[2]-other.z)<other.radius+1.6))continue;
          this.camera.position=eye;break;
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
      // Place the initial camera inside a clearing, with trunks on all sides.
      for(const [x,z,r] of [[-6.2,5.8,.44],[6.0,6.8,.47],[-2.7,11.7,.38],[3.5,12.4,.42]])
        plant(x+rand(-.18,.18),z,r,rand(21,27),rand(-.022,.022));
      for(let i=0;i<99;i++)for(let attempt=0;attempt<35;attempt++){
        const a=rand(0,TAU),distance=i<58?rand(10,34):rand(34,68),x=Math.cos(a)*distance,z=4+Math.sin(a)*distance;
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
          cluster(tip,rand(1.10,1.75),index<30?35:index<65?20:10);
          for(let fork=0;fork<2;fork++){
            const root=add(start,sub(tip,start),.6),side=yaw+(fork?-.65:.65),end=add(root,[Math.cos(side),.45,Math.sin(side)],length*.8);
            branch(wood,root,end,r*.045,color);cluster(end,1.10,index<30?20:10);
          }
        }
      });
      // Low saplings form a distant green understory, never photographic billboards.
      for(let i=0;i<26;i++){
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
      for(let i=0;i<85;i++){
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
      for(let i=0;i<260;i++){
        const angle=rand(0,TAU),distance=rand(2.0,42),x=Math.cos(angle)*distance,z=4+Math.sin(angle)*distance;
        if(Math.abs(x-Math.sin(z*.1)*2)<1.3||this.trees.some(t=>Math.hypot(x-t.x,z-t.z)<t.radius*1.25))continue;
        for(let j=0;j<7;j++){
          const yaw=rand(0,TAU),h=rand(.08,.30),base=[x+rand(-.18,.18),-.048,z+rand(-.18,.18)];
          const w=.014,tip=add(base,[Math.cos(yaw)*.08,h,Math.sin(yaw)*.08]);
          triangle(understory,add(base,[Math.sin(yaw)*w,0,-Math.cos(yaw)*w]),add(base,[-Math.sin(yaw)*w,0,Math.cos(yaw)*w]),tip,canopyColor(rand(.7,1.3)));
        }
      }
      this.decorMeshes=[...this.chunkMeshes(wood,5),...this.chunkMeshes(foliage,2),...this.chunkMeshes(understory,2)];
      this.shadows=this.mesh(shadows);
      this.meshes.push(...this.decorMeshes.map(chunk=>chunk.mesh),this.shadows);
      this.forestMeshes=[...this.meshes];
      }
      this.resize();this.updateViewProjection();
      const living=moths.filter(m=>m.alive),eye=this.camera.position;
      for(let i=living.length-1;i>0;i--){const j=Math.floor(rand(0,i+1));[living[i],living[j]]=[living[j],living[i]];}
      const eligible=this.trees.map((t,i)=>({t,i,distance:Math.hypot(t.x-eye[0],t.z-eye[2])})).filter(target=>target.distance>3&&target.distance<34);
      const sectors=Array.from({length:8},()=>[]),cursors=Array(8).fill(0),occupied=new Map();
      for(const target of eligible){
        const angle=(Math.atan2(target.t.z-eye[2],target.t.x-eye[0])+TAU)%TAU;
        sectors[Math.floor(angle/TAU*8)].push(target);
      }
      sectors.forEach(sector=>sector.sort((a,b)=>a.distance-b.distance));
      const groups={light:data(),dark:data()},records={light:[],dark:[]};
      moths.forEach(moth=>{moth.batch=null;});
      living.forEach((moth,index)=>{
        const sector=index%8,choices=sectors[sector].length?sectors[sector]:eligible;
        const target=choices[cursors[sector]++%choices.length];
        const tree=target.t,slot=occupied.get(target.i)||0;occupied.set(target.i,slot+1);
        let y=1.12+(slot%5)*.53+rand(0,.12);
        let angle=Math.atan2(eye[2]-tree.z,eye[0]-tree.x)+rand(-.20,.20);
        moth.treeIndex=target.i;moth.scale=rand(.47,.58);moth.width=Math.min(.50*moth.scale*2.06,tree.radius*1.2);
        // Leave the new aiming circle empty. Students must observe and aim again.
        const clearRadius=Math.max(56,Math.min(this.canvas.clientWidth,this.canvas.clientHeight)*.08);
        for(let attempt=0;attempt<12;attempt++){
          const point=this.project(surface(tree,angle,y/tree.height,.018));
          if(!point||Math.hypot(point.x-this.canvas.clientWidth/2,point.y-this.canvas.clientHeight/2)>clearRadius)break;
          y=attempt<10?rand(1.0,3.9):(this.camera.pitch>=0?.85:4.5);
          angle=Math.atan2(eye[2]-tree.z,eye[0]-tree.x)+rand(-.25,.25);
        }
        const h=moth.width/2.06,rotation=rand(-.12,.12),cs=Math.cos(rotation),sn=Math.sin(rotation);
        moth.world=surface(tree,angle,y/tree.height,.018);
        moth.normal=norm([Math.cos(angle)*Math.cos(tree.lean),Math.cos(angle)*Math.sin(tree.lean),Math.sin(angle)]);
        const d=data(),put=(u,v)=>{
          const x=(u-.5)*moth.width,z=(v-.5)*h,arc=(x*cs-z*sn)/(tree.radius*(1.14-.38*y/tree.height));
          const height=y+x*sn+z*cs;
          vertex(d,surface(tree,angle+arc,height/tree.height,.018),moth.normal,[u,v]);
        };
        for(let row=0;row<3;row++)for(let col=0;col<16;col++){
          const u=col/16,U=(col+1)/16,v=row/3,V=(row+1)/3;
          put(u,v);put(U,v);put(u,V);put(u,V);put(U,v);put(U,V);
        }
        const group=groups[moth.type],start=group.p.length/3;
        for(const key of ['p','n','uv','c'])group[key].push(...d[key]);
        records[moth.type].push({moth,start,count:d.p.length/3});
      });
      this.mothBatches=[];
      for(const type of ['light','dark']){
        const mesh=this.mesh(groups[type]);this.meshes.push(mesh);this.targetMeshes.push(mesh);this.mothBatches.push({type,mesh});
        records[type].forEach(({moth,start,count})=>{moth.batch={mesh,start,count};});
      }
      this.resize();this.updateViewProjection();
      this.canvas.dataset.sceneBuildMs=String(Math.round(performance.now()-buildStart));
      this.canvas.dataset.sceneTriangles=String(Math.round(this.meshes.reduce((n,m)=>n+m.count/3,0)+this.trees.reduce((n,t)=>n+(Math.hypot(t.x-eye[0],t.z-eye[2])<34?this.trunks[0]:this.farTrunks[0]).count/3,0)));
    }
    turn(yaw,pitch){this.camera.yaw=((this.camera.yaw+yaw+Math.PI)%TAU+TAU)%TAU-Math.PI;this.camera.pitch=clamp(this.camera.pitch+pitch,-.72,1.18);}
    rotate(dx,dy){this.turn(-dx*.0025,-dy*.0023);}
    setActive(value){this.active=value;this.frameStart=0;this.lastRenderedAt=undefined;}
    removeMoth(moth){
      if(!this.supported||!moth.batch)return;
      const {mesh,start,count}=moth.batch;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER,mesh.p);
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER,start*3*4,new Float32Array(count*3));
    }
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
      if(!this.active||!this.supported||!this.canvas.clientWidth||!this.canvas.clientHeight)return;
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
        if(!this.inFrustum(center,ext))continue;
        const trunks=Math.hypot(tree.x-this.camera.position[0],tree.z-this.camera.position[2])<34?this.trunks:this.farTrunks;
        this.draw(trunks[tree.variant],0,tree.model,tree.normal,tree.seed+tree.x*.37+tree.z*.13);
      }
      for(const chunk of this.decorMeshes)if(this.inFrustum(chunk.center,chunk.extent))this.draw(chunk.mesh,chunk.kind);
      // Alpha-tested moths write depth just like bark and leaves; no transparent sorting artifacts.
      for(const batch of this.mothBatches||[]){gl.bindTexture(gl.TEXTURE_2D,this.textures[batch.type]);this.draw(batch.mesh,4);}
    }
    animate(now){
      if(this.lastRenderedAt!==undefined&&now-this.lastRenderedAt<1000/60-.4){requestAnimationFrame(this.animate);return;}
      this.lastRenderedAt=this.lastRenderedAt===undefined?now:now-(now-this.lastRenderedAt)%(1000/60);this.render();
      if(this.active&&this.canvas.clientWidth&&this.canvas.clientHeight){
        if(!this.frameStart){this.frameStart=now;this.frameCount=0;}
        if(++this.frameCount>=90){
          const fps=this.frameCount*1000/(now-this.frameStart);this.canvas.dataset.renderFps=String(Math.round(fps));
          if(fps<30&&this.renderScale>.75)this.renderScale=Math.max(.75,this.renderScale*.88);
          this.frameStart=now;this.frameCount=0;
        }
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
    nearestMoth(moths){
      let nearest=null;
      for(const moth of moths){
        if(!moth.alive||!moth.world)continue;
        const point=this.project(moth.world);if(!point)continue;
        const distance=Math.hypot(point.x-this.canvas.clientWidth/2,point.y-this.canvas.clientHeight/2);
        if(nearest&&distance>=nearest.distance)continue;
        if(this.mothVisible(moth))nearest={moth,point,distance};
      }
      return nearest;
    }
  }
  window.ForestScene=ForestScene;
})();

