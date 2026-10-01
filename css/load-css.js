const cssFiles = [
'background.css',
'main.css',
'title-bar.css'
];

// 动态创建 <link> 标签并添加到 <head>
cssFiles.forEach(href => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `css/${href}`;
    document.head.appendChild(link);
});
