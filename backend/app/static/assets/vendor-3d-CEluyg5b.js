import{r as e}from"./rolldown-runtime-QTnfLwEv.js";import{i as t,n}from"./vendor-react-CcBvSIYo.js";import{$a as r,$i as i,Aa as a,Er as o,Ha as s,Ln as c,Or as l,Rt as u,U as d,Wa as f,Yt as p,bt as m,co as h,eo as g,er as _,ka as v,kr as y,to as b}from"./vendor-3d-Co-9pgkG.js";import{a as x,d as S,l as C,p as w}from"./vendor-3d-CqMMcnsU.js";import{t as T}from"./vendor-3d-CvVTau-c.js";import{a as E,i as D,n as O,o as k,r as A,t as j}from"./vendor-3d-DYQSoBc4.js";var M=e(t()),N=e(n()),P=new g,F=new g,I=new g,L=new r;function ee(e,t,n){let r=P.setFromMatrixPosition(e.matrixWorld);r.project(t);let i=n.width/2,a=n.height/2;return[r.x*i+i,-(r.y*a)+a]}function te(e,t){let n=P.setFromMatrixPosition(e.matrixWorld),r=F.setFromMatrixPosition(t.matrixWorld),i=n.sub(r),a=t.getWorldDirection(I);return i.angleTo(a)>Math.PI/2}function ne(e,t,n,r){let i=P.setFromMatrixPosition(e.matrixWorld),a=i.clone();a.project(t),L.set(a.x,a.y),n.setFromCamera(L,t);let o=n.intersectObjects(r,!0);if(o.length){let e=o[0].distance;return i.distanceTo(n.ray.origin)<e}return!0}function re(e,t){if(t instanceof o)return t.zoom;if(t instanceof l){let n=P.setFromMatrixPosition(e.matrixWorld),r=F.setFromMatrixPosition(t.matrixWorld),i=t.fov*Math.PI/180,a=n.distanceTo(r);return 1/(2*Math.tan(i/2)*a)}else return 1}function ie(e,t,n){if(t instanceof l||t instanceof o){let r=P.setFromMatrixPosition(e.matrixWorld),i=F.setFromMatrixPosition(t.matrixWorld),a=r.distanceTo(i),o=(n[1]-n[0])/(t.far-t.near),s=n[1]-o*t.far;return Math.round(o*a+s)}}var R=e=>Math.abs(e)<1e-10?0:e;function z(e,t,n=``){let r=`matrix3d(`;for(let n=0;n!==16;n++)r+=R(t[n]*e.elements[n])+(n===15?`)`:`,`);return n+r}var B=(e=>t=>z(t,e))([1,-1,1,1,1,-1,1,1,1,-1,1,1,1,-1,1,1]),ae=(e=>(t,n)=>z(t,e(n),`translate(-50%,-50%)`))(e=>[1/e,1/e,1/e,1,-1/e,-1/e,-1/e,-1,1/e,1/e,1/e,1,1,1,1,1]);function oe(e){return e&&typeof e==`object`&&`current`in e}var V=M.forwardRef(({children:e,eps:t=.001,style:n,className:r,prepend:i,center:a,fullscreen:o,portal:s,distanceFactor:c,sprite:l=!1,transform:u=!1,occlude:d,onOcclude:f,castShadow:p,receiveShadow:m,material:h,geometry:_,zIndexRange:v=[16777271,0],calculatePosition:y=ee,as:b=`div`,wrapperClass:x,pointerEvents:S=`auto`,...E},D)=>{let{gl:O,camera:k,scene:A,size:j,raycaster:P,events:F,viewport:I}=w(),[L]=M.useState(()=>document.createElement(b)),z=M.useRef(null),V=M.useRef(null),H=M.useRef(0),U=M.useRef([0,0]),W=M.useRef(null),G=M.useRef(null),K=s?.current||F.connected||O.domElement.parentNode,q=M.useRef(null),J=M.useRef(!1),Y=M.useMemo(()=>d&&d!==`blending`||Array.isArray(d)&&d.length&&oe(d[0]),[d]);M.useLayoutEffect(()=>{let e=O.domElement;d&&d===`blending`?(e.style.zIndex=`${Math.floor(v[0]/2)}`,e.style.position=`absolute`,e.style.pointerEvents=`none`):(e.style.zIndex=null,e.style.position=null,e.style.pointerEvents=null)},[d]),M.useLayoutEffect(()=>{if(V.current){let e=z.current=N.createRoot(L);if(A.updateMatrixWorld(),u)L.style.cssText=`position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;`;else{let e=y(V.current,k,j);L.style.cssText=`position:absolute;top:0;left:0;transform:translate3d(${e[0]}px,${e[1]}px,0);transform-origin:0 0;`}return K&&(i?K.prepend(L):K.appendChild(L)),()=>{K&&K.removeChild(L),e.unmount()}}},[K,u]),M.useLayoutEffect(()=>{x&&(L.className=x)},[x]);let X=M.useMemo(()=>u?{position:`absolute`,top:0,left:0,width:j.width,height:j.height,transformStyle:`preserve-3d`,pointerEvents:`none`}:{position:`absolute`,transform:a?`translate3d(-50%,-50%,0)`:`none`,...o&&{top:-j.height/2,left:-j.width/2,width:j.width,height:j.height},...n},[n,a,o,j,u]),Z=M.useMemo(()=>({position:`absolute`,pointerEvents:S}),[S]);M.useLayoutEffect(()=>{if(J.current=!1,u){var t;(t=z.current)==null||t.render(M.createElement(`div`,{ref:W,style:X},M.createElement(`div`,{ref:G,style:Z},M.createElement(`div`,{ref:D,className:r,style:n,children:e}))))}else{var i;(i=z.current)==null||i.render(M.createElement(`div`,{ref:D,style:X,className:r,children:e}))}});let Q=M.useRef(!0);C(e=>{if(V.current){k.updateMatrixWorld(),V.current.updateWorldMatrix(!0,!1);let e=u?U.current:y(V.current,k,j);if(u||Math.abs(H.current-k.zoom)>t||Math.abs(U.current[0]-e[0])>t||Math.abs(U.current[1]-e[1])>t){let t=te(V.current,k),n=!1;Y&&(Array.isArray(d)?n=d.map(e=>e.current):d!==`blending`&&(n=[A]));let r=Q.current;if(n){let e=ne(V.current,k,P,n);Q.current=e&&!t}else Q.current=!t;r!==Q.current&&(f?f(!Q.current):L.style.display=Q.current?`block`:`none`);let i=Math.floor(v[0]/2),a=d?Y?[v[0],i]:[i-1,0]:v;if(L.style.zIndex=`${ie(V.current,k,a)}`,u){let[e,t]=[j.width/2,j.height/2],n=k.projectionMatrix.elements[5]*t,{isOrthographicCamera:r,top:i,left:a,bottom:o,right:s}=k,u=B(k.matrixWorldInverse),d=r?`scale(${n})translate(${R(-(s+a)/2)}px,${R((i+o)/2)}px)`:`translateZ(${n}px)`,f=V.current.matrixWorld;l&&(f=k.matrixWorldInverse.clone().transpose().copyPosition(f).scale(V.current.scale),f.elements[3]=f.elements[7]=f.elements[11]=0,f.elements[15]=1),L.style.width=j.width+`px`,L.style.height=j.height+`px`,L.style.perspective=r?``:`${n}px`,W.current&&G.current&&(W.current.style.transform=`${d}${u}translate(${e}px,${t}px)`,G.current.style.transform=ae(f,1/((c||10)/400)))}else{let t=c===void 0?1:re(V.current,k)*c;L.style.transform=`translate3d(${e[0]}px,${e[1]}px,0) scale(${t})`}U.current=e,H.current=k.zoom}}if(!Y&&q.current&&!J.current)if(u){if(W.current){let e=W.current.children[0];if(e!=null&&e.clientWidth&&e!=null&&e.clientHeight){let{isOrthographicCamera:t}=k;if(t||_)E.scale&&(Array.isArray(E.scale)?E.scale instanceof g?q.current.scale.copy(E.scale.clone().divideScalar(1)):q.current.scale.set(1/E.scale[0],1/E.scale[1],1/E.scale[2]):q.current.scale.setScalar(1/E.scale));else{let t=(c||10)/400,n=e.clientWidth*t,r=e.clientHeight*t;q.current.scale.set(n,r,1)}J.current=!0}}}else{let t=L.children[0];if(t!=null&&t.clientWidth&&t!=null&&t.clientHeight){let e=1/I.factor,n=t.clientWidth*e,r=t.clientHeight*e;q.current.scale.set(n,r,1),J.current=!0}q.current.lookAt(e.camera.position)}});let $=M.useMemo(()=>({vertexShader:u?void 0:`
          /*
            This shader is from the THREE's SpriteMaterial.
            We need to turn the backing plane into a Sprite
            (make it always face the camera) if "transfrom"
            is false.
          */
          #include <common>

          void main() {
            vec2 center = vec2(0., 1.);
            float rotation = 0.0;

            // This is somewhat arbitrary, but it seems to work well
            // Need to figure out how to derive this dynamically if it even matters
            float size = 0.03;

            vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
            vec2 scale;
            scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
            scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );

            bool isPerspective = isPerspectiveMatrix( projectionMatrix );
            if ( isPerspective ) scale *= - mvPosition.z;

            vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale * size;
            vec2 rotatedPosition;
            rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
            rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
            mvPosition.xy += rotatedPosition;

            gl_Position = projectionMatrix * mvPosition;
          }
      `,fragmentShader:`
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `}),[u]);return M.createElement(`group`,T({},E,{ref:V}),d&&!Y&&M.createElement(`mesh`,{castShadow:p,receiveShadow:m,ref:q},_||M.createElement(`planeGeometry`,null),h||M.createElement(`shaderMaterial`,{side:2,vertexShader:$.vertexShader,fragmentShader:$.fragmentShader})))}),H=M.forwardRef(function({points:e,color:t=16777215,vertexColors:n,linewidth:i,lineWidth:a,segments:o,dashed:s,...c},l){var u;let f=w(e=>e.size),p=M.useMemo(()=>o?new O:new j,[o]),[m]=M.useState(()=>new A),h=(n==null||(u=n[0])==null?void 0:u.length)===4?4:3,_=M.useMemo(()=>{let i=o?new E:new D,a=e.map(e=>{let t=Array.isArray(e);return e instanceof g||e instanceof b?[e.x,e.y,e.z]:e instanceof r?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e});if(i.setPositions(a.flat()),n){t=16777215;let e=n.map(e=>e instanceof d?e.toArray():e);i.setColors(e.flat(),h)}return i},[e,o,n,h]);return M.useLayoutEffect(()=>{p.computeLineDistances()},[e,p]),M.useLayoutEffect(()=>{s?m.defines.USE_DASH=``:delete m.defines.USE_DASH,m.needsUpdate=!0},[s,m]),M.useEffect(()=>()=>{_.dispose(),m.dispose()},[_]),M.createElement(`primitive`,T({object:p,ref:l},c),M.createElement(`primitive`,{object:_,attach:`geometry`}),M.createElement(`primitive`,T({object:m,attach:`material`,color:t,vertexColors:!!n,resolution:[f.width,f.height],linewidth:i??a??1,dashed:s,transparent:h===4},c)))});function U(e,t,n,r){var a;return a=class extends i{constructor(i){super({vertexShader:t,fragmentShader:n,...i});for(let t in e)this.uniforms[t]=new s(e[t]),Object.defineProperty(this,t,{get(){return this.uniforms[t].value},set(e){this.uniforms[t].value=e}});this.uniforms=f.clone(this.uniforms),r?.(this)}},a.key=_.generateUUID(),a}var W=e=>e===Object(e)&&!Array.isArray(e)&&typeof e!=`function`;function G(e,t){let n=w(e=>e.gl),r=S(a,W(e)?Object.values(e):e);return(0,M.useLayoutEffect)(()=>{t?.(r)},[t]),(0,M.useEffect)(()=>{if(`initTexture`in n){let e=[];Array.isArray(r)?e=r:r instanceof v?e=[r]:W(r)&&(e=Object.values(r)),e.forEach(e=>{e instanceof v&&n.initTexture(e)})}},[n,r]),(0,M.useMemo)(()=>{if(W(e)){let t={},n=0;for(let i in e)t[i]=r[n++];return t}else return r},[e,r])}G.preload=e=>S.preload(a,e),G.clear=e=>S.clear(a,e);var K=parseInt(`185`.replace(/\D+/g,``));function q(e,t,n){let r=w(e=>e.size),i=w(e=>e.viewport),a=typeof e==`number`?e:r.width*i.dpr,o=typeof t==`number`?t:r.height*i.dpr,s=(typeof e==`number`?n:e)||{},{samples:l=0,depth:d,...f}=s,g=d??s.depthBuffer,_=M.useMemo(()=>{let e=new h(a,o,{minFilter:c,magFilter:c,type:p,...f});return g&&(e.depthTexture=new m(a,o,u)),e.samples=l,e},[]);return M.useLayoutEffect(()=>{_.setSize(a,o),l&&(_.samples=l)},[l,_,a,o]),M.useEffect(()=>()=>_.dispose(),[]),_}var J=e=>typeof e==`function`,Y=M.forwardRef(({envMap:e,resolution:t=256,frames:n=1/0,makeDefault:r,children:i,...a},o)=>{let s=w(({set:e})=>e),c=w(({camera:e})=>e),l=w(({size:e})=>e),u=M.useRef(null);M.useImperativeHandle(o,()=>u.current,[]);let d=M.useRef(null),f=q(t);M.useLayoutEffect(()=>{a.manual||(u.current.aspect=l.width/l.height)},[l,a]),M.useLayoutEffect(()=>{u.current.updateProjectionMatrix()});let p=0,m=null,h=J(i);return C(t=>{h&&(n===1/0||p<n)&&(d.current.visible=!1,t.gl.setRenderTarget(f),m=t.scene.background,e&&(t.scene.background=e),t.gl.render(t.scene,u.current),t.scene.background=m,t.gl.setRenderTarget(null),d.current.visible=!0,p++)}),M.useLayoutEffect(()=>{if(r){let e=c;return s(()=>({camera:u.current})),()=>s(()=>({camera:e}))}},[u,r,s]),M.createElement(M.Fragment,null,M.createElement(`perspectiveCamera`,T({ref:u},a),!h&&i),M.createElement(`group`,{ref:d},h&&i(f.texture)))}),X=M.forwardRef(({makeDefault:e,camera:t,regress:n,domElement:r,enableDamping:i=!0,keyEvents:a=!1,onChange:o,onStart:s,onEnd:c,...l},u)=>{let d=w(e=>e.invalidate),f=w(e=>e.camera),p=w(e=>e.gl),m=w(e=>e.events),h=w(e=>e.setEvents),g=w(e=>e.set),_=w(e=>e.get),v=w(e=>e.performance),y=t||f,b=r||m.connected||p.domElement,x=M.useMemo(()=>new k(y),[y]);return C(()=>{x.enabled&&x.update()},-1),M.useEffect(()=>(a&&x.connect(a===!0?b:a),x.connect(b),()=>void x.dispose()),[a,b,n,x,d]),M.useEffect(()=>{let e=e=>{d(),n&&v.regress(),o&&o(e)},t=e=>{s&&s(e)},r=e=>{c&&c(e)};return x.addEventListener(`change`,e),x.addEventListener(`start`,t),x.addEventListener(`end`,r),()=>{x.removeEventListener(`start`,t),x.removeEventListener(`end`,r),x.removeEventListener(`change`,e)}},[o,s,c,x,d,h]),M.useEffect(()=>{if(e){let e=_().controls;return g({controls:x}),()=>g({controls:e})}},[e,x]),M.createElement(`primitive`,T({ref:u,object:x,enableDamping:i},l))}),Z=U({cellSize:.5,sectionSize:1,fadeDistance:100,fadeStrength:1,fadeFrom:1,cellThickness:.5,sectionThickness:1,cellColor:new d,sectionColor:new d,infiniteGrid:!1,followCamera:!1,worldCamProjPosition:new g,worldPlanePosition:new g},`
    varying vec3 localPosition;
    varying vec4 worldPosition;

    uniform vec3 worldCamProjPosition;
    uniform vec3 worldPlanePosition;
    uniform float fadeDistance;
    uniform bool infiniteGrid;
    uniform bool followCamera;

    void main() {
      localPosition = position.xzy;
      if (infiniteGrid) localPosition *= 1.0 + fadeDistance;
      
      worldPosition = modelMatrix * vec4(localPosition, 1.0);
      if (followCamera) {
        worldPosition.xyz += (worldCamProjPosition - worldPlanePosition);
        localPosition = (inverse(modelMatrix) * worldPosition).xyz;
      }

      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,`
    varying vec3 localPosition;
    varying vec4 worldPosition;

    uniform vec3 worldCamProjPosition;
    uniform float cellSize;
    uniform float sectionSize;
    uniform vec3 cellColor;
    uniform vec3 sectionColor;
    uniform float fadeDistance;
    uniform float fadeStrength;
    uniform float fadeFrom;
    uniform float cellThickness;
    uniform float sectionThickness;

    float getGrid(float size, float thickness) {
      vec2 r = localPosition.xz / size;
      vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
      float line = min(grid.x, grid.y) + 1.0 - thickness;
      return 1.0 - min(line, 1.0);
    }

    void main() {
      float g1 = getGrid(cellSize, cellThickness);
      float g2 = getGrid(sectionSize, sectionThickness);

      vec3 from = worldCamProjPosition*vec3(fadeFrom);
      float dist = distance(from, worldPosition.xyz);
      float d = 1.0 - min(dist / fadeDistance, 1.0);
      vec3 color = mix(cellColor, sectionColor, min(1.0, sectionThickness * g2));

      gl_FragColor = vec4(color, (g1 + g2) * pow(d, fadeStrength));
      gl_FragColor.a = mix(0.75 * gl_FragColor.a, gl_FragColor.a, g2);
      if (gl_FragColor.a <= 0.0) discard;

      #include <tonemapping_fragment>
      #include <${K>=154?`colorspace_fragment`:`encodings_fragment`}>
    }
  `),Q=M.forwardRef(({args:e,cellColor:t=`#000000`,sectionColor:n=`#2080ff`,cellSize:r=.5,sectionSize:i=1,followCamera:a=!1,infiniteGrid:o=!1,fadeDistance:s=100,fadeStrength:c=1,fadeFrom:l=1,cellThickness:u=.5,sectionThickness:d=1,side:f=1,...p},m)=>{x({GridMaterial:Z});let h=M.useRef(null);M.useImperativeHandle(m,()=>h.current,[]);let _=new y,v=new g(0,1,0),b=new g(0,0,0);C(e=>{_.setFromNormalAndCoplanarPoint(v,b).applyMatrix4(h.current.matrixWorld);let t=h.current.material,n=t.uniforms.worldCamProjPosition,r=t.uniforms.worldPlanePosition;_.projectPoint(e.camera.position,n.value),r.value.set(0,0,0).applyMatrix4(h.current.matrixWorld)});let S={cellSize:r,sectionSize:i,cellColor:t,sectionColor:n,cellThickness:u,sectionThickness:d},w={fadeDistance:s,fadeStrength:c,fadeFrom:l,infiniteGrid:o,followCamera:a};return M.createElement(`mesh`,T({ref:h,frustumCulled:!1},p),M.createElement(`gridMaterial`,T({transparent:!0,"extensions-derivatives":!0,side:f},S,w)),M.createElement(`planeGeometry`,{args:e}))});export{H as a,G as i,X as n,V as o,Y as r,Q as t};