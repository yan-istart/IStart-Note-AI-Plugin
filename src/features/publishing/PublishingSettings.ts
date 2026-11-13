import { Notice, Platform, Setting } from "obsidian";
import type DeepSeekPlugin from "../../main";

/** Reused by Settings and the workbench so first setup is available beside the article. */
export function renderPublishingConnection(root: HTMLElement, plugin: DeepSeekPlugin, changed?: () => void): void {
  const controller = plugin.publishing, device = controller.device, config = device.value;
  if (!Platform.isMobile) new Setting(root).setName("连接方式").addDropdown(dropdown => dropdown
    .addOption("remote", "连接已有服务").addOption("local", "本地安装并启动")
    .setValue(config.mode).onChange(value => { config.mode = value === "local" ? "local" : "remote"; controller.resetConnection(); changed?.(); }));
  if (config.mode === "remote" || Platform.isMobile) {
    new Setting(root).setName("远程服务地址").setDesc("填写 IStart 配套分发服务地址，例如 https://publish.example.com。")
      .addText(input => input.setPlaceholder("https://publish.example.com").setValue(config.url).onChange(value => { config.url = value.trim(); device.save(); controller.connection = null; controller.accounts = []; controller.selected.clear(); }));
    new Setting(root).setName("服务访问令牌").setDesc(device.hasPersistentSecrets ? "通过 Obsidian SecretStorage 保存。" : "当前 Obsidian 版本仅在本次会话保留令牌，重启后需重新填写。")
      .addText(input => { input.inputEl.type = "password"; input.setValue(device.token).onChange(value => { device.token = value.trim(); controller.connection = null; controller.accounts = []; controller.selected.clear(); }); });
  } else {
    new Setting(root).setName("Node.js 路径").setDesc("需要 Node.js 22 或更高版本。留空时自动检测常见安装位置。")
      .addText(input => input.setPlaceholder("node / node.exe 的完整路径").setValue(config.nodePath).onChange(value => { config.nodePath = value.trim(); device.save(); }));
    for (const [key, label] of [["port", "本地服务端口"], ["bridgePort", "浏览器扩展端口"]] as const) {
      new Setting(root).setName(label).setDesc("修改后重启本地服务，并更新浏览器扩展中的连接地址。")
        .addText(input => input.setValue(String(config[key])).onChange(value => {
          const port = Number(value);
          if (Number.isInteger(port) && port > 1024 && port < 65535) { config[key] = port; device.save(); controller.connection = null; }
        }));
    }
    new Setting(root).setName("本地服务").setDesc(controller.local.status)
      .addButton(button => button.setButtonText("安装并启动 / 测试连接").setDisabled(controller.busy).onClick(() => { void controller.action(() => controller.connect()).then(() => changed?.()); }))
      .addButton(button => button.setButtonText("重启").setDisabled(controller.busy).onClick(() => { void controller.action(async () => { await controller.local.restart(); await controller.connect(); }).then(() => changed?.()); }))
      .addButton(button => button.setButtonText("停止").setDisabled(controller.busy).onClick(() => { controller.local.stop(); controller.resetConnection(); }));
    new Setting(root).setName("安装 Node.js").setDesc("缺少 Node.js 时先安装官方 LTS 版本，然后重试。").addButton(button => button.setButtonText("打开安装页面").onClick(() => window.open("https://nodejs.org/en/download", "_blank", "noopener")));
    if (device.extensionToken) {
      root.createEl("p", { text: "在 Wechatsync 扩展设置中启用桥接，粘贴下列地址及 Token，再测试连接。浏览器中登录各目标平台。" });
      const copy = (label: string, value: string) => new Setting(root).setName(label).setDesc("仅配置到自己的浏览器扩展，连接信息不写入分发记录。")
        .addButton(button => button.setButtonText("复制").onClick(() => { void navigator.clipboard.writeText(value).then(() => new Notice("已复制"), () => new Notice("剪贴板不可用，请使用远程服务部署说明进行配置")); }));
      copy("扩展服务器地址", `ws://127.0.0.1:${config.bridgePort}/extension?key=${encodeURIComponent(device.extensionToken)}`);
      copy("扩展 Token", device.extensionToken);
    }
    if (!device.hasPersistentSecrets) root.createEl("p", { text: "此版本 Obsidian 仅在当前会话保留本地令牌，重启后需重新复制扩展连接信息。" });
  }
  if (config.mode === "remote" || Platform.isMobile) new Setting(root).setName("连接检测")
    .addButton(button => button.setButtonText("测试连接并刷新账号").setDisabled(controller.busy).onClick(() => { void controller.action(() => controller.connect()); }));
  root.createEl("p", { text: "配套服务需要连接运行中的浏览器扩展；服务地址、连接方式和凭证按设备保存。" });
}
