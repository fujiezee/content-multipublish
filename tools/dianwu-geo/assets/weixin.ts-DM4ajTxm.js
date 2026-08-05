(function(){(()=>{const a={status:"idle",platforms:[],results:[]};function g(){if(!document.querySelector("#js_content")||document.querySelector("#wechatsync-fab"))return;const l=document.createElement("div");l.id="wechatsync-fab",l.innerHTML=`
    <style>
      #wechatsync-fab {
        position: fixed;
        right: 24px;
        bottom: 88px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      /* 主按钮 - 胶囊形状带文字 */
      .wechatsync-main-btn {
        height: 40px;
        padding: 0 16px;
        border-radius: 20px;
        background: linear-gradient(135deg, #07c160 0%, #06ad56 100%);
        border: none;
        box-shadow: 0 4px 12px rgba(7, 193, 96, 0.35);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        color: white;
        font-size: 14px;
        font-weight: 500;
      }

      .wechatsync-main-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(7, 193, 96, 0.45);
      }

      .wechatsync-main-btn svg {
        width: 18px;
        height: 18px;
        fill: white;
        transition: transform 0.3s;
      }

      /* 同步中旋转动画 */
      .wechatsync-main-btn.syncing svg {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* 成功状态 */
      .wechatsync-main-btn.success {
        background: linear-gradient(135deg, #52c41a 0%, #389e0d 100%);
      }

      /* 失败状态 */
      .wechatsync-main-btn.error {
        background: linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%);
      }

      /* 平台展开面板 */
      .wechatsync-panel {
        position: absolute;
        bottom: 60px;
        right: 0;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        padding: 12px;
        min-width: 200px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px) scale(0.95);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      #wechatsync-fab:hover .wechatsync-panel,
      #wechatsync-fab.expanded .wechatsync-panel {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      .wechatsync-panel-header {
        font-size: 12px;
        color: #999;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid #f0f0f0;
      }

      /* 平台列表 */
      .wechatsync-platforms {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }

      .wechatsync-platform {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        border: 2px solid transparent;
        background: #f5f5f5;
        font-size: 12px;
      }

      .wechatsync-platform:hover {
        background: #e8f5e9;
      }

      .wechatsync-platform.selected {
        border-color: #07c160;
        background: #e8f5e9;
      }

      .wechatsync-platform img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
      }

      .wechatsync-platform .status-icon {
        margin-left: auto;
      }

      .wechatsync-platform .status-icon.success {
        color: #52c41a;
      }

      .wechatsync-platform .status-icon.error {
        color: #ff4d4f;
      }

      /* 操作按钮 */
      .wechatsync-actions {
        display: flex;
        gap: 8px;
      }

      .wechatsync-sync-btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        background: #07c160;
        color: white;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }

      .wechatsync-sync-btn:hover {
        background: #06ad56;
      }

      .wechatsync-sync-btn:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      .wechatsync-more-btn {
        padding: 8px 12px;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        background: white;
        color: #666;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .wechatsync-more-btn:hover {
        border-color: #07c160;
        color: #07c160;
      }

      /* 结果提示 */
      .wechatsync-toast {
        position: absolute;
        bottom: 60px;
        right: 0;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        padding: 12px 16px;
        font-size: 13px;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px);
        transition: all 0.2s;
      }

      .wechatsync-toast.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .wechatsync-toast.success {
        border-left: 3px solid #52c41a;
      }

      .wechatsync-toast.error {
        border-left: 3px solid #ff4d4f;
      }

      /* 加载状态 */
      .wechatsync-loading {
        text-align: center;
        padding: 20px;
        color: #999;
        font-size: 12px;
      }

      /* 同步结果列表 */
      .wechatsync-results {
        margin-bottom: 12px;
        max-height: 200px;
        overflow-y: auto;
      }

      .wechatsync-result-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        margin-bottom: 6px;
        font-size: 12px;
      }

      .wechatsync-result-item.success {
        background: #f6ffed;
        border: 1px solid #b7eb8f;
      }

      .wechatsync-result-item.error {
        background: #fff2f0;
        border: 1px solid #ffccc7;
      }

      .wechatsync-result-item img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
      }

      .wechatsync-result-item .name {
        flex: 1;
      }

      .wechatsync-result-item .status {
        font-size: 11px;
      }

      .wechatsync-result-item .status.success {
        color: #52c41a;
        background: none;
        border: none;
      }

      .wechatsync-result-item .status.error {
        color: #ff4d4f;
        background: none;
        border: none;
      }

      .wechatsync-result-item a {
        color: #1890ff;
        text-decoration: none;
        font-size: 11px;
      }

      .wechatsync-result-item a:hover {
        text-decoration: underline;
      }

      /* 底部链接 */
      .wechatsync-footer {
        display: flex;
        justify-content: space-between;
        padding-top: 8px;
        border-top: 1px solid #f0f0f0;
        margin-top: 8px;
      }

      .wechatsync-footer a {
        color: #999;
        text-decoration: none;
        font-size: 11px;
      }

      .wechatsync-footer a:hover {
        color: #07c160;
      }
    </style>

    <div class="wechatsync-panel">
      <div class="wechatsync-panel-header" id="wechatsync-panel-header">选择同步平台</div>

      <!-- 同步结果区域（同步后显示） -->
      <div class="wechatsync-results" id="wechatsync-results" style="display: none;"></div>

      <!-- 平台选择区域 -->
      <div class="wechatsync-platforms" id="wechatsync-platforms">
        <div class="wechatsync-loading">加载中...</div>
      </div>

      <div class="wechatsync-actions">
        <button class="wechatsync-sync-btn" id="wechatsync-sync-btn" disabled>
          同步到选中平台
        </button>
        <button class="wechatsync-more-btn" id="wechatsync-more-btn" title="更多选项">
          ⋯
        </button>
      </div>

      <div class="wechatsync-footer">
        <a href="javascript:void(0)" id="wechatsync-history-link">同步历史</a>
        <a href="javascript:void(0)" id="wechatsync-add-cms-link">添加站点</a>
      </div>
    </div>

    <div class="wechatsync-toast" id="wechatsync-toast"></div>

    <button class="wechatsync-main-btn" id="wechatsync-main-btn" title="同步文章到多平台">
      <svg viewBox="0 0 24 24">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
      </svg>
      <span>同步</span>
    </button>
  `,document.body.appendChild(l);const e=document.getElementById("wechatsync-main-btn"),c=document.getElementById("wechatsync-sync-btn"),h=document.getElementById("wechatsync-more-btn"),o=document.getElementById("wechatsync-platforms"),p=document.getElementById("wechatsync-results"),u=document.getElementById("wechatsync-panel-header"),b=document.getElementById("wechatsync-history-link"),C=document.getElementById("wechatsync-add-cms-link");x(),e.addEventListener("click",()=>{l.classList.toggle("expanded")}),c.addEventListener("click",()=>L()),h.addEventListener("click",async()=>{const t=w();t&&await chrome.storage.local.set({pendingArticle:t}),chrome.runtime.sendMessage({type:"OPEN_SYNC_PAGE"})}),b.addEventListener("click",t=>{t.preventDefault(),chrome.runtime.sendMessage({type:"OPEN_SYNC_PAGE",path:"/history"})}),C.addEventListener("click",t=>{t.preventDefault(),chrome.runtime.sendMessage({type:"OPEN_SYNC_PAGE",path:"/add-cms"})});async function x(){try{const t=await chrome.runtime.sendMessage({type:"CHECK_ALL_AUTH"});a.platforms=(t.platforms||[]).filter(r=>r.isAuthenticated);const s=(await chrome.storage.local.get("lastSelectedPlatforms")).lastSelectedPlatforms||[];E(s)}catch{o.innerHTML='<div class="wechatsync-loading">加载失败</div>'}}function E(t=[]){var n;if(a.platforms.length===0){o.innerHTML=`
        <div class="wechatsync-loading">
          暂无已登录平台<br>
          <a href="javascript:void(0)" id="wechatsync-login-link" style="color: #07c160;">去登录 →</a>
        </div>
      `,(n=document.getElementById("wechatsync-login-link"))==null||n.addEventListener("click",s=>{s.preventDefault(),chrome.runtime.sendMessage({type:"OPEN_SYNC_PAGE"})});return}o.innerHTML=a.platforms.map(s=>{const r=t.includes(s.id),i=a.results.find(f=>f.platform===s.id);let d="";return i&&(d=i.success?'<span class="status-icon success">✓</span>':'<span class="status-icon error">✗</span>'),`
        <div class="wechatsync-platform ${r?"selected":""}" data-id="${s.id}">
          <img src="${s.icon}" alt="${s.name}" onerror="this.style.display='none'">
          <span>${s.name}</span>
          ${d}
        </div>
      `}).join(""),o.querySelectorAll(".wechatsync-platform").forEach(s=>{s.addEventListener("click",()=>{s.classList.toggle("selected"),v()})}),v()}function v(){const t=o.querySelectorAll(".wechatsync-platform.selected");c.disabled=t.length===0,c.textContent=t.length>0?`同步到 ${t.length} 个平台`:"选择平台"}async function L(){var s;const t=w();if(!t){m("未能提取文章内容","error"),chrome.runtime.sendMessage({type:"TRACK_ARTICLE_EXTRACT",payload:{source:"weixin",success:!1}}).catch(()=>{});return}chrome.runtime.sendMessage({type:"TRACK_ARTICLE_EXTRACT",payload:{source:"weixin",success:!0,hasTitle:!!t.title,hasContent:!!t.content,hasCover:!!t.cover,contentLength:((s=t.content)==null?void 0:s.length)||0}}).catch(()=>{});const n=[];if(o.querySelectorAll(".wechatsync-platform.selected").forEach(r=>{n.push(r.getAttribute("data-id"))}),n.length===0){m("请选择要同步的平台","error");return}await chrome.storage.local.set({lastSelectedPlatforms:n}),a.status="syncing",a.results=[],e.classList.add("syncing"),e.classList.remove("success","error"),c.disabled=!0,c.textContent="同步中...";try{const r=await chrome.runtime.sendMessage({type:"SYNC_ARTICLE",payload:{article:t,platforms:n,source:"weixin"}});a.results=r.results||[];const i=a.results.filter(f=>f.success).length,d=a.results.filter(f=>!f.success).length;a.status=d===0?"success":"error",e.classList.remove("syncing"),e.classList.add(a.status),A(),d===0?m(`✓ 成功同步到 ${i} 个平台`,"success"):m(`${i} 成功，${d} 失败`,"error")}catch(r){a.status="error",e.classList.remove("syncing"),e.classList.add("error"),m("同步失败："+r.message,"error")}}function m(t,n){const s=document.getElementById("wechatsync-toast");s.textContent=t,s.className=`wechatsync-toast show ${n}`,setTimeout(()=>{s.classList.remove("show")},3e3)}function A(){if(a.results.length===0){p.style.display="none",o.style.display="block",u.textContent="选择同步平台";return}u.textContent="同步结果",o.style.display="none",p.style.display="block",p.innerHTML=a.results.map(t=>{const n=a.platforms.find(d=>d.id===t.platform),s=t.success?"success":"error",r=t.success?"✓ 已同步":"✗ 失败";let i="";return t.success&&t.postUrl?i=`<a href="${t.postUrl}" target="_blank">编辑草稿 →</a>`:t.success||(i=`<span class="status error">${t.error||"未知错误"}</span>`),`
        <div class="wechatsync-result-item ${s}">
          <img src="${(n==null?void 0:n.icon)||""}" alt="${(n==null?void 0:n.name)||t.platform}" onerror="this.style.display='none'">
          <span class="name">${(n==null?void 0:n.name)||t.platform}</span>
          <span class="status ${s}">${r}</span>
          ${i}
        </div>
      `}).join(""),c.textContent="继续同步其他平台",c.disabled=!1,c.onclick=()=>{a.results=[],p.style.display="none",o.style.display="block",u.textContent="选择同步平台",e.classList.remove("success","error"),x()}}}function w(){var o,p,u,b;const y=(p=(o=document.querySelector("#activity-name"))==null?void 0:o.textContent)==null?void 0:p.trim(),l=document.querySelector("#js_content"),e=(u=document.querySelector('meta[property="og:image"]'))==null?void 0:u.getAttribute("content"),c=(b=document.querySelector('meta[property="og:description"]'))==null?void 0:b.getAttribute("content");if(!y||!l)return null;const h=l.cloneNode(!0);return k(h),{title:y,html:h.innerHTML,content:h.innerHTML,summary:c||void 0,cover:e||void 0,source:{url:window.location.href,platform:"weixin"}}}function k(y){y.querySelectorAll("img").forEach(e=>{const c=e.getAttribute("data-src")||e.getAttribute("data-original")||e.getAttribute("data-actualsrc")||e.getAttribute("_src")||e.src;c&&!c.startsWith("data:image/svg")&&e.setAttribute("src",c),e.removeAttribute("data-src"),e.removeAttribute("data-original"),e.removeAttribute("data-actualsrc"),e.removeAttribute("_src"),e.removeAttribute("data-ratio"),e.removeAttribute("data-w"),e.removeAttribute("data-type"),e.removeAttribute("data-s")})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",g):g()})();
})()
