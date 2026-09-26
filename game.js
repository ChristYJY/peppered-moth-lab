(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const random = (min, max) => Math.random() * (max - min) + min;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const shuffle = (items) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  const els = {
    start: $('#startScreen'),
    game: $('#gameScreen'),
    viewport: $('#sceneViewport'),
    canvas: $('#forestCanvas'),
    timer: $('#timer'),
    captureCount: $('#captureCount'),
    environment: $('#environmentLabel'),
    reticle: $('.reticle'),
    refresh: $('#sceneRefresh'),
    refreshNumber: $('#refreshNumber'),
    ready: $('#readyOverlay'),
    readyText: $('#readyText'),
    result: $('#resultPanel'),
    resultTitle: $('#resultTitle'),
    resultSummary: $('#resultSummary'),
    resultEnvironment: $('#resultEnvironment'),
    resultTotal: $('#resultTotal'),
    lightCaptured: $('#lightCaptured'),
    lightRemaining: $('#lightRemaining'),
    darkCaptured: $('#darkCaptured'),
    darkRemaining: $('#darkRemaining'),
    status: $('#liveStatus'),
    joystick: $('#joystick'),
    knob: $('#joystickKnob'),
    captureButton: $('#captureButton'),
    soundButton: $('#soundButton')
  };

  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function translation(x, y, z) {
    const out = identity();
    out[12] = x; out[13] = y; out[14] = z;
    return out;
  }

  function scale(x, y, z) {
    const out = identity();
    out[0] = x; out[5] = y; out[10] = z;
    return out;
  }

  function rotationZ(angle) {
    const out = identity();
    const c = Math.cos(angle); const s = Math.sin(angle);
    out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
    return out;
  }

  function branchModel(start, end, radius) {
    const axis = normalize([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
    const side = normalize(cross([0, 0, 1], axis));
    const back = normalize(cross(axis, side));
    const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    return new Float32Array([
      side[0] * radius, side[1] * radius, side[2] * radius, 0,
      axis[0] * length, axis[1] * length, axis[2] * length, 0,
      back[0] * radius, back[1] * radius, back[2] * radius, 0,
      start[0], start[1], start[2], 1
    ]);
  }

  function trunkX(tree, y) {
    return tree.x - Math.sin(tree.lean) * (y + 1.7);
  }

  function trunksClear(candidate, trees) {
    return trees.every((other) => [0, 8, 16, 27].every((y) => {
      const a = trunkX(candidate, y);
      const b = trunkX(other, y);
      const radiusA = candidate.radius * (1.12 - .22 * Math.min(y / candidate.height, 1));
      const radiusB = other.radius * (1.12 - .22 * Math.min(y / other.height, 1));
      return Math.hypot(a - b, candidate.z - other.z) > radiusA + radiusB + .42;
    }));
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * range, -1,
      0, 0, 2 * far * near * range, 0
    ]);
  }

  function normalize(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function lookAt(eye, target, up) {
    const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
    ]);
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'WebGL shader compilation failed');
    }
    return shader;
  }

  function program(gl, vertexSource, fragmentSource) {
    const result = gl.createProgram();
    gl.attachShader(result, compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(result, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(result) || 'WebGL program linking failed');
    }
    return result;
  }

  function cylinderData(segments = 20, rings = 24, seed = 0) {
    const positions = []; const normals = []; const uvs = [];
    const add = (step, ring) => {
      const angle = step / segments * Math.PI * 2;
      const y = ring / rings;
      const contour = 1 + .034 * Math.sin(angle * 5 + y * 12 + seed)
        + .017 * Math.sin(angle * 9 - y * 27 + seed * 2.3);
      const taper = 1.12 - y * .22 + .018 * Math.sin(y * 5.6 + seed);
      const bendX = .024 * Math.sin(y * 5.3 + seed) - .024 * Math.sin(seed);
      const bendZ = .019 * Math.sin(y * 6.7 + seed * 1.7) - .019 * Math.sin(seed * 1.7);
      const x = Math.cos(angle); const z = Math.sin(angle);
      positions.push(x * contour * taper + bendX, y, z * contour * taper + bendZ);
      normals.push(x, .025, z);
      uvs.push(step / segments, y);
    };
    for (let ring = 0; ring < rings; ring += 1) {
      for (let step = 0; step < segments; step += 1) {
        add(step, ring); add(step + 1, ring); add(step, ring + 1);
        add(step, ring + 1); add(step + 1, ring); add(step + 1, ring + 1);
      }
    }
    return { positions, normals, uvs };
  }

  function groundData() {
    return {
      positions: [-50, 0, 50, 50, 0, 50, -50, 0, -55, -50, 0, -55, 50, 0, 50, 50, 0, -55],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      uvs: [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]
    };
  }

  function shadowData() {
    return {
      positions: [-1, 0, 1, 1, 0, 1, -1, 0, -1, -1, 0, -1, 1, 0, 1, 1, 0, -1],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      uvs: [0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]
    };
  }

  function mothStripData(segments = 12) {
    const vertices = [];
    for (let i = 0; i < segments; i += 1) {
      const left = i / segments - .5;
      const right = (i + 1) / segments - .5;
      vertices.push(left, -.5, right, -.5, left, .5, left, .5, right, -.5, right, .5);
    }
    return new Float32Array(vertices);
  }

  class ForestRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance'
      });
      this.supported = Boolean(this.gl);
      this.theme = 'pale';
      this.trees = [];
      this.branches = [];
      this.canopyCards = [];
      this.moths = [];
      this.camera = { position: [0, 2.35, 4], yaw: 0, pitch: .18, fov: 54 };
      this.viewProjection = identity();
      this.lastFrame = performance.now();
      if (!this.supported) return;
      this.createPrograms();
      this.trunkMeshes = [0, 1.6, 3.2, 4.8].map((seed) => this.createMesh(cylinderData(20, 24, seed)));
      this.branchMesh = this.createMesh(cylinderData(8, 4, 1.3));
      this.groundMesh = this.createMesh(groundData());
      this.shadowMesh = this.createMesh(shadowData());
      this.leafBuffer = this.gl.createBuffer();
      this.leafCount = 0;
      this.quadBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
        -.5, -.5, .5, -.5, -.5, .5,
        -.5, .5, .5, -.5, .5, .5
      ]), this.gl.STATIC_DRAW);
      const mothStrip = mothStripData();
      this.mothBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.mothBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, mothStrip, this.gl.STATIC_DRAW);
      this.mothVertexCount = mothStrip.length / 2;
      this.textures = {
        light: this.loadTexture('./assets/moth-light-cutout.png'),
        dark: this.loadTexture('./assets/moth-dark-cutout.png'),
        barkPale: this.loadTexture('./assets/forest-light-reference.jpg'),
        barkDark: this.loadTexture('./assets/forest-dark-reference.png'),
        barkDetail: this.loadTexture('./assets/bark-clean.png')
      };
      this.gl.enable(this.gl.DEPTH_TEST);
      this.gl.depthFunc(this.gl.LEQUAL);
      this.animate = this.animate.bind(this);
      requestAnimationFrame(this.animate);
    }

    createPrograms() {
      const gl = this.gl;
      const opaqueVertex = [
        'attribute vec3 aPosition;',
        'attribute vec3 aNormal;',
        'attribute vec2 aUv;',
        'uniform mat4 uViewProjection;',
        'uniform mat4 uModel;',
        'varying vec3 vWorld;',
        'varying vec3 vNormal;',
        'varying vec2 vUv;',
        'void main(){',
        '  vec4 world = uModel * vec4(aPosition, 1.0);',
        '  vWorld = world.xyz;',
        '  vNormal = normalize(mat3(uModel) * aNormal);',
        '  vUv = aUv;',
        '  gl_Position = uViewProjection * world;',
        '}'
      ].join('\n');
      const opaqueFragment = [
        'precision mediump float;',
        'uniform vec3 uBase;',
        'uniform vec3 uFog;',
        'uniform vec3 uCamera;',
        'uniform float uTheme;',
        'uniform float uKind;',
        'uniform vec4 uSlice;',
        'uniform sampler2D uBark;',
        'uniform sampler2D uBarkDetail;',
        'varying vec3 vWorld;',
        'varying vec3 vNormal;',
        'varying vec2 vUv;',
        'void main(){',
        '  vec3 lightDir = normalize(vec3(-0.38, 0.76, 0.52));',
        '  float diffuse = 0.69 + 0.31 * max(dot(normalize(vNormal), lightDir), 0.0);',
        '  vec3 color = uBase;',
        '  float opacity = 1.0;',
        '  if (uKind < 0.5 || (uKind > 1.5 && uKind < 2.5)) {',
        '    vec2 barkUv = vec2(mix(0.02, 0.52, uTheme) + fract(vUv.x * 0.93 + uSlice.z) * 0.46, fract(vUv.y * 2.3 + uSlice.w));',
        '    vec3 detail = texture2D(uBarkDetail, barkUv).rgb;',
        '    float around = abs(fract(vUv.x + uSlice.z) * 2.0 - 1.0);',
        '    float photoU = uSlice.x + (around - 0.5) * uSlice.y;',
        '    vec3 reference = texture2D(uBark, vec2(photoU, mix(0.20, 0.84, vUv.y))).rgb;',
        '    float greenCast = reference.g - (reference.r + reference.b) * 0.5;',
        '    float gray = dot(reference, vec3(0.30, 0.59, 0.11));',
        '    reference = mix(reference, vec3(gray), smoothstep(0.015, 0.09, greenCast));',
        '    float brightLeak = smoothstep(0.25, 0.48, gray) * uTheme;',
        '    vec3 bark = mix(reference, detail, max(mix(0.08, 0.36, uTheme), brightLeak * 0.96));',
        '    float grain = dot(bark, vec3(0.30, 0.59, 0.11));',
        '    float relief = 0.88 + 0.18 * smoothstep(0.13, 0.88, grain);',
        '    color = mix(bark, bark * uBase, 0.12) * diffuse * relief;',
        '  } else if (uKind < 1.5) {',
        '    vec2 p = vWorld.xz * 4.0;',
        '    vec2 cell = floor(p);',
        '    vec2 t = fract(p);',
        '    t = t * t * (3.0 - 2.0 * t);',
        '    float a = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);',
        '    float b = fract(sin(dot(cell + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);',
        '    float c = fract(sin(dot(cell + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);',
        '    float d = fract(sin(dot(cell + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);',
        '    float soil = mix(mix(a, b, t.x), mix(c, d, t.x), t.y);',
        '    color *= 0.82 + soil * 0.23;',
        '  } else {',
        '    float radius = length((vUv - vec2(0.5)) * 2.0);',
        '    opacity = (1.0 - smoothstep(0.18, 1.0, radius)) * 0.31;',
        '  }',
        '  float distanceToEye = distance(vWorld, uCamera);',
        '  float fogAmount = smoothstep(13.0, 44.0, distanceToEye);',
        '  gl_FragColor = vec4(mix(color, uFog, fogAmount * 0.93), opacity);',
        '}'
      ].join('\n');
      this.opaqueProgram = program(gl, opaqueVertex, opaqueFragment);
      this.opaque = {
        position: gl.getAttribLocation(this.opaqueProgram, 'aPosition'),
        normal: gl.getAttribLocation(this.opaqueProgram, 'aNormal'),
        uv: gl.getAttribLocation(this.opaqueProgram, 'aUv'),
        viewProjection: gl.getUniformLocation(this.opaqueProgram, 'uViewProjection'),
        model: gl.getUniformLocation(this.opaqueProgram, 'uModel'),
        base: gl.getUniformLocation(this.opaqueProgram, 'uBase'),
        fog: gl.getUniformLocation(this.opaqueProgram, 'uFog'),
        camera: gl.getUniformLocation(this.opaqueProgram, 'uCamera'),
        theme: gl.getUniformLocation(this.opaqueProgram, 'uTheme'),
        kind: gl.getUniformLocation(this.opaqueProgram, 'uKind'),
        slice: gl.getUniformLocation(this.opaqueProgram, 'uSlice'),
        bark: gl.getUniformLocation(this.opaqueProgram, 'uBark'),
        barkDetail: gl.getUniformLocation(this.opaqueProgram, 'uBarkDetail')
      };

      const leafVertex = [
        'attribute vec3 aPosition;',
        'attribute vec3 aColor;',
        'attribute float aSize;',
        'uniform mat4 uViewProjection;',
        'uniform vec3 uCamera;',
        'uniform vec3 uFog;',
        'varying vec3 vColor;',
        'void main(){',
        '  float distanceToEye = distance(aPosition, uCamera);',
        '  float fog = smoothstep(11.0, 43.0, distanceToEye);',
        '  vColor = mix(aColor, uFog, fog * 0.8);',
        '  gl_PointSize = clamp(aSize * 43.0 / max(distanceToEye, 1.0), 1.4, 22.0);',
        '  gl_Position = uViewProjection * vec4(aPosition, 1.0);',
        '}'
      ].join('\n');
      const leafFragment = [
        'precision mediump float;',
        'varying vec3 vColor;',
        'void main(){',
        '  vec2 p = gl_PointCoord * 2.0 - 1.0;',
        '  float leaf = length(vec2(p.x * 0.72, p.y * 1.38));',
        '  if (leaf > 1.0) discard;',
        '  float edge = 1.0 - smoothstep(0.72, 1.0, leaf);',
        '  float vein = 0.92 + 0.08 * (1.0 - abs(p.x));',
        '  gl_FragColor = vec4(vColor * vein, edge * 0.95);',
        '}'
      ].join('\n');
      this.leafProgram = program(gl, leafVertex, leafFragment);
      this.leaf = {
        position: gl.getAttribLocation(this.leafProgram, 'aPosition'),
        color: gl.getAttribLocation(this.leafProgram, 'aColor'),
        size: gl.getAttribLocation(this.leafProgram, 'aSize'),
        viewProjection: gl.getUniformLocation(this.leafProgram, 'uViewProjection'),
        camera: gl.getUniformLocation(this.leafProgram, 'uCamera'),
        fog: gl.getUniformLocation(this.leafProgram, 'uFog')
      };

      const spriteVertex = [
        'attribute vec2 aCorner;',
        'uniform mat4 uViewProjection;',
        'uniform vec3 uCenter;',
        'uniform vec3 uRight;',
        'uniform vec3 uUp;',
        'uniform vec3 uNormal;',
        'uniform vec2 uSize;',
        'uniform float uRotation;',
        'uniform float uCurve;',
        'varying vec2 vUv;',
        'void main(){',
        '  float c = cos(uRotation);',
        '  float s = sin(uRotation);',
        '  vec2 corner = vec2(c * aCorner.x - s * aCorner.y, s * aCorner.x + c * aCorner.y);',
        '  vec3 world = uCenter + uUp * corner.y * uSize.y;',
        '  if (uCurve > 0.01) {',
        '    float arc = corner.x * uSize.x / uCurve;',
        '    world += uRight * sin(arc) * uCurve + uNormal * (cos(arc) - 1.0) * uCurve;',
        '  } else {',
        '    world += uRight * corner.x * uSize.x;',
        '  }',
        '  vUv = aCorner + vec2(0.5);',
        '  gl_Position = uViewProjection * vec4(world, 1.0);',
        '}'
      ].join('\n');
      const spriteFragment = [
        'precision mediump float;',
        'uniform sampler2D uTexture;',
        'varying vec2 vUv;',
        'void main(){',
        '  vec4 texel = texture2D(uTexture, vUv);',
        '  float cleanAlpha = smoothstep(0.28, 0.56, texel.a);',
        '  if (cleanAlpha < 0.08) discard;',
        '  gl_FragColor = vec4(texel.rgb, cleanAlpha);',
        '}'
      ].join('\n');
      this.spriteProgram = program(gl, spriteVertex, spriteFragment);
      this.sprite = {
        corner: gl.getAttribLocation(this.spriteProgram, 'aCorner'),
        viewProjection: gl.getUniformLocation(this.spriteProgram, 'uViewProjection'),
        center: gl.getUniformLocation(this.spriteProgram, 'uCenter'),
        right: gl.getUniformLocation(this.spriteProgram, 'uRight'),
        up: gl.getUniformLocation(this.spriteProgram, 'uUp'),
        normal: gl.getUniformLocation(this.spriteProgram, 'uNormal'),
        size: gl.getUniformLocation(this.spriteProgram, 'uSize'),
        rotation: gl.getUniformLocation(this.spriteProgram, 'uRotation'),
        curve: gl.getUniformLocation(this.spriteProgram, 'uCurve'),
        texture: gl.getUniformLocation(this.spriteProgram, 'uTexture')
      };

      const canopyFragment = [
        'precision mediump float;',
        'uniform sampler2D uPhoto;',
        'uniform vec4 uCrop;',
        'uniform float uTheme;',
        'varying vec2 vUv;',
        'void main(){',
        '  vec2 sourceUv = uCrop.xy + (vUv - vec2(0.5)) * uCrop.zw;',
        '  vec3 photo = texture2D(uPhoto, sourceUv).rgb;',
        '  float green = photo.g - (photo.r + photo.b) * 0.5;',
        '  float vivid = smoothstep(0.015, 0.085, green);',
        '  float edge = smoothstep(0.0, 0.13, vUv.x) * smoothstep(0.0, 0.13, vUv.y)',
        '    * smoothstep(0.0, 0.13, 1.0 - vUv.x) * smoothstep(0.0, 0.13, 1.0 - vUv.y);',
        '  float alpha = vivid * edge * mix(0.82, 0.91, uTheme);',
        '  if (alpha < 0.05) discard;',
        '  gl_FragColor = vec4(photo, alpha);',
        '}'
      ].join('\n');
      this.canopyProgram = program(gl, spriteVertex, canopyFragment);
      this.canopy = {
        corner: gl.getAttribLocation(this.canopyProgram, 'aCorner'),
        viewProjection: gl.getUniformLocation(this.canopyProgram, 'uViewProjection'),
        center: gl.getUniformLocation(this.canopyProgram, 'uCenter'),
        right: gl.getUniformLocation(this.canopyProgram, 'uRight'),
        up: gl.getUniformLocation(this.canopyProgram, 'uUp'),
        size: gl.getUniformLocation(this.canopyProgram, 'uSize'),
        rotation: gl.getUniformLocation(this.canopyProgram, 'uRotation'),
        photo: gl.getUniformLocation(this.canopyProgram, 'uPhoto'),
        crop: gl.getUniformLocation(this.canopyProgram, 'uCrop'),
        theme: gl.getUniformLocation(this.canopyProgram, 'uTheme')
      };
    }

    createMesh(data) {
      const gl = this.gl;
      const mesh = { count: data.positions.length / 3 };
      mesh.position = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.positions), gl.STATIC_DRAW);
      mesh.normal = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.normals), gl.STATIC_DRAW);
      mesh.uv = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.uvs), gl.STATIC_DRAW);
      return mesh;
    }

    loadTexture(url) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const image = new Image();
      image.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      };
      image.src = url;
      return texture;
    }

    resize() {
      if (!this.supported) return;
      const width = Math.max(1, this.canvas.clientWidth);
      const height = Math.max(1, this.canvas.clientHeight);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
      }
      this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    }

    direction() {
      const c = Math.cos(this.camera.pitch);
      return [
        Math.sin(this.camera.yaw) * c,
        Math.sin(this.camera.pitch),
        -Math.cos(this.camera.yaw) * c
      ];
    }

    cameraBasis() {
      const direction = this.direction();
      const right = normalize(cross(direction, [0, 1, 0]));
      const up = normalize(cross(right, direction));
      return { direction, right, up };
    }

    updateViewProjection() {
      const direction = this.direction();
      const eye = this.camera.position;
      const target = [eye[0] + direction[0], eye[1] + direction[1], eye[2] + direction[2]];
      const view = lookAt(eye, target, [0, 1, 0]);
      const projection = perspective(this.camera.fov * Math.PI / 180, Math.max(.1, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight)), .08, 70);
      this.viewProjection = multiply(projection, view);
    }

    randomizeScene(theme, moths) {
      this.theme = theme;
      this.moths = moths;
      this.camera = {
        position: [0, 2.35, 4],
        yaw: random(-.018, .018),
        pitch: random(.165, .185),
        fov: 54
      };
      const barkSlices = theme === 'pale'
        ? [.108, .177, .191, .302, .58, .594, .663, .885]
        : [.118, .186, .299, .592, .603, .66, .671, .886];
      this.trees = [{
        x: 0, z: -7.4, height: 29, radius: .46, lean: random(-.008, .008),
        shade: 1, slice: barkSlices[Math.floor(random(0, barkSlices.length))], sliceWidth: .052,
        barkOffset: random(0, 1), barkV: random(0, 1), variant: 0
      }];
      const plant = (candidate) => {
        if (!trunksClear(candidate, this.trees)) return false;
        this.trees.push({
          ...candidate,
          slice: barkSlices[Math.floor(random(0, barkSlices.length))],
          sliceWidth: random(.043, .065),
          barkOffset: random(0, 1), barkV: random(0, 1),
          variant: Math.floor(random(0, this.trunkMeshes.length))
        });
        return true;
      };
      const referenceTrunks = theme === 'pale'
        ? [
          [-5.7, -4.5, .67, -.012], [-3.4, -10.5, .62, .018],
          [3.5, -8.7, .7, -.015], [6.2, -7.8, .56, .01],
          [-8.6, -17, .48, .013], [9.1, -15, .47, -.014]
        ]
        : [
          [-5.5, -4.8, .78, .017], [-3.5, -10.5, .69, -.021],
          [3.5, -8.5, .8, .017], [6.4, -8.2, .68, -.024],
          [-8.4, -16.5, .55, .012], [9.4, -15.5, .57, -.018]
        ];
      referenceTrunks.forEach(([x, z, radius, lean]) => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (plant({
            x: x + random(-.2, .2), z: z + random(-.25, .25), radius,
            lean, height: random(27, 32), shade: random(.96, 1.04)
          })) break;
        }
      });
      for (let i = this.trees.length; i < 59; i += 1) {
        const depth = i < 28 ? random(5.8, 22) : random(22, 53);
        let placed = false;
        for (let attempt = 0; attempt < 60 && !placed; attempt += 1) {
          let x = random(-21, 21);
          if (depth < 15 && Math.abs(x) < 3.2) x = (Math.random() > .5 ? 1 : -1) * random(3.6, 8);
          placed = plant({
            x, z: 4 - depth, height: random(24, 33),
            radius: i < 28
              ? (theme === 'dark' ? random(.29, .73) : random(.23, .64))
              : random(.19, .46),
            lean: theme === 'dark' ? random(-.026, .026) : random(-.018, .018),
            shade: random(.9, 1.07)
          });
        }
        if (!placed) break;
      }
      const mothTreeCount = this.trees.length;
      for (let i = 0; i < 27; i += 1) {
        for (let attempt = 0; attempt < 45; attempt += 1) {
          let x = random(-23, 23);
          const z = random(8, 36);
          if (z < 14 && Math.abs(x) < 3.4) x = (Math.random() > .5 ? 1 : -1) * random(3.8, 8);
          if (plant({
            x, z, height: random(24, 32), radius: random(.24, .58),
            lean: random(-.022, .022), shade: random(.88, 1.06)
          })) break;
        }
      }
      this.branches = [];
      this.trees.forEach((tree, index) => {
        const branchCount = index < 29 ? 3 : 2;
        for (let branch = 0; branch < branchCount; branch += 1) {
          const side = (branch % 2 ? 1 : -1);
          const angle = random(-.65, .65);
          const y = random(6.8, 12.5);
          const reach = random(1.7, 4.3);
          const start = [trunkX(tree, y) + side * tree.radius * .7, y, tree.z];
          const end = [
            start[0] + side * reach,
            y + random(.6, 2.8),
            start[2] + Math.sin(angle) * reach
          ];
          const collides = this.trees.some((other, otherIndex) => {
            if (otherIndex === index) return false;
            return [.2, .4, .6, .8, 1].some((t) => {
              const height = start[1] + (end[1] - start[1]) * t;
              return Math.hypot(
                start[0] + (end[0] - start[0]) * t - trunkX(other, height),
                start[2] + (end[2] - start[2]) * t - other.z
              ) < other.radius + .22;
            });
          });
          if (!collides) this.branches.push({
            model: branchModel(start, end, random(.035, .07)),
            shade: tree.shade, slice: [tree.slice, tree.sliceWidth, tree.barkOffset, tree.barkV], treeIndex: index
          });
        }
      });
      this.canopyCards = [];
      this.trees.forEach((tree, index) => {
        const count = index < 29 ? 3 : 2;
        for (let card = 0; card < count; card += 1) {
          this.canopyCards.push({
            center: [
              tree.x + random(-3.7, 3.7),
              index < 29 ? random(7.2, 11.4) : random(9.2, 15.0),
              tree.z - random(.7, 2.3)
            ],
            size: [random(3.4, 6.7), random(2.4, 4.5)],
            crop: [random(.15, .85), random(.79, .9), random(.11, .21), random(.09, .17)],
            rotation: random(-.35, .35)
          });
        }
      });
      for (let i = 0; i < 42; i += 1) {
        const depth = random(8, 39);
        this.canopyCards.push({
          center: [random(-17, 17), random(.45, 1.4), 4 - depth],
          size: [random(1.4, 2.5), random(.8, 1.5)],
          crop: [random(.17, .83), random(.79, .91), random(.1, .16), random(.08, .13)],
          rotation: random(-.55, .55)
        });
      }
      this.buildLeaves();
      const alive = moths.filter((moth) => moth.alive);
      const anchor = alive[Math.floor(Math.random() * alive.length)];
      const treeIndexes = shuffle(Array.from({ length: Math.min(32, mothTreeCount - 1) }, (_, index) => index + 1));
      let treeCursor = 0;
      const attachMoth = (moth, tree, y, angle, scale) => {
        const surfaceRadius = tree.radius * (1.12 - .22 * y / tree.height);
        const curveRadius = surfaceRadius * 1.09 + .045;
        const normal = [Math.sin(angle), 0, Math.cos(angle)];
        moth.world = [
          trunkX(tree, y) + normal[0] * curveRadius,
          y,
          tree.z + normal[2] * curveRadius
        ];
        moth.normal = normal;
        moth.right = [Math.cos(angle), 0, -Math.sin(angle)];
        moth.curveRadius = curveRadius;
        moth.scale = scale;
        moth.width = Math.min(.64 * scale * 2.06, surfaceRadius * 2.35);
        moth.rotation = random(-.14, .14);
      };
      alive.forEach((moth) => {
        if (moth === anchor) {
          moth.treeIndex = 0;
          attachMoth(moth, this.trees[0], 4.39, 0, .82);
          return;
        }
        const index = treeIndexes[treeCursor % treeIndexes.length];
        treeCursor += 1;
        const tree = this.trees[index];
        moth.treeIndex = index;
        const mothY = random(2.0, 7.3);
        attachMoth(moth, tree, mothY, random(-1.08, 1.08), random(.57, .84));
      });
      this.resize();
      this.updateViewProjection();
    }

    buildLeaves() {
      const gl = this.gl;
      const data = [];
      const dark = this.theme === 'dark';
      const add = (x, y, z, size, color) => {
        data.push(x, y, z, color[0], color[1], color[2], size);
      };
      this.trees.forEach((tree, index) => {
        const count = index < 29 ? 5 : 3;
        for (let cluster = 0; cluster < count; cluster += 1) {
          const side = cluster % 2 ? 1 : -1;
          const cx = tree.x + side * random(1.1, 3.6);
          const cy = index < 29 ? random(6.7, 11.5) : random(9.0, 15.5);
          const cz = tree.z + random(-2.0, 1.5);
          const radius = random(1.7, 3.2);
          const leafCount = index < 29 ? 18 : 9;
          for (let leaf = 0; leaf < leafCount; leaf += 1) {
            const theta = random(0, Math.PI * 2);
            const phi = Math.acos(random(-1, 1));
            const r = radius * Math.cbrt(Math.random());
            const brightness = random(.72, 1.22);
            const color = dark
              ? [.23 * brightness, .36 * brightness, .22 * brightness]
              : [.36 * brightness, .56 * brightness, .24 * brightness];
            const x = cx + Math.sin(phi) * Math.cos(theta) * r;
            const y = cy + Math.cos(phi) * r * .66;
            const z = cz + Math.sin(phi) * Math.sin(theta) * r;
            const insideTrunk = this.trees.some((other) =>
              Math.hypot(x - trunkX(other, y), z - other.z) < other.radius * 1.25
            );
            if (!insideTrunk) add(x, y, z, random(2.8, 5.1), color);
          }
        }
      });
      this.leafCount = data.length / 7;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.leafBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    }

    rotate(deltaX, deltaY) {
      const turn = this.camera.yaw - deltaX * .0031;
      this.camera.yaw = ((turn + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.camera.pitch = clamp(this.camera.pitch - deltaY * .0027, -.6, .58);
    }

    move(forward, strafe) {
      let x = clamp(this.camera.position[0] + Math.sin(this.camera.yaw) * forward
        + Math.cos(this.camera.yaw) * strafe, -16, 16);
      let z = clamp(this.camera.position[2] - Math.cos(this.camera.yaw) * forward
        + Math.sin(this.camera.yaw) * strafe, -23, 24);
      for (let pass = 0; pass < 2; pass += 1) {
        this.trees.forEach((tree) => {
          const dx = x - trunkX(tree, this.camera.position[1]);
          const dz = z - tree.z;
          const minimum = tree.radius * 1.16 + .42;
          const distance = Math.hypot(dx, dz);
          if (distance >= minimum) return;
          if (distance < .001) {
            x = trunkX(tree, this.camera.position[1]) + minimum;
            return;
          }
          const factor = minimum / distance;
          x = trunkX(tree, this.camera.position[1]) + dx * factor;
          z = tree.z + dz * factor;
        });
      }
      this.camera.position[0] = clamp(x, -16, 16);
      this.camera.position[2] = clamp(z, -23, 24);
    }

    zoom(delta) {
      this.camera.fov = clamp(this.camera.fov + delta, 38, 68);
    }

    isVisible(x, z, radius = 0) {
      const dx = x - this.camera.position[0];
      const dz = z - this.camera.position[2];
      const forward = dx * Math.sin(this.camera.yaw) - dz * Math.cos(this.camera.yaw);
      if (forward < -radius || forward - radius > 70) return false;
      const side = dx * Math.cos(this.camera.yaw) + dz * Math.sin(this.camera.yaw);
      const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
      const halfWidth = Math.max(0, forward) * Math.tan(this.camera.fov * Math.PI / 360) * aspect;
      return Math.abs(side) < halfWidth + radius + .7;
    }

    drawMesh(mesh, model, base, kind, slice = [.5, .05, 0, 0]) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
      gl.enableVertexAttribArray(this.opaque.position);
      gl.vertexAttribPointer(this.opaque.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
      gl.enableVertexAttribArray(this.opaque.normal);
      gl.vertexAttribPointer(this.opaque.normal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
      gl.enableVertexAttribArray(this.opaque.uv);
      gl.vertexAttribPointer(this.opaque.uv, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(this.opaque.model, false, model);
      gl.uniform3fv(this.opaque.base, base);
      gl.uniform1f(this.opaque.kind, kind);
      gl.uniform4fv(this.opaque.slice, slice);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    renderOpaque() {
      const gl = this.gl;
      gl.useProgram(this.opaqueProgram);
      gl.uniformMatrix4fv(this.opaque.viewProjection, false, this.viewProjection);
      gl.uniform3fv(this.opaque.camera, this.camera.position);
      gl.uniform1f(this.opaque.theme, this.theme === 'dark' ? 1 : 0);
      const fog = this.theme === 'dark' ? [.34, .43, .4] : [.72, .78, .68];
      gl.uniform3fv(this.opaque.fog, fog);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.theme === 'dark' ? this.textures.barkDark : this.textures.barkPale);
      gl.uniform1i(this.opaque.bark, 1);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.barkDetail);
      gl.uniform1i(this.opaque.barkDetail, 3);
      const ground = this.theme === 'dark' ? [.13, .2, .16] : [.3, .43, .24];
      this.drawMesh(this.groundMesh, translation(0, -.08, 0), ground, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this.trees.forEach((tree, index) => {
        if (!this.visibleTrees[index]) return;
        const model = multiply(
          translation(trunkX(tree, -.08), -.074, tree.z),
          scale(tree.radius * 2.1, 1, tree.radius * 1.8)
        );
        this.drawMesh(this.shadowMesh, model, [.025, .055, .035], 3);
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      this.trees.forEach((tree, index) => {
        if (!this.visibleTrees[index]) return;
        const model = multiply(
          translation(tree.x, -1.7, tree.z),
          multiply(rotationZ(tree.lean), scale(tree.radius, tree.height + 1.7, tree.radius))
        );
        const base = this.theme === 'dark'
          ? [.83 * tree.shade, .87 * tree.shade, .88 * tree.shade]
          : [.98 * tree.shade, .98 * tree.shade, .96 * tree.shade];
        this.drawMesh(this.trunkMeshes[tree.variant], model, base, 0, [tree.slice, tree.sliceWidth, tree.barkOffset, tree.barkV]);
      });
      this.branches.forEach((branch) => {
        if (!this.visibleTrees[branch.treeIndex]) return;
        const base = this.theme === 'dark'
          ? [.78 * branch.shade, .8 * branch.shade, .78 * branch.shade]
          : [.87 * branch.shade, .85 * branch.shade, .8 * branch.shade];
        this.drawMesh(this.branchMesh, branch.model, base, 2, branch.slice);
      });
    }

    renderLeaves() {
      if (!this.leafCount) return;
      const gl = this.gl;
      gl.useProgram(this.leafProgram);
      gl.uniformMatrix4fv(this.leaf.viewProjection, false, this.viewProjection);
      gl.uniform3fv(this.leaf.camera, this.camera.position);
      gl.uniform3fv(this.leaf.fog, this.theme === 'dark' ? [.34, .43, .4] : [.72, .78, .68]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.leafBuffer);
      gl.enableVertexAttribArray(this.leaf.position);
      gl.vertexAttribPointer(this.leaf.position, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(this.leaf.color);
      gl.vertexAttribPointer(this.leaf.color, 3, gl.FLOAT, false, 28, 12);
      gl.enableVertexAttribArray(this.leaf.size);
      gl.vertexAttribPointer(this.leaf.size, 1, gl.FLOAT, false, 28, 24);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArrays(gl.POINTS, 0, this.leafCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    renderCanopy() {
      if (!this.canopyCards.length) return;
      const gl = this.gl;
      const basis = this.cameraBasis();
      const cards = this.canopyCards.filter((card) =>
        this.isVisible(card.center[0], card.center[2], card.size[0] * .65 + 1)
      ).sort((a, b) => {
        const da = Math.hypot(a.center[0] - this.camera.position[0], a.center[2] - this.camera.position[2]);
        const db = Math.hypot(b.center[0] - this.camera.position[0], b.center[2] - this.camera.position[2]);
        return db - da;
      });
      gl.useProgram(this.canopyProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(this.canopy.corner);
      gl.vertexAttribPointer(this.canopy.corner, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(this.canopy.viewProjection, false, this.viewProjection);
      gl.uniform3fv(this.canopy.right, basis.right);
      gl.uniform3fv(this.canopy.up, basis.up);
      gl.uniform1f(this.canopy.theme, this.theme === 'dark' ? 1 : 0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.theme === 'dark' ? this.textures.barkDark : this.textures.barkPale);
      gl.uniform1i(this.canopy.photo, 2);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      cards.forEach((card) => {
        gl.uniform3fv(this.canopy.center, card.center);
        gl.uniform2fv(this.canopy.size, card.size);
        gl.uniform4fv(this.canopy.crop, card.crop);
        gl.uniform1f(this.canopy.rotation, card.rotation);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    renderMoths() {
      const gl = this.gl;
      const living = this.moths
        .filter((moth) => moth.alive && moth.world && this.mothVisible(moth))
        .sort((a, b) => {
          const da = Math.hypot(a.world[0] - this.camera.position[0], a.world[2] - this.camera.position[2]);
          const db = Math.hypot(b.world[0] - this.camera.position[0], b.world[2] - this.camera.position[2]);
          return db - da;
        });
      gl.useProgram(this.spriteProgram);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.mothBuffer);
      gl.enableVertexAttribArray(this.sprite.corner);
      gl.vertexAttribPointer(this.sprite.corner, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(this.sprite.viewProjection, false, this.viewProjection);
      gl.uniform3fv(this.sprite.up, [0, 1, 0]);
      gl.uniform1i(this.sprite.texture, 0);
      living.forEach((moth) => {
        const height = .64 * moth.scale;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[moth.type]);
        gl.uniform3fv(this.sprite.center, moth.world);
        gl.uniform3fv(this.sprite.right, moth.right);
        gl.uniform3fv(this.sprite.normal, moth.normal);
        gl.uniform1f(this.sprite.curve, moth.curveRadius);
        gl.uniform2f(this.sprite.size, moth.width, height);
        gl.uniform1f(this.sprite.rotation, moth.rotation);
        gl.drawArrays(gl.TRIANGLES, 0, this.mothVertexCount);
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    render() {
      if (!this.supported || !this.canvas.isConnected || !this.canvas.clientWidth || !this.canvas.clientHeight) return;
      this.resize();
      this.updateViewProjection();
      this.visibleTrees = this.trees.map((tree) => this.isVisible(tree.x, tree.z, tree.radius * 2 + 3));
      const gl = this.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.renderOpaque();
      this.renderLeaves();
      this.renderCanopy();
      this.renderMoths();
    }

    animate() {
      this.render();
      requestAnimationFrame(this.animate);
    }

    project(world) {
      const m = this.viewProjection;
      const x = world[0]; const y = world[1]; const z = world[2];
      const clipX = m[0] * x + m[4] * y + m[8] * z + m[12];
      const clipY = m[1] * x + m[5] * y + m[9] * z + m[13];
      const clipZ = m[2] * x + m[6] * y + m[10] * z + m[14];
      const clipW = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (clipW <= 0) return null;
      const nx = clipX / clipW; const ny = clipY / clipW; const nz = clipZ / clipW;
      if (nz < -1 || nz > 1 || Math.abs(nx) > 1.18 || Math.abs(ny) > 1.18) return null;
      return {
        x: (nx * .5 + .5) * this.canvas.clientWidth,
        y: (-ny * .5 + .5) * this.canvas.clientHeight,
        depth: nz
      };
    }

    mothVisible(moth) {
      const eye = this.camera.position;
      const towardEye = moth.normal[0] * (eye[0] - moth.world[0])
        + moth.normal[2] * (eye[2] - moth.world[2]);
      if (towardEye <= .02) return false;
      const rayX = moth.world[0] - eye[0];
      const rayZ = moth.world[2] - eye[2];
      const lengthSquared = rayX * rayX + rayZ * rayZ;
      if (lengthSquared < .001) return true;
      return !this.trees.some((tree, index) => {
        if (index === moth.treeIndex) return false;
        const trunkCenterX = trunkX(tree, moth.world[1]);
        const t = clamp(((trunkCenterX - eye[0]) * rayX + (tree.z - eye[2]) * rayZ) / lengthSquared, 0, 1);
        if (t <= .01 || t >= .98) return false;
        const dx = eye[0] + rayX * t - trunkCenterX;
        const dz = eye[2] + rayZ * t - tree.z;
        const radius = tree.radius * (1.12 - .22 * moth.world[1] / tree.height);
        return dx * dx + dz * dz < radius * radius;
      });
    }

    nearestMoth(moths) {
      const centerX = this.canvas.clientWidth / 2;
      const centerY = this.canvas.clientHeight / 2;
      return moths
        .filter((moth) => moth.alive && moth.world && this.mothVisible(moth))
        .map((moth) => {
          const point = this.project(moth.world);
          return point ? { moth, point, distance: Math.hypot(point.x - centerX, point.y - centerY) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance)[0] || null;
    }
  }

  const renderer = new ForestRenderer(els.canvas);
  const state = {
    theme: 'pale',
    moths: [],
    captured: { light: 0, dark: 0 },
    totalCaptured: 0,
    running: false,
    transitioning: false,
    sound: true,
    deadline: 0,
    timerId: 0,
    drag: null,
    joy: { x: 0, y: 0, pointerId: null },
    keys: new Set(),
    audio: null,
    roundId: 0,
    lastControlFrame: performance.now()
  };

  const themeLabel = () => state.theme === 'pale' ? '浅色树干' : '深色树干';

  function createPopulation() {
    state.moths = [];
    for (let i = 0; i < 10; i += 1) state.moths.push({ id: 'light-' + i, type: 'light', alive: true });
    for (let i = 0; i < 10; i += 1) state.moths.push({ id: 'dark-' + i, type: 'dark', alive: true });
  }

  async function countdown(roundId) {
    els.ready.classList.remove('is-hidden');
    for (const value of ['3', '2', '1', '开始']) {
      if (roundId !== state.roundId) return;
      els.readyText.textContent = value;
      await new Promise((resolve) => setTimeout(resolve, value === '开始' ? 450 : 520));
    }
    if (roundId !== state.roundId) return;
    els.ready.classList.add('is-hidden');
    state.running = true;
    state.deadline = performance.now() + 60000;
    state.timerId = window.setInterval(updateTimer, 100);
    els.status.textContent = '实验开始，剩余时间 60 秒。';
  }

  function startGame(theme = state.theme) {
    clearInterval(state.timerId);
    state.keys.clear();
    state.theme = theme;
    state.captured = { light: 0, dark: 0 };
    state.totalCaptured = 0;
    state.running = false;
    state.transitioning = false;
    createPopulation();
    els.captureCount.textContent = '0';
    els.timer.textContent = '01:00';
    els.timer.parentElement.classList.remove('urgent');
    els.environment.textContent = themeLabel();
    els.result.classList.add('is-hidden');
    els.start.classList.add('is-hidden');
    els.game.classList.remove('is-hidden', 'theme-pale', 'theme-dark');
    els.game.classList.add('theme-' + state.theme);
    renderer.randomizeScene(state.theme, state.moths);
    if (!renderer.supported) {
      els.status.textContent = '当前浏览器未启用 WebGL，建议使用最新版 Chrome 或 Edge。';
    }
    const roundId = ++state.roundId;
    countdown(roundId);
  }

  function updateTimer() {
    if (!state.running || state.transitioning) return;
    const remaining = Math.max(0, state.deadline - performance.now());
    const seconds = Math.ceil(remaining / 1000);
    els.timer.textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    els.timer.parentElement.classList.toggle('urgent', seconds <= 10);
    if (remaining <= 0) finishGame('timeout');
  }

  function capture() {
    if (!state.running || state.transitioning) return;
    const target = renderer.nearestMoth(state.moths);
    const threshold = clamp(innerWidth * .073, 64, 106);
    if (!target || target.distance > threshold) {
      pulseReticle('miss');
      playSound('miss');
      els.status.textContent = '没有捕捉到，请将桦尺蛾对准中央。';
      return;
    }
    const moth = target.moth;
    moth.alive = false;
    state.captured[moth.type] += 1;
    state.totalCaptured += 1;
    pulseReticle('hit');
    burstParticles(moth.type);
    playSound('hit');
    els.captureCount.textContent = String(state.totalCaptured);
    els.status.textContent = '捕食成功，已捕食 ' + state.totalCaptured + ' 只。场景正在更新。';
    if (state.totalCaptured >= 10) {
      state.running = false;
      window.setTimeout(() => finishGame('complete'), 520);
      return;
    }
    transitionScene();
  }

  function transitionScene() {
    state.transitioning = true;
    els.refreshNumber.textContent = String(state.totalCaptured + 1).padStart(2, '0') + ' / 10';
    els.refresh.classList.add('show');
    els.canvas.classList.add('is-switching');
    window.setTimeout(() => {
      renderer.randomizeScene(state.theme, state.moths);
    }, 270);
    window.setTimeout(() => {
      els.canvas.classList.remove('is-switching');
      els.refresh.classList.remove('show');
      state.transitioning = false;
      state.deadline += 760;
    }, 760);
  }

  function finishGame(reason) {
    if (!els.result.classList.contains('is-hidden')) return;
    clearInterval(state.timerId);
    state.roundId += 1;
    state.running = false;
    state.transitioning = false;
    els.resultTitle.textContent = reason === 'complete' ? '实验完成' : '时间到';
    els.resultSummary.textContent = reason === 'complete' ? '你完成了 10 次捕食' : '本次共捕食 ' + state.totalCaptured + ' 只桦尺蛾';
    els.resultEnvironment.textContent = themeLabel();
    els.resultTotal.textContent = String(state.totalCaptured);
    els.lightCaptured.textContent = String(state.captured.light);
    els.darkCaptured.textContent = String(state.captured.dark);
    els.lightRemaining.textContent = String(10 - state.captured.light);
    els.darkRemaining.textContent = String(10 - state.captured.dark);
    els.result.classList.remove('is-hidden');
    els.status.textContent = '实验结束。浅色桦尺蛾剩余 ' + (10 - state.captured.light) + ' 只，深色桦尺蛾剩余 ' + (10 - state.captured.dark) + ' 只。';
  }

  function pulseReticle(name) {
    els.reticle.classList.remove('hit', 'miss');
    void els.reticle.offsetWidth;
    els.reticle.classList.add(name);
  }

  function burstParticles(type) {
    const color = type === 'light' ? '#eee9db' : '#2d2925';
    for (let i = 0; i < 18; i += 1) {
      const particle = document.createElement('i');
      particle.className = 'particle';
      particle.style.setProperty('--particle-color', color);
      particle.style.setProperty('--dx', random(-105, 105) + 'px');
      particle.style.setProperty('--dy', random(-90, 90) + 'px');
      particle.style.setProperty('--spin', random(-240, 240) + 'deg');
      document.body.append(particle);
      window.setTimeout(() => particle.remove(), 620);
    }
  }

  function audioContext() {
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audio.state === 'suspended') state.audio.resume();
    return state.audio;
  }

  function playSound(kind) {
    if (!state.sound) return;
    const context = audioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === 'hit' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(kind === 'hit' ? 640 : 160, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'hit' ? 980 : 110, context.currentTime + .16);
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(kind === 'hit' ? .16 : .06, context.currentTime + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .22);
  }

  function updateJoystick(event) {
    const rect = els.joystick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const radius = rect.width * .29;
    const distance = Math.hypot(dx, dy) || 1;
    const factor = Math.min(1, radius / distance);
    const x = dx * factor; const y = dy * factor;
    els.knob.style.transform = 'translate(calc(-50% + ' + x + 'px), calc(-50% + ' + y + 'px))';
    state.joy.x = x / radius;
    state.joy.y = y / radius;
  }

  function releaseJoystick(event) {
    if (event && state.joy.pointerId !== event.pointerId) return;
    state.joy = { x: 0, y: 0, pointerId: null };
    els.knob.style.transform = 'translate(-50%, -50%)';
  }

  function controlFrame(now) {
    const seconds = clamp((now - state.lastControlFrame) / 1000, 0, .05);
    state.lastControlFrame = now;
    if (!els.game.classList.contains('is-hidden')) {
      const forward = Number(state.keys.has('ArrowUp') || state.keys.has('KeyW'))
        - Number(state.keys.has('ArrowDown') || state.keys.has('KeyS'));
      const strafe = Number(state.keys.has('ArrowRight') || state.keys.has('KeyD'))
        - Number(state.keys.has('ArrowLeft') || state.keys.has('KeyA'));
      const length = Math.hypot(forward, strafe) || 1;
      if (forward || strafe || state.joy.pointerId !== null) {
        renderer.move((forward / length * 3.1 - state.joy.y * 2.6) * seconds, strafe / length * 3.1 * seconds);
      }
    }
    if (state.joy.pointerId !== null) {
      renderer.rotate(-state.joy.x * seconds * 250, 0);
    }
    requestAnimationFrame(controlFrame);
  }

  function returnToStart() {
    clearInterval(state.timerId);
    state.keys.clear();
    state.roundId += 1;
    state.running = false;
    state.transitioning = false;
    els.result.classList.add('is-hidden');
    els.ready.classList.add('is-hidden');
    els.game.classList.add('is-hidden');
    els.start.classList.remove('is-hidden');
  }

  $$('.scene-card').forEach((button) => button.addEventListener('click', () => startGame(button.dataset.theme)));
  $('#exitButton').addEventListener('click', returnToStart);
  $('#replayButton').addEventListener('click', () => startGame(state.theme));
  $('#changeSceneButton').addEventListener('click', returnToStart);
  els.captureButton.addEventListener('click', capture);
  els.soundButton.addEventListener('click', () => {
    state.sound = !state.sound;
    els.soundButton.textContent = state.sound ? '♫' : '×';
    els.soundButton.setAttribute('aria-label', state.sound ? '关闭声音' : '打开声音');
  });

  els.viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.game-hud, .bottom-controls')) return;
    state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    els.viewport.setPointerCapture(event.pointerId);
  });
  els.viewport.addEventListener('pointermove', (event) => {
    if (!state.drag || state.drag.id !== event.pointerId) return;
    const dx = event.clientX - state.drag.x;
    const dy = event.clientY - state.drag.y;
    state.drag.x = event.clientX;
    state.drag.y = event.clientY;
    renderer.rotate(dx, dy);
  });
  els.viewport.addEventListener('pointerup', () => { state.drag = null; });
  els.viewport.addEventListener('pointercancel', () => { state.drag = null; });
  els.viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    renderer.zoom(event.deltaY * .018);
  }, { passive: false });

  els.joystick.addEventListener('pointerdown', (event) => {
    state.joy.pointerId = event.pointerId;
    els.joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });
  els.joystick.addEventListener('pointermove', (event) => {
    if (state.joy.pointerId === event.pointerId) updateJoystick(event);
  });
  els.joystick.addEventListener('pointerup', releaseJoystick);
  els.joystick.addEventListener('pointercancel', releaseJoystick);

  const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
  window.addEventListener('keydown', (event) => {
    if (els.game.classList.contains('is-hidden')) return;
    if (movementKeys.has(event.code)) {
      event.preventDefault();
      state.keys.add(event.code);
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) capture();
    }
  });
  window.addEventListener('keyup', (event) => state.keys.delete(event.code));
  window.addEventListener('blur', () => state.keys.clear());
  window.addEventListener('resize', () => renderer.resize());
  requestAnimationFrame(controlFrame);

  const modelContext = document.modelContext;
  if (modelContext && modelContext.registerTool) {
    const tool = {
      name: 'start_peppered_moth_experiment',
      title: '开始桦尺蛾捕食实验',
      description: '选择浅色或深色森林，并在当前页面开始一局新的三维捕食实验。',
      inputSchema: {
        type: 'object',
        properties: { environment: { type: 'string', enum: ['pale', 'dark'] } },
        required: ['environment'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !['pale', 'dark'].includes(input.environment)) throw new Error('environment 必须是 pale 或 dark');
        startGame(input.environment);
        return {
          started: true,
          renderMode: 'WebGL 3D',
          environment: input.environment,
          initialLightMoths: 10,
          initialDarkMoths: 10,
          targetCaptures: 10,
          timeLimitSeconds: 60
        };
      }
    };
    try {
      Promise.resolve(modelContext.registerTool(tool)).catch(() => {});
    } catch (_) {
      // Older browsers may expose an incomplete draft API.
    }
  }
})();

