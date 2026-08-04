import{$a as e,$i as t,An as n,Da as r,E as i,Er as a,Fi as o,Lt as s,Or as c,Ur as l,Wa as u,Zn as d,an as f,do as p,eo as m,er as ee,fa as h,ir as g,kr as _,on as v,pn as y,rr as b,to as x,ua as S}from"./vendor-3d-Co-9pgkG.js";import{t as C}from"./vendor-3d-DVjKscQ6.js";var w=parseInt(`185`.replace(/\D+/g,``)),T=w>=125?`uv1`:`uv2`,E=Object.defineProperty,D=(e,t,n)=>t in e?E(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,O=(e,t,n)=>(D(e,typeof t==`symbol`?t:t+``,n),n),te=class{constructor(){O(this,`_listeners`)}addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;let n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;let n=this._listeners[e];if(n!==void 0){let e=n.indexOf(t);e!==-1&&n.splice(e,1)}}dispatchEvent(e){if(this._listeners===void 0)return;let t=this._listeners[e.type];if(t!==void 0){e.target=this;let n=t.slice(0);for(let t=0,r=n.length;t<r;t++)n[t].call(this,e);e.target=null}}},k=Object.defineProperty,A=(e,t,n)=>t in e?k(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,j=(e,t,n)=>(A(e,typeof t==`symbol`?t:t+``,n),n),M=new o,ne=new _,re=Math.cos(Math.PI/180*70),ie=(e,t)=>(e%t+t)%t,N=class extends te{constructor(t,n){super(),j(this,`object`),j(this,`domElement`),j(this,`enabled`,!0),j(this,`target`,new m),j(this,`minDistance`,0),j(this,`maxDistance`,1/0),j(this,`minZoom`,0),j(this,`maxZoom`,1/0),j(this,`minPolarAngle`,0),j(this,`maxPolarAngle`,Math.PI),j(this,`minAzimuthAngle`,-1/0),j(this,`maxAzimuthAngle`,1/0),j(this,`enableDamping`,!1),j(this,`dampingFactor`,.05),j(this,`enableZoom`,!0),j(this,`zoomSpeed`,1),j(this,`enableRotate`,!0),j(this,`rotateSpeed`,1),j(this,`enablePan`,!0),j(this,`panSpeed`,1),j(this,`screenSpacePanning`,!0),j(this,`keyPanSpeed`,7),j(this,`zoomToCursor`,!1),j(this,`autoRotate`,!1),j(this,`autoRotateSpeed`,2),j(this,`reverseOrbit`,!1),j(this,`reverseHorizontalOrbit`,!1),j(this,`reverseVerticalOrbit`,!1),j(this,`keys`,{LEFT:`ArrowLeft`,UP:`ArrowUp`,RIGHT:`ArrowRight`,BOTTOM:`ArrowDown`}),j(this,`mouseButtons`,{LEFT:d.ROTATE,MIDDLE:d.DOLLY,RIGHT:d.PAN}),j(this,`touches`,{ONE:r.ROTATE,TWO:r.DOLLY_PAN}),j(this,`target0`),j(this,`position0`),j(this,`zoom0`),j(this,`_domElementKeyEvents`,null),j(this,`getPolarAngle`),j(this,`getAzimuthalAngle`),j(this,`setPolarAngle`),j(this,`setAzimuthalAngle`),j(this,`getDistance`),j(this,`getZoomScale`),j(this,`listenToKeyEvents`),j(this,`stopListenToKeyEvents`),j(this,`saveState`),j(this,`reset`),j(this,`update`),j(this,`connect`),j(this,`dispose`),j(this,`dollyIn`),j(this,`dollyOut`),j(this,`getScale`),j(this,`setScale`),this.object=t,this.domElement=n,this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this.getPolarAngle=()=>g.phi,this.getAzimuthalAngle=()=>g.theta,this.setPolarAngle=e=>{let t=ie(e,2*Math.PI),n=g.phi;n<0&&(n+=2*Math.PI),t<0&&(t+=2*Math.PI);let r=Math.abs(t-n);2*Math.PI-r<r&&(t<n?t+=2*Math.PI:n+=2*Math.PI),_.phi=t-n,i.update()},this.setAzimuthalAngle=e=>{let t=ie(e,2*Math.PI),n=g.theta;n<0&&(n+=2*Math.PI),t<0&&(t+=2*Math.PI);let r=Math.abs(t-n);2*Math.PI-r<r&&(t<n?t+=2*Math.PI:n+=2*Math.PI),_.theta=t-n,i.update()},this.getDistance=()=>i.object.position.distanceTo(i.target),this.listenToKeyEvents=e=>{e.addEventListener(`keydown`,Se),this._domElementKeyEvents=e},this.stopListenToKeyEvents=()=>{this._domElementKeyEvents.removeEventListener(`keydown`,Se),this._domElementKeyEvents=null},this.saveState=()=>{i.target0.copy(i.target),i.position0.copy(i.object.position),i.zoom0=i.object.zoom},this.reset=()=>{i.target.copy(i.target0),i.object.position.copy(i.position0),i.object.zoom=i.zoom0,i.object.updateProjectionMatrix(),i.dispatchEvent(o),i.update(),p=f.NONE},this.update=(()=>{let e=new m,n=new m(0,1,0),r=new l().setFromUnitVectors(t.up,n),s=r.clone().invert(),u=new m,d=new l,h=2*Math.PI;return function(){let l=i.object.position;r.setFromUnitVectors(t.up,n),s.copy(r).invert(),e.copy(l).sub(i.target),e.applyQuaternion(r),g.setFromVector3(e),i.autoRotate&&p===f.NONE&&L(F()),i.enableDamping?(g.theta+=_.theta*i.dampingFactor,g.phi+=_.phi*i.dampingFactor):(g.theta+=_.theta,g.phi+=_.phi);let b=i.minAzimuthAngle,x=i.maxAzimuthAngle;isFinite(b)&&isFinite(x)&&(b<-Math.PI?b+=h:b>Math.PI&&(b-=h),x<-Math.PI?x+=h:x>Math.PI&&(x-=h),b<=x?g.theta=Math.max(b,Math.min(x,g.theta)):g.theta=g.theta>(b+x)/2?Math.max(b,g.theta):Math.min(x,g.theta)),g.phi=Math.max(i.minPolarAngle,Math.min(i.maxPolarAngle,g.phi)),g.makeSafe(),i.enableDamping===!0?i.target.addScaledVector(y,i.dampingFactor):i.target.add(y),i.zoomToCursor&&A||i.object.isOrthographicCamera?g.radius=K(g.radius):g.radius=K(g.radius*v),e.setFromSpherical(g),e.applyQuaternion(s),l.copy(i.target).add(e),i.object.matrixAutoUpdate||i.object.updateMatrix(),i.object.lookAt(i.target),i.enableDamping===!0?(_.theta*=1-i.dampingFactor,_.phi*=1-i.dampingFactor,y.multiplyScalar(1-i.dampingFactor)):(_.set(0,0,0),y.set(0,0,0));let S=!1;if(i.zoomToCursor&&A){let n=null;if(i.object instanceof c&&i.object.isPerspectiveCamera){let t=e.length();n=K(t*v);let r=t-n;i.object.position.addScaledVector(te,r),i.object.updateMatrixWorld()}else if(i.object.isOrthographicCamera){let t=new m(k.x,k.y,0);t.unproject(i.object),i.object.zoom=Math.max(i.minZoom,Math.min(i.maxZoom,i.object.zoom/v)),i.object.updateProjectionMatrix(),S=!0;let r=new m(k.x,k.y,0);r.unproject(i.object),i.object.position.sub(r).add(t),i.object.updateMatrixWorld(),n=e.length()}else console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled.`),i.zoomToCursor=!1;n!==null&&(i.screenSpacePanning?i.target.set(0,0,-1).transformDirection(i.object.matrix).multiplyScalar(n).add(i.object.position):(M.origin.copy(i.object.position),M.direction.set(0,0,-1).transformDirection(i.object.matrix),Math.abs(i.object.up.dot(M.direction))<re?t.lookAt(i.target):(ne.setFromNormalAndCoplanarPoint(i.object.up,i.target),M.intersectPlane(ne,i.target))))}else i.object instanceof a&&i.object.isOrthographicCamera&&(S=v!==1,S&&(i.object.zoom=Math.max(i.minZoom,Math.min(i.maxZoom,i.object.zoom/v)),i.object.updateProjectionMatrix()));return v=1,A=!1,S||u.distanceToSquared(i.object.position)>ee||8*(1-d.dot(i.object.quaternion))>ee?(i.dispatchEvent(o),u.copy(i.object.position),d.copy(i.object.quaternion),S=!1,!0):!1}})(),this.connect=e=>{i.domElement=e,i.domElement.style.touchAction=`none`,i.domElement.addEventListener(`contextmenu`,Te),i.domElement.addEventListener(`pointerdown`,_e),i.domElement.addEventListener(`pointercancel`,$),i.domElement.addEventListener(`wheel`,xe)},this.dispose=()=>{var e,t,n,r,a,o;i.domElement&&(i.domElement.style.touchAction=`auto`),(e=i.domElement)==null||e.removeEventListener(`contextmenu`,Te),(t=i.domElement)==null||t.removeEventListener(`pointerdown`,_e),(n=i.domElement)==null||n.removeEventListener(`pointercancel`,$),(r=i.domElement)==null||r.removeEventListener(`wheel`,xe),(a=i.domElement)==null||a.ownerDocument.removeEventListener(`pointermove`,ve),(o=i.domElement)==null||o.ownerDocument.removeEventListener(`pointerup`,$),i._domElementKeyEvents!==null&&i._domElementKeyEvents.removeEventListener(`keydown`,Se)};let i=this,o={type:`change`},s={type:`start`},u={type:`end`},f={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},p=f.NONE,ee=1e-6,g=new h,_=new h,v=1,y=new m,b=new e,x=new e,S=new e,C=new e,w=new e,T=new e,E=new e,D=new e,O=new e,te=new m,k=new e,A=!1,N=[],P={};function F(){return 2*Math.PI/60/60*i.autoRotateSpeed}function I(){return .95**i.zoomSpeed}function L(e){i.reverseOrbit||i.reverseHorizontalOrbit?_.theta+=e:_.theta-=e}function R(e){i.reverseOrbit||i.reverseVerticalOrbit?_.phi+=e:_.phi-=e}let z=(()=>{let e=new m;return function(t,n){e.setFromMatrixColumn(n,0),e.multiplyScalar(-t),y.add(e)}})(),B=(()=>{let e=new m;return function(t,n){i.screenSpacePanning===!0?e.setFromMatrixColumn(n,1):(e.setFromMatrixColumn(n,0),e.crossVectors(i.object.up,e)),e.multiplyScalar(t),y.add(e)}})(),V=(()=>{let e=new m;return function(t,n){let r=i.domElement;if(r&&i.object instanceof c&&i.object.isPerspectiveCamera){let a=i.object.position;e.copy(a).sub(i.target);let o=e.length();o*=Math.tan(i.object.fov/2*Math.PI/180),z(2*t*o/r.clientHeight,i.object.matrix),B(2*n*o/r.clientHeight,i.object.matrix)}else r&&i.object instanceof a&&i.object.isOrthographicCamera?(z(t*(i.object.right-i.object.left)/i.object.zoom/r.clientWidth,i.object.matrix),B(n*(i.object.top-i.object.bottom)/i.object.zoom/r.clientHeight,i.object.matrix)):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.`),i.enablePan=!1)}})();function H(e){i.object instanceof c&&i.object.isPerspectiveCamera||i.object instanceof a&&i.object.isOrthographicCamera?v=e:(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),i.enableZoom=!1)}function U(e){H(v/e)}function W(e){H(v*e)}function G(e){if(!i.zoomToCursor||!i.domElement)return;A=!0;let t=i.domElement.getBoundingClientRect(),n=e.clientX-t.left,r=e.clientY-t.top,a=t.width,o=t.height;k.x=n/a*2-1,k.y=-(r/o)*2+1,te.set(k.x,k.y,1).unproject(i.object).sub(i.object.position).normalize()}function K(e){return Math.max(i.minDistance,Math.min(i.maxDistance,e))}function q(e){b.set(e.clientX,e.clientY)}function ae(e){G(e),E.set(e.clientX,e.clientY)}function J(e){C.set(e.clientX,e.clientY)}function Y(e){x.set(e.clientX,e.clientY),S.subVectors(x,b).multiplyScalar(i.rotateSpeed);let t=i.domElement;t&&(L(2*Math.PI*S.x/t.clientHeight),R(2*Math.PI*S.y/t.clientHeight)),b.copy(x),i.update()}function X(e){D.set(e.clientX,e.clientY),O.subVectors(D,E),O.y>0?U(I()):O.y<0&&W(I()),E.copy(D),i.update()}function Z(e){w.set(e.clientX,e.clientY),T.subVectors(w,C).multiplyScalar(i.panSpeed),V(T.x,T.y),C.copy(w),i.update()}function Q(e){G(e),e.deltaY<0?W(I()):e.deltaY>0&&U(I()),i.update()}function oe(e){let t=!1;switch(e.code){case i.keys.UP:V(0,i.keyPanSpeed),t=!0;break;case i.keys.BOTTOM:V(0,-i.keyPanSpeed),t=!0;break;case i.keys.LEFT:V(i.keyPanSpeed,0),t=!0;break;case i.keys.RIGHT:V(-i.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),i.update())}function se(){if(N.length==1)b.set(N[0].pageX,N[0].pageY);else{let e=.5*(N[0].pageX+N[1].pageX),t=.5*(N[0].pageY+N[1].pageY);b.set(e,t)}}function ce(){if(N.length==1)C.set(N[0].pageX,N[0].pageY);else{let e=.5*(N[0].pageX+N[1].pageX),t=.5*(N[0].pageY+N[1].pageY);C.set(e,t)}}function le(){let e=N[0].pageX-N[1].pageX,t=N[0].pageY-N[1].pageY,n=Math.sqrt(e*e+t*t);E.set(0,n)}function ue(){i.enableZoom&&le(),i.enablePan&&ce()}function de(){i.enableZoom&&le(),i.enableRotate&&se()}function fe(e){if(N.length==1)x.set(e.pageX,e.pageY);else{let t=ke(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);x.set(n,r)}S.subVectors(x,b).multiplyScalar(i.rotateSpeed);let t=i.domElement;t&&(L(2*Math.PI*S.x/t.clientHeight),R(2*Math.PI*S.y/t.clientHeight)),b.copy(x)}function pe(e){if(N.length==1)w.set(e.pageX,e.pageY);else{let t=ke(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);w.set(n,r)}T.subVectors(w,C).multiplyScalar(i.panSpeed),V(T.x,T.y),C.copy(w)}function me(e){let t=ke(e),n=e.pageX-t.x,r=e.pageY-t.y,a=Math.sqrt(n*n+r*r);D.set(0,a),O.set(0,(D.y/E.y)**+i.zoomSpeed),U(O.y),E.copy(D)}function he(e){i.enableZoom&&me(e),i.enablePan&&pe(e)}function ge(e){i.enableZoom&&me(e),i.enableRotate&&fe(e)}function _e(e){var t,n;i.enabled!==!1&&(N.length===0&&((t=i.domElement)==null||t.ownerDocument.addEventListener(`pointermove`,ve),(n=i.domElement)==null||n.ownerDocument.addEventListener(`pointerup`,$)),Ee(e),e.pointerType===`touch`?Ce(e):ye(e))}function ve(e){i.enabled!==!1&&(e.pointerType===`touch`?we(e):be(e))}function $(e){var t,n,r;De(e),N.length===0&&((t=i.domElement)==null||t.releasePointerCapture(e.pointerId),(n=i.domElement)==null||n.ownerDocument.removeEventListener(`pointermove`,ve),(r=i.domElement)==null||r.ownerDocument.removeEventListener(`pointerup`,$)),i.dispatchEvent(u),p=f.NONE}function ye(e){let t;switch(e.button){case 0:t=i.mouseButtons.LEFT;break;case 1:t=i.mouseButtons.MIDDLE;break;case 2:t=i.mouseButtons.RIGHT;break;default:t=-1}switch(t){case d.DOLLY:if(i.enableZoom===!1)return;ae(e),p=f.DOLLY;break;case d.ROTATE:if(e.ctrlKey||e.metaKey||e.shiftKey){if(i.enablePan===!1)return;J(e),p=f.PAN}else{if(i.enableRotate===!1)return;q(e),p=f.ROTATE}break;case d.PAN:if(e.ctrlKey||e.metaKey||e.shiftKey){if(i.enableRotate===!1)return;q(e),p=f.ROTATE}else{if(i.enablePan===!1)return;J(e),p=f.PAN}break;default:p=f.NONE}p!==f.NONE&&i.dispatchEvent(s)}function be(e){if(i.enabled!==!1)switch(p){case f.ROTATE:if(i.enableRotate===!1)return;Y(e);break;case f.DOLLY:if(i.enableZoom===!1)return;X(e);break;case f.PAN:if(i.enablePan===!1)return;Z(e);break}}function xe(e){i.enabled===!1||i.enableZoom===!1||p!==f.NONE&&p!==f.ROTATE||(e.preventDefault(),i.dispatchEvent(s),Q(e),i.dispatchEvent(u))}function Se(e){i.enabled===!1||i.enablePan===!1||oe(e)}function Ce(e){switch(Oe(e),N.length){case 1:switch(i.touches.ONE){case r.ROTATE:if(i.enableRotate===!1)return;se(),p=f.TOUCH_ROTATE;break;case r.PAN:if(i.enablePan===!1)return;ce(),p=f.TOUCH_PAN;break;default:p=f.NONE}break;case 2:switch(i.touches.TWO){case r.DOLLY_PAN:if(i.enableZoom===!1&&i.enablePan===!1)return;ue(),p=f.TOUCH_DOLLY_PAN;break;case r.DOLLY_ROTATE:if(i.enableZoom===!1&&i.enableRotate===!1)return;de(),p=f.TOUCH_DOLLY_ROTATE;break;default:p=f.NONE}break;default:p=f.NONE}p!==f.NONE&&i.dispatchEvent(s)}function we(e){switch(Oe(e),p){case f.TOUCH_ROTATE:if(i.enableRotate===!1)return;fe(e),i.update();break;case f.TOUCH_PAN:if(i.enablePan===!1)return;pe(e),i.update();break;case f.TOUCH_DOLLY_PAN:if(i.enableZoom===!1&&i.enablePan===!1)return;he(e),i.update();break;case f.TOUCH_DOLLY_ROTATE:if(i.enableZoom===!1&&i.enableRotate===!1)return;ge(e),i.update();break;default:p=f.NONE}}function Te(e){i.enabled!==!1&&e.preventDefault()}function Ee(e){N.push(e)}function De(e){delete P[e.pointerId];for(let t=0;t<N.length;t++)if(N[t].pointerId==e.pointerId){N.splice(t,1);return}}function Oe(t){let n=P[t.pointerId];n===void 0&&(n=new e,P[t.pointerId]=n),n.set(t.pageX,t.pageY)}function ke(e){let t=e.pointerId===N[0].pointerId?N[1]:N[0];return P[t.pointerId]}this.dollyIn=(e=I())=>{W(e),i.update()},this.dollyOut=(e=I())=>{U(e),i.update()},this.getScale=()=>v,this.setScale=e=>{H(e),i.update()},this.getZoomScale=()=>I(),n!==void 0&&this.connect(n),this.update()}},P=new i,F=new m,I=class extends f{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new s([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new s([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new v(t,6,1);return this.setAttribute(`instanceStart`,new y(n,3,0)),this.setAttribute(`instanceEnd`,new y(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new v(n,t*2,1);return this.setAttribute(`instanceColorStart`,new y(r,t,0)),this.setAttribute(`instanceColorEnd`,new y(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new p(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new i);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),P.setFromBufferAttribute(t),this.boundingBox.union(P))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new S),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)F.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(F)),F.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(F));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},L=class extends I{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(t===3)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},R=class extends t{constructor(t){super({type:`LineMaterial`,uniforms:u.clone(u.merge([C.common,C.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new e(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
				#include <common>
				#include <fog_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				#include <clipping_planes_pars_vertex>

				uniform float linewidth;
				uniform vec2 resolution;

				attribute vec3 instanceStart;
				attribute vec3 instanceEnd;

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
						attribute vec4 instanceColorStart;
						attribute vec4 instanceColorEnd;
					#else
						varying vec3 vLineColor;
						attribute vec3 instanceColorStart;
						attribute vec3 instanceColorEnd;
					#endif
				#endif

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#ifdef USE_DASH

					uniform float dashScale;
					attribute float instanceDistanceStart;
					attribute float instanceDistanceEnd;
					varying float vLineDistance;

				#endif

				void trimSegment( const in vec4 start, inout vec4 end ) {

					// trim end segment so it terminates between the camera plane and the near plane

					// conservative estimate of the near plane
					float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
					float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
					float nearEstimate = - 0.5 * b / a;

					float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

					end.xyz = mix( start.xyz, end.xyz, alpha );

				}

				void main() {

					#ifdef USE_COLOR

						vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

					#endif

					#ifdef USE_DASH

						vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
						vUv = uv;

					#endif

					float aspect = resolution.x / resolution.y;

					// camera space
					vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
					vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

					#ifdef WORLD_UNITS

						worldStart = start.xyz;
						worldEnd = end.xyz;

					#else

						vUv = uv;

					#endif

					// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
					// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
					// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
					// perhaps there is a more elegant solution -- WestLangley

					bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

					if ( perspective ) {

						if ( start.z < 0.0 && end.z >= 0.0 ) {

							trimSegment( start, end );

						} else if ( end.z < 0.0 && start.z >= 0.0 ) {

							trimSegment( end, start );

						}

					}

					// clip space
					vec4 clipStart = projectionMatrix * start;
					vec4 clipEnd = projectionMatrix * end;

					// ndc space
					vec3 ndcStart = clipStart.xyz / clipStart.w;
					vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

					// direction
					vec2 dir = ndcEnd.xy - ndcStart.xy;

					// account for clip-space aspect ratio
					dir.x *= aspect;
					dir = normalize( dir );

					#ifdef WORLD_UNITS

						// get the offset direction as perpendicular to the view vector
						vec3 worldDir = normalize( end.xyz - start.xyz );
						vec3 offset;
						if ( position.y < 0.5 ) {

							offset = normalize( cross( start.xyz, worldDir ) );

						} else {

							offset = normalize( cross( end.xyz, worldDir ) );

						}

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						float forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );

						// don't extend the line if we're rendering dashes because we
						// won't be rendering the endcaps
						#ifndef USE_DASH

							// extend the line bounds to encompass  endcaps
							start.xyz += - worldDir * linewidth * 0.5;
							end.xyz += worldDir * linewidth * 0.5;

							// shift the position of the quad so it hugs the forward edge of the line
							offset.xy -= dir * forwardOffset;
							offset.z += 0.5;

						#endif

						// endcaps
						if ( position.y > 1.0 || position.y < 0.0 ) {

							offset.xy += dir * 2.0 * forwardOffset;

						}

						// adjust for linewidth
						offset *= linewidth * 0.5;

						// set the world position
						worldPos = ( position.y < 0.5 ) ? start : end;
						worldPos.xyz += offset;

						// project the worldpos
						vec4 clip = projectionMatrix * worldPos;

						// shift the depth of the projected points so the line
						// segments overlap neatly
						vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
						clip.z = clipPose.z * clip.w;

					#else

						vec2 offset = vec2( dir.y, - dir.x );
						// undo aspect ratio adjustment
						dir.x /= aspect;
						offset.x /= aspect;

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						// endcaps
						if ( position.y < 0.0 ) {

							offset += - dir;

						} else if ( position.y > 1.0 ) {

							offset += dir;

						}

						// adjust for linewidth
						offset *= linewidth;

						// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
						offset /= resolution.y;

						// select end
						vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

						// back to clip space
						offset *= clip.w;

						clip.xy += offset;

					#endif

					gl_Position = clip;

					vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

					#include <logdepthbuf_vertex>
					#include <clipping_planes_vertex>
					#include <fog_vertex>

				}
			`,fragmentShader:`
				uniform vec3 diffuse;
				uniform float opacity;
				uniform float linewidth;

				#ifdef USE_DASH

					uniform float dashOffset;
					uniform float dashSize;
					uniform float gapSize;

				#endif

				varying float vLineDistance;

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#include <common>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <clipping_planes_pars_fragment>

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
					#else
						varying vec3 vLineColor;
					#endif
				#endif

				vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

					float mua;
					float mub;

					vec3 p13 = p1 - p3;
					vec3 p43 = p4 - p3;

					vec3 p21 = p2 - p1;

					float d1343 = dot( p13, p43 );
					float d4321 = dot( p43, p21 );
					float d1321 = dot( p13, p21 );
					float d4343 = dot( p43, p43 );
					float d2121 = dot( p21, p21 );

					float denom = d2121 * d4343 - d4321 * d4321;

					float numer = d1343 * d4321 - d1321 * d4343;

					mua = numer / denom;
					mua = clamp( mua, 0.0, 1.0 );
					mub = ( d1343 + d4321 * ( mua ) ) / d4343;
					mub = clamp( mub, 0.0, 1.0 );

					return vec2( mua, mub );

				}

				void main() {

					#include <clipping_planes_fragment>

					#ifdef USE_DASH

						if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

						if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

					#endif

					float alpha = opacity;

					#ifdef WORLD_UNITS

						// Find the closest points on the view ray and the line segment
						vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
						vec3 lineDir = worldEnd - worldStart;
						vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

						vec3 p1 = worldStart + lineDir * params.x;
						vec3 p2 = rayEnd * params.y;
						vec3 delta = p1 - p2;
						float len = length( delta );
						float norm = len / linewidth;

						#ifndef USE_DASH

							#ifdef USE_ALPHA_TO_COVERAGE

								float dnorm = fwidth( norm );
								alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

							#else

								if ( norm > 0.5 ) {

									discard;

								}

							#endif

						#endif

					#else

						#ifdef USE_ALPHA_TO_COVERAGE

							// artifacts appear on some hardware if a derivative is taken within a conditional
							float a = vUv.x;
							float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
							float len2 = a * a + b * b;
							float dlen = fwidth( len2 );

							if ( abs( vUv.y ) > 1.0 ) {

								alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

							}

						#else

							if ( abs( vUv.y ) > 1.0 ) {

								float a = vUv.x;
								float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
								float len2 = a * a + b * b;

								if ( len2 > 1.0 ) discard;

							}

						#endif

					#endif

					vec4 diffuseColor = vec4( diffuse, alpha );
					#ifdef USE_COLOR
						#ifdef USE_LINE_COLOR_ALPHA
							diffuseColor *= vLineColor;
						#else
							diffuseColor.rgb *= vLineColor;
						#endif
					#endif

					#include <logdepthbuf_fragment>

					gl_FragColor = diffuseColor;

					#include <tonemapping_fragment>
					#include <${w>=154?`colorspace_fragment`:`encodings_fragment`}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA=`1`:delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(t)}},z=new x,B=new m,V=new m,H=new x,U=new x,W=new x,G=new m,K=new b,q=new n,ae=new m,J=new i,Y=new S,X=new x,Z,Q;function oe(e,t,n){return X.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),X.multiplyScalar(1/X.w),X.x=Q/n.width,X.y=Q/n.height,X.applyMatrix4(e.projectionMatrixInverse),X.multiplyScalar(1/X.w),Math.abs(Math.max(X.x,X.y))}function se(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){q.start.fromBufferAttribute(i,r),q.end.fromBufferAttribute(a,r),q.applyMatrix4(n);let o=new m,s=new m;Z.distanceSqToSegment(q.start,q.end,s,o),s.distanceTo(o)<Q*.5&&t.push({point:s,pointOnLine:o,distance:Z.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,[T]:null})}}function ce(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,c=o.attributes.instanceEnd,l=Math.min(o.instanceCount,s.count),u=-t.near;Z.at(1,W),W.w=1,W.applyMatrix4(t.matrixWorldInverse),W.applyMatrix4(r),W.multiplyScalar(1/W.w),W.x*=i.x/2,W.y*=i.y/2,W.z=0,G.copy(W),K.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=l;t<o;t++){if(H.fromBufferAttribute(s,t),U.fromBufferAttribute(c,t),H.w=1,U.w=1,H.applyMatrix4(K),U.applyMatrix4(K),H.z>u&&U.z>u)continue;if(H.z>u){let e=H.z-U.z,t=(H.z-u)/e;H.lerp(U,t)}else if(U.z>u){let e=U.z-H.z,t=(U.z-u)/e;U.lerp(H,t)}H.applyMatrix4(r),U.applyMatrix4(r),H.multiplyScalar(1/H.w),U.multiplyScalar(1/U.w),H.x*=i.x/2,H.y*=i.y/2,U.x*=i.x/2,U.y*=i.y/2,q.start.copy(H),q.start.z=0,q.end.copy(U),q.end.z=0;let o=q.closestPointToPointParameter(G,!0);q.at(o,ae);let l=ee.lerp(H.z,U.z,o),d=l>=-1&&l<=1,f=G.distanceTo(ae)<Q*.5;if(d&&f){q.start.fromBufferAttribute(s,t),q.end.fromBufferAttribute(c,t),q.start.applyMatrix4(a),q.end.applyMatrix4(a);let r=new m,i=new m;Z.distanceSqToSegment(q.start,q.end,i,r),n.push({point:i,pointOnLine:r,distance:Z.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,[T]:null})}}}var le=class extends g{constructor(e=new I,t=new R({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)B.fromBufferAttribute(t,e),V.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+B.distanceTo(V);let i=new v(r,2,1);return e.setAttribute(`instanceDistanceStart`,new y(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new y(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;Z=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;Q=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),Y.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?Q*.5:oe(r,Math.max(r.near,Y.distanceToPoint(Z.origin)),s.resolution),Y.radius+=c,Z.intersectsSphere(Y)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),J.copy(o.boundingBox).applyMatrix4(a);let l;l=n?Q*.5:oe(r,Math.max(r.near,J.distanceToPoint(Z.origin)),s.resolution),J.expandByScalar(l),Z.intersectsBox(J)!==!1&&(n?se(this,t):ce(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(z),this.material.uniforms.resolution.value.set(z.z,z.w))}},ue=class extends le{constructor(e=new L,t=new R({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}};export{I as a,L as i,le as n,N as o,R as r,ue as t};