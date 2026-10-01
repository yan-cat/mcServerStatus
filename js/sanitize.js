// 把第三方 API 返回的 MOTD HTML 洗成只含白名单标签/样式的节点，防止注入。
// 设计原则：白名单放行 —— 不在名单里的一律不保留；属性默认全删，只给 SPAN 留受控的 style。
// 返回值是 DocumentFragment，可直接 replaceChildren() 进页面。

const KEEP_TAGS = new Set([
    "SPAN", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL"
]);

// 这些标签连内容一起丢掉（内容若只是文本，丢掉也不会执行任何东西，但更干净）
const DROP_TAGS = new Set([
    "SCRIPT", "STYLE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "APPLET",
    "LINK", "META", "BASE", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION",
    "SVG", "MATH", "TEMPLATE", "A", "IMG", "VIDEO", "AUDIO", "SOURCE", "TRACK", "CANVAS"
]);

const KEEP_STYLES = new Set([
    "color", "font-weight", "font-style", "text-decoration", "text-shadow"
]);

// 只保留白名单属性；值里出现 url()/expression/javascript: 等一律丢弃
function cleanStyle(value) {
    const out = [];
    for (const decl of String(value).split(";")) {
        const at = decl.indexOf(":");
        if (at < 0) continue;
        const prop = decl.slice(0, at).trim().toLowerCase();
        const val = decl.slice(at + 1).trim();
        if (!KEEP_STYLES.has(prop)) continue;
        if (/url\s*\(|expression|javascript:|@import|behavior/i.test(val)) continue;
        out.push(`${prop}: ${val}`);
    }
    return out.join("; ");
}

function scrub(node) {
    // 先快照，避免边遍历边改 childNodes
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) continue;

        if (child.nodeType !== Node.ELEMENT_NODE) {
            child.remove();                       // 注释、CDATA 之类一律丢弃
            continue;
        }
        if (DROP_TAGS.has(child.tagName)) {
            child.remove();
            continue;
        }
        if (!KEEP_TAGS.has(child.tagName)) {
            // 未知标签：只留它的文字，标签本身去掉
            child.replaceWith(document.createTextNode(child.textContent ?? ""));
            continue;
        }

        // 属性全删，只给 SPAN 放回清洗过的 style（on*、href、src 等一律不保留）
        const style = child.tagName === "SPAN"
            ? cleanStyle(child.getAttribute("style") || "")
            : "";
        for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
        if (style) child.setAttribute("style", style);

        scrub(child);
    }
}

export function sanitizeMotd(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html ?? "");
    scrub(tpl.content);
    return tpl.content;
}
