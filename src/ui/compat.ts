import { requireApiVersion } from "obsidian";
import type { ButtonComponent } from "obsidian";

/** Keep destructive styling on the minimum supported app without deprecated APIs. */
export function destructiveButton(button: ButtonComponent): ButtonComponent {
  if (requireApiVersion("1.13.0")) return button.setDestructive();
  return button.setClass("mod-warning");
}
