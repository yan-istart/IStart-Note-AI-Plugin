import { Platform, Setting } from "obsidian";
import type DeepSeekPlugin from "../../main";

/** Reused by Settings and the workbench so first setup is available beside the article. */
export function renderPublishingConnection(root: HTMLElement, plugin: DeepSeekPlugin, changed?: () => void): void {
  const controller = plugin.publishing, device = controller.device, config = device.value;
  if (!Platform.isMobile) new Setting(root).setName("连接方式").addDropdown(dropdown => dropdown
    .addOption("remote", "连接已有服务").addOption("local", "连接本机服务")
    .setValue(config.mode).onChange(value => { config.mode = value === "local" ? "local" : "remote"; controller.resetConnection(); changed?.(); }));
  if (config.mode === "remote" || Platform.isMobile) {
    new Setting(root).setName("分发服务地址").setDesc("填写已部署的服务地址，例如 https://publish.example.com；本机服务可使用 http://127.0.0.1:27123。")
      .addText(input => input.setPlaceholder("https://publish.example.com").setValue(config.url).onChange(value => { config.url = value.trim(); controller.resetConnection(false); }));
  } else {
    new Setting(root).setName("本机服务端口").setDesc("先按部署说明独立启动本机服务，再填写其 HTTP 端口，默认 27123。")
      .addText(input => input.setValue(String(config.port)).onChange(value => {
        const port = Number(value);
        if (Number.isInteger(port) && port > 1024 && port < 65535) { config.port = port; controller.resetConnection(false); }
      }));
  }
  new Setting(root).setName("服务访问令牌").setDesc(device.hasPersistentSecrets ? "填写部署服务时设置的访问令牌，通过 Obsidian SecretStorage 保存。" : "填写部署服务时设置的访问令牌。当前 Obsidian 版本仅在本次会话保留，重启后需重新填写。")
    .addText(input => { input.inputEl.type = "password"; input.setValue(device.token).onChange(value => { device.token = value.trim(); controller.resetConnection(false); }); });
  new Setting(root).setName("连接检测")
    .addButton(button => button.setButtonText("测试连接并刷新账号").setDisabled(controller.busy).onClick(() => { void controller.action(() => controller.connect()); }));
  new Setting(root).setName("部署说明").setDesc("配套服务和浏览器扩展由你独立安装、启动与更新；插件连接已运行的服务。")
    .addButton(button => button.setButtonText("打开部署说明").onClick(() => window.open("https://github.com/yan-istart/IStart-Note-AI-Plugin/blob/main/docs/publishing.md", "_blank", "noopener")));
  root.createEl("p", { text: "配套服务需要连接运行中的浏览器扩展；服务地址、连接方式和凭证按设备保存。" });
}
