import{r as e}from"./rolldown-runtime-QTnfLwEv.js";import{i as t}from"./vendor-react-CcBvSIYo.js";import{$a as n,$i as r,A as i,U as a,eo as o,j as s,rr as c}from"./vendor-3d-Co-9pgkG.js";import{t as l}from"./vendor-3d-DVjKscQ6.js";var u=e(t(),1);typeof window<`u`&&(window.document?.createElement||window.navigator?.product===`ReactNative`)?u.useLayoutEffect:u.useEffect;function d(e,t,n){if(!e)return;if(n(e)===!0)return e;let r=t?e.return:e.child;for(;r;){let e=d(r,t,n);if(e)return e;r=t?null:r.sibling}}function f(e){try{return Object.defineProperties(e,{_currentRenderer:{get(){return null},set(){}},_currentRenderer2:{get(){return null},set(){}}})}catch{return e}}var p=f(u.createContext(null)),m=class extends u.Component{render(){return u.createElement(p.Provider,{value:this._reactInternals},this.props.children)}};function h(){let e=u.useContext(p);if(e===null)throw Error(`its-fine: useFiber must be called within a <FiberProvider />!`);let t=u.useId();return u.useMemo(()=>{for(let n of[e,e?.alternate]){if(!n)continue;let e=d(n,!1,e=>{let n=e.memoizedState;for(;n;){if(n.memoizedState===t)return!0;n=n.next}});if(e)return e}},[e,t])}var g=Symbol.for(`react.context`),_=e=>typeof e==`object`&&!!e&&`$$typeof`in e&&e.$$typeof===g;function v(){let e=h(),[t]=u.useState(()=>new Map);t.clear();let n=e;for(;n;){let e=n.type;_(e)&&e!==p&&!t.has(e)&&t.set(e,u.use(f(e))),n=n.return}return t}function y(){let e=v();return u.useMemo(()=>Array.from(e.keys()).reduce((t,n)=>r=>u.createElement(t,null,u.createElement(n.Provider,{...r,value:e.get(n)})),e=>u.createElement(m,{...e})),[e])}function b(e,t){let n;return(...r)=>{window.clearTimeout(n),n=window.setTimeout(()=>e(...r),t)}}function x({debounce:e,scroll:t,polyfill:n,offsetSize:r}={debounce:0,scroll:!1,offsetSize:!1}){let i=n||(typeof window>`u`?class{}:window.ResizeObserver);if(!i)throw Error(`This browser does not support ResizeObserver out of the box. See: https://github.com/react-spring/react-use-measure/#resize-observer-polyfills`);let[a,o]=(0,u.useState)({left:0,top:0,width:0,height:0,bottom:0,right:0,x:0,y:0}),s=(0,u.useRef)({element:null,scrollContainers:null,resizeObserver:null,lastBounds:a,orientationHandler:null}),c=e?typeof e==`number`?e:e.scroll:null,l=e?typeof e==`number`?e:e.resize:null,d=(0,u.useRef)(!1);(0,u.useEffect)(()=>(d.current=!0,()=>void(d.current=!1)));let[f,p,m]=(0,u.useMemo)(()=>{let e=()=>{if(!s.current.element)return;let{left:e,top:t,width:n,height:i,bottom:a,right:c,x:l,y:u}=s.current.element.getBoundingClientRect(),f={left:e,top:t,width:n,height:i,bottom:a,right:c,x:l,y:u};s.current.element instanceof HTMLElement&&r&&(f.height=s.current.element.offsetHeight,f.width=s.current.element.offsetWidth),Object.freeze(f),d.current&&!E(s.current.lastBounds,f)&&o(s.current.lastBounds=f)};return[e,l?b(e,l):e,c?b(e,c):e]},[o,r,c,l]);function h(){s.current.scrollContainers&&(s.current.scrollContainers.forEach(e=>e.removeEventListener(`scroll`,m,!0)),s.current.scrollContainers=null),s.current.resizeObserver&&(s.current.resizeObserver.disconnect(),s.current.resizeObserver=null),s.current.orientationHandler&&(`orientation`in screen&&`removeEventListener`in screen.orientation?screen.orientation.removeEventListener(`change`,s.current.orientationHandler):`onorientationchange`in window&&window.removeEventListener(`orientationchange`,s.current.orientationHandler))}function g(){s.current.element&&(s.current.resizeObserver=new i(m),s.current.resizeObserver.observe(s.current.element),t&&s.current.scrollContainers&&s.current.scrollContainers.forEach(e=>e.addEventListener(`scroll`,m,{capture:!0,passive:!0})),s.current.orientationHandler=()=>{m()},`orientation`in screen&&`addEventListener`in screen.orientation?screen.orientation.addEventListener(`change`,s.current.orientationHandler):`onorientationchange`in window&&window.addEventListener(`orientationchange`,s.current.orientationHandler))}return C(m,!!t),S(p),(0,u.useEffect)(()=>{h(),g()},[t,m,p]),(0,u.useEffect)(()=>h,[]),[e=>{!e||e===s.current.element||(h(),s.current.element=e,s.current.scrollContainers=w(e),g())},a,f]}function S(e){(0,u.useEffect)(()=>{let t=e;return window.addEventListener(`resize`,t),()=>void window.removeEventListener(`resize`,t)},[e])}function C(e,t){(0,u.useEffect)(()=>{if(t){let t=e;return window.addEventListener(`scroll`,t,{capture:!0,passive:!0}),()=>void window.removeEventListener(`scroll`,t,!0)}},[e,t])}function w(e){let t=[];if(!e||e===document.body)return t;let{overflow:n,overflowX:r,overflowY:i}=window.getComputedStyle(e);return[n,r,i].some(e=>e===`auto`||e===`scroll`)&&t.push(e),[...t,...w(e.parentElement)]}var T=[`x`,`y`,`top`,`bottom`,`left`,`right`,`width`,`height`],E=(e,t)=>T.every(n=>e[n]===t[n]),D=Object.defineProperty,O=(e,t,n)=>t in e?D(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,k=(e,t,n)=>(O(e,typeof t==`symbol`?t:t+``,n),n);function A(e,t,n,r,i){let a;if(e=e.subarray||e.slice?e:e.buffer,n=n.subarray||n.slice?n:n.buffer,e=t?e.subarray?e.subarray(t,i&&t+i):e.slice(t,i&&t+i):e,n.set)n.set(e,r);else for(a=0;a<e.length;a++)n[a+r]=e[a];return n}function j(e){return e instanceof Float32Array?e:e instanceof s?e.getAttribute(`position`).array:e.map(e=>{let t=Array.isArray(e);return e instanceof o?[e.x,e.y,e.z]:e instanceof n?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e}).flat()}var M=class extends s{constructor(){super(),k(this,`type`,`MeshLine`),k(this,`isMeshLine`,!0),k(this,`positions`,[]),k(this,`previous`,[]),k(this,`next`,[]),k(this,`side`,[]),k(this,`width`,[]),k(this,`indices_array`,[]),k(this,`uvs`,[]),k(this,`counters`,[]),k(this,`widthCallback`,null),k(this,`_attributes`),k(this,`_points`,[]),k(this,`points`),k(this,`matrixWorld`,new c),Object.defineProperties(this,{points:{enumerable:!0,get(){return this._points},set(e){this.setPoints(e,this.widthCallback)}}})}setMatrixWorld(e){this.matrixWorld=e}setPoints(e,t){if(e=j(e),this._points=e,this.widthCallback=t??null,this.positions=[],this.counters=[],e.length&&e[0]instanceof o)for(let t=0;t<e.length;t++){let n=e[t],r=t/(e.length-1);this.positions.push(n.x,n.y,n.z),this.positions.push(n.x,n.y,n.z),this.counters.push(r),this.counters.push(r)}else for(let t=0;t<e.length;t+=3){let n=t/(e.length-1);this.positions.push(e[t],e[t+1],e[t+2]),this.positions.push(e[t],e[t+1],e[t+2]),this.counters.push(n),this.counters.push(n)}this.process()}compareV3(e,t){let n=e*6,r=t*6;return this.positions[n]===this.positions[r]&&this.positions[n+1]===this.positions[r+1]&&this.positions[n+2]===this.positions[r+2]}copyV3(e){let t=e*6;return[this.positions[t],this.positions[t+1],this.positions[t+2]]}process(){let e=this.positions.length/6;this.previous=[],this.next=[],this.side=[],this.width=[],this.indices_array=[],this.uvs=[];let t,n;n=this.compareV3(0,e-1)?this.copyV3(e-2):this.copyV3(0),this.previous.push(n[0],n[1],n[2]),this.previous.push(n[0],n[1],n[2]);for(let r=0;r<e;r++){if(this.side.push(1),this.side.push(-1),t=this.widthCallback?this.widthCallback(r/(e-1)):1,this.width.push(t),this.width.push(t),this.uvs.push(r/(e-1),0),this.uvs.push(r/(e-1),1),r<e-1){n=this.copyV3(r),this.previous.push(n[0],n[1],n[2]),this.previous.push(n[0],n[1],n[2]);let e=r*2;this.indices_array.push(e,e+1,e+2),this.indices_array.push(e+2,e+1,e+3)}r>0&&(n=this.copyV3(r),this.next.push(n[0],n[1],n[2]),this.next.push(n[0],n[1],n[2]))}n=this.compareV3(e-1,0)?this.copyV3(1):this.copyV3(e-1),this.next.push(n[0],n[1],n[2]),this.next.push(n[0],n[1],n[2]),!this._attributes||this._attributes.position.count!==this.counters.length?this._attributes={position:new i(new Float32Array(this.positions),3),previous:new i(new Float32Array(this.previous),3),next:new i(new Float32Array(this.next),3),side:new i(new Float32Array(this.side),1),width:new i(new Float32Array(this.width),1),uv:new i(new Float32Array(this.uvs),2),index:new i(new Uint16Array(this.indices_array),1),counters:new i(new Float32Array(this.counters),1)}:(this._attributes.position.copyArray(new Float32Array(this.positions)),this._attributes.position.needsUpdate=!0,this._attributes.previous.copyArray(new Float32Array(this.previous)),this._attributes.previous.needsUpdate=!0,this._attributes.next.copyArray(new Float32Array(this.next)),this._attributes.next.needsUpdate=!0,this._attributes.side.copyArray(new Float32Array(this.side)),this._attributes.side.needsUpdate=!0,this._attributes.width.copyArray(new Float32Array(this.width)),this._attributes.width.needsUpdate=!0,this._attributes.uv.copyArray(new Float32Array(this.uvs)),this._attributes.uv.needsUpdate=!0,this._attributes.index.copyArray(new Uint16Array(this.indices_array)),this._attributes.index.needsUpdate=!0),this.setAttribute(`position`,this._attributes.position),this.setAttribute(`previous`,this._attributes.previous),this.setAttribute(`next`,this._attributes.next),this.setAttribute(`side`,this._attributes.side),this.setAttribute(`width`,this._attributes.width),this.setAttribute(`uv`,this._attributes.uv),this.setAttribute(`counters`,this._attributes.counters),this.setAttribute(`position`,this._attributes.position),this.setAttribute(`previous`,this._attributes.previous),this.setAttribute(`next`,this._attributes.next),this.setAttribute(`side`,this._attributes.side),this.setAttribute(`width`,this._attributes.width),this.setAttribute(`uv`,this._attributes.uv),this.setAttribute(`counters`,this._attributes.counters),this.setIndex(this._attributes.index),this.computeBoundingSphere(),this.computeBoundingBox()}advance({x:e,y:t,z:n}){let r=this._attributes.position.array,i=this._attributes.previous.array,a=this._attributes.next.array,o=r.length;A(r,0,i,0,o),A(r,6,r,0,o-6),r[o-6]=e,r[o-5]=t,r[o-4]=n,r[o-3]=e,r[o-2]=t,r[o-1]=n,A(r,6,a,0,o-6),a[o-6]=e,a[o-5]=t,a[o-4]=n,a[o-3]=e,a[o-2]=t,a[o-1]=n,this._attributes.position.needsUpdate=!0,this._attributes.previous.needsUpdate=!0,this._attributes.next.needsUpdate=!0}},N=`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <fog_pars_vertex>
  #include <clipping_planes_pars_vertex>

  attribute vec3 previous;
  attribute vec3 next;
  attribute float side;
  attribute float width;
  attribute float counters;
  
  uniform vec2 resolution;
  uniform float lineWidth;
  uniform vec3 color;
  uniform float opacity;
  uniform float sizeAttenuation;
  
  varying vec2 vUV;
  varying vec4 vColor;
  varying float vCounters;
  
  vec2 fix(vec4 i, float aspect) {
    vec2 res = i.xy / i.w;
    res.x *= aspect;
    return res;
  }
  
  void main() {
    float aspect = resolution.x / resolution.y;
    vColor = vec4(color, opacity);
    vUV = uv;
    vCounters = counters;
  
    mat4 m = projectionMatrix * modelViewMatrix;
    vec4 finalPosition = m * vec4(position, 1.0) * aspect;
    vec4 prevPos = m * vec4(previous, 1.0);
    vec4 nextPos = m * vec4(next, 1.0);
  
    vec2 currentP = fix(finalPosition, aspect);
    vec2 prevP = fix(prevPos, aspect);
    vec2 nextP = fix(nextPos, aspect);
  
    float w = lineWidth * width;
  
    vec2 dir;
    if (nextP == currentP) dir = normalize(currentP - prevP);
    else if (prevP == currentP) dir = normalize(nextP - currentP);
    else {
      vec2 dir1 = normalize(currentP - prevP);
      vec2 dir2 = normalize(nextP - currentP);
      dir = normalize(dir1 + dir2);
  
      vec2 perp = vec2(-dir1.y, dir1.x);
      vec2 miter = vec2(-dir.y, dir.x);
      //w = clamp(w / dot(miter, perp), 0., 4. * lineWidth * width);
    }
  
    //vec2 normal = (cross(vec3(dir, 0.), vec3(0., 0., 1.))).xy;
    vec4 normal = vec4(-dir.y, dir.x, 0., 1.);
    normal.xy *= .5 * w;
    //normal *= projectionMatrix;
    if (sizeAttenuation == 0.) {
      normal.xy *= finalPosition.w;
      normal.xy /= (vec4(resolution, 0., 1.) * projectionMatrix).xy * aspect;
    }
  
    finalPosition.xy += normal.xy * side;
    gl_Position = finalPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    #include <clipping_planes_vertex>
    #include <fog_vertex>
  }
`,P=`
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  #include <clipping_planes_pars_fragment>
  
  uniform sampler2D map;
  uniform sampler2D alphaMap;
  uniform float useGradient;
  uniform float useMap;
  uniform float useAlphaMap;
  uniform float useDash;
  uniform float dashArray;
  uniform float dashOffset;
  uniform float dashRatio;
  uniform float visibility;
  uniform float alphaTest;
  uniform vec2 repeat;
  uniform vec3 gradient[2];
  
  varying vec2 vUV;
  varying vec4 vColor;
  varying float vCounters;
  
  void main() {
    #include <logdepthbuf_fragment>
    vec4 diffuseColor = vColor;
    if (useGradient == 1.) diffuseColor = vec4(mix(gradient[0], gradient[1], vCounters), 1.0);
    if (useMap == 1.) diffuseColor *= texture2D(map, vUV * repeat);
    if (useAlphaMap == 1.) diffuseColor.a *= texture2D(alphaMap, vUV * repeat).a;
    if (diffuseColor.a < alphaTest) discard;
    if (useDash == 1.) diffuseColor.a *= ceil(mod(vCounters + dashOffset, dashArray) - (dashArray * dashRatio));
    diffuseColor.a *= step(vCounters, visibility);
    #include <clipping_planes_fragment>
    gl_FragColor = diffuseColor;     
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <${parseInt(`185`.replace(/\D+/g,``))>=154?`colorspace_fragment`:`encodings_fragment`}>
  }
`,F=class extends r{constructor(e){super({uniforms:{...l.fog,lineWidth:{value:1},map:{value:null},useMap:{value:0},alphaMap:{value:null},useAlphaMap:{value:0},color:{value:new a(16777215)},gradient:{value:[new a(16711680),new a(65280)]},opacity:{value:1},resolution:{value:new n(1,1)},sizeAttenuation:{value:1},dashArray:{value:0},dashOffset:{value:0},dashRatio:{value:.5},useDash:{value:0},useGradient:{value:0},visibility:{value:1},alphaTest:{value:0},repeat:{value:new n(1,1)}},vertexShader:N,fragmentShader:P}),k(this,`lineWidth`),k(this,`map`),k(this,`useMap`),k(this,`alphaMap`),k(this,`useAlphaMap`),k(this,`color`),k(this,`gradient`),k(this,`resolution`),k(this,`sizeAttenuation`),k(this,`dashArray`),k(this,`dashOffset`),k(this,`dashRatio`),k(this,`useDash`),k(this,`useGradient`),k(this,`visibility`),k(this,`repeat`),this.type=`MeshLineMaterial`,Object.defineProperties(this,{lineWidth:{enumerable:!0,get(){return this.uniforms.lineWidth.value},set(e){this.uniforms.lineWidth.value=e}},map:{enumerable:!0,get(){return this.uniforms.map.value},set(e){this.uniforms.map.value=e}},useMap:{enumerable:!0,get(){return this.uniforms.useMap.value},set(e){this.uniforms.useMap.value=e}},alphaMap:{enumerable:!0,get(){return this.uniforms.alphaMap.value},set(e){this.uniforms.alphaMap.value=e}},useAlphaMap:{enumerable:!0,get(){return this.uniforms.useAlphaMap.value},set(e){this.uniforms.useAlphaMap.value=e}},color:{enumerable:!0,get(){return this.uniforms.color.value},set(e){this.uniforms.color.value=e}},gradient:{enumerable:!0,get(){return this.uniforms.gradient.value},set(e){this.uniforms.gradient.value=e}},opacity:{enumerable:!0,get(){return this.uniforms.opacity.value},set(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get(){return this.uniforms.resolution.value},set(e){this.uniforms.resolution.value.copy(e)}},sizeAttenuation:{enumerable:!0,get(){return this.uniforms.sizeAttenuation.value},set(e){this.uniforms.sizeAttenuation.value=e}},dashArray:{enumerable:!0,get(){return this.uniforms.dashArray.value},set(e){this.uniforms.dashArray.value=e,this.useDash=e===0?0:1}},dashOffset:{enumerable:!0,get(){return this.uniforms.dashOffset.value},set(e){this.uniforms.dashOffset.value=e}},dashRatio:{enumerable:!0,get(){return this.uniforms.dashRatio.value},set(e){this.uniforms.dashRatio.value=e}},useDash:{enumerable:!0,get(){return this.uniforms.useDash.value},set(e){this.uniforms.useDash.value=e}},useGradient:{enumerable:!0,get(){return this.uniforms.useGradient.value},set(e){this.uniforms.useGradient.value=e}},visibility:{enumerable:!0,get(){return this.uniforms.visibility.value},set(e){this.uniforms.visibility.value=e}},alphaTest:{enumerable:!0,get(){return this.uniforms.alphaTest.value},set(e){this.uniforms.alphaTest.value=e}},repeat:{enumerable:!0,get(){return this.uniforms.repeat.value},set(e){this.uniforms.repeat.value.copy(e)}}}),this.setValues(e)}copy(e){return super.copy(e),this.lineWidth=e.lineWidth,this.map=e.map,this.useMap=e.useMap,this.alphaMap=e.alphaMap,this.useAlphaMap=e.useAlphaMap,this.color.copy(e.color),this.gradient=e.gradient,this.opacity=e.opacity,this.resolution.copy(e.resolution),this.sizeAttenuation=e.sizeAttenuation,this.dashArray=e.dashArray,this.dashOffset=e.dashOffset,this.dashRatio=e.dashRatio,this.useDash=e.useDash,this.useGradient=e.useGradient,this.visibility=e.visibility,this.alphaTest=e.alphaTest,this.repeat.copy(e.repeat),this}};export{d as a,h as i,F as n,m as o,x as r,y as s,M as t};