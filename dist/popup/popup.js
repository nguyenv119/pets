"use strict";(()=>{var r="pixel-pets-v1";async function c(e){await chrome.storage.local.set({[r]:e})}async function p(){try{let t=(await chrome.storage.local.get(r))[r];return Array.isArray(t)?t:[]}catch{return[]}}var g={chicken:["brown","white"],crab:["red"],dog:["akita","black","brown","red","white"],fox:["red","white"],monkey:["gray"],panda:["black","brown"],snail:["brown"],totoro:["gray"],turtle:["green","orange"]};var l=document.getElementById("pets-list"),u=document.getElementById("pet-name"),d=document.getElementById("pet-type"),y=document.getElementById("pet-color"),h=document.getElementById("btn-add"),E=document.getElementById("btn-throw-ball"),o=document.getElementById("btn-toggle"),n=[],a=!0;function m(){if(n.length===0){l.innerHTML=`
      <div class="empty-state">
        <img src="${chrome.runtime.getURL("assets/dog/brown_walk_8fps.gif")}" class="empty-pet" alt="" />
        <p class="empty-title">It's quiet here...</p>
        <p class="empty-cta">Adopt your first friend below!</p>
      </div>
    `;return}l.innerHTML=n.map(e=>`
    <div class="pet-item" data-id="${e.id}">
      <div class="pet-info">
        <img src="${chrome.runtime.getURL(`assets/${e.type}/${e.color}_idle_8fps.gif`)}" alt="${e.name}" />
        <div>
          <div class="pet-name">${e.name}</div>
          <div class="pet-meta">${e.color} ${e.type}</div>
        </div>
      </div>
      <button class="btn-remove" title="Remove ${e.name}">&times;</button>
    </div>
  `).join(""),l.querySelectorAll(".btn-remove").forEach(e=>{e.addEventListener("click",t=>{let i=t.target.closest(".pet-item").dataset.id;L(i)})})}function v(){let e=d.value,t=g[e]??[];y.innerHTML=t.map(s=>`<option value="${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join("")}async function P(){let e=u.value.trim()||"Pet",t=d.value,s=y.value;if(!s)return;let i={id:crypto.randomUUID(),name:e,type:t,color:s,x:Math.random()*800,y:0};n.push(i),await c(n),m();let f={type:"ADD_PET",pet:i};chrome.runtime.sendMessage(f),u.value=""}async function L(e){n=n.filter(s=>s.id!==e),await c(n),m();let t={type:"REMOVE_PET",id:e};chrome.runtime.sendMessage(t)}function b(){let e={type:"THROW_BALL"};chrome.runtime.sendMessage(e)}function w(){a=!a;let e={type:"TOGGLE_VISIBILITY",visible:a};chrome.runtime.sendMessage(e),a?(o.classList.remove("hidden-state"),o.title="Hide pets"):(o.classList.add("hidden-state"),o.title="Show pets")}d.addEventListener("change",v);h.addEventListener("click",P);E.addEventListener("click",b);o.addEventListener("click",w);async function T(){v(),(await chrome.storage.local.get("pixel-pets-visible"))["pixel-pets-visible"]===!1&&(a=!1,o.classList.add("hidden-state"),o.title="Show pets"),n=await p(),m()}T();})();
