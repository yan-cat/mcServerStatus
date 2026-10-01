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

    try {
        const res = await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(addr)}`);
        const data = await res.json();

        if (data.online) {
            card.classList.remove("offline");
            dot.style.color = "#4caf50";
            players.innerHTML = `<b>${data.players.online}</b> / ${data.players.max} 人`;

            const list = data.players?.list || [];
            if (list.length) {
                const MAX = 6;
                const names = list.map(n => n.name || n);
                const shown = names.slice(0, MAX).join("、");
                const more = names.length > MAX ? ` +${names.length - MAX}` : "";
                playersList.textContent = `👥 ${shown}${more}`;
                playersList.style.display = "block";
                playersList.title = names.join("\n");
            } else {
                playersList.textContent = "";
                playersList.style.display = "none";
                playersList.removeAttribute("title");
            }

            if (data.icon) {
                icon.src = data.icon.startsWith("data:")
                ? data.icon
                : `data:image/png;base64,${data.icon}`;
            } else {
                icon.src = PLACEHOLDER_ICON;
            }
            icon.onerror = () => { icon.src = PLACEHOLDER_ICON; };

            if (data.motd?.html?.length) {
                motd.innerHTML = data.motd.html.join("<br>");
            } else if (data.motd?.clean?.length) {
                motd.textContent = data.motd.clean.join("\n");
            } else {
                motd.textContent = "（无 MOTD）";
            }

        } else {
            card.classList.add("offline");
            dot.style.color = "#f44336";
            players.innerHTML = `<b>离线</b>`;
            playersList.textContent = "";
            playersList.style.display = "none";
            icon.src = PLACEHOLDER_ICON;
            motd.textContent = "服务器离线";
        }
    } catch (e) {
        card.classList.add("offline");
        dot.style.color = "#999";
        players.innerHTML = `<b>查询失败</b>`;
        playersList.textContent = "";
        playersList.style.display = "none";
        icon.src = PLACEHOLDER_ICON;
        motd.textContent = "";
    }
}

loadServerList();
