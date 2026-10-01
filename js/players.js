// 玩家列表：数据归一化、头像、可展开面板。
// 独立成模块，是为了能脱离 server.js 单独构造数据做测试。

// 两个 API 的玩家结构不同，统一成 {name, uuid}
export function normalizePlayers(list, ...nameKeys) {
    return (Array.isArray(list) ? list : [])
    .map(n => {
        if (typeof n === "string") {
            const name = n.trim();
            return name ? { name, uuid: "" } : null;
        }
        if (!n || typeof n !== "object") return null;
        for (const k of nameKeys) {
            const v = n[k];
            if (typeof v === "string" && v.trim()) {
                // mcsrvstat / mcstatus.io 用 uuid，minetools 用 id
                const uuid = [n.uuid, n.id].find(x => typeof x === "string") || "";
                return { name: v.trim(), uuid };
            }
        }
        return null;
    })
    .filter(Boolean);
}

// 合并多个来源的玩家列表，按名字去重（保留先出现的顺序）。
// 有的 API 会过滤掉匿名玩家（uuid 全零），只取单一来源会漏人。
export function mergePlayers(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        for (const p of list || []) {
            const key = String(p?.name || "").toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(p);
        }
    }
    return out;
}

export function normalizeUuid(uuid) {
    const hex = String(uuid || "").replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) return "";
    if (/^0+$/.test(hex)) return "";   // 全零是匿名玩家的占位 uuid，不是真账号
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 头像源：按顺序尝试，前一个失败就换下一个（不同网络下能用的源不一样）
const AVATAR_SOURCES = [
    id => `https://minotar.net/avatar/${id}/32`,
    id => `https://crafatar.com/avatars/${id}?size=32&overlay`,
    id => `https://mc-heads.net/avatar/${id}/32`,
];

// 头像查询用的 id：直接用用户名。
// 服务器返回的 uuid 往往是离线模式按名字生成的（并不是 Mojang uuid），
// 拿它去查皮肤会查不到；用名字反而准（前提是玩家用正版名）。
function avatarId(p) {
    if (/^[A-Za-z0-9_]{1,16}$/.test(p.name)) return p.name;
    return normalizeUuid(p.uuid);
}

export function avatarUrl(p, index = 0) {
    const id = avatarId(p);
    const source = AVATAR_SOURCES[index];
    return id && source ? source(id) : "";
}

export function makeAvatar(p) {
    const box = document.createElement("span");
    box.className = "mc-avatar mc-avatar-fallback";
    box.textContent = (p.name || "?").charAt(0).toUpperCase();

    if (!avatarId(p)) return box;

    const img = document.createElement("img");
    img.className = "mc-avatar";
    img.alt = "";
    img.decoding = "async";
    let sourceIndex = 0;
    img.dataset.src = avatarUrl(p, sourceIndex);   // 折叠状态不加载，展开时才赋值
    img.addEventListener("error", () => {
        sourceIndex += 1;
        if (sourceIndex < AVATAR_SOURCES.length) {
            img.src = avatarUrl(p, sourceIndex);   // 换下一个头像源
        } else if (img.isConnected) {
            img.replaceWith(box);                  // 全挂才退回首字母
        }
    });
    return img;
}

export function makePlayerRow(p) {
    const row = document.createElement("div");
    row.className = "mc-player";
    row.title = p.name;

    const name = document.createElement("span");
    name.className = "mc-player-name";
    name.textContent = p.name;   // 始终走 textContent，绝不拼 HTML

    row.append(makeAvatar(p), name);
    return row;
}

// 折叠时不发任何头像请求：只有展开那一刻才把 data-src 变成 src
export function loadAvatars(panel) {
    panel.querySelectorAll("img[data-src]").forEach(img => {
        if (!img.getAttribute("src")) img.src = img.dataset.src;
    });
}

export function bindPlayersToggle(card) {
    card.querySelector(".mc-toggle").addEventListener("click", () => {
        const toggle = card.querySelector(".mc-toggle");
        const panel = card.querySelector(".mc-players-panel");
        const opening = panel.hidden;
        panel.hidden = !opening;
        toggle.setAttribute("aria-expanded", String(opening));
        if (opening) loadAvatars(panel);
    });
}

export function renderPlayers(card, list) {
    const toggle = card.querySelector(".mc-toggle");
    const panel = card.querySelector(".mc-players-panel");

    if (!list.length) {
        toggle.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        panel.hidden = true;
        panel.replaceChildren();
        return;
    }

    toggle.hidden = false;
    toggle.textContent = `玩家列表 (${list.length})`;
    panel.replaceChildren(...list.map(makePlayerRow));
    // 轮询会重建面板内容，若此时面板仍展开着，头像得补回来
    if (!panel.hidden) loadAvatars(panel);
}
