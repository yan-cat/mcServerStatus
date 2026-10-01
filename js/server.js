import { sanitizeMotd } from "./sanitize.js";

const LIST_URL = "../server-list.txt";

// 从 URL 读盐，参数名用 k
const params = new URLSearchParams(location.search);
const salt = params.get("k");

const PLACEHOLDER_ICON = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<rect width="64" height="64" fill="#2a2a2a"/>
<rect x="0" y="0" width="64" height="20" fill="#4caf50"/>
<rect x="0" y="20" width="64" height="8" fill="#3d8b40"/>
<rect x="0" y="28" width="64" height="36" fill="#5d4037"/>
<rect x="8" y="8" width="8" height="8" fill="#66bb6a"/>
<rect x="28" y="12" width="8" height="8" fill="#66bb6a"/>
<rect x="48" y="6" width="8" height="8" fill="#66bb6a"/>
<rect x="12" y="36" width="6" height="6" fill="#4e342e"/>
<rect x="40" y="44" width="6" height="6" fill="#4e342e"/>
</svg>`);

let servers = [];

function decode(str, key) {
    try {
        const b64 = atob(str.trim());
        let out = "";
        for (let i = 0; i < b64.length; i++) {
            out += String.fromCharCode(b64.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return out;
    } catch {
        return "";
    }
}

async function loadServerList() {
    const listEl = document.getElementById("mc-list");

    // 没有盐参数 → 什么都不显示
    if (!salt) {
        listEl.innerHTML = '<div class="mc-empty">请通过有效链接访问</div>';
        return;
    }

    try {
        const res = await fetch(LIST_URL);
        if (!res.ok) throw new Error("列表加载失败");
        const text = await res.text();

        servers = text
        .split("\n")
        .map(s => s.trim())
        .filter(s => s && !s.startsWith("#"))
        .map(s => decode(s, salt))
        .filter(Boolean);

        if (!servers.length) {
            listEl.innerHTML = '<div class="mc-empty">服务器列表为空或密钥错误</div>';
            return;
        }

        listEl.innerHTML = "";
        servers.forEach((addr, idx) => {
            const card = document.createElement("div");
            card.className = "mc-card";
            card.dataset.idx = idx;
            card.innerHTML = `
            <img class="mc-icon" alt="服务器图标" src="${PLACEHOLDER_ICON}">
            <div class="mc-info">
            <div class="mc-motd">查询中...</div>
            <div class="mc-line">
            <span class="mc-dot">●</span>
            <span class="mc-players"><b>--</b> / -- 人</span>
            </div>
            <div class="mc-players-list"></div>
            </div>
            <div class="mc-footer">
            <span class="mc-addr"></span>
            <button class="mc-copy" title="复制服务器地址">复制ip</button>
            </div>
            `;
            card.querySelector(".mc-addr").textContent = addr;
            listEl.appendChild(card);
        });

        listEl.querySelectorAll(".mc-copy").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                const idx = +btn.closest(".mc-card").dataset.idx;
                copyAddress(idx, btn);
            });
        });

        servers.forEach((addr, idx) => updateMCStatus(idx));
        setInterval(() => servers.forEach((addr, idx) => updateMCStatus(idx)), 60000);

    } catch (e) {
        listEl.innerHTML = '<div class="mc-empty">服务器列表加载失败</div>';
        console.error(e);
    }
}

async function copyAddress(idx, btn) {
    const addr = servers[idx];
    if (!addr) return;

    const showCopied = () => {
        const old = btn.textContent;
        btn.textContent = "已复制";
        btn.classList.add("copied");
        setTimeout(() => {
            btn.textContent = old;
            btn.classList.remove("copied");
        }, 1500);
    };

    try {
        await navigator.clipboard.writeText(addr);
        showCopied();
    } catch {
        const ta = document.createElement("textarea");
        ta.value = addr;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showCopied();
    }
}

// ---------- 状态查询：mcsrvstat.us 与 mcstatus.io 交叉验证 ----------
const API_TIMEOUT = 8000;

function fetchWithTimeout(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
}

function normalizeIcon(icon) {
    if (typeof icon !== "string" || !icon) return "";
    const src = icon.startsWith("data:") ? icon : `data:image/png;base64,${icon}`;
    // 只接受图片 data URI，其余一律不采用
    return /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(src) ? src : "";
}

// api.mcsrvstat.us/3/ 的响应
function parseMcsrvstat(d) {
    if (!d?.online) return null;
    return {
        playersOnline: d.players?.online ?? 0,
        playersMax: d.players?.max ?? 0,
        players: (d.players?.list || [])
        .map(n => (typeof n === "string" ? n : n?.name))
        .filter(Boolean),
        motdHtml: d.motd?.html?.length ? d.motd.html.join("<br>") : "",
        motdText: d.motd?.clean?.length ? d.motd.clean.join("\n") : "",
        icon: normalizeIcon(d.icon),
    };
}

// api.mcstatus.io/v2/status/java/ 的响应
function parseMcstatusIo(d) {
    if (!d?.online) return null;
    return {
        playersOnline: d.players?.online ?? 0,
        playersMax: d.players?.max ?? 0,
        players: (d.players?.list || [])
        .map(n => (typeof n === "string" ? n : (n?.name_clean || n?.name_raw)))
        .filter(Boolean),
        motdHtml: d.motd?.html || "",
        motdText: d.motd?.clean || "",
        icon: normalizeIcon(d.icon),
    };
}

async function fetchOne(url, parse) {
    const res = await fetchWithTimeout(url, API_TIMEOUT);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parse(await res.json());
}

// 两个 API 并行请求：任一返回在线就采用它；只有两个都请求失败才算「查询失败」
async function queryServer(addr) {
    const host = encodeURIComponent(addr);
    const settled = await Promise.allSettled([
        fetchOne(`https://api.mcsrvstat.us/3/${host}`, parseMcsrvstat),
        fetchOne(`https://api.mcstatus.io/v2/status/java/${host}`, parseMcstatusIo),
    ]);

    const responded = settled
    .filter(s => s.status === "fulfilled")
    .map(s => s.value);
    const online = responded.find(Boolean);

    if (online) return { online: true, data: online };
    if (!responded.length) return { online: false, failed: true };  // 两个 API 都没响应
    return { online: false, failed: false };                        // 有响应，但服务器离线
}

async function updateMCStatus(idx) {
    const card = document.querySelector(`.mc-card[data-idx="${idx}"]`);
    if (!card) return;

    const addr = servers[idx];
    if (!addr) return;

    const dot = card.querySelector(".mc-dot");
    const players = card.querySelector(".mc-players");
    const playersList = card.querySelector(".mc-players-list");
    const icon = card.querySelector(".mc-icon");
    const motd = card.querySelector(".mc-motd");

    const result = await queryServer(addr);

    if (result.online) {
        const d = result.data;

        card.classList.remove("offline");
        dot.style.color = "#4caf50";
        // 强制转成数字，杜绝 API 返回字符串时的注入面
        const online = Number(d.playersOnline) || 0;
        const max = Number(d.playersMax) || 0;
        players.innerHTML = `<b>${online}</b> / ${max} 人`;

        if (d.players.length) {
            const MAX = 6;
            const shown = d.players.slice(0, MAX).join("、");
            const more = d.players.length > MAX ? ` +${d.players.length - MAX}` : "";
            playersList.textContent = `👥 ${shown}${more}`;
            playersList.style.display = "block";
            playersList.title = d.players.join("\n");
        } else {
            playersList.textContent = "";
            playersList.style.display = "none";
            playersList.removeAttribute("title");
        }

        icon.src = d.icon || PLACEHOLDER_ICON;
        icon.onerror = () => { icon.src = PLACEHOLDER_ICON; };

        if (d.motdHtml) {
            motd.replaceChildren(sanitizeMotd(d.motdHtml));
        } else if (d.motdText) {
            motd.textContent = d.motdText;
        } else {
            motd.textContent = "（无 MOTD）";
        }
        return;
    }

    // 离线 或 查询失败
    card.classList.add("offline");
    playersList.textContent = "";
    playersList.style.display = "none";
    icon.src = PLACEHOLDER_ICON;

    if (result.failed) {
        dot.style.color = "#999";
        players.innerHTML = `<b>查询失败</b>`;
        motd.textContent = "";
    } else {
        dot.style.color = "#f44336";
        players.innerHTML = `<b>离线</b>`;
        motd.textContent = "服务器离线";
    }
}

loadServerList();
