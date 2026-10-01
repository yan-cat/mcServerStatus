import { sanitizeMotd } from "./sanitize.js";
import { bindPlayersToggle, mergePlayers, normalizePlayers, renderPlayers } from "./players.js";

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
        // 列表会随换盐更新，禁掉缓存，避免访客拿到旧密文
        const res = await fetch(LIST_URL, { cache: "no-store" });
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
            <button class="mc-toggle" type="button" aria-expanded="false" hidden>玩家列表</button>
            </div>
            <div class="mc-players-panel" hidden></div>
            </div>
            <div class="mc-footer">
            <span class="mc-addr"></span>
            <button class="mc-copy" title="复制服务器地址">复制ip</button>
            </div>
            `;
            card.querySelector(".mc-addr").textContent = addr;
            bindPlayersToggle(card);
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

// ---------- 状态查询：mcsrvstat / mcstatus.io / minetools 三源交叉验证 ----------
const API_TIMEOUT = 8000;        // 常规超时
const API_TIMEOUT_FAST = 3000;   // mcstatus.io 在部分网络会被阻断，别让它拖满 8 秒

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

// 把 "host:port" 拆开（minetools 要求分开传）；没写端口时按 25565
function splitAddr(addr) {
    const s = String(addr).trim();
    const v6 = s.match(/^\[(.+)\]:(\d+)$/);
    if (v6) return { host: v6[1], port: v6[2] };
    const i = s.lastIndexOf(":");
    if (i > 0 && /^\d+$/.test(s.slice(i + 1))) {
        return { host: s.slice(0, i), port: s.slice(i + 1) };
    }
    return { host: s, port: "25565" };
}

// minetools 的 description 是带 § 颜色代码的纯文本：剥掉代码、保留文字
function stripSection(text) {
    return String(text ?? "").replace(/§[0-9a-fk-orx]/gi, "");
}

// api.mcsrvstat.us/3/ 的响应
function parseMcsrvstat(d) {
    if (!d?.online) return null;
    return {
        playersOnline: d.players?.online ?? 0,
        playersMax: d.players?.max ?? 0,
        players: normalizePlayers(d.players?.list, "name"),
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
        players: normalizePlayers(d.players?.list, "name_clean", "name_raw"),
        motdHtml: d.motd?.html || "",
        motdText: d.motd?.clean || "",
        icon: normalizeIcon(d.icon),
    };
}

// api.minetools.eu/ping/<host>/<port> 的响应
// 注意：服务器离线或域名解析失败时 HTTP 仍返回 200，只能靠 error 字段判断
function parseMinetools(d) {
    if (!d || typeof d !== "object" || d.error) return null;
    const p = d.players;
    if (!p || typeof p !== "object") return null;
    return {
        playersOnline: Number(p.online) || 0,
        playersMax: Number(p.max) || 0,
        players: normalizePlayers(p.sample, "name"),
        motdHtml: "",                                  // minetools 只给纯文本 MOTD
        motdText: stripSection(d.description),
        icon: normalizeIcon(d.favicon),
    };
}

async function fetchOne(url, parse, timeout = API_TIMEOUT) {
    const res = await fetchWithTimeout(url, timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parse(await res.json());
}

// 三个 API 并行请求：任一返回在线就采用它；全都请求失败才算「查询失败」
async function queryServer(addr) {
    const host = encodeURIComponent(addr);
    const { host: rawHost, port } = splitAddr(addr);
    const settled = await Promise.allSettled([
        fetchOne(`https://api.mcsrvstat.us/3/${host}`, parseMcsrvstat, API_TIMEOUT),
        fetchOne(`https://api.mcstatus.io/v2/status/java/${host}`, parseMcstatusIo, API_TIMEOUT_FAST),
        fetchOne(`https://api.minetools.eu/ping/${encodeURIComponent(rawHost)}/${encodeURIComponent(port)}`, parseMinetools, API_TIMEOUT),
    ]);

    const responded = settled
    .filter(s => s.status === "fulfilled")
    .map(s => s.value);
    const onlineResults = responded.filter(Boolean);

    if (!onlineResults.length) {
        if (!responded.length) return { online: false, failed: true };  // 三个 API 都没响应
        return { online: false, failed: false };                        // 有响应，但服务器离线
    }

    // 人数等字段以第一个在线结果为准；玩家列表则合并所有来源并按名字去重
    // —— 有的 API 会把匿名玩家（uuid 全零）过滤掉，只取单一来源会漏人
    const [primary, ...others] = onlineResults;
    return {
        online: true,
        data: {
            ...primary,
            players: mergePlayers(primary.players, ...others.map(r => r.players)),
        },
    };
}

async function updateMCStatus(idx) {
    const card = document.querySelector(`.mc-card[data-idx="${idx}"]`);
    if (!card) return;

    const addr = servers[idx];
    if (!addr) return;

    const dot = card.querySelector(".mc-dot");
    const players = card.querySelector(".mc-players");
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

        renderPlayers(card, d.players);

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
    renderPlayers(card, []);
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
