import type { AppShortcut } from "@bb/domain";
import {
  browserPlatform,
  formatAppShortcut,
  formatAppShortcutAria,
} from "@/lib/app-keybindings";

const MODIFIER_SUBMIT_SHORTCUT: AppShortcut = {
  key: "Enter",
  mod: true,
  meta: false,
  control: false,
  alt: false,
  shift: false,
};

const SHIFT_MODIFIER_SUBMIT_SHORTCUT: AppShortcut = {
  ...MODIFIER_SUBMIT_SHORTCUT,
  shift: true,
};

export function isModifierSubmitKeyEvent(
  event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
  shift = false,
): boolean {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.shiftKey === shift
  );
}

export function modifierSubmitShortcutLabel(shift = false): string {
  return formatAppShortcut(
    shift ? SHIFT_MODIFIER_SUBMIT_SHORTCUT : MODIFIER_SUBMIT_SHORTCUT,
    browserPlatform(),
  );
}

export function modifierSubmitShortcutAria(shift = false): string {
  return formatAppShortcutAria(
    shift ? SHIFT_MODIFIER_SUBMIT_SHORTCUT : MODIFIER_SUBMIT_SHORTCUT,
    browserPlatform(),
  );
}
