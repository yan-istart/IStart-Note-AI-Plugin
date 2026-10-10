export type QuickActionId = "continue" | "polish" | "expand" | "explain" | "summarize";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  icon: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "continue", label: "续写", icon: "istart-continue" },
  { id: "polish", label: "润色", icon: "istart-polish" },
  { id: "expand", label: "扩写", icon: "istart-expand" },
  { id: "explain", label: "解释", icon: "istart-explain" },
  { id: "summarize", label: "总结", icon: "istart-summarize" },
];

export function availableQuickActions(hasSelection: boolean): QuickAction[] {
  const ids: QuickActionId[] = hasSelection ? ["polish", "expand", "explain"] : ["continue", "summarize"];
  return ids.map((id) => QUICK_ACTIONS.find((action) => action.id === id)!);
}
