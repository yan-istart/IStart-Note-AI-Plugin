import type { AgentTask } from "../../core/agent/types";
import { AGENT_TASKS } from "../../core/agent/AgentTasks";

/** One inline parameter form for every structured Agent task. */
export function renderAgentTaskForm(root: HTMLElement, task: AgentTask, update: (key: string, value: string | number | boolean) => void, cancel: () => void): void {
  const def = AGENT_TASKS[task.actionId];
  const heading = root.createDiv({ cls: "istart-agent-task-heading" });
  heading.createEl("strong", { text: def.label });
  const close = heading.createEl("button", { text: "取消任务", attr: { type: "button" } });
  close.addEventListener("click", cancel);
  root.createEl("p", { text: "填写本次任务参数，生成后可在同一会话中继续调整。", cls: "istart-agent-muted" });
  for (const field of def.fields) {
    const label = root.createEl("label", { cls: "istart-agent-task-field" });
    label.createSpan({ text: `${field.label}${field.required ? " *" : ""}` });
    const value = task.args[field.key];
    if (field.choices) {
      const select = label.createEl("select");
      for (const [key, text] of Object.entries(field.choices)) select.createEl("option", { value: key, text });
      select.value = String(value ?? Object.keys(field.choices)[0]);
      select.addEventListener("change", () => update(field.key, select.value));
    } else if (field.type === "boolean") {
      const input = label.createEl("input", { type: "checkbox" }); input.checked = value === true;
      input.addEventListener("change", () => update(field.key, input.checked));
    } else {
      const input = field.type === "multiline" ? label.createEl("textarea", { attr: { rows: "3" } })
        : label.createEl("input", { type: field.type === "number" ? "number" : "text" });
      input.value = String(value ?? "");
      input.required = field.required === true;
      if (field.type === "number") { input.setAttribute("min", String(field.min ?? 1)); input.setAttribute("max", String(field.max ?? 10000)); input.setAttribute("step", "1"); }
      input.addEventListener("input", () => update(field.key, field.type === "number" && input.value !== "" ? Number(input.value) : input.value));
    }
  }
}
