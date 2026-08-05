import{c as I}from"./logger-CvfM-6aa.js";const p=I("WeixinEditor");(()=>{const c={view:"loading",platforms:[],selectedPlatforms:[],results:[],collapsed:!0};function L(){const t=window.location.href;return t.includes("mp.weixin.qq.com/cgi-bin/appmsg")&&(t.includes("action=edit")||t.includes("appmsg_edit"))}async function k(){if(document.querySelector("#wechatsync-editor-panel"))return;const t=document.createElement("div");t.id="wechatsync-editor-panel",t.innerHTML=`
    <style>
      #wechatsync-editor-panel {
        position: fixed;
        right: 20px;
        bottom: 80px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
      }

      #wechatsync-editor-panel * {
        box-sizing: border-box;
      }

      /* 收起时只显示圆形按钮 */
      .ws-fab {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: linear-gradient(135deg, #07c160 0%, #06ad56 100%);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(7, 193, 96, 0.4);
        transition: all 0.2s;
      }

      .ws-fab:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(7, 193, 96, 0.5);
      }

      .ws-fab svg {
        width: 24px;
        height: 24px;
        fill: white;
      }

      .ws-fab.hidden {
        display: none;
      }

      /* 展开的面板 */
      .ws-panel {
        width: 260px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
        overflow: hidden;
        display: none;
      }

      .ws-panel.visible {
        display: block;
      }

      .ws-header {
        background: linear-gradient(135deg, #07c160 0%, #06ad56 100%);
        color: white;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
        user-select: none;
      }

      .ws-header-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
      }

      .ws-header-title svg {
        width: 16px;
        height: 16px;
      }

      .ws-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 4px;
        display: flex;
        opacity: 0.8;
      }

      .ws-close:hover {
        opacity: 1;
      }

      .ws-content {
        padding: 12px;
        max-height: 300px;
        overflow-y: auto;
      }

      .ws-section-title {
        font-size: 11px;
        color: #999;
        margin-bottom: 8px;
      }

      .ws-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 180px;
        overflow-y: auto;
        margin-bottom: 10px;
      }

      .ws-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 6px;
        cursor: pointer;
        background: #f5f5f5;
        border: 2px solid transparent;
        transition: all 0.15s;
      }

      .ws-item:hover {
        background: #e8f5e9;
      }

      .ws-item.selected {
        border-color: #07c160;
        background: #e8f5e9;
      }

      .ws-item.disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background: #f9f9f9;
      }

      .ws-item.disabled:hover {
        background: #f9f9f9;
      }

      .ws-item img {
        width: 18px;
        height: 18px;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .ws-item-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ws-item-status {
        font-size: 11px;
        flex-shrink: 0;
      }

      .ws-item-status.success { color: #52c41a; }
      .ws-item-status.error { color: #ff4d4f; }

      .ws-btn {
        width: 100%;
        padding: 10px;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }

      .ws-btn-primary {
        background: #07c160;
        color: white;
      }

      .ws-btn-primary:hover {
        background: #06ad56;
      }

      .ws-btn-primary:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      .ws-btn-secondary {
        background: white;
        color: #666;
        border: 1px solid #ddd;
        margin-top: 8px;
      }

      .ws-btn-secondary:hover {
        border-color: #07c160;
        color: #07c160;
      }

      .ws-loading, .ws-empty {
        text-align: center;
        padding: 20px 12px;
        color: #999;
        font-size: 12px;
      }

      .ws-empty a {
        color: #07c160;
        text-decoration: none;
      }

      .ws-result {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 6px;
        margin-bottom: 6px;
        font-size: 12px;
      }

      .ws-result.success {
        background: #f6ffed;
        border: 1px solid #b7eb8f;
      }

      .ws-result.error {
        background: #fff2f0;
        border: 1px solid #ffccc7;
      }

      .ws-result img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
      }

      .ws-result-name { flex: 1; }

      .ws-result a {
        color: #1890ff;
        text-decoration: none;
        font-size: 11px;
      }

      .ws-footer {
        padding: 8px 12px;
        border-top: 1px solid #f0f0f0;
        display: flex;
        justify-content: space-between;
        font-size: 11px;
      }

      .ws-footer a {
        color: #999;
        text-decoration: none;
      }

      .ws-footer a:hover {
        color: #07c160;
      }

      @keyframes ws-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .ws-spinning {
        animation: ws-spin 1s linear infinite;
      }
    </style>

    <!-- 收起时的悬浮按钮 -->
    <button class="ws-fab" id="ws-fab" title="同步助手">
      <svg viewBox="0 0 24 24">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
      </svg>
    </button>

    <!-- 展开的面板 -->
    <div class="ws-panel" id="ws-panel">
      <div class="ws-header" id="ws-header">
        <span class="ws-header-title">
          <svg viewBox="0 0 24 24" fill="white">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
          同步助手
        </span>
        <button class="ws-close" id="ws-close" title="收起">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="ws-content" id="ws-content"></div>
      <div class="ws-footer">
        <a href="javascript:void(0)" id="ws-history">同步历史</a>
        <a href="javascript:void(0)" id="ws-popup">完整面板</a>
      </div>
    </div>
  `,document.body.appendChild(t),_(),S()}function _(){const t=document.getElementById("ws-fab"),m=document.getElementById("ws-panel"),d=document.getElementById("ws-header"),a=document.getElementById("ws-close"),s=document.getElementById("ws-history"),l=document.getElementById("ws-popup"),e=document.getElementById("wechatsync-editor-panel");t.addEventListener("click",()=>{c.collapsed=!1,t.classList.add("hidden"),m.classList.add("visible")}),a.addEventListener("click",i=>{i.stopPropagation(),c.collapsed=!0,t.classList.remove("hidden"),m.classList.remove("visible")});let r=!1,n=0,g=0,w=20,h=80;d.addEventListener("mousedown",i=>{if(i.target.closest(".ws-close"))return;r=!0,n=i.clientX,g=i.clientY;const o=e.getBoundingClientRect();w=window.innerWidth-o.right,h=window.innerHeight-o.bottom,i.preventDefault()}),document.addEventListener("mousemove",i=>{if(!r)return;const o=n-i.clientX,u=g-i.clientY,b=Math.max(0,Math.min(window.innerWidth-280,w+o)),x=Math.max(0,Math.min(window.innerHeight-100,h+u));e.style.right=b+"px",e.style.bottom=x+"px"}),document.addEventListener("mouseup",()=>{r=!1}),s.addEventListener("click",i=>{i.preventDefault(),i.stopPropagation(),chrome.runtime.sendMessage({type:"OPEN_SYNC_PAGE",path:"/history"})}),l.addEventListener("click",async i=>{i.preventDefault(),i.stopPropagation();const o=await E();o&&await chrome.storage.local.set({pendingArticle:o}),chrome.runtime.sendMessage({type:"OPEN_SYNC_PAGE"})})}async function S(){f("loading");try{const t=await chrome.runtime.sendMessage({type:"CHECK_ALL_AUTH"});c.platforms=(t.platforms||[]).filter(d=>d.isAuthenticated),console.log("[WeixinEditor] Loaded platforms:",c.platforms.length);const m=await chrome.storage.local.get("lastSelectedPlatforms");c.selectedPlatforms=m.lastSelectedPlatforms||[],c.platforms.length===0?f("empty"):f("platforms")}catch(t){p.error("Failed to load platforms:",t),f("empty")}}function f(t){var d,a;c.view=t;const m=document.getElementById("ws-content");switch(t){case"loading":m.innerHTML='<div class="ws-loading">加载中...</div>';break;case"empty":m.innerHTML=`
        <div class="ws-empty">
          暂无已登录平台<br>
          <a href="javascript:void(0)" id="ws-login">去登录 →</a>
        </div>
      `,(d=document.getElementById("ws-login"))==null||d.addEventListener("click",s=>{s.preventDefault(),chrome.runtime.sendMessage({type:"OPEN_SYNC_PAGE"})});break;case"platforms":C();break;case"syncing":m.innerHTML=`
        <div class="ws-loading">
          <svg class="ws-spinning" width="24" height="24" viewBox="0 0 24 24" fill="#07c160">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
          <div style="margin-top: 8px">同步中...</div>
          <button class="ws-btn ws-btn-secondary" id="ws-cancel" style="margin-top: 12px; font-size: 12px; padding: 6px 16px;">取消</button>
        </div>
      `,(a=document.getElementById("ws-cancel"))==null||a.addEventListener("click",()=>{c.results=[],f("platforms")});break;case"results":P();break}}function C(){var d;const t=document.getElementById("ws-content"),m=c.selectedPlatforms.length;t.innerHTML=`
    <div class="ws-section-title">选择同步平台</div>
    <div class="ws-list" id="ws-list">
      ${c.platforms.map(a=>{const s=c.selectedPlatforms.includes(a.id),l=!a.isAuthenticated;return`
          <div class="ws-item ${s?"selected":""} ${l?"disabled":""}" data-id="${a.id}" ${l?'title="未连接"':""}>
            <img src="${a.icon}" alt="${a.name}" onerror="this.style.display='none'">
            <span class="ws-item-name">${a.name}</span>
            ${l?'<span class="ws-item-status error">未连接</span>':""}
          </div>
        `}).join("")}
    </div>
    <button class="ws-btn ws-btn-primary" id="ws-sync" ${m===0?"disabled":""}>
      ${m>0?`同步到 ${m} 个平台`:"请选择平台"}
    </button>
  `,document.querySelectorAll(".ws-item").forEach(a=>{a.addEventListener("click",()=>{if(a.classList.contains("disabled"))return;const s=a.getAttribute("data-id");a.classList.toggle("selected"),a.classList.contains("selected")?c.selectedPlatforms.includes(s)||c.selectedPlatforms.push(s):c.selectedPlatforms=c.selectedPlatforms.filter(r=>r!==s);const l=document.getElementById("ws-sync"),e=c.selectedPlatforms.length;l.disabled=e===0,l.textContent=e>0?`同步到 ${e} 个平台`:"请选择平台"})}),(d=document.getElementById("ws-sync"))==null||d.addEventListener("click",T)}function P(){var a;const t=document.getElementById("ws-content"),m=c.results.filter(s=>s.success).length,d=c.results.length;t.innerHTML=`
    <div class="ws-section-title">同步结果 (${m}/${d})</div>
    <div class="ws-list">
      ${c.results.map(s=>{const l=c.platforms.find(n=>n.id===s.platform),e=s.platformName||(l==null?void 0:l.name)||s.platform,r=(l==null?void 0:l.icon)||"";return`
          <div class="ws-result ${s.success?"success":"error"}">
            <img src="${r}" alt="${e}" onerror="this.style.display='none'">
            <span class="ws-result-name">${e}</span>
            ${s.success&&s.postUrl?`<a href="${s.postUrl}" target="_blank">${s.draftOnly?"编辑草稿":"查看"} →</a>`:s.success?`<span class="ws-item-status success">${s.draftOnly?"已保存草稿":"已发布"}</span>`:`<span class="ws-item-status error">${s.error||"失败"}</span>`}
          </div>
        `}).join("")}
    </div>
    <button class="ws-btn ws-btn-secondary" id="ws-back">返回继续同步</button>
  `,(a=document.getElementById("ws-back"))==null||a.addEventListener("click",()=>{c.results=[],f("platforms")})}async function T(){var m;const t=await E();if(!t){alert(`未能提取文章内容

请确保：
1. 文章已保存
2. 标题和内容不为空`),chrome.runtime.sendMessage({type:"TRACK_ARTICLE_EXTRACT",payload:{source:"weixin-editor",success:!1}}).catch(()=>{});return}if(chrome.runtime.sendMessage({type:"TRACK_ARTICLE_EXTRACT",payload:{source:"weixin-editor",success:!0,hasTitle:!!t.title,hasContent:!!t.content,hasCover:!!t.cover,contentLength:((m=t.content)==null?void 0:m.length)||0}}).catch(()=>{}),c.selectedPlatforms.length===0){alert("请选择要同步的平台");return}await chrome.storage.local.set({lastSelectedPlatforms:c.selectedPlatforms}),f("syncing");try{await chrome.runtime.sendMessage({type:"INIT_SYNC_STATE",payload:{article:t,platforms:c.selectedPlatforms}})}catch(d){p.debug("Failed to init sync state:",d)}try{const d=[],a=[];console.log("[WeixinEditor] state.platforms:",c.platforms),console.log("[WeixinEditor] selectedPlatforms:",c.selectedPlatforms);for(const e of c.selectedPlatforms){const r=c.platforms.find(n=>n.id===e);console.log("[WeixinEditor] Platform check:",e,"sourceType:",r==null?void 0:r.sourceType),(r==null?void 0:r.sourceType)==="cms"?a.push(e):(r==null?void 0:r.sourceType)==="dsl"?d.push(e):e.startsWith("cms_")?(console.log("[WeixinEditor] Fallback: detected CMS by ID prefix:",e),a.push(e)):r?(console.warn("[WeixinEditor] Platform missing sourceType, defaulting to DSL:",e),d.push(e)):(console.warn("[WeixinEditor] Platform not in state:",e),e.startsWith("cms_")&&a.push(e))}console.log("[WeixinEditor] Platform split result:",{dsl:d,cms:a});const s=[];if(d.length>0){const e=await chrome.runtime.sendMessage({type:"SYNC_ARTICLE",payload:{article:t,platforms:d,source:"weixin-editor",skipHistory:!0}});e!=null&&e.results&&s.push(...e.results)}for(const e of a){const r=c.platforms.find(n=>n.id===e);try{const n=await chrome.runtime.sendMessage({type:"SYNC_TO_CMS",payload:{accountId:e,article:t}});p.debug("CMS sync response:",e,n),s.push({platform:e,platformName:(n==null?void 0:n.platformName)||(r==null?void 0:r.name)||e,success:(n==null?void 0:n.success)===!0,postUrl:(n==null?void 0:n.postUrl)||void 0,draftOnly:(n==null?void 0:n.draftOnly)??!0,error:(n==null?void 0:n.error)||((n==null?void 0:n.success)===!1?"同步失败":void 0),sourceType:"cms"})}catch(n){p.error("CMS sync error:",e,n),s.push({platform:e,platformName:(r==null?void 0:r.name)||e,success:!1,error:n.message||"未知错误",sourceType:"cms"})}}p.debug("All results:",s),c.results=s;const l=s.map(e=>{const r=c.platforms.find(n=>n.id===e.platform);return{...e,platformName:e.platformName||(r==null?void 0:r.name)||e.platform}});try{const r=(await chrome.storage.local.get("syncHistory")).syncHistory||[],g=[{id:Date.now().toString(),title:t.title||"未知文章",cover:t.cover,timestamp:Date.now(),results:l},...r].slice(0,25);await chrome.storage.local.set({syncHistory:g}),p.debug("History saved")}catch(e){p.error("Failed to save history:",e)}try{await chrome.runtime.sendMessage({type:"SET_SYNC_COMPLETED"})}catch(e){p.debug("Failed to set sync completed:",e)}f("results")}catch(d){alert("同步失败："+d.message),f("platforms")}}async function E(){var t,m,d;try{p.debug("Extracting article...");const a=["#js_title_place","#title",'input[name="title"]',".weui-desktop-form__input",".title_input input",".js_title",'[data-id="title"]',".appmsg_title input",".appmsg-edit-title input"];let s="";for(const i of a){const o=document.querySelector(i),u=((t=o==null?void 0:o.value)==null?void 0:t.trim())||((m=o==null?void 0:o.textContent)==null?void 0:m.trim());if(u){s=u,p.debug("Title found via:",i,"=",s.substring(0,30));break}}let l="";const e=["#ueditor_0",'iframe[id^="ueditor"]',".edui-editor iframe","iframe.edui-body-container"];for(const i of e)try{const o=document.querySelector(i);if((d=o==null?void 0:o.contentDocument)!=null&&d.body){const u=o.contentDocument.body.innerHTML;if(u&&u.trim()&&u.trim()!=="<p><br></p>"&&u.length>10){l=u,p.debug("Content found via iframe:",i);break}}}catch{p.debug("Cannot access iframe:",i)}if(!l){const i=[".edui-body-container",".rich_media_content","#js_content",".appmsg-edit-content"];for(const o of i){const u=document.querySelector(o);if(u!=null&&u.innerHTML&&u.innerHTML.trim().length>10){l=u.innerHTML,p.debug("Content found via container:",o);break}}}const r=new URLSearchParams(window.location.search).get("appmsgid");if(r&&(!l||!s)){p.debug("Trying API fetch for appmsgid:",r);const i=await M(r);if(i)return p.debug("Article fetched via API"),i}if(!s)return p.warn("Title not found. Available inputs:",document.querySelectorAll("input").length),null;if(!l)return p.warn("Content not found. Available iframes:",document.querySelectorAll("iframe").length),null;const n=[".appmsg_thumb img",".js_cover img",".cover-img img",".appmsg_thumb_wrap img"];let g="";for(const i of n){const o=document.querySelector(i);if(o!=null&&o.src&&!o.src.includes("data:")){g=o.src;break}}const w=['[name="digest"]',"#digest","textarea.digest",".appmsg_desc textarea"];let h="";for(const i of w){const o=document.querySelector(i);if(o!=null&&o.value){h=o.value;break}}return p.debug("Extracted:",{title:s,contentLen:l.length,hasCover:!!g}),{title:s,html:l,content:l,summary:h,cover:g,source:{url:window.location.href,platform:"weixin-editor"}}}catch(a){return p.error("Extract failed:",a),null}}async function M(t){var m,d,a,s;try{const l=window.location.search.match(/token=(\d+)/);if(!l)return null;const e=l[1],n=await(await fetch(`https://mp.weixin.qq.com/cgi-bin/appmsg?action=get_temp_url&appmsgid=${t}&itemidx=1&token=${e}&lang=zh_CN&f=json&ajax=1`,{credentials:"include"})).json();if(!n.temp_url)return null;const w=await(await fetch(n.temp_url)).text(),i=new DOMParser().parseFromString(w,"text/html"),o=(d=(m=i.querySelector("#activity-name"))==null?void 0:m.textContent)==null?void 0:d.trim(),u=i.querySelector("#js_content"),b=(a=i.querySelector('meta[property="og:image"]'))==null?void 0:a.getAttribute("content"),x=(s=i.querySelector('meta[property="og:description"]'))==null?void 0:s.getAttribute("content");return!o||!u?null:(u.querySelectorAll("img").forEach(y=>{const v=y.getAttribute("data-src")||y.getAttribute("data-original")||y.src;v&&!v.startsWith("data:")&&(y.src=v)}),{title:o,html:u.innerHTML,content:u.innerHTML,summary:x,cover:b,source:{url:n.temp_url,platform:"weixin"}})}catch(l){return p.error("API fetch failed:",l),null}}function A(){if(!L())return;const t=()=>setTimeout(k,1500);document.readyState==="loading"?document.addEventListener("DOMContentLoaded",t):t()}A()})();
