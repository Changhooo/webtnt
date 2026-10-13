"""Validate the unpacked extension and package the dependency-free source project."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import zipfile
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--install-only", action="store_true", help="Put manifest.json directly at the ZIP root for installation.")
    args = parser.parse_args()
    manifest = json.loads((root / "extension/manifest.json").read_text(encoding="utf-8"))
    assert manifest["manifest_version"] == 3
    assert set(manifest["permissions"]) == {"activeTab", "scripting", "storage"}
    assert not manifest.get("host_permissions"), "Production build must not request persistent site access."
    assets = list(manifest["icons"].values()) + list(manifest["action"]["default_icon"].values())
    assets += [manifest["action"]["default_popup"], manifest["background"]["service_worker"]]
    assets += ["settings.js", "background-image.js", "engine.js", "content.js", "popup.js", "popup.css"]
    for group in manifest.get("web_accessible_resources", []):
        assets += group["resources"]
    for name in assets:
        assert (root / "extension" / name).is_file(), f"Missing extension resource: {name}"
    node = shutil.which("node")
    if node:
        for source in sorted((root / "extension").glob("*.js")):
            subprocess.run([node, "--check", str(source)], check=True)
    filename = f"TNT_Blast_v{manifest['version']}_install.zip" if args.install_only else f"TNT_Blast_Chrome_Edge_v{manifest['version']}.zip"
    output = (args.output or root.parent / filename).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        source_root = root / "extension" if args.install_only else root
        for source in sorted(source_root.rglob("*")):
            relative = source.relative_to(source_root)
            if not source.is_file() or source.is_symlink():
                continue
            if any(part in {"node_modules", ".git", "__pycache__", ".cache", "dist"} for part in relative.parts):
                continue
            if relative.parts[:2] == ("tests", "output") or source.suffix in {".pyc", ".log"}:
                continue
            if source == output:
                continue
            archive.write(source, relative if args.install_only else Path(f"tnt-blast-v{manifest['version']}") / relative)
            count += 1
        if args.install_only:
            archive.write(root / "LICENSE", "LICENSE")
            archive.writestr("安装说明.txt", f"TNT · 网页爆破 v{manifest['version']}\r\n\r\n完整解压本 ZIP。\r\n更新旧版：把本包文件覆盖到原插件安装目录，在扩展页面点击重新加载，并刷新使用中的网页。\r\nChrome 打开 chrome://extensions/，Edge 打开 edge://extensions/。\r\n开启开发者模式，点击加载已解压的扩展程序，选择解压后直接包含 manifest.json 的文件夹。\r\n打开普通网页，点击工具栏 TNT 图标，然后点击显示 TNT。\r\n只有右键拖动才移动固定图标，松开不引爆；单独右击打开菜单。\r\n左键拖动显示独立目标预览，松开后在精确鼠标落点点燃；固定图标在拖动、点燃、爆炸与复原期间都不移动。\r\n按 Esc 取消目标预览或立即复原。\r\n目标预览不带虚线矩形框。点击悬浮工具栏“文”、弹窗隐藏／显示图标下方文字按钮或设置复选框，可切换下方提示。默认显示，保存到本机并同步到已启用标签页，固定 TNT 与目标预览所有阶段一起生效；悬停说明和 ARIA 标签保留。\r\n工具栏弹窗可以选择本地背景图片；缺口大小默认65%，可单独调整。深色与图片缺口均呈现不规则凹角、断裂切口与局部裂纹。\r\n截图外缘裁边细片与原网页连接，外围投影和厚度随冲击减弱至零，避免拼成圆形阴影；中心轨迹和破碎缺口保持。\r\n碎片带缓存柔和阴影和厚度，复原时完全消退；截图与图片均在本机处理。\r\nWindows 桌面应用尚未实现，本包仅适用于 Chrome／Edge。\r\n")
            count += 2
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        if args.install_only:
            assert json.loads(archive.read("manifest.json"))["version"] == manifest["version"]
            assert all(name in archive.namelist() for name in assets)
    print(json.dumps({"file": str(output), "files": count, "bytes": output.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
