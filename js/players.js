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
                return { name: v.trim(), uuid: typeof n.uuid === "string" ? n.uuid : "" };
            }
        }
        return null;
    })
    .filter(Boolean);
}

export function normalizeUuid(uuid) {
    const hex = String(uuid || "").replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) return "";
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 优先用 uuid（玩家改名也不受影响），退而用合法用户名；都不合法就不发请求
export function avatarUrl(p) {
    const uuid = normalizeUuid(p.uuid);
    if (uuid) return `https://mc-heads.net/avatar/${uuid}/32`;
    if (/^[A-Za-z0-9_]{1,16}$/.test(p.name)) {
        return `https://mc-heads.net/avatar/${p.name}/32`;
    }
    return "";
}

// 主源失败时的备用源
function backupAvatarUrl(p) {
    const uuid = normalizeUuid(p.uuid);
    if (uuid) return `https://crafatar.com/avatars/${uuid}?size=32&overlay`;
    if (/^[A-Za-z0-9_]{1,16}$/.test(p.name)) {
        return `https://crafatar.com/avatars/${p.name}?size=32&overlay`;
    }
    return "";
}

export function makeAvatar(p) {
    const box = document.createElement("span");
    box.className = "mc-avatar mc-avatar-fallback";
    box.textContent = (p.name || "?").charAt(0).toUpperCase();

    const url = avatarUrl(p);
    if (!url) return box;

    const img = document.createElement("img");
    img.className = "mc-avatar";
    img.alt = "";
    img.decoding = "async";
    img.dataset.src = url;   // 折叠状态不加载，展开时才赋值（已由 data-src 控时机，无需 loading=lazy）
    img.addEventListener("error", () => {
        const backup = backupAvatarUrl(p);
        if (img.dataset.retry !== "1" && backup) {
            img.dataset.retry = "1";
            img.src = backup;
        } else if (img.isConnected) {
            img.replaceWith(box);
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
